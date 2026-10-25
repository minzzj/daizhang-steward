# Packages

> 状态：**两阶段交付完成：阶段一（M0–M4，v0.5.0）+ 阶段二（v0.6.0 P1 / v0.8.0 P2+P3），最终发布
> v1.0.0（Latest，2026-10-26）**，工程为
> **单包布局**。当前实际源码包：`steward-core`（内核 + M2 安全三模块）、`steward-harness`
> （MockHarness + 隔离 worktree 补丁（含 CRLF 归一化）+ 两轮编码回路）、`steward-browser`
> （Playwright 真实浏览器适配器）、`steward-desktop`（真实 Windows 桌面适配器）、`steward-scout`
> （Scout 客户分支引擎）、`steward-domain`（P1 经营域引擎）、`steward-console`（P1 本地 Web 控制台）、
> `steward-fault`（P2 故障演练）、`steward-enterprise`（P3 企业版）；下表其余包为 P4/后续规划项。
> 包职责见 [`docs/zh-CN/architecture.md`](../docs/zh-CN/architecture.md) 与
> [`docs/zh-CN/enterprise.md`](../docs/zh-CN/enterprise.md)。

| 包 | 职责 | 状态 |
|---|---|---|
| `steward-core` | AgentRuntime、BranchSpec、ToolRegistry、PolicyEngine、ArtifactBus、PromptManager、EventLog、BudgetGuard、StopSignal + **M2 安全三模块**：`stop-controller`（停止键 ≤5s）、`checkpoint`（检查点/断点续跑）、`isolation`（凭据隔离 / ProfileLock / 工具白名单） | ✅ M0/M2 已实现 |
| `steward-harness` | HarnessAdapter：MockHarness + `patch.ts`（隔离 git worktree 应用补丁，CRLF 归一化）+ `loop.ts`（`runCodeLoop` 两轮升级） | ✅ M0/M1 已实现（mock + 脚本化补丁） |
| `steward-browser` | Playwright 真实浏览器适配器（有头默认、`chrome→msedge` 回退、独立 `userDataDir`、逐步截图/DOM/console、5 类失败分类、风控停交人） | ✅ M1 已实现 |
| `steward-desktop` | 真实 Windows 桌面适配器（Python ctypes 侧车：窗口枚举/聚焦、BitBlt 截图、SendInput 真实鼠标与 Unicode 真实键盘；白名单默认拒绝、DPI 感知、5 类失败分类、每步截图、凭据提示停止交人；10 个 `desktop.*` ToolSpec） | ✅ M2 已实现（需 Python ≥ 3.8；真实桌面 E2E：`tests/e2e-desktop/`） |
| `steward-scout` | Scout 客户分支引擎：ICP 与 3 个高价值场景、四因子评分（40/20/20/20）、来源硬校验、去重、≤150 字草稿（引用信号）、人工审批队列（默认 pending）、每日每渠道 ≤10、退订/回复/会议统计、`ScoutReport`；**纯逻辑零依赖、零网络 IO**（`markSent` 只记状态，不外发） | ✅ M3 已实现（fixtures：`examples/scout-fixtures/`；测试：`tests/unit/scout.test.mjs` 21 条） |
| `steward-domain` | **P1 经营域引擎**：8 概念（委托/预算三层/项目/任务/代理/证据/账本/墓碑 + 置信度）、选题提案、账本 6 要素、承诺追溯、审批卡（超时挂起）、接管键 + 6 类接管包、月报、L0/L1/L2 摘要、**18 条个人模式边界规则**（全目录 20 条）、仿真业务线端到端；**纯逻辑零依赖、无网络/无真实资金**，`domain/state.json` 原子写 + `domain/events.jsonl` 只追加审计 | ✅ P1 已实现（v0.6.0；测试：`tests/unit/domain.test.mjs` 30 条） |
| `steward-console` | **P1 本地 Web 控制台**：零第三方依赖（Node 内置 http + 原生 HTML/CSS/JS）；**只监听 127.0.0.1**、写操作 `X-Steward-Token`、无 CDN/外链/内联脚本（CSP）；看板 / 项目时间线 / 账本 6 要素抽屉 / 审批卡 / 接管键（停止+恢复）/ 月报 / `/health` + JSON API | ✅ P1 已实现（v0.6.0；真实浏览器 E2E：`tests/e2e-console/` 9 步 / 73 检查 / 9 截图） |
| `steward-fault` | **P2 故障演练**：**真实 localhost HTTP** 故障注入（真实 `ECONNREFUSED` 断网 / 真实 `403+x-platform-ban` 封禁，不用 mock/stub）；`PromisesGate`（断网不产生新承诺）、`Outbox`（幂等排队 + 恢复重放）、`LedgerReconciler`（`duplicates_found=0`）、`BanDetector`（封禁检测停止）、`buildAlternativePlan()`（替代方案）、`notifyLocal()`（本地通知留痕）；零第三方依赖 | ✅ P2 已实现（随 v0.8.0 发布、v1.0.0 最终交付；短跑 11/11 + 真实 120min/15min 长跑均通过；测试：`tests/unit/fault.test.mjs` 20 条） |
| `steward-enterprise` | **P3 企业版**：`validateEntity()` 主体认证（执照/税号/授权书人签/用印四项）、对公账户、增值税普通/专用发票、`createInvoiceDraft()` 开票校验 → `draft_pending_human`、`createTaxFilingDraft()` 申报草稿（`ai_may_submit=false`）、`reviewAccountChange()` 双人复核（2 位不同角色）、`approvalChainFor()` 组织审批链（1/2/3 级）、`sealFlow()` 用印（**`ai_may_sign=false`，AI 不代签**）、`runDualModeOrders()` **B8**（6 类不一致阻断）、`boundaryRules30()` **30 条边界双模式表**；纯逻辑、无网络、无真实银行/税务/CA | ✅ P3 已实现（随 v1.0.0 最终交付，v0.8.0 首发；B8 通过；测试：`tests/unit/enterprise.test.mjs` 18 条；定义说明见 `docs/zh-CN/enterprise.md`） |
| `steward-conductor` | 总调度：目标拆解、派生分支、验收、汇总、预算 | 规划（P4+；M0–P3 由 CLI/BranchManager + domain 承担最小能力） |
| `steward-operator` | 操作型分支：浏览器/桌面/文件/HTTP、CodeTask 编写与验收执行 | 规划（P4+；M1/M2 由 CLI `browser-flow`/`desktop-flow`/`code-loop` + 适配器覆盖最小回路） |
| `steward-notify` | 通知与协助适配器（Toast/邮件/Webhook/审批队列） | 规划（P3/P4） |
| `steward-iot` | IoT 适配器契约 + 模拟设备 fixture | 规划（P3/P4 stub） |
| `steward-mcp` | 把内核能力暴露为 MCP server | 规划（P3/P4） |

约定：

- **单包布局**：根 `package.json` + 根 `tsconfig.json`（`include` = `packages/*/src/**/*.ts` +
  `apps/cli/src/**/*.ts`，`outDir` = `dist/`），命令一律用 npm；**不使用 pnpm workspace**，
  当前包**没有**独立 `package.json` / `tsconfig.json`。
- 源码目录：`packages/<name>/src/`，公开入口为 `src/index.ts`（由 `apps/cli` 引用）。
- 先定契约（`docs/*/contracts.md`）再写实现；字段只增不减。
- 包之间只通过公开入口引用，禁止跨包读内部文件。
