# Packages

> 状态：**M1 已完成**，工程为**单包布局**。当前实际源码包：`steward-core`（内核）、
> `steward-harness`（MockHarness + 隔离 worktree 补丁 + 两轮编码回路）、`steward-browser`
> （Playwright 真实浏览器适配器）；下表其余包为规划项，随 M2–M4 / 阶段二落地。
> 包职责见 [`docs/zh-CN/architecture.md`](../docs/zh-CN/architecture.md)。

| 包 | 职责 | 状态 |
|---|---|---|
| `steward-core` | AgentRuntime、BranchSpec、ToolRegistry、PolicyEngine、ArtifactBus、PromptManager、EventLog、BudgetGuard、StopSignal | ✅ M0 已实现 |
| `steward-harness` | HarnessAdapter：MockHarness + `patch.ts`（隔离 git worktree 应用补丁）+ `loop.ts`（`runCodeLoop` 两轮升级） | ✅ M0/M1 已实现（mock + 脚本化补丁） |
| `steward-browser` | Playwright 真实浏览器适配器（有头默认、`chrome→msedge` 回退、独立 `userDataDir`、逐步截图/DOM/console、5 类失败分类、风控停交人） | ✅ M1 已实现 |
| `steward-conductor` | 总调度：目标拆解、派生分支、验收、汇总、预算 | 规划（M2+；M0/M1 由 CLI/BranchManager 承担最小能力） |
| `steward-operator` | 操作型分支：浏览器/桌面/文件/HTTP、CodeTask 编写与验收执行 | 规划（M2+；M1 由 CLI `browser-flow`/`code-loop` + `steward-browser` 覆盖最小回路） |
| `steward-scout` | 客户分支：ICP、来源清单、评分、外联草稿、审批队列、周报 | 规划（M3） |
| `steward-desktop` | 真实桌面适配器（Windows：UIA + SendInput + 截图 + 白名单） | 规划（M2） |
| `steward-notify` | 通知与协助适配器（Toast/邮件/Webhook/审批队列） | 规划（阶段二） |
| `steward-domain` | 委托/预算/项目/任务/代理/证据/账本/墓碑 + 30 条边界规则 | 规划（阶段二） |
| `steward-console` | 本地 Web 控制台（看板/审批/接管/月报/L0-L1-L2） | 规划（阶段二） |
| `steward-iot` | IoT 适配器契约 + 模拟设备 fixture | 规划（阶段二 stub） |
| `steward-mcp` | 把内核能力暴露为 MCP server | 规划（阶段二） |

约定：

- **单包布局**：根 `package.json` + 根 `tsconfig.json`（`include` = `packages/*/src/**/*.ts` +
  `apps/cli/src/**/*.ts`，`outDir` = `dist/`），命令一律用 npm；**不使用 pnpm workspace**，
  当前包**没有**独立 `package.json` / `tsconfig.json`。
- 源码目录：`packages/<name>/src/`，公开入口为 `src/index.ts`（由 `apps/cli` 引用）。
- 先定契约（`docs/*/contracts.md`）再写实现；字段只增不减。
- 包之间只通过公开入口引用，禁止跨包读内部文件。
