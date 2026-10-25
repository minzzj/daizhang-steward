# Packages

> 状态：**待 M0 实现**。包划分与职责见 [`docs/zh-CN/architecture.md`](../docs/zh-CN/architecture.md) 与实施总方案 §3.4。

| 包 | 职责 | 阶段 |
|---|---|---|
| `steward-core` | AgentRuntime、BranchSpec、ToolRegistry、PolicyEngine、ArtifactBus、PromptManager、SQLite、events.jsonl、检查点 | 1 |
| `steward-conductor` | 总调度：目标拆解、派生分支、验收、汇总、预算 | 1 |
| `steward-operator` | 操作型分支：浏览器/桌面/文件/HTTP、CodeTask 编写与验收执行 | 1 |
| `steward-scout` | 客户分支：ICP、来源清单、评分、外联草稿、审批队列、周报 | 1 |
| `steward-harness` | HarnessAdapter：mock / dsh-headless / deepseek-api | 1 |
| `steward-browser` | Playwright 真实浏览器适配器（截图/DOM/控制台/下载/上传/多标签/隔离） | 1 |
| `steward-desktop` | 真实桌面适配器（Windows：UIA + SendInput + 截图 + 白名单） | 1 |
| `steward-notify` | 通知与协助适配器（Toast/邮件/Webhook/审批队列） | 1 → 2 |
| `steward-domain` | 委托/预算/项目/任务/代理/证据/账本/墓碑 + 30 条边界规则 | 2 |
| `steward-console` | 本地 Web 控制台（看板/审批/接管/月报/L0-L1-L2） | 2 |
| `steward-iot` | IoT 适配器契约 + 模拟设备 fixture | 2（stub） |
| `steward-mcp` | 把内核能力暴露为 MCP server | 2 |

约定：

- pnpm workspace；每个包独立 `package.json`、`tsconfig.json`、`README.md`、`src/`、`test/`。
- 先定契约（`docs/*/contracts.md`）再写实现；字段只增不减。
- 包之间只通过公开入口（`exports`）引用，禁止跨包读内部文件。
