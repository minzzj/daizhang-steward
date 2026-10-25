# Changelog / 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned — Phase 2 (remaining)
- **P2 长跑收尾**：真实 2 小时断网 + 15 分钟封禁长跑证据（`long-drill-*`）入库；强杀恢复、72h 失联、
  循环超限等扩展故障演练
- **P4 发布**：v1.0.0 + GitHub Release + 验收包 + 真实截图宣传片（BGM/静音双版本）
- 通知与协助：Windows Toast / 邮件 / Webhook / 交接流程
- IoT 适配器契约（stub）+ MCP server
- 企业专属 UI（企业看板/工作流页面）

## [0.8.0] — 2026-10-25

### Added — 阶段二 P3 企业版 MVP（B8 通过 + 30 条边界双模式表）

- **企业版引擎 `packages/steward-enterprise`**：企业主体认证（营业执照/统一社会信用代码 + 公司授权书
  **人签** + 对公账户 + 税号四项硬校验）；对公账户收款校验；增值税**普通/专用**发票；
  `createInvoiceDraft()` 开票校验（抬头/税号/合同一致）→ `draft_pending_human`（人工确认，不自动开票）；
  `createTaxFilingDraft()` 税务申报**草稿**（`ai_may_submit=false`，不自动提交）；
  **双人复核** `requestAccountChange()` / `reviewAccountChange()`（1 位不生效；2 位不同角色 finance +
  legal 才生效）；**组织审批链** `approvalChainFor()`（≤5000 1 级 / 5000–50000 2 级 / >50000 3 级）；
  **用印** `sealFlow()` + `markSealSignedByHuman()`（**`ai_may_sign=false`，仅自然人签署**）；
  用工/派遣/资质类转人工；`acquireAgentSlot()` 多代理/多账号**串行**；经营范围校验。
- **30 条边界双模式标注表**：`boundaryRules30()` 恰好 30 条（EB-01…EB-30，个人/企业 ×
  已实现/人工/不适用；四类重点越界 EB-01 无证 / EB-02 借资质 / EB-03 陌生外呼 / EB-04 超预算 =
  双模式 **deny**）；`boundaryTableMarkdown()` 生成可入库表格；全文见新增
  `docs/zh-CN/enterprise.md` + `docs/en/enterprise.md`。
- **B8 双模式一致性**：`runDualModeOrders()`——个人/企业各跑一单（主体/抬头/收款/发票类型一致），
  **6 类不一致全部阻断**（`MODE_CLIENT_TYPE_MISMATCH` / `MODE_INVOICE_TYPE_MISMATCH` /
  `MODE_PAYMENT_METHOD_MISMATCH` / `AUTHORIZATION_LETTER_NOT_SIGNED` / `TAX_NO_MISMATCH` /
  `SIGNATORY_NOT_AUTHORIZED` / `SEAL_NOT_SIGNED` 等冲突码，阻断时不产生发票/收款）。
- **企业版仿真 fixtures `examples/demo-enterprise/`**：`enterprise.json`（主体/授权书/用印/对公账户/
  税号/双人复核/3 档审批链/多代理串行）+ `orders.json` 8 条订单（2 正常 + 6 不一致，纯虚构数据）。
- **CLI**：新增 `enterprise-demo [--json]`（别名 `demo-enterprise`）→ 业务命令 19 个 + `help` 入口，
  **0 占位**。
- **测试**：133 → **151/151** 通过（新增 `tests/unit/enterprise.test.mjs` 18 条；共 16 个测试文件）。
- **`npm run acceptance:p3`**：一键验收（build + 151 测试 + 企业版流程，**12/12 检查 ✅**），生成
  `docs/test-evidence/p3-acceptance-<stamp>.{md,json}` + `evidence-p3-<stamp>/`（18 文件，已脱敏；
  企业 run `run-20261025-232357-2ce6f6`）。
- **CI**：新增 P3 企业版演示步骤（B8 + 30 条边界，无网络）。

### Changed
- 验收：**B8 通过**；30 条边界双模式标注表完成；企业 run `run-20261025-232357-2ce6f6`；P3 交付
  **v0.8.0**（GitHub Release/tag 待 Lead 按发布节奏处理；`package.json` 当前版本以仓库为准）。
- 文档同步：README 中英、ROADMAP、HANDOFF、ASSUMPTIONS、docs/README、delivery-checklist 中英、
  architecture 中英、packages/apps/tests/examples README 更新到「阶段二 P3 完成 / v0.8.0 待发版」，
  并新增 `docs/zh-CN/enterprise.md` + `docs/en/enterprise.md`。

## [0.7.0] — 2026-10-25

### Added — 阶段二 P2 故障演练（B3 / B4 短跑通过；长跑进行中）

- **故障演练模块 `packages/steward-fault`**：**真实 localhost HTTP 故障注入**（不用 mock/stub）——
  B3 断网（真实 `ECONNREFUSED`）：断网期间**不产生新承诺**（`PromisesGate` 拒绝并计数）、动作进入
  **幂等 Outbox** 排队、恢复后重放 + 对账（**账本重复 0**，二次对账全部跳过）；B4 平台封禁
  （真实 `403 + x-platform-ban: true`）：**检测后停止动作**、生成可读**替代方案**（渠道/原因/下一步/
  负责人）、本地通知留痕、解禁恢复。
- **故障注入平台 `examples/demo-platform/`**：真实 localhost 平台（主端口 `/health`/`/quote`/`/message`
  幂等 + 控制端口 `/admin/outage`、`/admin/ban`），用于断网/封禁演练。
- **CLI**：新增 `fault-drill --case net-outage|platform-ban [--outage-minutes N] [--ban-minutes N] [--json]`
  → 命令数 18 → 19。
- **测试**：113 → **133/133** 通过（新增 `tests/unit/fault.test.mjs` 20 条；P2 时点共 15 个测试文件）。
- **`npm run acceptance:p2`（短跑）**：一键短跑验收（约 2 分钟断网 + 2 分钟封禁，**11/11 检查 ✅**），
  生成 `docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.{md,json}` + `evidence-p2-.../`
  （10 文件，已脱敏；断网 `outage=120007ms`、25 次承诺被拒、25 条排队/重放、账本重复 0；
  封禁 11ms 检测、替代方案 5 条、通知留痕）。
- **CI**：新增真实 localhost 故障演练步骤（B3/B4 短跑，`--outage-minutes 0.2 --ban-minutes 0.2`）。

### Changed
- 验收：**B3/B4 短跑通过**（11/11 检查）；**真实 2 小时断网 + 15 分钟封禁长跑仍在后台运行**，
  长跑证据（`long-drill-*`）待 Lead 入库后才算完整通过。P2 交付 **v0.7.0 待发版**。
- 文档同步：README 中英、ROADMAP、HANDOFF、ASSUMPTIONS、docs/README、delivery-checklist 中英、
  architecture 中英、packages/apps/tests/examples README 更新到「P2 短跑通过 / 长跑进行中」。

## [0.6.0] — 2026-10-25

### Added — 阶段二 P1 个人版 MVP（验收 B1 / B2 / B5 / B6 / B7 通过）

- **经营域引擎 `packages/steward-domain`**：8 概念数据模型（委托 / 预算三层 / 项目 / 任务 / 代理 / 证据 /
  账本 / 墓碑 + 置信度四档）；选题提案（≥3 条业务线、来源可查）；账本**6 要素**（金额/收付方/依据/
  审批人/回执/所属项目）；承诺追溯（对话原文→委托条款→项目，未记录=未授权）；审批卡超时挂起
  （不自动放行）；接管键 + **6 类接管包**（含凭据引用）；月报；L0/L1/L2 摘要；**18 条个人模式边界规则**
  （全目录 20 条，企业模式 19 条）；仿真业务线端到端；`domain/state.json` 原子写 +
  `domain/events.jsonl` 只追加审计（detail 脱敏）。纯逻辑、零第三方依赖、无网络、无真实资金。
- **本地 Web 控制台 `packages/steward-console`**：零第三方依赖（Node 内置 `http` + 原生 HTML/CSS/JS）；
  **只监听 127.0.0.1**、写操作需 `X-Steward-Token`、无 CDN/外链/内联脚本（CSP）；页面：看板 / 项目
  时间线 / 账本 6 要素抽屉 / 审批卡（批准/驳回）/ 接管键（停止 + 6 类接管包 + 恢复）/ 月报 /
  `/health` + JSON API。
- **真实浏览器 E2E `tests/e2e-console/`**：有头 Chrome，9 步 / 73 项检查 / 9 张截图，浏览器实测接管
  停止 **88ms**（≤10000ms）；断言只监听本机、写操作无 token → 401、同源无外链、无页面 JS 错误。
- **仿真业务线 `examples/demo-business/`**：一条纯虚构个人版业务线（3 条候选业务线 / 客户询价 / 报价 /
  9 任务 / 7 消息 / 交付物 / 收款 / 发票 / 支出 / 月报；保留域名、无真实个人信息）。
- **CLI 新增命令**：`business`（选题/仿真业务线/账本 6 要素/承诺追溯/接管包/月报/边界）、
  `boundary-check`（18 条边界规则自检）、`console`（本地 Web 控制台，`--port` 默认 4180）、
  `approve`（真实人工审批，超时挂起不自动放行）、`takeover`（真实接管/恢复，`--resume`）→
  命令数 13 → **18 个已实现 + 0 个占位**（原 `takeover`/`approve` 占位转真实实现）。
- **`npm run acceptance:p1`**：一键验收（build + 113 测试 + business/boundary-check + 控制台真实浏览器
  E2E + CLI 控制台真实浏览器 + 人工审批），生成 `docs/test-evidence/p1-acceptance-<stamp>.{md,json}`
  并把 business-run / boundary-run / console-e2e / console-cli / takeover 证据 + `unit-tests.log`
  复制到 `docs/test-evidence/evidence-p1-<stamp>/`（本次 39 文件，已脱敏）。
- **测试**：80 → **113/113** 通过（新增 `tests/unit/domain.test.mjs` 30 条 +
  `tests/unit/phase2-cli.test.mjs` 3 条；共 14 个测试文件）。
- **CI**：新增 Phase-2 `business` / `boundary-check` 步骤 + Console E2E（无头真实浏览器）。

### Changed
- `package.json` 版本 0.5.0 → **0.6.0**；CLI `VERSION` 同步 0.6.0。
- 验收：B1 / B2 / B5 / B6 / B7 通过（P1 验收 12/12 检查；B6 `stop_ms=3` ≤10000 + 6 类接管包；
  B7 18 条规则、四类越界 4/4 拒绝、支付→human、报价→draft_only）；**B3/B4 延后 P2、B8 延后 P3**。
  证据 `docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
  `docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`（39 文件）；runs `run-20261025-221904-b56b1a`
  （business）、`run-20261025-221904-89b2f3`（boundary）。
- 文档同步：README 中英、ROADMAP、HANDOFF、ASSUMPTIONS、docs/README、delivery-checklist 中英、
  architecture 中英、packages/apps/tests/examples README 更新到「阶段二 P1 完成 / v0.6.0」。

## [0.5.0] — 2026-10-25

### Added — M4 开源发布收尾（阶段一完成，验收 A10 / A11 / A12 通过）

- **发布文档**：新增 `docs/good-first-issues.md`（5 个 good-first-issue，中英双语，均可离线验证）、
  `docs/demo-script.zh-CN.md` + `docs/demo-script.md`（3 分钟真实命令演示脚本）、
  `docs/RELEASE_NOTES_v0.5.0.md`（阶段一 v0.5.0 发布说明，中英双语：亮点、A1–A12 验收对照、
  安装与快速开始、许可证、已知限制、下一步）。
- **A10 只读 dummy 分支**：CLI 新增命令 `dummy-branch`——新增只读分支只需 BranchSpec +
  已有 `reviewer@1.0.0` 提示词，**不改核心**；命令数 12 → **13 个已实现 + 2 个占位**
  （`takeover`、`approve` 仍为占位）。
- **A11 发布就绪**：`npm run acceptance:m4` 一键检查——build、**80/80** 测试、A10 dummy 分支、
  CC BY-NC-SA 4.0 许可证全文 + 非商用条款、NOTICE 第三方声明、COMMERCIAL 商用说明、中英双语文档配对、
  源码无遥测、`package.json` 与 CLI `VERSION` 一致（0.5.0）、发布文档齐全。
- **测试**：74 → **80/80** 通过（新增 `tests/unit/m4-release.test.mjs` 6 条：A10 dummy 分支、
  A11 许可证/第三方声明/双语文档/无遥测/发布文档、版本一致性；共 12 个测试文件）。
- **CI**：新增 A10 `dummy-branch` 演示步骤；CI #10（Windows + Ubuntu）全绿。

### Changed
- `package.json` 版本 0.4.0 → **0.5.0**；CLI `VERSION` 同步 `0.5.0`；发布 GitHub Release
  [v0.5.0](https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0)。
- 验收：A10 / A11 / A12 通过；**A1–A12 全部通过**，阶段一（M0–M4）完成。证据索引
  `docs/test-evidence/`（M0 test-result、M1/M2/M3 acceptance + M4 `m4-acceptance-<stamp>.{md,json}` /
  `evidence-m4-<stamp>/`，由 `npm run acceptance:m4` 生成）。
- 文档同步：README 中英、ROADMAP、HANDOFF、ASSUMPTIONS、docs/README、delivery-checklist 中英、
  architecture 中英、packages/apps/tests/examples README 更新到「阶段一完成 / v0.5.0」。

## [0.4.0] — 2026-10-25

### Added — M3 客户分支 Scout（验收 A7 通过）

- **Scout 核心模块 `packages/steward-scout`**：`ScoutEngine` 实现 ICP 画像与恰好 3 个高价值场景、
  四因子评分（需求 40% / 预算 20% / 可触达性 20% / 合规 20%）、来源硬校验（缺 `source_url` /
  非 http(s) / 空 `signal` / 空 `consent_basis` 一律丢弃并留证）、`org+signal` 归一化去重、
  ≤150 字外联草稿（引用具体信号、不冒充人类、不群发）、人工审批队列（默认全部 `pending`）、
  每日每渠道 ≤10 频控、退订拦截、回复/会议统计与 `ScoutReport`。模块**纯逻辑、零第三方依赖、
  零网络 IO**：所有"发送"类方法只记录状态，不真正外发。
- **合规线索 fixtures `examples/scout-fixtures/`**：14 条**纯虚构**线索（`leads.json` + 中文 README），
  域名一律保留域名 `example.com`/`example.org`，无真实个人信息；覆盖合格、缺来源、非法 URL、
  空合规依据、重复五类质量池。
- **CLI 新增命令 `scout`**（`--fixture <path>` / `--json`）：fixture 驱动跑 Scout 分支并写证据
  （`scout-report.md/.json`、`leads-scored.json`、`drafts.json`、`approval-queue.json`、
  `outreach-drafts/`）→ 命令数 11 → **12 个已实现 + 2 个占位**（`takeover`、`approve` 仍为占位）。
- **`npm run acceptance:m3`**：一键验收（build + 74 测试 + Scout 运行 + A7 的 12 项检查），生成
  `docs/test-evidence/m3-acceptance-<stamp>.{md,json}` 并把 scout-run 证据 + `unit-tests.log`
  复制到 `docs/test-evidence/evidence-m3-<stamp>/`（本次 15 文件，已脱敏）。
- **测试**：53 → **74/74** 通过（新增 `tests/unit/scout.test.mjs` 21 条；共 11 个测试文件）。
- **CI**：新增 Scout demo 步骤（fixture 驱动、无网络、只起草不发送）。

### Changed
- `package.json` 版本 0.3.0 → **0.4.0**；CLI `VERSION` 同步 `0.4.0`。
- 验收：A7 通过；累计 A1/A2/A3/A4/A5/A6/A7/A8/A9/A12 通过。证据
  `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
  `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件）；Scout run
  `run-20261025-200457-17b4e7`：14 条线索 → 丢弃 4 → 合格 8 → 3 条草稿（110–113 字）→
  审批队列全 `pending`、`sent_count=0`。

## [0.3.0] — 2026-10-25

### Added — M2 真实桌面与安全模块（验收 A3 / A8 / A9 通过）

- **真实 Windows 桌面适配器 `packages/steward-desktop`**：Python ctypes 侧车（长驻）实现真实 Win32
  调用——`EnumWindows` 窗口枚举、`SetForegroundWindow` 聚焦、`BitBlt` + 自写 PNG 编码截图、
  `SendInput` 真实鼠标与 **Unicode 真实键盘**（中文直送，不走剪贴板）；白名单默认拒绝
  （`DesktopAllowlistError`）、Per-Monitor V2 DPI 感知、5 类失败分类（`window-not-found` /
  `focus-lost` / `timeout` / `allowlist-denied` / `unknown`）、每步截图证据、凭据/安全提示命中即
  停止交人；导出 10 个 `desktop.*` ToolSpec + 编排级 `desktop.flow`。契约见
  `docs/*/adapters.md` 第 2 节，细节见 `packages/steward-desktop/README.md`。
- **真实桌面 E2E `tests/e2e-desktop/`**：`run.mjs` 用 `examples/demo-desktop` 真实 tkinter 窗口 +
  真实键鼠完成打开→填表→保存→校验→截图，断言真实 JSON 内容与校验失败不写文件；A3 实测
  **36/36 检查通过、20 张逐步截图、15 个交互步骤全部有截图**。
- **停止键 `packages/steward-core/src/stop-controller.ts`**：200ms watchdog 轮询 + `AbortController`
  即时 abort + `withAbort` 兜底（≤5s），CLI `safety-check` 实测停止耗时 **305ms**。
- **检查点 `packages/steward-core/src/checkpoint.ts`**：`checkpoint.json` 原子写、
  `listResumable`、`markStepDone`/`markCompleted`；runtime 每步落检查点，`run --resume <runId>`
  跳过已完成步骤、不重复执行。
- **分支隔离 `packages/steward-core/src/isolation.ts`**：`CredentialVault` 按分支隔离凭据引用 +
  脱敏（跨分支读取抛 `CrossBranchAccessError`）、`ProfileLock` 同一 profile 独占
  （并发占用抛 `ProfileBusyError`）、`assertBranchToolsAllowed` 工具白名单断言。
- **runtime 集成**：StopController 运行中抢占、每步 checkpoint、resume、`ToolContext` 提供
  `signal` / `locks` / `vault`。
- **CLI 新增命令**：`desktop-flow`（别名 `demo-desktop`）、`safety-check`、`run --resume <runId>`；
  命令数 9 → **11 个已实现 + 2 个占位**（`takeover`、`approve` 仍为占位）。
- **`npm run acceptance:m2`**：一键本机真实验收（build + 53 测试 + A3 桌面流程 + A8 停止键/检查点 +
  A8 resume runtime + A9 隔离），生成
  `docs/test-evidence/m2-acceptance-<stamp>.{md,json}` 并把证据复制到
  `docs/test-evidence/evidence-m2-<stamp>/`（本次 34 文件，已脱敏）。
- **测试**：35 → **53/53** 通过（新增 `tests/unit/m2-safety.test.mjs` 14 条 +
  `tests/unit/m2-runtime.test.mjs` 4 条；共 10 个测试文件）。
- **CI**：新增 `safety-check` 步骤（停止键 ≤5s / 检查点 / 分支隔离）；真实桌面 E2E 只能本机跑。

### Changed
- `package.json` 版本 0.2.0 → **0.3.0**（M2 交付版本）。
- `steward-core` 公开入口新增 `stop-controller` / `checkpoint` / `isolation` 三个模块；
  `AgentRuntime` 内置停止控制器、检查点存储、profile 锁与凭据 vault。
- 验收：A3 / A8 / A9 通过；累计 A1/A2/A3/A4/A5/A6/A8/A9/A12 通过。证据
  `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件）；A3 run
  `run-20261025-185100-6a4d70`，A8/A9 自检
  `evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`。

## [0.2.0] — 2026-10-25

### Added — M1 真实浏览器回路（验收 A2 / A4 / A5 / A6 通过）

- **真实浏览器适配器 `packages/steward-browser`**：Playwright 驱动本机 Chrome/Edge，**有头默认**、
  `chrome → msedge` 回退；每次运行独立 `userDataDir`；每步截图 / DOM / console 证据；5 类失败分类；
  风控关键词命中 → `RiskControlStopError` 停止交人；adapter-smoke **28/28 PASS**。
- **编码回路 `packages/steward-harness/src/patch.ts` + `loop.ts`**：`patch.ts` 在隔离 git worktree
  应用 unified diff；`loop.ts` 的 `runCodeLoop` 最多两轮，超限升级（`escalated=true`，退出码 1，不无限重试）。
- **CLI 新增命令**：`browser-flow`（真实浏览器登录→提交→校验，逐步截图）、`code-loop`（CodeTask→
  补丁→worktree→真实浏览器验收，`--fail` 注入坏补丁）；兼容别名 `demo-browser` / `demo-code-loop`。
  命令数 7 → **9 个已实现 + 2 个占位**（`takeover`、`approve`）。
- **真实浏览器 E2E `tests/e2e-browser/`**：`login-flow.mjs` 支持 `normal`（应绿）/ `login-timeout`
  （修复前应红，复现预置缺陷）/ `--expect-red` 模式；`adapter-smoke.mjs` 适配器冒烟 28/28 PASS。
- **脚本化补丁**：`examples/mock-harness/fix-login-timeout.patch`（真实修复）与
  `broken-login-timeout.patch`（失败注入）。
- **`npm run acceptance`**：一键本机有头验收（build + A2 + A4 + A5），生成
  `docs/test-evidence/m1-acceptance-<stamp>.{md,json}` 并把截图/日志/结果复制到
  `docs/test-evidence/evidence-m1-<stamp>/`（本次 45 文件：A2/A4/A5 三组）。
- **测试**：30 → **35/35** 通过（新增 `tests/unit/code-loop.test.mjs` 5 条，含 Windows CRLF 补丁归一化回归）。
- **CI**：新增无头真实浏览器 E2E（`login-flow.mjs --case normal --headless 1`）；有头验收仅本机。

### Changed
- `steward-harness` 由 MockHarness 扩展为含补丁应用与两轮编码回路；
  `tests/unit` 覆盖编码回路的成功、失败与升级路径。
- 验收：A2 / A4 / A5 / A6 通过；证据 `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}`
  + `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`；runs `run-20261025-175213-9ea8ab`（A2）、
  `run-20261025-175216-fe8759`（A4）、`run-20261025-175223-de0b95`（A5）。

### Fixed
- **Windows CI**（提交 `b4ed316`）：Windows runner 曾把 `*.patch` 转成 CRLF 导致 `git apply` 失败；
  `.gitattributes` 改为全仓 `eol=lf`（`*.patch` / `*.diff` 显式 `eol=lf`），`patch.ts` 归一化 CRLF，
  并新增 CRLF 回归测试（测试数 34 → 35）。
- **证据脱敏**：新增 `scripts/sanitize.mjs` / `scripts/sanitize-evidence.mjs`，M1 acceptance bundle
  已脱敏（无本机绝对路径）；当前证据 `m1-acceptance-2026-10-25_09-52-12.{md,json}` +
  `evidence-m1-2026-10-25_09-52-12/`（45 文件）。

## [0.1.0] — 2026-10-25

### Added — M0 内核最小闭环（验收 A1 / A6 / A12 通过）

- **AgentRuntime 内核**：`AgentRuntime`（计划→行动→观察→反思→报告）、`BranchSpec` / `BranchManager`、
  `PolicyEngine`（allow / deny / approve / unknown，高风险默认拒绝）、`ArtifactBus`、`PromptManager`、
  `EventLog`（只追加 + seq + 哈希链 + 密钥脱敏）、`BudgetGuard`（80% 告警 / 100% 暂停）、`StopSignal`。
- **CLI（7 命令 + 2 占位）**：`steward demo`（空回路，MockHarness，无付费 API）、`run`、`branch`、
  `report`、`stop`、`version`、`help`；`takeover`（阶段二）、`approve`（M1）为占位。
- **MockHarness + 代码回路骨架**：`CodeTask` 校验 → MockHarness 生成 unified diff → 保存
  `code-task.json` / `code-result.json` / `patch.diff` / `test.log`。
- **prompts v1**：conductor / operator / scout / reviewer 4 份运行时提示词，`prompts/manifest.json`
  记录版本与 sha256，安全条款 + 禁止项 + 无密钥/本机路径测试覆盖（`npm run test:prompts`）。
- **演示素材**：`examples/demo-web`（Node 内置 http，预置“登录超时无提示”缺陷）与
  `examples/demo-desktop`（tkinter 真窗口表单），供 M1/M2 真实浏览器/桌面验收使用。
- **工程布局**：从 pnpm workspace 改为**单包布局**（H: exFAT 不支持符号链接），`tsc -p tsconfig.json`
  编译 `packages/*/src` + `apps/cli/src` → `dist/`；全部命令改用 npm。
- **测试**：30/30 单元 + 集成测试通过（`npm test`：build + `node --test "tests/unit/*.test.mjs"`）。
- **证据脚本**：`npm run evidence` 自动 build + tests + demo，生成
  `docs/test-evidence/test-result-<stamp>.{md,json}`；每次运行产物写入 `runs/<run-id>/`
  （prompt.md / report.md / console.log / meta.json / events.jsonl / patch.diff / test.log 等）。
- **文档**：README（中英）、ROADMAP、HANDOFF、ASSUMPTIONS、验收清单更新为 M0 完成状态；
  新增 `docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}` 与
  `docs/test-evidence/2026-10-25-repo-publish.md`。

### Changed
- 开发命令从 pnpm 全面切换为 npm；构建改为单包 `tsc`（无 workspace）。

## [0.0.1] — 2026-10-25

### Added
- **GitHub 公开仓库发布**：https://github.com/minzzj/daizhang-steward（2026-10-25，public，许可证显示 Other 属预期）
- 发布验证证据：`docs/test-evidence/2026-10-25-repo-publish.md` + 真实浏览器截图 `docs/images/repo-home-2026-10-25.png`
- 仓库脚手架：目录结构、pnpm workspace、tsconfig、GitHub Actions CI 骨架
- 许可证 **CC BY-NC-SA 4.0**、`COMMERCIAL.md`、`NOTICE`（第三方 MIT 组件声明）
- 双语 README、ROADMAP、ASSUMPTIONS、HANDOFF、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT
- 双语文档骨架：architecture / contracts / threat-model / adapters / runtime-prompts / delivery-checklist
- 脚手架自检 `pnpm check`、密钥扫描 `pnpm check:secrets`、交付同步脚本 `scripts/sync-delivery.ps1`

[Unreleased]: https://github.com/minzzj/daizhang-steward/compare/v0.6.0...HEAD
[0.8.0]: https://github.com/minzzj/daizhang-steward/compare/v0.6.0...0185e50
[0.7.0]: https://github.com/minzzj/daizhang-steward/compare/v0.6.0...a41fe68
[0.6.0]: https://github.com/minzzj/daizhang-steward/compare/v0.5.0...2db8da3
[0.5.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0
[0.4.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.4.0
[0.3.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.3.0
[0.2.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.2.0
[0.1.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.1.0
[0.0.1]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.0.1
