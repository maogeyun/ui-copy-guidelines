#!/usr/bin/env node
/**
 * Assert capture.json is a business page, not a login wall.
 *   node assert_business_page.mjs path/to/capture.json
 * Exit 1 + 中文提示 if login — Agent must not generate a business copy report.
 *
 * 以最终产物为准：default.png 的 items 明确为业务页时通过，
 * 即使历史误写了 loginBlocked / pageKind:login。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyPageKind } from "./page-extract.mjs";

const file = resolve(process.argv[2] || "");
if (!file || !existsSync(file)) {
  console.error("usage: node assert_business_page.mjs path/to/capture.json");
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, "utf8"));
const pageUrl = data.pageUrl || data.requestedUrl || "";
const defaultState = (data.states || []).find((s) => s.id === "default" || s.src === "default.png")
  || (data.states || []).find((s) => s.id === "login" || /login\.png$/i.test(s.src || ""))
  || (data.states || [])[0];
const items = (defaultState && defaultState.items) || data.items || [];
const src = (defaultState && defaultState.src) || "";
const kind = classifyPageKind({ items, href: pageUrl });

let reason = "";
if (/login\.png$/i.test(src) || defaultState?.id === "login") {
  // 明确业务产物覆盖 login.png 误标：仅当 items 也像业务页时放行
  if (kind === "app") {
    reason = "";
  } else {
    reason = "默认态截图为 login.png / 登录态";
  }
} else if (kind === "app") {
  reason = "";
} else if (kind === "login") {
  reason = "抽取文案签名像登录页（可见表单/用户名/密码/登录，且不像业务列表）";
} else if (data.loginBlocked === true || data.pageKind === "login") {
  reason = "capture 标记为登录墙，且产物未呈现明确业务页签名";
}

if (reason) {
  console.error("禁止当业务页出报告：" + reason);
  console.error("请在已登录业务页重新抓取；登录墙截图应使用 login.png，勿覆盖 default.png。");
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, pageUrl, items: items.length, pageKind: kind || "app" }, null, 2));
