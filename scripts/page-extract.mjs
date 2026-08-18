#!/usr/bin/env node
/**
 * DOM extract helpers shared by capture_page.mjs and Cursor 内嵌浏览器 CDP.
 *
 * Print an expression for Runtime.evaluate:
 *   node page-extract.mjs extract document
 *   node page-extract.mjs extract viewport
 *   node page-extract.mjs login
 *   node page-extract.mjs meta
 *   node page-extract.mjs overlayInfo
 *   node page-extract.mjs candidates
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const FORBIDDEN_ACTIONS = /^(确认|确定|提交|支付|删除|同意并继续|同意)$/;
export const TRIGGER_RE = /删除|新增|更多|筛选|导出|设置|编辑|撤回|撤销/;
export const OVERLAY_SEL = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  ".ant-modal",
  ".ant-modal-wrap",
  ".ant-drawer-content",
  ".ant-popover:not(.ant-popover-hidden)",
  ".ant-dropdown:not(.ant-dropdown-hidden)",
  ".ant-message",
  ".ant-notification",
  ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  ".el-dialog",
  ".el-drawer",
  ".el-message",
  ".el-popper:not(.el-popper-hidden)",
  ".el-select-dropdown",
  '[class*="toast"]',
  '[class*="Toast"]',
  ".modal.show",
  ".drawer",
].join(",");

export const EXTRACT_FN = (mode) => {
  const min = 8;
  const seen = new Set();
  const items = [];

  const vis = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width < min || r.height < min) return false;
    if (mode === "viewport") {
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    }
    return true;
  };

  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    if (mode === "document") {
      return [
        Math.round(r.x + scrollX),
        Math.round(r.y + scrollY),
        Math.round(r.width),
        Math.round(r.height),
      ];
    }
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };

  const regionOf = (el) => {
    const r = el.getBoundingClientRect();
    const y = mode === "document" ? r.y + scrollY : r.y;
    const h = mode === "document" ? Math.max(document.documentElement.scrollHeight, innerHeight) : innerHeight;
    if (y < h * 0.18) return "顶栏";
    if (y > h * 0.82) return "底栏";
    return "内容";
  };

  const componentOf = (el) => {
    const role = (el.getAttribute("role") || "").toLowerCase();
    const cls = el.className && typeof el.className === "string" ? el.className : "";
    const tag = el.tagName;
    if (el.placeholder != null && "placeholder" in el && el.placeholder) return "占位";
    if (role === "dialog" || role === "alertdialog" || /modal|dialog|drawer/i.test(cls)) return "弹窗";
    if (/toast|message|notification/i.test(cls) || role === "alert" || role === "status") return "Toast";
    if (tag === "BUTTON" || role === "button") return "按钮";
    if (tag === "A") return "文字链";
    if (/^H[1-6]$/.test(tag)) return "标题";
    if (tag === "LABEL") return "标签";
    if (tag === "INPUT" || tag === "TEXTAREA") return "输入框";
    if (role === "menuitem") return "菜单项";
    return "文本";
  };

  const push = (el, text) => {
    const original = String(text || "").replace(/\s+/g, " ").trim();
    if (!original) return;
    if (!vis(el)) return;
    const key = original + "@" + boxOf(el).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      original,
      component: componentOf(el),
      region: regionOf(el),
      bbox_px: boxOf(el),
      tag: el.tagName.toLowerCase(),
    });
  };

  for (const el of document.querySelectorAll("button, a, [role='button'], [role='menuitem']")) {
    push(el, el.innerText || el.getAttribute("aria-label") || el.title);
  }
  for (const el of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    push(el, el.getAttribute("placeholder"));
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH)$/.test(parent.tagName)) continue;
    if (parent.closest("button, a, [role='button']")) continue;
    push(parent, node.nodeValue);
  }
  items.sort((a, b) => a.bbox_px[1] - b.bbox_px[1] || a.bbox_px[0] - b.bbox_px[0]);
  return items;
};

export const OVERLAY_INFO_FN = (sel) => {
  const nodes = [...document.querySelectorAll(sel)].filter((el) => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  });
  if (!nodes.length) return null;
  const el = nodes.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height
    - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
  const text = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return { fingerprint: el.className + "|" + text.slice(0, 80), label: text.slice(0, 24) || "弹层" };
};

export function isLoginPath(pathname, href = "") {
  const path = String(pathname || "").toLowerCase();
  const h = String(href || "").toLowerCase();
  if (/\/(login|signin|sso)(\/|$)/.test(path)) return true;
  if (/\/user\/login(\/|$)/.test(path)) return true;
  // 路径段含 login（银行后台 /fips/user/login 等）
  if (path.split("/").some((seg) => seg === "login" || seg.endsWith("login"))) return true;
  if (/[?&](login|signin)=/.test(h)) return true;
  return false;
}

const APP_HINT = /查询|新增|导出|导入|基金管理|请输入|共\s*\d+|条\/页|条每页|编辑|删除|筛选|重置/;

function itemTexts(items) {
  return (Array.isArray(items) ? items : []).map((i) =>
    String(i && i.original != null ? i.original : i).replace(/\s+/g, "")
  );
}

/** 抽取结果是否像已登录业务页（列表/查询等）。命中则不能只因 URL 含 login 判登录墙。 */
export function looksLikeAppPageItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 5) return false;
  const hits = itemTexts(list).filter((t) => APP_HINT.test(t)).length;
  return hits >= 2 || (list.length >= 8 && hits >= 1);
}

/** 抽取结果是否像登录页产物。只看文案签名，不因 pathname 含 login 短路。 */
export function looksLikeLoginPageItems(items, _pageUrl = "") {
  if (looksLikeAppPageItems(items)) return false;
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return false;
  const texts = itemTexts(list);
  // 「修改密码」等设置项不算登录墙
  const settingsPwd = texts.some((t) => /修改密码|重置密码|旧密码|新密码/.test(t));
  if (settingsPwd && list.length > 8) return false;
  const hitPwd = texts.some((t) => /密码|忘记密码|用户名|密码登录|短信登录/.test(t));
  const hitLoginBtn = texts.some((t) => /^(登录|登陆)$/i.test(t));
  const hitWelcome = texts.some((t) => /欢迎/.test(t));
  const few = list.length <= 12;
  return few && hitPwd && (hitLoginBtn || hitWelcome);
}

/**
 * 页面种类：以可见 DOM/文案为准。URL 含 /login 永远不单独作为登录结论。
 * @returns {"login"|"app"|"unknown"}
 */
export function classifyPageKind({ items, href = "", loginFn } = {}) {
  if (looksLikeAppPageItems(items)) return "app";
  if (looksLikeLoginPageItems(items)) return "login";
  if (loginFn === true) return "login";
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "unknown";
  return "app";
}

/** 仅检测可见密码输入框（供 wait-login 轮询，避免反复完整登录墙判定）。 */
export const PWD_VISIBLE_FN = () => {
  const pwd = document.querySelector('input[type="password"]');
  if (!pwd) return false;
  const r = pwd.getBoundingClientRect();
  const st = getComputedStyle(pwd);
  return (
    r.width > 0 &&
    r.height > 0 &&
    st.display !== "none" &&
    st.visibility !== "hidden" &&
    st.opacity !== "0"
  );
};

export const LOGIN_FN = () => {
  const href = location.href.toLowerCase();
  const path = location.pathname.toLowerCase();
  const onLoginPath =
    /\/(login|signin|sso)(\/|$)/.test(path) ||
    /\/user\/login(\/|$)/.test(path) ||
    path.split("/").some((seg) => seg === "login" || seg.endsWith("login")) ||
    /[?&](login|signin)=/.test(href);

  const pwd = document.querySelector('input[type="password"]');
  let pwdVisible = false;
  if (pwd) {
    const r = pwd.getBoundingClientRect();
    const st = getComputedStyle(pwd);
    pwdVisible =
      r.width > 0 &&
      r.height > 0 &&
      st.display !== "none" &&
      st.visibility !== "hidden" &&
      st.opacity !== "0";
  }

  // 「登 录」等字间空格先去掉再匹配
  const btnNorm = (el) =>
    String(el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, "");
  const loginBtn = [...document.querySelectorAll("button, [role='button'], input[type='submit'], a")]
    .some((el) => {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      return /^(登录|登陆|signin|login)$/i.test(btnNorm(el));
    });

  const raw = (document.body && document.body.innerText || "").replace(/\s+/g, "");
  const textLen = raw.length;
  // 已进入业务壳：有查询/列表等签名时，即使 URL 仍带 /login 也不算登录墙
  const appShell = /查询|新增|导出|导入|基金管理|共\d+条|条\/页|条每页|编辑|删除|筛选/.test(raw);

  if (appShell && !pwdVisible) return false;

  // 必须看到密码框才算登录墙。禁止「路径含 login + 任意登录按钮」——
  // SPA 登录后常仍停在 /login，页头/页脚还留着「登录」链，会误判未登录。
  if (pwdVisible && loginBtn) return true;
  if (pwdVisible && onLoginPath && textLen < 1200) return true;
  return false;
};

export const CANDIDATES_FN = (triggerSrc) => {
  const triggerRe = new RegExp(triggerSrc);
  const out = [];
  const els = document.querySelectorAll("button, a, [role='button'], [aria-haspopup], [aria-controls]");
  for (const el of els) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const text = (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    const popup = el.getAttribute("aria-haspopup");
    const controls = el.getAttribute("aria-controls");
    if (triggerRe.test(text) || popup || controls) {
      out.push({ text: text.slice(0, 20), x: r.x + r.width / 2, y: r.y + r.height / 2 });
    }
  }
  return out.slice(0, 20);
};

export const META_FN = () => ({
  href: location.href,
  title: document.title || "",
  width: Math.max(document.documentElement.scrollWidth, innerWidth),
  height: Math.max(document.documentElement.scrollHeight, innerHeight),
  viewportWidth: innerWidth,
  viewportHeight: innerHeight,
  dpr: window.devicePixelRatio || 1,
});

export function cdpExpression(name, arg) {
  const fns = {
    extract: EXTRACT_FN,
    login: LOGIN_FN,
    pwdVisible: PWD_VISIBLE_FN,
    overlayInfo: OVERLAY_INFO_FN,
    candidates: CANDIDATES_FN,
    meta: META_FN,
  };
  const fn = fns[name];
  if (!fn) throw new Error("unknown expression: " + name);
  const args = arg === undefined ? "" : JSON.stringify(arg);
  return `(${fn.toString()})(${args})`;
}

import { realpathSync } from "node:fs";
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
  }
})();
if (isMain) {
  const name = process.argv[2];
  const raw = process.argv[3];
  const arg = name === "extract" ? (raw || "document")
    : name === "overlayInfo" ? (raw || OVERLAY_SEL)
    : name === "candidates" ? (raw || TRIGGER_RE.source)
    : raw;
  try {
    process.stdout.write(cdpExpression(name, arg === undefined ? undefined : arg));
  } catch {
    console.error("usage: node page-extract.mjs extract|login|meta|overlayInfo|candidates [arg]");
    process.exit(1);
  }
}
