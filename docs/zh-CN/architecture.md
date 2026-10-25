# 架构 / Architecture（中文）

> 状态：设计定稿；**阶段一（M0–M4）已实现并发布 v0.5.0；阶段二 P1 个人版 MVP 已交付 v0.6.0；
> P2 故障演练短跑通过（长跑进行中）；P3 企业版 MVP 已实现并交付 v0.8.0（待发版）（2026-10-25）**；
> P4（v1.0.0/宣传片）按 ROADMAP 推进，细节改动以 PR 为准。
> 配套：`docs/zh-CN/contracts.md`、`docs/zh-CN/threat-model.md`、`docs/zh-CN/adapters.md`、
> `docs/zh-CN/enterprise.md`（企业版 + 30 条边界双模式表）。

## 1. 设计原则

1. **可组合优先**：Operator、Scout、Reviewer 都是 `AgentRuntime` 的配置（BranchSpec），不是硬编码类；
   新增分支只增加配置、提示词与工具白名单。
2. **证据优先**：每个对外动作必须落到 `events.jsonl` 与 `runs/<id>/` 证据目录；没有证据的成功视为未完成。
3. **默认拒绝**：高风险动作先由 PolicyEngine 判定 `allow / deny / approve / unknown`；超时挂起不自动放行。
4. **人是最终责任主体**：审批、接管、例外、月度对账由人完成；AI 不担任法律主体。
5. **底座可替换**：核心不硬依赖 DeepSeek Harness；通过 HarnessAdapter 隔离，MockHarness 保证离线可演示。

## 2. 分层

```text
┌ 接口层 ─ CLI / 本地 Web 控制台（P1，只监听 127.0.0.1 + token 写保护） / 通知（P2 本地通知） / MCP（给 DSH 驾驶舱、物联软件）
├ 编排层 ─ Conductor（目标拆解、分支生命周期、预算、验收）/ 经营域引擎 steward-domain（委托-预算-项目-任务-账本-审批-接管）
├ 执行层 ─ AgentRuntime（计划-行动-观察-反思-报告）→ Operator / Scout / Reviewer
├ 能力层 ─ ToolRegistry（浏览器、桌面、文件、HTTP、消息、代码执行、支付[禁用]）
│          HarnessAdapter（mock / DSH headless / DeepSeek API）
├ 治理层 ─ PolicyEngine、预算门、停止键、检查点、审计、边界规则（P1 个人 18 条 / P3 双模式 30 条）
├ 企业层 ─ steward-enterprise：主体/授权/用印、对公/专票、双人复核、组织审批链、申报草稿（P3）
├ 演练层 ─ steward-fault：真实 localhost 断网/封禁注入、承诺闸门、幂等 Outbox、替代方案（P2）
└ 数据层 ─ SQLite（WAL）+ events.jsonl（哈希链）+ runs/ 产物 + prompts/ 版本化提示词
           + <root>/domain/state.json + domain/events.jsonl（P1 经营域，原子写/只追加/脱敏）
```

## 3. 运行形态

| 形态 | 命令 | 用途 |
|---|---|---|
| 内核 CLI | `node dist/apps/cli/src/index.js demo/browser-flow/desktop-flow/scout/dummy-branch/business/boundary-check/fault-drill/enterprise-demo/console/approve/takeover/code-loop/run/branch/report/stop/safety-check/version/help` | 24h 运行、演示、验收 |
| 本地 Web 控制台（P1） | `node dist/apps/cli/src/index.js console [--port 4180]` | 看板/项目时间线/账本 6 要素/审批卡/接管键/月报；只监听 127.0.0.1 |
| 故障演练（P2） | `node dist/apps/cli/src/index.js fault-drill --case net-outage\|platform-ban [--outage-minutes N] [--ban-minutes N]` | 真实 localhost HTTP 断网/封禁演练（demo-platform） |
| 企业版演示（P3） | `node dist/apps/cli/src/index.js enterprise-demo` | B8 双模式订单 + 6 类阻断 + 30 条边界表 + 双人复核/用印/专票/组织审批链 |
| DSH 驾驶舱（可选） | `dsh --profile daizhang web` | 人用 DSH GUI 观察/审批/接管；挂 `steward-mcp` 与 `dsh-browser`/`dsh-computer-use` |

内核是独立 Node/TS 进程；驾驶舱只是可选的“人机接口”，不参与核心决策。

工程为**单包布局**（无 pnpm workspace）：`packages/*/src` + `apps/cli/src` 由
`tsc -p tsconfig.json` 编译到 `dist/`，命令一律用 npm（`npm run build` / `npm test` / `npm run demo` /
`npm run acceptance` / `acceptance:m2` / `acceptance:m3` / `acceptance:m4` / `acceptance:p1` /
`acceptance:p2`（短跑）/ `acceptance:p3`）。**`takeover` 与 `approve` 自 P1 起为真实人工命令**；
P2 新增 `fault-drill`、P3 新增 `enterprise-demo` —— 业务命令 **19 个 + `help` 入口，0 占位**。

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

**P2 实现现状（故障演练，v0.7.0 待发版；短跑通过 / 长跑进行中）**：
- `packages/steward-fault`：**真实 localhost HTTP 故障演练**——B3 断网（真实 `ECONNREFUSED`）：
  `PromisesGate` 断网期间拒绝新承诺并计数、动作写入**幂等 Outbox**、恢复后 `Outbox.replay()` +
  `LedgerReconciler` 对账（`duplicates_found=0`）；B4 平台封禁（真实 `403 + x-platform-ban: true`）：
  `BanDetector` 检测后停止动作、`buildAlternativePlan()` 生成替代方案（渠道/原因/下一步/负责人）、
  `notifyLocal()` 本地通知留痕、解禁恢复。
- `examples/demo-platform/`：真实 localhost 故障注入平台（主端口 + `/admin/*` 控制端口）。
- CLI 新增 `fault-drill --case net-outage|platform-ban`；`npm run acceptance:p2` **短跑 11/11 检查 ✅**
  （真实 2h 断网 + 15min 封禁长跑仍在后台运行，`evidence-long-drill-*` 待 Lead 入库）。
- CI 新增真实 localhost 故障演练步骤（B3/B4 短跑）。

**P3 实现现状（企业版 MVP，v0.8.0 待发版；B8 通过）**：
- `packages/steward-enterprise`：企业版引擎——`validateEntity()` 主体认证（营业执照/统一社会信用代码 +
  公司授权书人签 + 对公账户 + 税号四项校验）；对公账户收款校验；增值税普通/专用发票；
  `createInvoiceDraft()` 开票校验（抬头/税号/合同一致）→ `draft_pending_human`；
  `createTaxFilingDraft()` 申报草稿（`ai_may_submit=false`）；`requestAccountChange()` +
  `reviewAccountChange()` **双人复核**（2 位不同角色才 `applied=true`）；`approvalChainFor()`
  **组织审批链**（≤5000 1 级 / 5000–50000 2 级 / >50000 3 级）；`sealFlow()` 用印
  （**`ai_may_sign=false`，仅自然人签**）；`acquireAgentSlot()` 多代理串行；`checkBoundary()` 30 条边界；
  `runDualModeOrders()` **B8**（个人/企业各一单 + 6 类不一致阻断，blocked 时无发票/收款）；
  `boundaryRules30()` 30 条双模式标注表。
- `examples/demo-enterprise/`：`enterprise.json`（主体/授权/用印/对公/税号/双人复核/3 档审批链/串行）+
  `orders.json` 8 条订单（2 正常 + 6 不一致，纯虚构）。
- CLI 新增 `enterprise-demo`；`npm run acceptance:p3` **12/12 检查 ✅**（build + 151 测试 + 企业流程）；
  边界表全文见 `docs/zh-CN/enterprise.md`。CI 新增 P3 企业版演示步骤（B8 + 30 条边界，无网络）。
- 仍为后续阶段：企业专属 UI、真实银行/税务/CA/电子签章对接、Conductor/Reviewer 完整编排。

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

P2/P3 现状：`fault-drill` 在真实 localhost 平台上演练断网/封禁（不派生新分支，只验证现行断网/封禁
行为与幂等恢复）；`enterprise-demo` 由 enterprise 引擎执行双模式订单与 30 条边界判定，B8 不一致时
在产生发票/收款前阻断。企业版不新增分支类型，仍复用 operator/scout 分支与 domain 引擎。

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
  `result.json` + 9 张逐步截图 + `console-server.log`；**P2 `fault-drill` 运行另含
  `drill-net-outage.json`、`outbox.json`、`ledger.json`、`drill-platform-ban.json`、
  `alternative-plan.json` 与 `notifications/`；P3 `enterprise-demo` 运行另含 `profile.json`、
  `entity-validation.json`、`seal-flow.json`、`dual-review.json`、`invoice-validation.json`、
  `org-approval.json`、`dual-mode-orders.json`、`boundary-table.{md,json}`、`boundary-checks.json`、
  `fixture-checks.json`**。验收时复制到 `docs/test-evidence/evidence-m1-<stamp>/`…`evidence-p3-<stamp>/`。
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
页面直接消费。P3 企业版复用同一摘要体系，月报增加企业合规事件（专票/申报/用印/双人复核等）。

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

多租户 SaaS、计费系统、复杂前端（阶段一；P1 只做零依赖本地 Web 控制台；P3 未新增企业专属 UI）、
无审批的支付/合同/账号权限、绕过验证码与风控、真实银行/税务/CA/电子签章对接（P3 仅草稿与人工记录）。
