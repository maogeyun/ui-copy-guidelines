#!/usr/bin/env node
/**
 * Open a live URL, extract visible copy + bbox_px from the DOM, screenshot
 * the default state, then click common triggers to capture dialogs/menus/toasts.
 *
 * Does not type into inputs, upload files, or click overlay primary actions
 * (确认/提交/支付/删除/同意并继续).
 *
 * Setup:
 *   npm i playwright@1.49.0
 *   npx playwright@1.49.0 install chromium
 *
 * Usage:
 *   node capture_page.mjs --url URL --out DIR [--viewport 1440x900] [--storage FILE] [--max-overlays 8]
 *   [--headed --wait-login]         Codex / Claude Code: user logs in once, session reused
 *   [--cdp URL]                     attach an existing Chromium
 *   [--no-login-check]              never stop as login wall
 */
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CANDIDATES_FN,
  EXTRACT_FN,
  FORBIDDEN_ACTIONS,
  LOGIN_FN,
  OVERLAY_INFO_FN,
  OVERLAY_SEL,
  PWD_VISIBLE_FN,
  TRIGGER_RE,
  classifyPageKind,
} from "./page-extract.mjs";

const WAIT_LOGIN_MS = 5 * 60 * 1000;
const LOGIN_HINT = [
  "请在刚打开的浏览器窗口登录；登录后回复「继续」。不要把密码发我。",
  "不要新开无痕窗口再登一次；登录后从同一窗口直接读取页面。",
].join("\n");

function parseArgs(argv) {
  const out = {
    viewport: "1440x900",
    maxOverlays: 8,
    storage: "",
    url: "",
    outDir: "",
    cdp: "",
    noLoginCheck: false,
    headed: false,
    waitLogin: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--url") out.url = next, i++;
    else if (a === "--out") out.outDir = next, i++;
    else if (a === "--viewport") out.viewport = next, i++;
    else if (a === "--storage") out.storage = next, i++;
    else if (a === "--cdp") out.cdp = next, i++;
    else if (a === "--max-overlays") out.maxOverlays = Number(next), i++;
    else if (a === "--no-login-check") out.noLoginCheck = true;
    else if (a === "--headed") out.headed = true;
    else if (a === "--wait-login") out.waitLogin = true;
  }
  if (!out.url || !out.outDir) {
    console.error("usage: node capture_page.mjs --url URL --out DIR [--viewport 1440x900] [--storage FILE] [--headed] [--wait-login] [--cdp URL] [--no-login-check] [--max-overlays 8]");
    process.exit(1);
  }
  const [w, h] = out.viewport.split("x").map(Number);
  if (!w || !h) {
    console.error("invalid --viewport, expected WIDTHxHEIGHT");
    process.exit(1);
  }
  out.width = w;
  out.height = h;
  if (out.waitLogin) out.headed = true;
  if (out.headed) out.waitLogin = true;
  if (!out.storage) out.storage = defaultStoragePath(new URL(out.url).host);
  return out;
}

function defaultStoragePath(host) {
  const safe = String(host || "site").replace(/[^\w.-]/g, "_");
  return join(homedir(), ".ui-copy-guidelines", "storage", `${safe}.json`);
}

function slug(s) {
  return String(s || "overlay")
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "overlay";
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error([
      "未安装 Playwright。请先执行：",
      "  npm i playwright@1.49.0",
      "  PLAYWRIGHT_BROWSERS_PATH=\"$HOME/Library/Caches/ms-playwright\" npx playwright@1.49.0 install chromium",
    ].join("\n"));
    process.exit(1);
  }
}

async function connectBrowser(chromium, args) {
  if (args.cdp) {
    try {
      const browser = await chromium.connectOverCDP(args.cdp, { timeout: 3000 });
      return { browser, attached: true, endpoint: args.cdp };
    } catch (err) {
      console.error(`CDP failed (${args.cdp}): ${err && err.message ? err.message : err}`);
    }
  }
  const storageExists = args.storage && existsSync(args.storage);
  if (!args.headed && !storageExists) {
    return { browser: null, attached: false, endpoint: "", needSession: true };
  }
  try {
    const browser = await chromium.launch({ headless: !args.headed });
    return { browser, attached: false, endpoint: "", needSession: false };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      console.error([
        "Playwright Chromium 未安装或不在预期路径。请执行：",
        "  PLAYWRIGHT_BROWSERS_PATH=\"$HOME/Library/Caches/ms-playwright\" npx playwright@1.49.0 install chromium",
        msg,
      ].join("\n"));
      process.exit(1);
    }
    throw err;
  }
}

function samePage(href, target) {
  try {
    const a = new URL(href);
    const b = new URL(target);
    return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

async function pickPage(browser, args) {
  let createdPage = false;
  for (const context of browser.contexts()) {
    for (const p of context.pages()) {
      if (samePage(p.url(), args.url) || p.url() === args.url) {
        return { page: p, context, createdPage, reusedTab: true };
      }
    }
  }
  const context = browser.contexts()[0] || await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  createdPage = true;
  return { page, context, createdPage, reusedTab: false };
}

async function waitForLogin(page, timeoutMs) {
  console.error("请在刚打开的浏览器窗口登录；登录成功后脚本会自动继续。不要把密码发我。");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // 只等可见密码表单消失，不反复跑完整登录墙判定，也不在此跳目标 URL
      const pwdVisible = await page.evaluate(PWD_VISIBLE_FN);
      if (!pwdVisible) {
        await page.waitForTimeout(600);
        const still = await page.evaluate(PWD_VISIBLE_FN);
        if (!still) return true;
      }
    } catch { /* navigation in progress */ }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function saveStorage(context, storagePath) {
  if (!context || !storagePath) return;
  try {
    mkdirSync(dirname(storagePath), { recursive: true });
    await context.storageState({ path: storagePath });
  } catch (err) {
    console.error("未能保存登录会话：", err && err.message ? err.message : err);
  }
}

async function dismissOverlay(page) {
  const cancel = page.locator("button, a, [role='button']").filter({ hasText: /^(取消|关闭|我再想想)$/ }).first();
  try {
    if (await cancel.isVisible({ timeout: 400 })) {
      await cancel.click({ timeout: 800 });
      await page.waitForTimeout(300);
      return;
    }
  } catch { /* ignore */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

async function cleanup({ browser, attached, createdPage, page }) {
  if (attached) {
    if (createdPage && page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    browser.disconnect();
  } else if (browser) {
    await browser.close();
  }
}

async function isLoginWall(page) {
  try {
    const loginFn = await page.evaluate(LOGIN_FN);
    const items = await page.evaluate(EXTRACT_FN, "viewport");
    return classifyPageKind({ items, href: page.url(), loginFn }) === "login";
  } catch {
    return false;
  }
}

async function writeLoginCapture(page, args, result, meta) {
  const loginPath = "login.png";
  await page.screenshot({ path: join(args.outDir, loginPath), fullPage: true, scale: "css" });
  const items = await page.evaluate(EXTRACT_FN, "document");
  const size = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, innerWidth),
    height: Math.max(document.documentElement.scrollHeight, innerHeight),
  }));
  result.pageUrl = page.url();
  result.loginBlocked = true;
  result.pageKind = "login";
  result.states = [{
    id: "login",
    label: "登录页",
    src: loginPath,
    imageSize: size,
    trigger: "登录墙",
    items,
  }];
  writeFileSync(join(args.outDir, "capture.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    loginBlocked: true,
    pageKind: "login",
    attached: result.attached,
    reusedTab: result.reusedTab,
    out: args.outDir,
    states: 1,
    ...meta,
  }, null, 2));
  console.error(LOGIN_HINT);
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = await loadPlaywright();
  mkdirSync(args.outDir, { recursive: true });

  const { browser, attached, endpoint, needSession } = await connectBrowser(chromium, args);
  if (needSession) {
    const result = {
      pageUrl: "",
      requestedUrl: args.url,
      viewport: { width: args.width, height: args.height },
      loginBlocked: true,
      skipLoginCheck: false,
      attached: false,
      reusedTab: false,
      cdp: "",
      gotoError: "",
      states: [],
    };
    writeFileSync(join(args.outDir, "capture.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ loginBlocked: true, hint: "headed-wait-login", out: args.outDir }, null, 2));
    console.error(LOGIN_HINT);
    console.error(`重试：node capture_page.mjs --url "${args.url}" --out "${args.outDir}" --headed --wait-login`);
    process.exit(1);
  }

  let page;
  let context;
  let createdPage = false;
  let reusedTab = false;

  if (attached) {
    const picked = await pickPage(browser, args);
    page = picked.page;
    context = picked.context;
    createdPage = picked.createdPage;
    reusedTab = picked.reusedTab;
  } else {
    const contextOpts = {
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: 1,
    };
    if (args.storage && existsSync(args.storage)) contextOpts.storageState = resolve(args.storage);
    context = await browser.newContext(contextOpts);
    page = await context.newPage();
    createdPage = true;
  }

  page.setDefaultTimeout(8000);
  if (createdPage) {
    try {
      await page.setViewportSize({ width: args.width, height: args.height });
    } catch { /* attached contexts may ignore viewport */ }
  }

  const originHost = new URL(args.url).host;
  if (createdPage) {
    page.on("popup", (p) => p.close().catch(() => {}));
  }

  let gotoError = "";
  if (!reusedTab) {
    try {
      await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(800);
    } catch (err) {
      gotoError = String(err && err.message ? err.message : err);
    }
  } else {
    await page.waitForTimeout(300);
  }

  const skipLoginCheck = Boolean(args.noLoginCheck || attached);
  const result = {
    pageUrl: page.url(),
    requestedUrl: args.url,
    viewport: { width: args.width, height: args.height },
    loginBlocked: false,
    skipLoginCheck,
    attached,
    reusedTab,
    cdp: attached ? endpoint : "",
    storage: args.storage || "",
    gotoError,
    states: [],
  };

  if (gotoError) {
    writeFileSync(join(args.outDir, "capture.json"), JSON.stringify(result, null, 2));
    await cleanup({ browser, attached, createdPage, page });
    console.error(gotoError);
    if (!attached) console.error(LOGIN_HINT);
    process.exit(1);
  }

  // —— 登录阶段：只判定一次 ——
  let loggedInThisRun = false;
  if (!skipLoginCheck && await isLoginWall(page)) {
    if (args.waitLogin && args.headed) {
      const ok = await waitForLogin(page, WAIT_LOGIN_MS);
      if (ok) {
        loggedInThisRun = true;
        await saveStorage(context, args.storage);
        result.pageUrl = page.url();
      } else {
        await writeLoginCapture(page, args, result, {
          hint: "wait-login-timeout",
        });
        await cleanup({ browser, attached, createdPage, page });
        process.exit(1);
      }
    } else {
      await writeLoginCapture(page, args, result, {
        hint: "headed-wait-login",
      });
      await cleanup({ browser, attached, createdPage, page });
      process.exit(1);
    }
  }

  // 登录完成后：最多跳目标 URL 一次，不再二次 isLoginWall
  if (!samePage(page.url(), args.url)) {
    try {
      await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(800);
      result.pageUrl = page.url();
    } catch (err) {
      gotoError = String(err && err.message ? err.message : err);
      result.gotoError = gotoError;
    }
  }

  if (!attached && args.storage) await saveStorage(context, args.storage);

  // —— 直接抽取 ——
  const defPath = "default.png";
  await page.screenshot({ path: join(args.outDir, defPath), fullPage: true, scale: "css" });
  const defaultItems = await page.evaluate(EXTRACT_FN, "document");
  const defaultSize = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, innerWidth),
    height: Math.max(document.documentElement.scrollHeight, innerHeight),
  }));

  result.pageUrl = page.url();
  // 产物只分类一次：业务签名优先；明确登录表单签名才失败
  const kind = classifyPageKind({ items: defaultItems, href: page.url() });
  if (!skipLoginCheck && kind === "login") {
    const loginPath = "login.png";
    const from = join(args.outDir, defPath);
    const to = join(args.outDir, loginPath);
    try {
      if (existsSync(from)) renameSync(from, to);
    } catch {
      await page.screenshot({ path: to, fullPage: true, scale: "css" });
      try { if (existsSync(from)) unlinkSync(from); } catch { /* ignore */ }
    }
    result.loginBlocked = true;
    result.pageKind = "login";
    result.states.push({
      id: "login",
      label: "登录页",
      src: loginPath,
      imageSize: defaultSize,
      trigger: "登录墙",
      items: defaultItems,
    });
    writeFileSync(join(args.outDir, "capture.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      loginBlocked: true,
      pageKind: "login",
      attached,
      reusedTab,
      out: args.outDir,
      states: 1,
      hint: loggedInThisRun ? "post-login-still-login-form" : "looks-like-login-page",
    }, null, 2));
    console.error(LOGIN_HINT);
    await cleanup({ browser, attached, createdPage, page });
    process.exit(1);
  }

  result.pageKind = "app";
  result.loginBlocked = false;
  result.states.push({
    id: "default",
    label: "默认",
    src: defPath,
    imageSize: defaultSize,
    trigger: "默认",
    items: defaultItems,
  });

  const fingerprints = new Set();
  const candidates = await page.evaluate(CANDIDATES_FN, TRIGGER_RE.source);
  let captured = 0;
  for (const cand of candidates) {
    if (captured >= args.maxOverlays) break;
    if (FORBIDDEN_ACTIONS.test(cand.text)) continue;
    try {
      if (new URL(page.url()).host !== originHost) {
        await page.goto(args.url, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(400);
      }
      await page.mouse.click(cand.x, cand.y);
      await page.waitForTimeout(1200);
      const info = await page.evaluate(OVERLAY_INFO_FN, OVERLAY_SEL);
      if (!info || fingerprints.has(info.fingerprint)) {
        await dismissOverlay(page);
        continue;
      }
      fingerprints.add(info.fingerprint);
      const id = `overlay-${slug(info.label || cand.text)}-${captured + 1}`;
      const src = `${id}.png`;
      await page.screenshot({ path: join(args.outDir, src), fullPage: false, scale: "css" });
      const items = await page.evaluate(EXTRACT_FN, "viewport");
      result.states.push({
        id,
        label: info.label || cand.text || "弹层",
        src,
        imageSize: { width: args.width, height: args.height },
        trigger: `点击「${cand.text || "触发器"}」`,
        items,
      });
      captured += 1;
      await dismissOverlay(page);
    } catch {
      await dismissOverlay(page).catch(() => {});
    }
  }

  writeFileSync(join(args.outDir, "capture.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    loginBlocked: false,
    pageKind: "app",
    attached,
    reusedTab,
    cdp: attached ? endpoint : "",
    storage: args.storage || "",
    out: args.outDir,
    states: result.states.length,
    overlays: captured,
  }, null, 2));
  await cleanup({ browser, attached, createdPage, page });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
