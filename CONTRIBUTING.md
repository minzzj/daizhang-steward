# Contributing / 贡献指南

本仓库**先定契约，再写实现**；每个里程碑一个 PR，附证据。欢迎 Issue 与 PR，但请先读这里的硬规则。

## 一、许可证与贡献

- 本仓库自有代码采用 **CC BY-NC-SA 4.0**（禁止商用、分发修改版须同许可）。
- 提交贡献即表示你同意：你的贡献以同一许可证授权，且你有权提交该内容。
- 不允许提交来源不明、许可证不兼容或含第三方专有代码的片段。

## 二、真实测试硬规则（不接受纸面测试）

1. UI 验收**必须**使用真实 Chromium/Edge（headed）与真实 Windows 窗口真实键鼠；
   **禁止**用 `page.route`、假 DOM、预录视频或纯 HTTP API 冒充 UI 验收。
2. 每个对外动作必须有截图/DOM 或窗口快照/日志/回执；没有证据的“成功”按失败处理。
3. 失败保留现场；重试最多两轮，超限升级人类，不允许无限重试。
4. 发布前在干净中性路径重跑全量测试，避免截图泄露本机路径。

## 三、开发约定

- 语言：TypeScript（Node ≥ 22.18，单包布局、npm）；桌面辅助可用 Python 侧车（Windows UIA/SendInput）。
- 每步操作写事件账本；高风险动作走 PolicyEngine 的 `approve/deny` 出口。
- 运行时提示词放在 `prompts/`，必须版本化、有测试，**禁止硬编码进业务代码**。
- 新分支 = BranchSpec + 提示词 + 工具白名单；不改核心代码。
- 密钥只从环境变量读；提交前跑 `npm run check:secrets`。
- 提交信息：`<type>(<scope>): <summary>`（type: feat/fix/test/docs/chore/refactor）。

## 四、PR 检查清单

- [ ] `npm run lint && npm test` 通过
- [ ] 涉及 UI 的改动附真实浏览器/桌面截图证据（路径写进 PR 描述）
- [ ] 契约字段只增不减；如必须改动，先改 `docs/*/contracts.md` 并说明迁移
- [ ] 无密钥、无本机绝对路径、无内网资料
- [ ] 更新 `CHANGELOG.md` 与相关文档（中英双语）

## 五、Issue 模板

标题前缀：`[bug]` / `[feat]` / `[docs]` / `[commercial]`；正文写：环境、复现步骤、期望/实际、
证据（截图/日志）、是否涉及真实外部账号。

_Last updated: 2026-10-25._
