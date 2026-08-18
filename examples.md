# 产出样例

## 1. 检查优化

**输入**（对公·指令删除弹窗）

> 标题：删除失败！！  
> 正文：error_code=500 删除没成功，请稍后。  
> 按钮：确定 / 关闭

**输出**

产品线 / 人格 / 称谓：对公 / 财务管理专家 / 您

| 位置/组件 | 原文 | 问题 | 依据 | 建议 |
|-----------|------|------|------|------|
| 弹窗标题 | 删除失败！！ | 负向词作标题；感叹号滥用 | 写作原则·负向用语；对公·感叹号 | 未能删除该笔指令 |
| 弹窗正文 | error_code=500 删除没成功，请稍后。 | 暴露报错码；口语「没成功」；「请稍后」缺后续成分 | 写作原则·易懂；语料·请稍候 | 该笔指令仍保留。请检查网络后重试 |
| 主按钮 | 确定 | 二次确认主按钮应是动作本身 | 组件句式·二次确认；近义词·确定/确认 | 重试 |
| 次按钮 | 关闭 | 放弃操作用「取消」 | 语料·取消 vs 关闭 | 取消 |

可直接替换：

```
标题：未能删除该笔指令
正文：该笔指令仍保留。请检查网络后重试
主按钮：重试
次按钮：取消
```

---

## 2. 按需求生成

**输入**（个人·容易贷）

> 额度申请结果页：预审通过，引导去上传身份证做复审。主按钮进入下一步。

**输出**

产品线 / 人格 / 称谓：个人 / 个人财富专家 / 您

| 组件 | 文案 |
|------|------|
| 页面标题 | 预审已通过 |
| 说明 | 再上传身份证，即可进入复审 |
| 主按钮 | 上传身份证 |
| 次要说明 | 信息仅用于额度审核 |

备选（更短）：说明改为「上传身份证后进入复审」。主方案保留「仅需/即可」语气，因规范鼓励尝试新步骤。

自检：未写「失败/错误」；「预审」「复审」用个人专业词；标题无「的」；按钮 2–4 字无句号。

---

## 3. 读图检查 → HTML 报告

**输入**：对公网银截图（示意）。图上可见：标题「资金计划上报。」、占位「请输入应用名。」、金额「123456」、按钮「登陆」、Toast「操作失败！」。

**聊天摘要**（不要贴完整大表）

```
对公 / 财务管理专家 / 您
文案 5 · 通过 0 · 需优化 5 · 严重 1
严重：主按钮「登陆」为错字，可能无法对上登录功能
报告：copy-review-资金计划上报-2026-08-14.html
```

**`#report-data` 节选**（完整字段见 [report.md](report.md)）

```json
{
  "title": "资金计划上报 · 文案检查",
  "generatedAt": "2026-08-14 09:00",
  "productLine": "corporate",
  "persona": "财务管理专家",
  "address": "您",
  "screenshotSrc": "shot.png",
  "imageSize": { "width": 375, "height": 812 },
  "summary": { "total": 5, "pass": 0, "issue": 5, "critical": 1 },
  "items": [
    {
      "id": 1,
      "component": "页面标题",
      "region": "顶栏",
      "original": "资金计划上报。",
      "status": "issue",
      "severity": "major",
      "bbox_px": [30, 33, 165, 41],
      "problem": "标题末尾多了句号",
      "rule": "共用·句号",
      "ruleQuote": "标签、标题单独出现时省略句号",
      "why": "顶栏标题是单独出现的标题，却以「。」结尾",
      "suggested": "资金计划上报",
      "how": "去掉句号，符合标题单独出现不加句号"
    },
    {
      "id": 4,
      "component": "主按钮",
      "region": "底栏",
      "original": "登陆",
      "status": "issue",
      "severity": "critical",
      "bbox_px": [30, 698, 315, 49],
      "problem": "错字，统一用语是登录",
      "rule": "语料·登录",
      "ruleQuote": "登录 = 身份验证后进入系统；不要用「登陆」",
      "why": "按钮写成「登陆」，与规范动词不一致，易造成功能识别错误",
      "suggested": "登录",
      "how": "改用语料库统一用语「登录」"
    }
  ]
}
```

依据必须能指回规范。框用 `bbox_px`（原图像素），由网格刻度换算，不要写目测百分比。

**复检反例**（禁止）：已按「个人·括号空格」标出 `0.15% (原1.5%)`。用户说「重新检查」后，因 OCR 未读出 `%` 与 `(` 之间的空格，把该条改成 pass。原图空格仍在，应维持 issue；复检只可补漏或改正框，不得无原图证据改判。

---

## 4. 页面链接检查

**输入**：`https://example.com/fund/plan`（对公），未指定操作路径。

**聊天摘要**

```
对公 / 财务管理专家 / 您
URL https://example.com/fund/plan
状态 2（默认 + 删除确认）；弹层 1；用户在同一窗口登录后继续
状态 2（默认 + 删除确认）；弹层 1；复用 MCP 标签会话
文案 12 · 通过 10 · 需优化 2 · 严重 0
报告：copy-review-资金计划-2026-08-14.html
```

`bbox_px` 来自 `capture.json`，不要网格目测。`report-data.json` 里 `screenshots[].src` 可先写文件名，再用：

```bash
node "$SKILL/scripts/build_report.mjs" \
  --data report-data.json \
  --capture capture.json \
  --out copy-review-资金计划-2026-08-14.html
```

`--capture` 会锁定同批状态截图和 bbox，禁止因文件名相同误用其他目录图片。交付 HTML 中 `src` 必须是 `data:image/...;base64,...`。生成前 JSON 示例：

```json
{
  "pageUrl": "https://example.com/fund/plan",
  "screenshots": [
    { "id": "default", "src": "default.png", "label": "默认", "imageSize": { "width": 1440, "height": 1600 } },
    { "id": "overlay-删除确认-1", "src": "overlay-删除确认-1.png", "label": "删除确认", "imageSize": { "width": 1440, "height": 900 } }
  ],
  "items": [
    {
      "id": 1,
      "screenshotId": "default",
      "component": "按钮",
      "region": "内容",
      "original": "删除",
      "status": "pass",
      "severity": null,
      "bbox_px": [120, 240, 64, 32],
      "rule": "检查清单已过"
    },
    {
      "id": 8,
      "screenshotId": "overlay-删除确认-1",
      "component": "弹窗",
      "region": "内容",
      "original": "删除失败！！",
      "status": "issue",
      "severity": "major",
      "bbox_px": [520, 300, 280, 28],
      "problem": "负向词作标题且滥用感叹号",
      "rule": "写作原则·负向用语；对公·感叹号",
      "ruleQuote": "少用「失败」；对公仅严重警告可用感叹号",
      "why": "弹窗标题为「删除失败！！」",
      "suggested": "未能删除该笔指令",
      "how": "去掉失败与感叹号，改成动作结果陈述"
    }
  ]
}
```
