#!/usr/bin/env node
/**
 * Smoke tests for build_report.mjs (embed screenshots as data URI).
 *   node scripts/test_build_report.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const build = join(__dirname, "build_report.mjs");
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) console.log("ok - " + name);
  else {
    failed += 1;
    console.error("FAIL - " + name + (detail ? ": " + detail : ""));
  }
}

const dir = mkdtempSync(join(tmpdir(), "ui-copy-build-report-"));
try {
  // 1x1 PNG
  const pngPath = join(dir, "default.png");
  writeFileSync(pngPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  ));

  const data = {
    title: "t",
    generatedAt: "2026-08-17",
    productLine: "corporate",
    persona: "财务管理专家",
    address: "您",
    pageUrl: "https://example.com",
    screenshotSrc: "default.png",
    imageSize: { width: 1, height: 1 },
    screenshots: [
      { id: "default", src: "default.png", label: "默认", imageSize: { width: 1, height: 1 } },
    ],
    summary: { total: 0, pass: 0, issue: 0, critical: 0 },
    items: [],
  };
  const dataPath = join(dir, "report-data.json");
  writeFileSync(dataPath, JSON.stringify(data, null, 2));

  const outPath = join(dir, "report.html");
  const r = spawnSync(process.execPath, [build, "--data", dataPath, "--out", outPath], {
    encoding: "utf8",
  });
  assert("build_report exit 0", r.status === 0, r.stderr || r.stdout);
  const html = readFileSync(outPath, "utf8");
  assert("html embeds data URI", /data:image\/png;base64,/.test(html));
  assert("html keeps title", /"title": "t"/.test(html));
  assert("single screenshots mode removes duplicate screenshotSrc", /"screenshotSrc": ""/.test(html));

  // Same aspect ratio with a different pixel density is valid: bbox stays in imageSize coordinates.
  const dprData = structuredClone(data);
  dprData.screenshots[0].imageSize = { width: 0.5, height: 0.5 };
  dprData.items = [{
    id: 1,
    screenshotId: "default",
    original: "A",
    status: "pass",
    bbox_px: [0.1, 0.1, 0.2, 0.2],
  }];
  const dprPath = join(dir, "dpr-data.json");
  writeFileSync(dprPath, JSON.stringify(dprData));
  const dprOut = join(dir, "dpr.html");
  const dpr = spawnSync(process.execPath, [build, "--data", dprPath, "--out", dprOut], {
    encoding: "utf8",
  });
  assert("DPR-scaled screenshot is accepted", dpr.status === 0, dpr.stderr || dpr.stdout);
  const dprHtml = readFileSync(dprOut, "utf8");
  assert("DPR report keeps annotation coordinate size", /"width": 0.5/.test(dprHtml));
  assert("DPR report records PNG pixel size", /"pixelSize":[\s\S]*?"width": 1/.test(dprHtml));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(dprOut).href);
    await page.locator("#shotImg").waitFor({ state: "visible" });
    await page.locator("#shotOverlay .frame").waitFor({ state: "attached" });
    const rect = await page.locator("#shotOverlay .frame").evaluate((el) => ({
      x: Number(el.getAttribute("x")),
      y: Number(el.getAttribute("y")),
      width: Number(el.getAttribute("width")),
      height: Number(el.getAttribute("height")),
    }));
    assert(
      "template scales bbox from 0.5 coordinate space to 1px image",
      Math.abs(rect.x - 0.2) < 0.001
        && Math.abs(rect.y - 0.2) < 0.001
        && Math.abs(rect.width - 0.4) < 0.001
        && Math.abs(rect.height - 0.4) < 0.001,
      JSON.stringify(rect)
    );
  } finally {
    await browser.close();
  }

  // Different aspect ratios mean wrong/cropped screenshot and must fail.
  const wrongRatioData = structuredClone(data);
  wrongRatioData.screenshots[0].imageSize = { width: 2, height: 1 };
  const wrongRatioPath = join(dir, "wrong-ratio.json");
  writeFileSync(wrongRatioPath, JSON.stringify(wrongRatioData));
  const wrongRatio = spawnSync(
    process.execPath,
    [build, "--data", wrongRatioPath, "--out", join(dir, "wrong-ratio.html")],
    { encoding: "utf8" }
  );
  assert("wrong screenshot aspect ratio is rejected", wrongRatio.status !== 0);
  assert("wrong ratio explains cross-batch risk", /其他批次|比例不一致/.test(wrongRatio.stderr || ""));

  // relative path broken when HTML elsewhere — --embed with --assets fixes
  const other = join(dir, "elsewhere");
  mkdirSync(other);
  const brokenHtml = readFileSync(join(__dirname, "..", "report-template.html"), "utf8")
    .replace(
      /<script type="application\/json" id="report-data">[\s\S]*?<\/script>/,
      `<script type="application/json" id="report-data">\n${JSON.stringify(data, null, 2)}\n</script>`
    );
  const brokenPath = join(other, "broken.html");
  writeFileSync(brokenPath, brokenHtml);
  const r2 = spawnSync(
    process.execPath,
    [
      build,
      "--embed", brokenPath,
      "--assets", dir,
      "--refresh-template",
      "--out", join(other, "fixed.html"),
    ],
    { encoding: "utf8" }
  );
  assert("embed with --assets exit 0", r2.status === 0, r2.stderr || r2.stdout);
  assert(
    "fixed html has data URI",
    /data:image\/png;base64,/.test(readFileSync(join(other, "fixed.html"), "utf8"))
  );
  assert(
    "refresh-template picks up coordinate scaling fix",
    /function imageMetrics/.test(readFileSync(join(other, "fixed.html"), "utf8"))
  );

  // missing png fails
  const missDir = join(dir, "miss");
  mkdirSync(missDir);
  writeFileSync(join(missDir, "report-data.json"), JSON.stringify(data, null, 2));
  const r3 = spawnSync(
    process.execPath,
    [build, "--data", join(missDir, "report-data.json"), "--out", join(missDir, "x.html")],
    { encoding: "utf8" }
  );
  assert("missing png exits non-zero", r3.status !== 0);
  assert("missing png message", /找不到截图/.test(r3.stderr || ""), r3.stderr);

  // --capture binds state image, dimensions and item provenance to the same batch.
  const capture = {
    pageUrl: "https://example.com/current",
    states: [{
      id: "default",
      label: "默认",
      src: "default.png",
      imageSize: { width: 1, height: 1 },
      items: [{ original: "首页", bbox_px: [0, 0, 1.5, 1] }],
    }],
  };
  const capturePath = join(dir, "capture.json");
  writeFileSync(capturePath, JSON.stringify(capture));
  const captureData = {
    ...data,
    pageUrl: "https://example.com/old",
    screenshotSrc: "",
    screenshots: [{
      id: "default",
      src: "../other-batch/default.png",
      label: "默认",
      imageSize: { width: 200, height: 100 },
    }],
    summary: { total: 1, pass: 1, issue: 0, critical: 0 },
    items: [{
      id: 1,
      screenshotId: "default",
      original: "首页",
      status: "pass",
      bbox_px: [0, 0, 1.5, 1],
    }],
  };
  const captureDataPath = join(dir, "capture-report-data.json");
  writeFileSync(captureDataPath, JSON.stringify(captureData));
  const captureOut = join(dir, "capture-report.html");
  const bound = spawnSync(
    process.execPath,
    [build, "--data", captureDataPath, "--capture", capturePath, "--out", captureOut],
    { encoding: "utf8" }
  );
  assert("capture-bound report exits 0", bound.status === 0, bound.stderr || bound.stdout);
  const captureHtml = readFileSync(captureOut, "utf8");
  assert("capture-bound report uses current page URL", /https:\/\/example\.com\/current/.test(captureHtml));
  assert("capture-bound report ignores foreign src", !/other-batch/.test(captureHtml));
  assert("partly offscreen bbox is clipped to visible image", /"bbox_px": \[\s*0,\s*0,\s*1,\s*1\s*\]/.test(captureHtml));
  const rebound = spawnSync(
    process.execPath,
    [
      build,
      "--embed", captureOut,
      "--capture", capturePath,
      "--refresh-template",
      "--out", join(dir, "capture-report-rebuilt.html"),
    ],
    { encoding: "utf8" }
  );
  assert("capture-bound build is idempotent after bbox clipping", rebound.status === 0, rebound.stderr || rebound.stdout);

  const staleData = structuredClone(captureData);
  staleData.items[0].original = "旧批次文案";
  const stalePath = join(dir, "stale-report-data.json");
  writeFileSync(stalePath, JSON.stringify(staleData));
  const stale = spawnSync(
    process.execPath,
    [build, "--data", stalePath, "--capture", capturePath, "--out", join(dir, "stale.html")],
    { encoding: "utf8" }
  );
  assert("stale report item is rejected", stale.status !== 0);
  assert("stale item error names capture mapping", /不属于本批 capture/.test(stale.stderr || ""), stale.stderr);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
