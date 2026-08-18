#!/usr/bin/env node
/**
 * Build a self-contained copy-review HTML with screenshots embedded as data URIs.
 *
 * Why: relative paths like "default.png" break when the HTML is opened from another
 * directory, shared alone, or previewed in environments that block local file images.
 *
 * Usage:
 *   node build_report.mjs --data report-data.json --out copy-review.html [--capture capture.json]
 *   node build_report.mjs --embed path/to/copy-review.html [--assets DIR] [--refresh-template]
 *   node build_report.mjs --data - --out copy-review.html < report-data.json
 *
 * Page-link reports should pass --capture. The builder then binds screenshot files,
 * coordinate systems and item provenance to that exact capture batch.
 * Missing images, wrong aspect ratios and cross-batch item mappings cause exit 1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, "..", "report-template.html");
const MARK_OPEN = '<script type="application/json" id="report-data">';
const MARK_CLOSE = "</script>";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function parseArgs(argv) {
  const out = {
    data: "",
    out: "",
    assets: "",
    capture: "",
    embed: "",
    template: TEMPLATE,
    refreshTemplate: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--data") out.data = next, i++;
    else if (a === "--out") out.out = next, i++;
    else if (a === "--assets") out.assets = next, i++;
    else if (a === "--capture") out.capture = next, i++;
    else if (a === "--embed") out.embed = next, i++;
    else if (a === "--template") out.template = next, i++;
    else if (a === "--refresh-template") out.refreshTemplate = true;
  }
  if (!out.embed && (!out.data || !out.out)) {
    console.error([
      "usage:",
      "  node build_report.mjs --data report-data.json --out copy-review.html [--capture capture.json]",
      "  node build_report.mjs --embed path/to/copy-review.html [--assets DIR] [--refresh-template]",
    ].join("\n"));
    process.exit(1);
  }
  return out;
}

function extractReportData(html) {
  const start = html.indexOf(MARK_OPEN);
  if (start < 0) throw new Error("HTML 缺少 #report-data");
  const jsonStart = start + MARK_OPEN.length;
  const end = html.indexOf(MARK_CLOSE, jsonStart);
  if (end < 0) throw new Error("HTML #report-data 未闭合");
  return {
    data: JSON.parse(html.slice(jsonStart, end)),
    before: html.slice(0, jsonStart),
    after: html.slice(end),
  };
}

function injectReportData(templateHtml, data) {
  const start = templateHtml.indexOf(MARK_OPEN);
  if (start < 0) throw new Error("模板缺少 #report-data");
  const jsonStart = start + MARK_OPEN.length;
  const end = templateHtml.indexOf(MARK_CLOSE, jsonStart);
  if (end < 0) throw new Error("模板 #report-data 未闭合");
  const json = JSON.stringify(data, null, 2);
  return templateHtml.slice(0, jsonStart) + "\n  " + json.replace(/\n/g, "\n  ") + "\n  " + templateHtml.slice(end);
}

function candidatePaths(src, searchDirs) {
  if (!src || String(src).startsWith("data:")) return [];
  if (isAbsolute(src)) return [src];
  const cleaned = String(src).replace(/^\.\//, "");
  return searchDirs.map((d) => join(d, cleaned));
}

function imageSize(buf, ext = "") {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && (buf.subarray(0, 6).toString("ascii") === "GIF87a"
    || buf.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p += 1; continue; }
      const marker = buf[p + 1];
      if (marker === 0xd8 || marker === 0xd9) { p += 2; continue; }
      const len = buf.readUInt16BE(p + 2);
      if (len < 2 || p + len + 2 > buf.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buf.readUInt16BE(p + 7), height: buf.readUInt16BE(p + 5) };
      }
      p += len + 2;
    }
  }
  if (buf.length >= 30 && buf.subarray(0, 4).toString("ascii") === "RIFF"
    && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    const type = buf.subarray(12, 16).toString("ascii");
    if (type === "VP8X") {
      const width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
      const height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
      return { width, height };
    }
  }
  throw new Error(`无法读取图片尺寸（${ext || "未知格式"}）`);
}

function dataUriBuffer(src) {
  const m = String(src).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  return {
    mime: m[1] || "application/octet-stream",
    buf: m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3])),
  };
}

function resolveImage(src, searchDirs, label) {
  if (!src) throw new Error(`${label} 缺少 src`);
  const inline = dataUriBuffer(src);
  if (inline) {
    return {
      uri: src,
      size: imageSize(inline.buf, inline.mime),
      source: "data URI",
    };
  }

  const tries = candidatePaths(src, searchDirs);
  const found = tries.filter(existsSync).map((path) => {
    const buf = readFileSync(path);
    return {
      path,
      buf,
      digest: createHash("sha256").update(buf).digest("hex"),
    };
  });
  if (!found.length) {
    throw new Error(
      `找不到截图文件「${src}」（${label}）。已试：\n  - ${tries.join("\n  - ") || "(无路径)"}`
    );
  }
  if (new Set(found.map((f) => f.digest)).size > 1) {
    throw new Error(
      `${label} 的同名截图在多个目录内容不同，拒绝猜测批次：\n  - ${found.map((f) => f.path).join("\n  - ")}`
    );
  }
  const picked = found[0];
  const ext = extname(picked.path).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const uri = `data:${mime};base64,${picked.buf.toString("base64")}`;
  return {
    uri,
    size: imageSize(picked.buf, ext),
    source: picked.path,
  };
}

function validateAspect(label, coordinateSize, pixelSize) {
  const cw = Number(coordinateSize && coordinateSize.width);
  const ch = Number(coordinateSize && coordinateSize.height);
  if (!(cw > 0 && ch > 0)) {
    return { ...pixelSize };
  }
  const sx = pixelSize.width / cw;
  const sy = pixelSize.height / ch;
  const drift = Math.abs(sx / sy - 1);
  if (drift > 0.01) {
    throw new Error(
      `${label} 尺寸与标注坐标系比例不一致：坐标 ${cw}×${ch}，图片 ${pixelSize.width}×${pixelSize.height}。`
      + " 这通常表示嵌入了其他批次或裁切范围不同的截图。"
    );
  }
  return { width: cw, height: ch };
}

function validateBoxes(data) {
  const shots = (data.screenshots && data.screenshots.length)
    ? data.screenshots
    : [{ id: "default", imageSize: data.imageSize || {} }];
  const shotMap = new Map(shots.map((sh) => [String(sh.id || "default"), sh]));
  const multiple = shots.length > 1;
  for (const item of data.items || []) {
    if (multiple && !item.screenshotId) {
      throw new Error(`条目 ${item.id ?? "?"} 缺少 screenshotId，多状态报告无法确定应标在哪张图`);
    }
    const id = String(item.screenshotId || shots[0].id || "default");
    const shot = shotMap.get(id);
    if (!shot) throw new Error(`条目 ${item.id ?? "?"} 指向不存在的截图状态「${id}」`);
    if (!Array.isArray(item.bbox_px) || item.bbox_px.length !== 4) continue;
    const [x, y, w, h] = item.bbox_px.map(Number);
    const sw = Number(shot.imageSize && shot.imageSize.width);
    const sh = Number(shot.imageSize && shot.imageSize.height);
    if (![x, y, w, h].every(Number.isFinite) || !(w > 0 && h > 0)) {
      throw new Error(`条目 ${item.id ?? "?"} 的 bbox_px 无效：${JSON.stringify(item.bbox_px)}`);
    }
    if (sw > 0 && sh > 0 && (x < 0 || y < 0 || x + w > sw || y + h > sh)) {
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const right = Math.min(sw, x + w);
      const bottom = Math.min(sh, y + h);
      if (left >= sw || top >= sh || right <= left || bottom <= top) {
        throw new Error(
          `条目 ${item.id ?? "?"} 的 bbox_px 完全落在状态「${id}」坐标系外：${JSON.stringify(item.bbox_px)}`
        );
      }
      item.bbox_px = [left, top, right - left, bottom - top];
      console.error(
        `clamped 条目 ${item.id ?? "?"} bbox 到状态「${id}」可见区域：${JSON.stringify(item.bbox_px)}`
      );
    }
  }
}

function embedImages(data, searchDirs) {
  const next = structuredClone(data);
  if (Array.isArray(next.screenshots) && next.screenshots.length) {
    next.screenshotSrc = "";
    next.screenshots = next.screenshots.map((sh, i) => {
      if (!sh || !sh.src) throw new Error(`screenshots[${i}] 缺少 src`);
      const image = resolveImage(sh.src, searchDirs, `screenshots[${i}].src (${sh.id || i})`);
      const coordinateSize = validateAspect(
        `截图状态「${sh.id || i}」`,
        sh.imageSize,
        image.size
      );
      console.error(
        `embedded screenshots[${i}] (${sh.id || i}): ${image.source}; `
        + `坐标 ${coordinateSize.width}×${coordinateSize.height} → 图片 ${image.size.width}×${image.size.height}`
      );
      return { ...sh, imageSize: coordinateSize, pixelSize: image.size, src: image.uri };
    });
  } else if (next.screenshotSrc) {
    const image = resolveImage(next.screenshotSrc, searchDirs, "screenshotSrc");
    next.imageSize = validateAspect("单图", next.imageSize, image.size);
    next.pixelSize = image.size;
    next.screenshotSrc = image.uri;
    console.error(
      `embedded screenshotSrc: ${image.source}; `
      + `坐标 ${next.imageSize.width}×${next.imageSize.height} → 图片 ${image.size.width}×${image.size.height}`
    );
  } else {
    throw new Error("报告未声明 screenshotSrc / screenshots[].src，无法内嵌截图");
  }
  validateBoxes(next);
  return next;
}

function normText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function sameBox(a, b, tolerance = 1) {
  return Array.isArray(a) && a.length === 4 && Array.isArray(b) && b.length === 4
    && a.every((v, i) => Math.abs(Number(v) - Number(b[i])) <= tolerance);
}

function visibleBox(box, size) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [x, y, w, h] = box.map(Number);
  const sw = Number(size && size.width);
  const sh = Number(size && size.height);
  if (!(sw > 0 && sh > 0)) return [x, y, w, h];
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(sw, x + w);
  const bottom = Math.min(sh, y + h);
  if (right <= left || bottom <= top) return null;
  return [left, top, right - left, bottom - top];
}

function bindCapture(data, capturePath) {
  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  const states = Array.isArray(capture.states) ? capture.states : [];
  if (!states.length) throw new Error("capture.json 没有 states");
  const stateMap = new Map(states.map((state) => [String(state.id || "default"), state]));
  const next = structuredClone(data);
  const reportShots = (next.screenshots && next.screenshots.length)
    ? next.screenshots
    : [{
        id: states[0].id || "default",
        label: states[0].label || "截图",
        src: next.screenshotSrc,
        imageSize: next.imageSize,
      }];

  next.screenshots = reportShots.map((shot) => {
    const id = String(shot.id || "default");
    const state = stateMap.get(id);
    if (!state) {
      throw new Error(`报告截图状态「${id}」不在本批 capture.json 中`);
    }
    if (!state.src) throw new Error(`capture 状态「${id}」缺少 src`);
    return {
      ...shot,
      id,
      label: shot.label || state.label || id,
      src: state.src,
      imageSize: state.imageSize,
    };
  });
  next.screenshotSrc = "";
  next.imageSize = {};
  next.pageUrl = capture.pageUrl || capture.requestedUrl || next.pageUrl || "";

  const defaultId = String(next.screenshots[0].id || "default");
  const multiple = next.screenshots.length > 1;
  for (const item of next.items || []) {
    if (multiple && !item.screenshotId) {
      throw new Error(`条目 ${item.id ?? "?"} 缺少 screenshotId，不能映射到 capture 状态`);
    }
    const id = String(item.screenshotId || defaultId);
    const state = stateMap.get(id);
    if (!state) throw new Error(`条目 ${item.id ?? "?"} 指向 capture 中不存在的状态「${id}」`);
    const matched = (state.items || []).some((source) =>
      normText(source.original) === normText(item.original)
      && (
        sameBox(source.bbox_px, item.bbox_px)
        || sameBox(visibleBox(source.bbox_px, state.imageSize), item.bbox_px)
      )
    );
    if (!matched) {
      throw new Error(
        `条目 ${item.id ?? "?"}「${normText(item.original)}」的文案/bbox 不属于本批 capture 状态「${id}」。`
        + " 禁止把旧报告条目或其他截图的标注拼入当前报告。"
      );
    }
  }
  return next;
}

function uniqDirs(dirs) {
  const seen = new Set();
  const out = [];
  for (const d of dirs) {
    if (!d) continue;
    const abs = resolve(d);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const capturePath = args.capture ? resolve(args.capture) : "";
  if (capturePath && !existsSync(capturePath)) {
    console.error("找不到 capture.json: " + capturePath);
    process.exit(1);
  }

  if (args.embed) {
    const htmlPath = resolve(args.embed);
    if (!existsSync(htmlPath)) {
      console.error("文件不存在: " + htmlPath);
      process.exit(1);
    }
    const html = readFileSync(htmlPath, "utf8");
    const { data, before, after } = extractReportData(html);
    const bound = capturePath ? bindCapture(data, capturePath) : data;
    const searchDirs = capturePath
      ? [dirname(capturePath)]
      : uniqDirs([args.assets, dirname(htmlPath)]);
    const embedded = embedImages(bound, searchDirs);
    const json = JSON.stringify(embedded, null, 2);
    const outHtml = args.refreshTemplate
      ? injectReportData(readFileSync(args.template, "utf8"), embedded)
      : before + "\n  " + json.replace(/\n/g, "\n  ") + "\n  " + after;
    const outPath = args.out ? resolve(args.out) : htmlPath;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, outHtml);
    console.log(JSON.stringify({ ok: true, mode: "embed", out: outPath, bytes: outHtml.length }, null, 2));
    return;
  }

  const dataPath = args.data === "-" ? null : resolve(args.data);
  const raw = args.data === "-"
    ? readFileSync(0, "utf8")
    : readFileSync(dataPath, "utf8");
  const rawData = JSON.parse(raw);
  const data = capturePath ? bindCapture(rawData, capturePath) : rawData;
  const outPath = resolve(args.out);
  const searchDirs = capturePath
    ? [dirname(capturePath)]
    : uniqDirs([args.assets, dataPath ? dirname(dataPath) : "", dirname(outPath)]);
  const embedded = embedImages(data, searchDirs);
  if (!existsSync(args.template)) {
    console.error("找不到模板: " + args.template);
    process.exit(1);
  }
  const template = readFileSync(args.template, "utf8");
  const outHtml = injectReportData(template, embedded);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, outHtml);
  console.log(JSON.stringify({
    ok: true,
    mode: "build",
    out: outPath,
    bytes: outHtml.length,
    shots: (embedded.screenshots && embedded.screenshots.length)
      || (embedded.screenshotSrc ? 1 : 0),
  }, null, 2));
}

main();
