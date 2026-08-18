#!/usr/bin/env node
/**
 * Fit bbox_px to screenshot PNG pixels (Cursor 内嵌浏览器截图常为设备像素).
 *   node write_capture.mjs path/to/capture.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function scaleBox(box, sx, sy) {
  const [x, y, w, h] = box.map(Number);
  return [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)];
}

const file = resolve(process.argv[2] || "");
if (!file || !existsSync(file)) {
  console.error("usage: node write_capture.mjs path/to/capture.json");
  process.exit(1);
}

const dir = dirname(file);
const data = JSON.parse(readFileSync(file, "utf8"));
let changed = 0;
for (const state of data.states || []) {
  const src = state.src && join(dir, state.src);
  if (!src || !existsSync(src)) continue;
  const png = pngSize(src);
  if (!png) continue;
  const cssW = (state.imageSize && state.imageSize.width) || 0;
  const cssH = (state.imageSize && state.imageSize.height) || 0;
  if (cssW && png.width !== cssW) {
    const sx = png.width / cssW;
    const sy = png.height / (cssH || png.height);
    for (const it of state.items || []) {
      if (Array.isArray(it.bbox_px) && it.bbox_px.length === 4) {
        it.bbox_px = scaleBox(it.bbox_px, sx, sy);
      }
    }
    changed += 1;
  }
  state.imageSize = png;
}
writeFileSync(file, JSON.stringify(data, null, 2));
console.log(JSON.stringify({ file, states: (data.states || []).length, scaled: changed }, null, 2));
