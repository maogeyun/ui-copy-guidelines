#!/usr/bin/env node
/**
 * Smoke tests for login-wall detection and assert_business_page.
 *   node scripts/test_login_detect.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPageKind,
  isLoginPath,
  looksLikeAppPageItems,
  looksLikeLoginPageItems,
} from "./page-extract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures", "login-wall");
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    console.log("ok - " + name);
  } else {
    failed += 1;
    console.error("FAIL - " + name + (detail ? ": " + detail : ""));
  }
}

// 1) path + 「登 录」按钮规范化
assert(
  "isLoginPath /fips/user/login",
  isLoginPath("/fips/user/login", "https://x/fips/user/login") === true
);
assert(
  "isLoginPath business fundProject",
  isLoginPath("/fips/fundInfo/fundProject", "https://x/fips/fundInfo/fundProject") === false
);
const btnNorm = (s) => String(s).replace(/\s+/g, "");
assert(
  "登 录 button normalizes to 登录",
  /^(登录|登陆|signin|login)$/i.test(btnNorm("登 录")) === true
);

// 2) looksLikeLoginPageItems — login fixture texts
const loginItems = [
  { original: "你好, 欢迎来到" },
  { original: "密码登录" },
  { original: "用户名" },
  { original: "密码" },
  { original: "登 录" },
  { original: "忘记密码" },
];
assert(
  "looksLikeLoginPageItems login sample",
  looksLikeLoginPageItems(loginItems, "https://x/fips/user/login") === true
);
assert(
  "looksLikeLoginPageItems by signature without url",
  looksLikeLoginPageItems(loginItems, "https://x/app/home") === true
);

// 3) /login URL + 业务列表 + 残留「登录」链接 → 业务页
const spaResidualLogin = [
  { original: "首页" },
  { original: "基金管理" },
  { original: "请输入基金全称" },
  { original: "查询" },
  { original: "新增" },
  { original: "导入" },
  { original: "导出" },
  { original: "共 157 条" },
  { original: "20 条/页" },
  { original: "登录" },
];
assert(
  "looksLikeAppPageItems /login URL + residual 登录 link",
  looksLikeAppPageItems(spaResidualLogin) === true
);
assert(
  "looksLikeLoginPageItems ignores residual 登录 on app list",
  looksLikeLoginPageItems(spaResidualLogin, "https://x/fips/user/login") === false
);
assert(
  "classifyPageKind residual 登录 + /login → app",
  classifyPageKind({ items: spaResidualLogin, href: "https://x/fips/user/login" }) === "app"
);

// 4) 可见密码框签名（文案级）→ 登录页；设置页「修改密码」→ 业务页
assert(
  "looksLikeLoginPageItems visible pwd form signature",
  looksLikeLoginPageItems(
    [
      { original: "用户名" },
      { original: "密码" },
      { original: "登录" },
      { original: "忘记密码" },
    ],
    "https://x/home"
  ) === true
);

const appItems = [
  { original: "查询" },
  { original: "新增" },
  { original: "请输入基金全称" },
  { original: "基金管理" },
  { original: "共 157 条" },
];
assert(
  "looksLikeLoginPageItems fund list",
  looksLikeLoginPageItems(appItems, "https://x/fips/fundInfo/fundProject") === false
);
assert(
  "looksLikeLoginPageItems ignores login URL when items are app",
  looksLikeLoginPageItems(appItems, "https://x/fips/user/login") === false
);
assert(
  "looksLikeAppPageItems fund list",
  looksLikeAppPageItems(appItems) === true
);
const appItemsDense = [
  ...appItems,
  { original: "导入" },
  { original: "导出" },
  { original: "基金全称" },
];
assert(
  "looksLikeAppPageItems dense fund list",
  looksLikeAppPageItems(appItemsDense) === true
);
assert(
  "classifyPageKind login items + login url → login",
  classifyPageKind({ items: loginItems, href: "https://x/fips/user/login" }) === "login"
);
assert(
  "classifyPageKind app items + login url → app",
  classifyPageKind({ items: appItemsDense, href: "https://x/fips/user/login" }) === "app"
);
assert(
  "classifyPageKind empty items + /login url → unknown (URL alone insufficient)",
  classifyPageKind({ items: [], href: "https://x/fips/user/login" }) === "unknown"
);

// 5) long settings page with 修改密码 — not login
const longSettings = Array.from({ length: 20 }, (_, i) => ({
  original: i === 5 ? "修改密码" : `设置项${i}`,
}));
assert(
  "looksLikeLoginPageItems long settings with 修改密码",
  looksLikeLoginPageItems(longSettings, "https://x/settings") === false
);
assert(
  "classifyPageKind settings with 修改密码 → app",
  classifyPageKind({ items: longSettings, href: "https://x/settings" }) === "app"
);

// 6) assert_business_page on fixtures
function runAssert(file) {
  return spawnSync(process.execPath, [join(__dirname, "assert_business_page.mjs"), file], {
    encoding: "utf8",
  });
}
const failLogin = runAssert(join(fixtureDir, "capture-login.json"));
assert(
  "assert_business_page rejects login capture",
  failLogin.status === 1,
  failLogin.stderr || failLogin.stdout
);
assert(
  "assert_business_page login message",
  /禁止当业务页出报告/.test(failLogin.stderr || ""),
  failLogin.stderr
);

const okApp = runAssert(join(fixtureDir, "capture-app.json"));
assert(
  "assert_business_page accepts app capture",
  okApp.status === 0,
  okApp.stderr || okApp.stdout
);

const okSpa = runAssert(join(fixtureDir, "capture-login-url-app.json"));
assert(
  "assert_business_page accepts app items even if pageUrl is /login",
  okSpa.status === 0,
  okSpa.stderr || okSpa.stdout
);

const okMislabelled = runAssert(join(fixtureDir, "capture-mislabelled-app.json"));
assert(
  "assert_business_page accepts app default even if loginBlocked history",
  okMislabelled.status === 0,
  okMislabelled.stderr || okMislabelled.stdout
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
