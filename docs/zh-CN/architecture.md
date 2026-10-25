# 架构 / Architecture（中文）

> 状态：设计定稿；**阶段一（M0 内核 + M1 真实浏览器 + M2 真实桌面与安全 + M3 Scout + M4 发布收尾）
> 已全部实现并验证，v0.5.0 已发布；阶段二 P1 个人版 MVP 已实现并交付 v0.6.0（2026-10-25）**；
> 阶段二 P2–P4 按 ROADMAP 推进，细节改动以 PR 为准。
> 配套：`docs/zh-CN/contracts.md`、`docs/zh-CN/threat-model.md`、`docs/zh-CN/adapters.md`。

## 1. 设计原则

1. **可组合优先**：Operator、Scout、Reviewer 都是 `AgentRuntime` 的配置（BranchSpec），不是硬编码类；
   新增分支只增加配置、提示词与工具白名单。
2. **证据优先**：每个对外动作必须落到 `events.jsonl` 与 `runs/<id>/` 证据目录；没有证据的成功视为未完成。
3. **默认拒绝**：高风险动作先由 PolicyEngine 判定 `allow / deny / approve / unknown`；超时挂起不自动放行。
4. **人是最终责任主体**：审批、接管、例外、月度对账由人完成；AI 不担任法律主体。
5. **底座可替换**：核心不硬依赖 DeepSeek Harness；通过 HarnessAdapter 隔离，MockHarness 保证离线可演示。

## 2. 分层

```text
┌ 接口层 ─ CLI / 本地 Web 控制台（P1 已实现，只监听 127.0.0.1 + token 写保护） / 通知通道 / MCP（给 DSH 驾驶舱、物联软件）
├ 编排层 ─ Conductor（目标拆解、分支生命周期、预算、验收）/ 经营域引擎 steward-domain（委托-预算-项目-任务-账本-审批-接管）
├ 执行层 ─ AgentRuntime（计划-行动-观察-反思-报告）→ Operator / Scout / Reviewer
├ 能力层 ─ ToolRegistry（浏览器、桌面、文件、HTTP、消息、代码执行、支付[禁用]）
│          HarnessAdapter（mock / DSH headless / DeepSeek API）
├ 治理层 ─ PolicyEngine、预算门、停止键、检查点、审计、边界规则（P1 个人模式 18 条）
└ 数据层 ─ SQLite（WAL）+ events.jsonl（哈希链）+ runs/ 产物 + prompts/ 版本化提示词
           + <root>/domain/state.json + domain/events.jsonl（P1 经营域，原子写/只追加/脱敏）
```

## 3. 运行形态

| 形态 | 命令 | 用途 |
|---|---|---|
| 内核 CLI | `node dist/apps/cli/src/index.js demo/browser-flow/desktop-flow/scout/dummy-branch/business/boundary-check/console/approve/takeover/code-loop/run/branch/report/stop/safety-check/version/help` | 24h 运行、演示、验收 |
| 本地 Web 控制台（P1） | `node dist/apps/cli/src/index.js console [--port 4180]` | 看板/项目时间线/账本 6 要素/审批卡/接管键/月报；只监听 127.0.0.1 |
| DSH 驾驶舱（可选） | `dsh --profile daizhang web` | 人用 DSH GUI 观察/审批/接管；挂 `steward-mcp` 与 `dsh-browser`/`dsh-computer-use` |

内核是独立 Node/TS 进程；驾驶舱只是可选的“人机接口”，不参与核心决策。

工程为**单包布局**（无 pnpm workspace）：`packages/*/src` + `apps/cli/src` 由
`tsc -p tsconfig.json` 编译到 `dist/`，命令一律用 npm（`npm run build` / `npm test` / `npm run demo` /
`npm run acceptance` / `npm run acceptance:m2` / `npm run acceptance:m3` / `npm run acceptance:m4` /
`npm run acceptance:p1`）。**P1 起 `takeover` 与 `approve` 已从占位转为真实人工命令**（共 18 个已实现
命令 + 0 个占位）。

**M1 实现现状**：`packages/steward-browser` 提供 Playwright 真实浏览器适配器（有头默认、
`chrome→msedge` 回退、每 run 独立 `userDataDir`、每步截图/DOM/console、5 类失败分类、
风控关键词 → 停止交人）；`packages/steward-harness/src/patch.ts` 在隔离 git worktree 应用补丁，
`loop.ts` 的 `runCodeLoop` 最多两轮、超限升级；`tests/e2e-browser/` 提供真实浏览器 E2E
（normal 绿 / login-timeout 红）。

**M2 实现现状**：`packages/steward-desktop` 提供真实 Windows 桌面适配器——Python ctypes 侧车
（长驻）执行真实 Win32 调用：窗口枚举/聚焦、BitBlt 截图 + 自写 PNG 编码、`SendInput` 真实鼠标与
Unicode 真实键盘；白名单默认拒绝、Per-Monitor V2 DPI 感知、5 类失败分类、每步截图证据、凭据/安全
提示命中即停止交人。`tests/e2e-desktop/` 提供真实桌面 E2E（真实键鼠 + 20 张截图 + JSON 内容断言）。
内核侧新增三个安全模块：`stop-controller.ts`（200ms watchdog + `AbortController` + `withAbort`，
停止 ≤5s）、`checkpoint.ts`（原子写检查点、`listResumable`、每步 `markStepDone`，`run --resume`
跳过已完成步骤）、`isolation.ts`（`CredentialVault` 跨分支凭据隔离 + 脱敏、`ProfileLock` profile
独占、`assertBranchToolsAllowed` 工具白名单断言）；runtime 集成这些模块并在 `ToolContext` 中提供
`signal` / `locks` / `vault`。CLI 新增 `desktop-flow`、`safety-check`、`run --resume <runId>`
（M2 后 11 个已实现命令 + 2 个占位）。

**M3 实现现状**：`packages/steward-scout` 提供 Scout 客户分支引擎（`ScoutEngine`）：ICP 与恰好
3 个高价值场景、四因子评分（需求 40% / 预算 20% / 可触达性 20% / 合规 20%）、来源硬校验
（缺 `source_url` / 非 http(s) / 空 `signal` / 空 `consent_basis` 即丢弃并留证）、`org+signal`
归一化去重、≤150 字外联草稿（引用具体信号、不冒充人类、不群发）、人工审批队列（默认全部
`pending`）、每日每渠道 ≤10 频控、退订与回复/会议统计、`ScoutReport`。模块**纯逻辑、零依赖、
零网络 IO**：`markSent` 只记录状态，绝不外发；fixture 在 `examples/scout-fixtures/`（14 条虚构
合规线索）。CLI 新增 `scout`（fixture 驱动，写 `scout-report.md/.json`、`leads-scored.json`、
`drafts.json`、`approval-queue.json`、`outreach-drafts/`），命令数 11 → **12 个已实现 + 2 个占位**。

**M4 实现现状**：A10 新增 CLI 命令 `dummy-branch`（别名 `demo-dummy`）——只读 dummy 分支仅由
BranchSpec（role/tools/prompt_ref）+ 已有 `reviewer@1.0.0` 提示词组成，**核心 runtime/CLI 分支机制未改动**；
命令数 12 → **13 个已实现 + 2 个占位**。A11 发布就绪由 `npm run acceptance:m4` 一键检查（build、
80 测试、A10、CC BY-NC-SA 4.0 许可证全文、NOTICE/COMMERCIAL、中英双语文档配对、源码无遥测、
`package.json`/CLI 版本一致 0.5.0、发布文档齐全），并生成 `m4-acceptance-*` + `evidence-m4-*`。
阶段一以 **v0.5.0** 发布（发布说明 `docs/RELEASE_NOTES_v0.5.0.md`、演示脚本 `docs/demo-script.*`、
Good First Issues `docs/good-first-issues.md`）。

**P1 实现现状（阶段二个人版 MVP，v0.6.0）**：
- `packages/steward-domain`：经营域引擎——8 概念（委托 / 预算三层 / 项目 / 任务 / 代理 / 证据 / 账本 /
  墓碑 + 置信度四档）；选题提案（≥3 条业务线、来源可查）；账本 6 要素；承诺追溯（对话原文→委托条款→
  项目）；审批卡（默认 pending、超时挂起不自动放行）；接管键 + 6 类接管包；月报；L0/L1/L2 摘要；
  18 条个人模式边界规则（全目录 20 条）；仿真业务线端到端；持久化 `<root>/domain/state.json`（原子写）
  + `domain/events.jsonl`（只追加审计，detail 脱敏）。纯逻辑、零依赖、无网络、无真实资金。
- `packages/steward-console`：本地 Web 控制台——Node 内置 `http` + 原生 HTML/CSS/JS（零第三方依赖），
  **只监听 127.0.0.1**（其它 host 抛 `ConsoleSecurityError`），写操作需 `X-Steward-Token`，无 CDN/外链/
  内联脚本（CSP）；页面：看板 / 项目时间线 / 账本 6 要素抽屉 / 审批卡 / 接管键（停止+恢复）/ 月报 /
  `/health` + JSON API。
- `tests/e2e-console/`：真实浏览器 E2E（有头 Chrome，9 步 / 73 项检查 / 9 张截图，浏览器实测接管停止
  **88ms** ≤10000ms；断言只监听本机、无 token 写操作 → 401、同源无外链）。
- `examples/demo-business/`：一条纯虚构仿真个人版业务线（3 条候选业务线 / 客户询价 / 报价 / 9 任务 /
  7 消息 / 交付物 / 收款 / 发票 / 支出 / 月报；保留域名、无真实个人信息）。
- CLI 新增 `business`、`boundary-check`、`console`、`approve`（真实审批）、`takeover`（真实接管/恢复）
  → 命令数 **13 → 18 个已实现 + 0 个占位**；`npm run acceptance:p1` 一键验收（12 项检查，本机有头
  Chrome）。**B3/B4（故障演练）→ P2，B8（企业版）→ P3；Conductor / Reviewer 的完整编排仍为后续阶段。**

## 4. 分支生命周期

```text
目标 → Conductor 生成 BranchSpec → PolicyEngine 校验预算/工具/审批策略
     → AgentRuntime 执行（计划→行动→观察→反思）→ 产物与事件
     → Reviewer 校验证据 → Conductor 验收 → 终止/到期（保留产物与事件，不删除）
```

分支不得自行再开分支；需要扩展时提交 `BranchRequest` 由 Conductor 决定。过期自动停止。

P1 现状：CLI 直接装配 operator 分支（BranchSpec + 工具白名单）跑 `browser-flow` / `desktop-flow` /
`code-loop`，scout 分支跑 `scout`（只起草、进审批队列、不发送），dummy 分支跑 `dummy-branch`
（只读、仅配置 + 已有提示词）；经营域 `business` 走 domain 引擎（项目→任务→交付→收款/开票→月报），
`console` 提供人机界面（看板/审批卡/接管键/月报）；runtime 已接入停止控制器、检查点（支持
`run --resume`）、profile 锁与按分支隔离的凭据引用。Conductor 的分支派生、Reviewer 证据复核与
Conductor 验收接口仍是后续阶段规划；P1 的审批/接管由 domain 引擎 + 人工命令/控制台承担。

## 5. 证据与账本

- `events.jsonl`：只追加、带 `seq` 与哈希链，字段见 contracts.md；密钥脱敏。
- `runs/<run-id>/`：M0 产物为 `prompt.md`、`report.md`、`console.log`、`meta.json`、`events.jsonl`，
  以及 MockHarness 回路的 `code-task.json`、`code-result.json`、`patch.diff`、`test.log`；M1 起
  真实浏览器运行另含 `e2e/<case>/screenshots/`、`e2e/<case>/result.json`、`e2e/server.log`；M2 起
  真实桌面运行另含 `e2e-desktop/screenshots/`、`e2e-desktop/result.json`、`steps.json`、
  `sidecar.log`，并每步原子写 `checkpoint.json`；M3 起 Scout 运行另含 `scout-report.md/.json`、
  `leads-scored.json`、`drafts.json`、`approval-queue.json`、`outreach-drafts/`；M4 dummy 分支运行
  另含 `role`/`tools`/`prompt_ref` 报告字段；**P1 起 `business` 运行另含 `proposal.json`、
  `business-result.json`、`ledger-facts.json`（6 要素）、`promise-traces.json`、`takeover-pack.json`、
  `boundary-check.json`、`monthly-report.{json,md}`、`summaries.json`**；控制台 E2E 另含
  `result.json` + 9 张逐步截图 + `console-server.log`。验收时复制到
  `docs/test-evidence/evidence-m1-<stamp>/`…`evidence-m4-<stamp>/` 与 `evidence-p1-<stamp>/`。
- 经营域数据单独持久化在 `<root>/domain/state.json`（原子写）+ `domain/events.jsonl`（只追加审计，
  detail 脱敏）；审批卡、接管状态、月报均由 domain 引擎产生，`approve` / `takeover` 命令与控制台
  操作同一份状态（人工决策，不自动放行）。
- SQLite 索引可从事件重放重建；崩溃后用检查点恢复，不重复发送/扣款。

## 6. 摘要层级

- **L0 动作卡**：谁、对谁、做了什么、依据哪条授权、证据在哪、结果如何。
- **L1 项目摘要**：目标、进度、花费、收入、未结事项、风险、下次验收。
- **L2 经营月报**：收支、毛利、回款率、预算余量、项目组合、合规事件、下月提案。

每层标注“截至何时、覆盖多少（完整/部分/未收录）”。

P1 现状：`steward-domain` 的 `summaries()` 提供 L0/L1/L2，`buildMonthlyReport("YYYY-MM")` 生成 L2 月报
（收支/毛利/预算余量/合规事件/下月提案/as_of/coverage），控制台 `/api/summary?level=` 与 `/report`
页面直接消费。

## 7. 扩展点

| 要加什么 | 只改什么 |
|---|---|
| 新分支（如支持/交付/财务） | BranchSpec + 提示词 + 工具白名单 |
| 新工具 | ToolRegistry 注册（参数、风险级别、审批要求、证据类型） |
| 新通知通道 | NotifyAdapter 实现 |
| 新业务线 | 项目模板 + 提示词 |
| 新模型 | LLM 路由 + 预算门 |
| 物联设备 | IoTAdapter（MQTT / HTTP JSON-RPC） |

## 8. 明确不做

多租户 SaaS、计费系统、复杂前端（阶段一；P1 只做零依赖本地 Web 控制台）、无审批的支付/合同/账号权限、
绕过验证码与风控。
