# 读图检查 HTML 报告

读图检查的主交付物。用 [scripts/build_report.mjs](scripts/build_report.mjs) 把 JSON 注入 [report-template.html](report-template.html) 并**内嵌截图**；不要手改模板 CSS/JS。

## 生成步骤

```
Task Progress:
- [ ] 把用户截图复制到报告目录（不要用聊天里的压缩预览当原图）
- [ ] python3 scripts/measure_image.py <截图>  → imageSize.width/height
- [ ] python3 scripts/make_grid.py <截图> -o /tmp/shot-grid.png
- [ ] Read 网格图（不是聊天预览）按刻度填 bbox_px
- [ ] 抽出全部可见文案；从上到下、从左到右赋 id
- [ ] 逐条过 SKILL.md 检查清单；需优化项写齐五字段
- [ ] 若为复检：先列出上一份报告的 issue，用原图+条款逐条核实；无新证据不得改 pass
- [ ] 写出 report-data.json（screenshotSrc / screenshots[].src 先写文件名，如 default.png）
- [ ] `node scripts/build_report.mjs --data report-data.json --out copy-review-….html`（**必须**内嵌截图）
- [ ] 页面链接报告额外传 `--capture capture.json`，让构建器锁定同批截图、状态、文案与 bbox
- [ ] 聊天摘要 + 报告路径
```

`SKILL=~/.cursor/skills/ui-copy-guidelines`

```bash
python3 "$SKILL/scripts/measure_image.py" shot.png
python3 "$SKILL/scripts/make_grid.py" shot.png -o /tmp/shot-grid.png

# 截图与 JSON 同目录后生成自包含 HTML（图以 data URI 内嵌）
node "$SKILL/scripts/build_report.mjs" \
  --data report-data.json \
  --out copy-review-<页面>-<日期>.html
```

输出路径：用户指定目录优先，否则当前工作区 `copy-review-<页面>-<日期>.html`。

页面链接报告必须绑定本批产物：

```bash
node "$SKILL/scripts/build_report.mjs" \
  --data "$OUT/report-data.json" \
  --capture "$OUT/capture.json" \
  --out "$OUT/copy-review-<页面>-<日期>.html"
```

`--capture` 会以 `capture.states[].id/src/imageSize/items` 为准，拒绝旧条目、错状态、缺图、超界 bbox 及宽高比不同的截图。传了 `--capture` 后不再跨目录搜索同名 `default.png`。

**截图显示（硬性）**：最终 HTML 里的 `screenshotSrc` / `screenshots[].src` **必须是** `data:image/...;base64,...`。用 `build_report.mjs` 从旁路 png 生成。禁止交付只含 `default.png` 相对路径的报告——Cursor 预览、换目录打开、单独转发 HTML 都会裂图。已有单图裂图报告可修：

```bash
node "$SKILL/scripts/build_report.mjs" --embed copy-review.html --assets <含原始截图的目录>
```

页面链接旧报告优先带 `--capture` 修复；没有本批 png 时必须重新截取，禁止借用其他批次同名图片。

**禁止用聊天/Read 压缩预览目测百分比。** 预览会缩放或裁切，框会错位。尺寸只信 `measure_image.py`；框只信网格刻度换算的 `bbox_px`。

### 复检 / 重新生成（不得无依据改判）

用户说「重新检查 / 再生成 / 再跑一遍」= **再执行本流程**，不是授权推翻上次结论。判定依据只有规范条款 + 原图像素，不受「人为再跑一次」干扰。

复检允许：补漏检、改正 `bbox_px`、补齐五字段、按本文件重出 HTML。

撤回或把 `issue` 改 `pass`，必须满足其一：

1. 截图/原文已变；或
2. 该条当时没有对应条款（编造了规则）；或
3. 用本文件规定的证据（裁切原图放大 / 沿文字行扫像素）证明事实认定错误

不够作为改判依据：OCR 与上次不一致、压缩预览看不清、觉得上次「判太严」、想让复检报告「看起来有变化」。

反例（禁止再犯）：第一次按个人分线标出 `0.15% (原1.5%)` 括号外空格；用户说「重新检查」后因 OCR 吞掉空格改成 pass。空格仍在原图上，应维持 issue。

### 标点 / 空格（OCR 不可终判）

OCR 只辅助抽字，**不作为括号、空格、全半角、冒号的终判**。常见误判：把 `0.15% (原1.5%)` 收成无空格，或把半角 `()` 认成全角 `（）`。

- 个人：括号外无空格，正 `金额(元)` / `0.15%(原1.5%)`；反 `金额 (元)` / `0.15% (原1.5%)`（不要套对公）
- 核对：按 `bbox_px` 裁切原图放大，或沿文字行扫像素看 `%` 与 `(` 之间有无空隙
- **禁止**只因 OCR 未读出空格，就撤回已成立的「个人·括号空格」等标点 issue

聊天摘要只含：产品线、文案条数、通过 / 需优化 / 严重、每条严重项一句话、报告文件路径。

## JSON

```json
{
  "title": "资金计划上报 · 文案检查",
  "generatedAt": "2026-08-14 09:00",
  "productLine": "corporate",
  "persona": "财务管理专家",
  "address": "您",
  "pageUrl": "",
  "screenshotSrc": "shot.png",
  "imageSize": { "width": 375, "height": 812 },
  "screenshots": [],
  "summary": { "total": 5, "pass": 0, "issue": 5, "critical": 1 },
  "items": []
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 报告标题 |
| `generatedAt` | 是 | 本地时间，可读即可 |
| `productLine` | 是 | `corporate` 或 `personal` |
| `persona` | 是 | 财务管理专家 / 个人财富专家 |
| `address` | 是 | 您 / 你 |
| `pageUrl` | 链接检查时 | 实际打开的页面 URL，模板页头展示 |
| `screenshotSrc` | 单图时是 | 生成前可写文件名；**交付 HTML 必须经 build_report 变成 data URI** |
| `imageSize` | 单图时是 | `bbox_px` 所属坐标系；读图检查等于 `measure_image.py` 尺寸，链接检查严格取 `capture.json` |
| `screenshots` | 多图/多状态时是 | `[{ "id","src","label","imageSize" }]`；有则条目加 `screenshotId`；交付时 `src` 同为 data URI |
| `summary` | 是 | 与 items 统计一致 |
| `items` | 是 | 全部可见文案，含通过项 |

### items[]

| 字段 | 说明 |
|------|------|
| `id` | 从 1 递增，与图上编号一致 |
| `screenshotId` | 多图时对应 `screenshots[].id` |
| `component` | 按钮 / 标题 / 占位 / Toast 等 |
| `region` | 大致区位，如「顶栏」「表单」「底栏」 |
| `original` | 图上原文；看不清用 `""` 且 `status: "unreadable"` |
| `status` | `pass` / `issue` / `unreadable` |
| `severity` | issue 时必填：`critical` / `major` / `minor`；其余 `null` |
| `bbox_px` | **必填** `[left, top, width, height]`，单位 px，相对原图左上角 |
| `bbox` | 仅兼容旧数据：`[left%, top%, width%, height%]`；有 `bbox_px` 时忽略 |
| `problem` | 问题一句话；pass 可空 |
| `rule` | 条款名，如「对公·感叹号」；pass 可写「检查清单已过」 |
| `ruleQuote` | 规范原意一句，可压缩，**不编造新规** |
| `why` | 原文哪一点触犯 |
| `suggested` | 可替换改写 |
| `how` | 改写如何满足该条款 |

`summary.total === items.length`。`pass` / `issue` / `critical` 与条目一致。`unreadable` 计入 `total`，不计入 pass/issue。

模板主区默认三栏：**截图 | 条目列表 | 当前详情**。读图三栏时选中编号后详情在右侧更新。多状态用顶栏页签（默认 / 弹窗 / 下拉）。

**网页 / 链接检查：** 有 `pageUrl` 或截图宽度 ≥ 900 时，模板改为通栏截图在上、列表与详情在下，避免 1440 图挤在左栏导致标注看不清。主区在视口内定高：截图、列表、详情各自独立滚动，点选只在对应容器内定位，不跟整页抢滚。`bbox_px` 直接用 `capture.json`，不要跑 `make_grid.py`。把各 state 写入 `screenshots[]`，条目带 `screenshotId`。见 [page-check.md](page-check.md)。用 `build_report.mjs` 注入 JSON 并内嵌 png；不要手改模板 CSS/JS。

## 标注（防错位）

模板用 SVG `viewBox = PNG 自然像素` 叠在图上，并按 `PNG 像素 ÷ imageSize 坐标系` 缩放 `bbox_px`。因此 Retina 2× 截图可以使用 1× DOM 坐标，但宽高比必须一致；宽高比不同代表错图或裁切范围不同，构建器会拒绝。

换算：网格上读到左 28、顶 8、宽 44、高 3（均为 0–100 刻度），原图 471×1024 则

`bbox_px = [round(28/100*471), round(8/100*1024), round(44/100*471), round(3/100*1024)]`

- 框住**该条文案元素**，禁止整页/整卡片大框
- 框边贴近文字或按钮可视边界
- 编号画在框左上角附近；点击与右侧列表双向高亮
- 通过=绿、一般=琥珀、建议=muted、严重=红、看不清=灰
- 长图：标注区滚动，坐标仍相对全图像素
- 网页通栏：截图接近原宽显示，编号仍相对原图像素；主区视口内分区滚动；读图窄屏仍用三栏
- 多图：填 `screenshots`，每条带 `screenshotId`
- 页面链接：每条 `original + bbox_px + screenshotId` 必须能在同批 `capture.json` 对应 state 中找到

## 严重度

| 值 | 何时 |
|----|------|
| `critical` | 报错码、错字导致误操作、协议/法律表述问题 |
| `major` | 标点、近义词混用、负向词、不当感叹号等硬违反 |
| `minor` | 可更短或更贴场景，但不是硬违反 |

## 优化理由（硬性）

`status: "issue"` 必须五字段齐全：

| 字段 | 要求 |
|------|------|
| `rule` | 能指回 shared-rules / 分线 / glossary / 组件句式 |
| `ruleQuote` | 规范原意一句 |
| `why` | 原文具体触犯点 |
| `suggested` | 改写 |
| `how` | 改写如何满足该条 |

缺任何一项不得标 `issue`。找不到条款 → `pass` 或说明「待确认」并写缺哪份产品细则，不要编规则。

## 自检

- [ ] 图上编号数量 = items.length（该图）
- [ ] 每条都有 `bbox_px`；`0≤x,y`；`x+w ≤ imageSize.width`；`y+h ≤ imageSize.height`
- [ ] 读图报告的 `imageSize` 与 `measure_image.py` 一致；链接报告与本批 `capture.json` 一致
- [ ] 多状态每条都有 `screenshotId`，并指向存在的 `screenshots[].id`
- [ ] 页面链接用 `--capture` 构建，未混入其他批次同名截图或旧条目
- [ ] 需优化项五字段非空
- [ ] 未臆造图上没有的字
- [ ] 括号/空格/全半角已用放大原图核对，未用 OCR 终判或据此撤回 issue
- [ ] 复检时未因「重新生成」把无新证据的 issue 改成 pass
- [ ] 用 build_report.mjs 生成；HTML 内截图为 data URI（打开报告能看到图，不是「截图无法加载」）
- [ ] 未手改模板 CSS/JS
- [ ] 聊天未再贴完整大表
