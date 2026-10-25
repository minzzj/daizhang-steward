# Packages

> 状态：**M3 已完成**，工程为**单包布局**。当前实际源码包：`steward-core`（内核 + M2 安全三模块）、
> `steward-harness`（MockHarness + 隔离 worktree 补丁（含 CRLF 归一化）+ 两轮编码回路）、`steward-browser`
> （Playwright 真实浏览器适配器）、`steward-desktop`（真实 Windows 桌面适配器）、`steward-scout`
> （Scout 客户分支引擎）；下表其余包为规划项，随 M4 / 阶段二落地。
> 包职责见 [`docs/zh-CN/architecture.md`](../docs/zh-CN/architecture.md)。

| 包 | 职责 | 状态 |
|---|---|---|
| `steward-core` | AgentRuntime、BranchSpec、ToolRegistry、PolicyEngine、ArtifactBus、PromptManager、EventLog、BudgetGuard、StopSignal + **M2 安全三模块**：`stop-controller`（停止键 ≤5s）、`checkpoint`（检查点/断点续跑）、`isolation`（凭据隔离 / ProfileLock / 工具白名单） | ✅ M0/M2 已实现 |
| `steward-harness` | HarnessAdapter：MockHarness + `patch.ts`（隔离 git worktree 应用补丁，CRLF 归一化）+ `loop.ts`（`runCodeLoop` 两轮升级） | ✅ M0/M1 已实现（mock + 脚本化补丁） |
| `steward-browser` | Playwright 真实浏览器适配器（有头默认、`chrome→msedge` 回退、独立 `userDataDir`、逐步截图/DOM/console、5 类失败分类、风控停交人） | ✅ M1 已实现 |
| `steward-desktop` | 真实 Windows 桌面适配器（Python ctypes 侧车：窗口枚举/聚焦、BitBlt 截图、SendInput 真实鼠标与 Unicode 真实键盘；白名单默认拒绝、DPI 感知、5 类失败分类、每步截图、凭据提示停止交人；10 个 `desktop.*` ToolSpec） | ✅ M2 已实现（需 Python ≥ 3.8；真实桌面 E2E：`tests/e2e-desktop/`） |
| `steward-scout` | Scout 客户分支引擎：ICP 与 3 个高价值场景、四因子评分（40/20/20/20）、来源硬校验、去重、≤150 字草稿（引用信号）、人工审批队列（默认 pending）、每日每渠道 ≤10、退订/回复/会议统计、`ScoutReport`；**纯逻辑零依赖、零网络 IO**（`markSent` 只记状态，不外发） | ✅ M3 已实现（fixtures：`examples/scout-fixtures/`；测试：`tests/unit/scout.test.mjs` 21 条） |
| `steward-conductor` | 总调度：目标拆解、派生分支、验收、汇总、预算 | 规划（M4+；M0–M3 由 CLI/BranchManager 承担最小能力） |
| `steward-operator` | 操作型分支：浏览器/桌面/文件/HTTP、CodeTask 编写与验收执行 | 规划（M4+；M1/M2 由 CLI `browser-flow`/`desktop-flow`/`code-loop` + 适配器覆盖最小回路） |
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
