# 页面链接检查

用户给出 `http(s)` URL 时走本流程，不要当成读图检查。文案与 `bbox_px` 以页面 DOM 为准，不要跑 `make_grid.py`。

## 需登录时：三步

```
1. 打开目标 URL（同一浏览器窗口）
2. 用户在该窗口登录（只判一次是否为登录表单）
3. 登录后直接抽取出报告（不再第二轮登录校验）
```

对用户只说一句：

> 请在刚打开的浏览器窗口登录；登录后回复「继续」。不要把密码发我。

### 硬约束（四条）

1. 不向用户要账号密码  
2. 登录只在一开始打开的那个窗口完成；禁止换无痕、`open_resource`、系统 Chrome 再登一次来「验证」  
3. 用户说「继续」后：直接抽取当前页；禁止再跑一轮「是否登录」探测，也禁止再请用户登录；仅当页面上仍有可见密码登录表单时，才再请一次（不要跳转）  
4. `assert_business_page.mjs` 未通过，禁止出业务报告（以最终 `default.png` 产物为准；明确业务签名可覆盖历史误写的 `loginBlocked`）  

### 环境怎么做

| 环境 | 做法 |
|------|------|
| Cursor（有 `browser_tabs` / `browser_navigate`） | 打开或复用 MCP 标签 → 仅首次判断是否登录表单 → unlock 请用户登录 → 「继续」后**只读当前标签**抽页，不再二次验登录 |
| Codex / Claude Code / 其他 CLI | 一条命令 `--headed --wait-login`：等密码表单消失 → 最多跳目标 URL 一次 → 直接抽取 |

有 Cursor 浏览器 MCP 就走 Cursor；没有才走 CLI。不要混用两套浏览器验登录。

## Cursor

```
Task Progress:
- [ ] browser_tabs list：已有目标页则 lock 后直接抽
- [ ] 没有标签：browser_navigate 打开 URL 一次
- [ ] 首次判定是登录页：unlock，对用户说上面那句提示（只这一次）
- [ ] 用户回复「继续」：lock 当前标签，直接抽 DOM/截图（禁止 navigate、禁止再判登录墙）
- [ ] 仅当仍有可见密码登录表单：再请一次；不要因 URL 含 /login 或残留「登录」链重开登录
- [ ] 写 capture.json → write_capture → assert_business_page → 出报告
```

### 抽取

`SKILL` 为 skill 根目录（`~/.cursor/skills/ui-copy-guidelines`，或 CC/Codex 下同名链接）。

```bash
EXPR_DIR="$SKILL/scripts"
# stdout 整段作为 browser_cdp Runtime.evaluate 的 expression，returnByValue=true
node "$EXPR_DIR/page-extract.mjs" meta
node "$EXPR_DIR/page-extract.mjs" extract document
node "$EXPR_DIR/page-extract.mjs" extract viewport
node "$EXPR_DIR/page-extract.mjs" candidates
node "$EXPR_DIR/page-extract.mjs" overlayInfo
```

截图：`browser_take_screenshot`，路径用 OUT 下绝对路径；默认态 `fullPage: true` → `default.png`，弹层 → `overlay-*.png`。若仍是登录墙，存 `login.png`，**禁止覆盖**已有业务 `default.png`。

```bash
OUT=copy-capture-<页面>-<日期>
mkdir -p "$OUT"
node "$SKILL/scripts/write_capture.mjs" "$OUT/capture.json"
node "$SKILL/scripts/assert_business_page.mjs" "$OUT/capture.json"
```

弹层：点「删除/筛选/更多」等；不点确认/提交/支付。最多 8 个。

## Codex / Claude Code / CLI

```bash
SKILL=~/.cursor/skills/ui-copy-guidelines
OUT=copy-capture-<页面>-<日期>
mkdir -p "$OUT"

npm i playwright@1.49.0
PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" npx playwright@1.49.0 install chromium

node "$SKILL/scripts/capture_page.mjs" \
  --url "https://example.com/page" \
  --out "$OUT" \
  --viewport 1440x900 \
  --headed --wait-login

node "$SKILL/scripts/assert_business_page.mjs" "$OUT/capture.json"
```

视口：对公 `1440x900`，个人 H5 `375x812`。`--storage` 可省略，默认 `~/.ui-copy-guidelines/storage/<host>.json`，下次自动复用。

## 步骤

```
Task Progress:
- [ ] 判定产品线；视口对公 1440x900、个人 H5 375x812
- [ ] 三步：打开 → 用户登录一次 → 直接抽取；不要先问账号、不要第二轮登录校验
- [ ] Cursor 用 MCP 标签；CLI 用 --headed --wait-login
- [ ] assert_business_page 通过后再出报告（业务产物优先于历史 loginBlocked）
- [ ] 读 capture.json，过检查清单；需优化写齐五字段
- [ ] 在 OUT 目录写 report-data.json（`screenshots[].src` 先写 `default.png` 等文件名）
- [ ] `node "$SKILL/scripts/build_report.mjs" --data "$OUT/report-data.json" --capture "$OUT/capture.json" --out "$OUT/copy-review-….html"`
- [ ] 打开报告确认截图、条目和编号框逐项对应（须为 data URI，且构建器未报批次/比例错误）
- [ ] 聊天摘要：URL、是否等过登录、状态数、弹层数、条数/通过/需优化/严重、报告路径
```

## 映射到报告

- `pageUrl` ← `capture.pageUrl`
- `screenshots` ← 各 state 的 `{ id, src, label, imageSize }`（生成 JSON 时 `src` 用文件名；`build_report` 写成 data URI）
- 报告 HTML、png、capture.json 同目录；最终以自包含 HTML 为准（可单独打开）
- `items[]` 全局 id 从 1 递增，带 `screenshotId`；`bbox_px` 原样使用
- 必须用 `--capture`：构建器会把每条 `original + bbox_px + screenshotId` 与本批 state 对照，并只从 capture 所在目录取图

## 安全边界

- 不填表、不上传、不点弹层主操作；不爬全站
- 不把账号密码写进命令行，也不向用户索要
- 会话文件只放 `~/.ui-copy-guidelines/storage/`，不要提交 git
- 明确登录表单产物 / `login.png` 禁止当业务页出报告；若最终 `default.png` 已是明确业务签名，即使历史误写 `loginBlocked` 也允许出报告
- 禁止只因 URL 含 `/login` 或页内残留「登录」链接判定未登录
- 禁止为补图而借用其他抓取目录的同名 `default.png` / `overlay-*.png`

## 与读图检查的分工

| 输入 | 流程 | bbox |
|------|------|------|
| 截图/照片 | 读图检查 + make_grid.py | 网格换算 bbox_px |
| 页面 URL | 本文件 | capture.json 的 bbox_px |
