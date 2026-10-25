# HANDOFF / 交接状态

> 给下一次会话（或下一位执行者）的现状交接。每次里程碑结束更新。
> 最后更新：2026-10-25（**阶段二 P3 企业版完成，v0.8.0 待发版；P2 短跑通过、长跑进行中**；
> 下一步 P2 长跑收尾 + P4 v1.0.0/宣传片）

## 当前状态（一句话）

**阶段二 P3（企业版 MVP）已完成并交付 v0.8.0（待发版）；P2 故障演练短跑已通过、真实长跑进行中**：
在阶段一内核（A1–A12 通过）与 P1 个人版（v0.6.0）之上，新增
`packages/steward-fault` 故障演练（真实 localhost HTTP 断网/封禁、离线承诺闸门、幂等 Outbox 重放、
替代方案 + 本地通知；B3/B4 短跑 11/11 通过，2 小时断网 + 15 分钟封禁长跑仍在后台运行）、
`packages/steward-enterprise` 企业版（主体/授权/用印、对公账户、专票校验、发票/申报仅草稿、
双人复核、组织审批链、AI 不代签、B8 双模式 6 类不一致阻断、30 条边界双模式表）、
`examples/demo-platform` 与 `examples/demo-enterprise`；CLI 新增 `fault-drill`、`enterprise-demo` →
**19 个已实现命令 + 0 个占位**。**151/151** 测试（16 个文件）；阶段二 **B1/B2/B5/B6/B7/B8 通过**
（P3 验收 12/12 检查）；代码已推送 GitHub `main`（P3 提交 `0185e50`）；**等待 P2 长跑完成 + P4
（v1.0.0/宣传片）**。

## M0 已完成清单（2026-10-25）

- [x] 内核：AgentRuntime / BranchSpec / PolicyEngine / ArtifactBus / PromptManager / EventLog / BudgetGuard / StopSignal
- [x] CLI：`demo` / `run` / `branch` / `report` / `stop` / `version` / `help`（`takeover`、`approve` 为占位）
- [x] MockHarness + CodeTask/CodeResult 骨架，`patch.diff`、`test.log` 落盘
- [x] prompts v1（4 角色）+ `prompts/manifest.json` sha256 + 提示词测试
- [x] 30/30 单元+集成测试通过；`npm run check`、`npm run check:secrets`、`npm test`、
      `npm run demo`、`npm run evidence` 全部通过
- [x] 单包构建（`tsc -p tsconfig.json` → `dist/`）+ 全部命令改用 npm；C: 旧副本转为归档
- [x] 验收 A1 / A6 / A12 通过（见 [ROADMAP.md](ROADMAP.md) 与 `docs/*/delivery-checklist.md`）
- 代码状态：已在 GitHub `main` 分支（后续提交见仓库历史；阶段一发版已在 M4 完成，v0.5.0）

## M1 已完成清单（2026-10-25）

- [x] `packages/steward-browser`：Playwright 真实浏览器适配器（有头默认、`chrome→msedge` 回退、
      每 run 独立 `userDataDir`、每步截图/DOM/console、5 类失败分类、风控关键词 → 停交人；
      adapter-smoke 28/28 PASS）
- [x] `packages/steward-harness/src/patch.ts`（隔离 git worktree 应用补丁）+
      `loop.ts`（`runCodeLoop` 最多两轮、超限升级，`escalated=true` / exit 1）
- [x] CLI 新增 `browser-flow` / `code-loop`（别名 `demo-browser` / `demo-code-loop`）→ 9 命令 + 2 占位
- [x] `tests/e2e-browser/`：真实浏览器 E2E（normal 绿 / login-timeout 红 / `--expect-red`）+ adapter-smoke
- [x] 脚本化补丁 `examples/mock-harness/fix-login-timeout.patch`（真实修复）与
      `broken-login-timeout.patch`（失败注入）
- [x] `npm run acceptance` 一键本机有头验收；证据
      `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
      `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件：A2/A4/A5 三组）
- [x] 测试 30 → **35/35**（新增 `tests/unit/code-loop.test.mjs` 5 条，含 Windows CRLF 补丁归一化回归）
- [x] **Windows CI 修复**（提交 `b4ed316`）：`.gitattributes` 全仓 `eol=lf`（`*.patch` / `*.diff` 也强制 LF）
      + `patch.ts` 归一化 CRLF，修复 Windows runner 把补丁转 CRLF 导致 `git apply` 失败；新增 CRLF 回归测试
- [x] **GitHub Actions CI #5（提交 `b4ed316`）Windows + Ubuntu 全绿**（build / 35 测试 / demo 证据 / 无头真实浏览器 E2E）
- [x] CI 增加无头真实浏览器 E2E（`login-flow.mjs --case normal --headless 1`）
- [x] 验收 **A2 / A4 / A5 / A6 通过**（runs `run-20261025-175213-9ea8ab` /
      `run-20261025-175216-fe8759` / `run-20261025-175223-de0b95`）

## M2 已完成清单（2026-10-25）

- [x] `packages/steward-desktop`：**真实 Windows 桌面适配器**——Python ctypes 侧车（长驻；
  `EnumWindows`/`SetForegroundWindow`/`BitBlt` 截图 + 自写 PNG 编码/`SendInput` 真实鼠标与
  Unicode 真实键盘）、白名单默认拒绝、Per-Monitor V2 DPI 感知、5 类失败分类
  （`window-not-found`/`focus-lost`/`timeout`/`allowlist-denied`/`unknown`）、每步截图证据、
  凭据/安全提示命中即停止交人；10 个 `desktop.*` ToolSpec + 编排级 `desktop.flow`
- [x] `tests/e2e-desktop/`：真实桌面 E2E（`run.mjs`，真实键鼠 + 每步截图 + JSON 内容断言）；
  A3 实测 **36/36 检查通过、20 张逐步截图、15 个交互步骤全部有截图**
- [x] `packages/steward-core/src/stop-controller.ts`：停止键 ≤5s（200ms watchdog +
  `AbortController` + `withAbort` 超时兜底；停止实测 **305ms**）
- [x] `packages/steward-core/src/checkpoint.ts`：检查点原子写、`listResumable`、
  `markStepDone`/`markCompleted`；`run --resume <runId>` 跳过已完成步骤、不重复执行
- [x] `packages/steward-core/src/isolation.ts`：`CredentialVault` 跨分支隔离 + 脱敏
  （`CrossBranchAccessError`）、`ProfileLock` 同一 profile 独占（`ProfileBusyError`）、
  `assertBranchToolsAllowed` 白名单断言
- [x] runtime 集成：StopController 运行中抢占、每步 checkpoint、resume、`ToolContext` 提供
  `signal`/`locks`/`vault`
- [x] CLI 新增 `desktop-flow`（别名 `demo-desktop`）、`safety-check`、`run --resume <runId>`
  → **11 个已实现命令 + 2 个占位**（`takeover`/`approve` 仍为占位）
- [x] 测试 35 → **53/53**（新增 `tests/unit/m2-safety.test.mjs` 14 条 + `tests/unit/m2-runtime.test.mjs`
  4 条；10 个测试文件）
- [x] `npm run acceptance:m2` 一键本机真实验收（build + 53 测试 + A3 + A8 停止键/检查点 +
  A8 resume runtime + A9 隔离）；证据 `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}`
  + `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件，已脱敏）
- [x] CI 增加 `safety-check` 步骤；真实桌面 E2E 只能本机跑（托管 CI 无交互桌面）
- [x] 验收 **A3 / A8 / A9 通过**（A3 run `run-20261025-185100-6a4d70`；A8/A9 自检
  `evidence-m2-…/A8-A9-safety-check/safety-check-result.json`）

## M3 已完成清单（2026-10-25）

- [x] `packages/steward-scout`：**Scout 客户分支引擎**（`ScoutEngine`，纯逻辑零依赖零网络）——
  ICP + 恰好 3 个高价值场景、四因子评分（需求 40% / 预算 20% / 可触达 20% / 合规 20%）、
  来源硬校验（缺 `source_url`/非 http(s)/空 `signal`/空 `consent_basis` 即丢弃并留证）、
  `org+signal` 归一化去重、≤150 字草稿（引用具体信号、不冒充人类、不群发）、人工审批队列
  （默认全部 `pending`）、每日每渠道 ≤10、退订拦截、回复/会议统计、`ScoutReport`
- [x] `examples/scout-fixtures/`：**14 条纯虚构合规线索**（`leads.json` + 中文 README；保留域名、
  无真实个人信息；覆盖合格/缺来源/非法 URL/空依据/重复五类质量池）
- [x] CLI 新增 `scout`（`--fixture <path>` / `--json`）：fixture → 评分 → 3 条草稿 → 审批队列，
  写 `scout-report.md/.json`、`leads-scored.json`、`drafts.json`、`approval-queue.json`、
  `outreach-drafts/` → **12 个已实现命令 + 2 个占位**（`takeover`/`approve` 仍为占位）
- [x] 测试 53 → **74/74**（新增 `tests/unit/scout.test.mjs` 21 条；共 11 个测试文件）
- [x] `npm run acceptance:m3` 一键验收（build + 74 测试 + Scout 运行 + A7 的 12 项检查）；
  证据 `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
  `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件，已脱敏）
- [x] CI 增加 Scout demo 步骤（fixture 驱动、无网络、只起草不发送）
- [x] 验收 **A7 通过**（run `run-20261025-200457-17b4e7`：14 线索 → 丢弃 4 → 合格 8 →
  3 草稿 110–113 字 → 审批全 pending、0 发送；丢弃原因全部留证）

## M4 已完成清单（2026-10-25，阶段一收尾 → v0.5.0）

- [x] **A10 只读 dummy 分支**：CLI 新增 `dummy-branch`（别名 `demo-dummy`）——仅 BranchSpec +
  已有 `reviewer@1.0.0` 提示词，不改核心；命令数 12 → **13 个已实现 + 2 个占位**
- [x] **A11 发布就绪**：`npm run acceptance:m4` 一键检查——build、**80/80** 测试、A10 dummy 分支、
  CC BY-NC-SA 4.0 许可证全文 + 非商用条款、NOTICE 第三方声明、COMMERCIAL 商用说明、中英双语文档配对、
  源码无遥测、`package.json` 与 CLI `VERSION` 均 0.5.0、发布文档齐全
- [x] 发布文档：`docs/good-first-issues.md`（5 个 GFI，中英双语、均可离线验证）、
  `docs/demo-script.zh-CN.md` + `docs/demo-script.md`（3 分钟真实命令演示脚本）、
  `docs/RELEASE_NOTES_v0.5.0.md`（中英发布说明）
- [x] 测试 74 → **80/80**（新增 `tests/unit/m4-release.test.mjs` 6 条：A10/A11 检查、版本一致性；
  共 12 个测试文件）
- [x] CI 增加 A10 `dummy-branch` 步骤；CI #10（Windows + Ubuntu）全绿
- [x] `package.json` 0.4.0 → **0.5.0**、CLI `VERSION` 同步；GitHub **Release v0.5.0** 发布
- [x] 验收 **A10 / A11 / A12 通过**；**A1–A12 全部通过 → 阶段一完成**
  （M4 证据：`docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` +
  `evidence-m4-2026-10-25_13-43-07/`，已脱敏）

## P1 已完成清单（2026-10-25，阶段二个人版 MVP → v0.6.0）

- [x] `packages/steward-domain`：**经营域引擎**——8 概念（委托 / 预算三层 / 项目 / 任务 / 代理 / 证据 /
  账本 / 墓碑 + 置信度四档）；选题提案；账本 **6 要素**；承诺追溯（对话原文→委托条款→项目，
  未记录=未授权）；审批卡超时挂起（不自动放行）；接管键 + **6 类接管包**；月报；L0/L1/L2 摘要；
  **18 条个人模式边界规则**（全目录 20 条）；仿真业务线端到端；`domain/state.json` 原子写 +
  `domain/events.jsonl` 只追加审计（detail 脱敏）
- [x] `packages/steward-console`：**本地 Web 控制台**——零第三方依赖（Node 内置 http + 原生
  HTML/CSS/JS）、**只监听 127.0.0.1**、写操作 `X-Steward-Token`、无 CDN/外链；看板 / 项目时间线 /
  账本 6 要素抽屉 / 审批卡 / 接管键 / 月报 / `/health`
- [x] `tests/e2e-console/`：**真实浏览器 E2E**（有头 Chrome；9 步 / 73 项检查 / 9 张截图；
  `measured_stop_ms=88` ≤10000；断言只监听本机、写操作无 token→401、同源无外链）
- [x] `examples/demo-business/`：一条**纯虚构**仿真个人版业务线（3 条候选业务线 / 客户询价 / 报价 /
  9 任务 / 7 消息 / 交付物 / 收款 / 发票 / 支出 / 月报；保留域名、无真实个人信息）
- [x] CLI 新增 `business`、`boundary-check`、`console`、`approve`（真实人工审批）、`takeover`
  （真实接管/恢复，`--resume`）→ **18 个已实现命令 + 0 个占位**（原 takeover/approve 占位转实现）
- [x] 测试 80 → **113/113**（新增 `tests/unit/domain.test.mjs` 30 条 + `tests/unit/phase2-cli.test.mjs`
  3 条；共 14 个测试文件）
- [x] `npm run acceptance:p1` 一键验收（build + 113 测试 + business/boundary-check + 控制台 E2E +
  CLI 控制台真实浏览器 + 人工审批，12 项检查）；证据
  `docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
  `evidence-p1-2026-10-25_14-18-54/`（39 文件，已脱敏）
- [x] CI 增加 Phase-2 `business` / `boundary-check` 步骤 + Console E2E（无头真实浏览器）
- [x] 验收 **B1 / B2 / B5 / B6 / B7 通过**（B6 `stop_ms=3` ≤10000 + 6 类接管包；B7 18 条规则、
  四类越界 4/4 拒绝、支付→human、报价→draft_only）；B3/B4 延后 P2、B8 延后 P3
- [x] `package.json` 0.5.0 → **0.6.0**；CLI `VERSION` 同步 0.6.0；P1 提交已推送 `main`（`2db8da3`）

## P2 已完成清单（2026-10-25，故障演练 → 短跑通过 / 长跑进行中，v0.7.0 待发版）

- [x] `packages/steward-fault`：**真实故障演练模块**——真实 localhost HTTP 故障注入
  （真实 `ECONNREFUSED` 断网 / 真实 `403 + x-platform-ban: true` 封禁，不用 mock/stub）、
  断网期间**承诺闸门**（`PromisesGate` 拒绝新承诺并计数）、**幂等 Outbox**（排队动作 + 恢复后重放 +
  对账，账本 `duplicates_found=0`）、**平台封禁检测**（检测后停止动作）、**替代方案**生成与本地通知留痕
- [x] `examples/demo-platform/`：真实 localhost 故障注入平台（主端口 + 控制端口 `/admin/*`，可模拟断网/封禁）
- [x] CLI 新增 `fault-drill --case net-outage|platform-ban [--outage-minutes N] [--ban-minutes N] [--json]`
  → 命令数 18 → **19**
- [x] `tests/unit/fault.test.mjs` 20 条；测试 113 → **133/133**（P2 时点）
- [x] `npm run acceptance:p2` 短跑验收（build + 133 测试 + B3/B4 演练，**11/11 检查 ✅**）；证据
  `docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.{md,json}` +
  `evidence-p2-2026-10-25_15-02-52/`（10 文件，已脱敏）；短跑实测：断网 `outage=120007ms`、
  25 次承诺被拒、25 条排队/重放、账本重复 **0**、恢复 10 分钟内；封禁 **11ms 检测**、替代方案 5 条、
  本地通知留痕、解禁恢复
- [x] CI 增加真实 localhost 故障演练步骤（B3/B4 短跑，`--outage-minutes 0.2 --ban-minutes 0.2`）
- [ ] **真实 2 小时断网 + 15 分钟封禁长跑仍在后台运行**；长跑证据（`long-drill-*`）待由 Lead 入库后
  才能判定 P2 完整通过（当前状态：**短跑通过 / 长跑进行中**）

## P3 已完成清单（2026-10-25，企业版 MVP → v0.8.0 待发版）

- [x] `packages/steward-enterprise`：**企业版引擎**——主体认证（营业执照/统一社会信用代码 + 公司授权书
  **人签** + 对公账户 + 税号四项校验）；对公账户；增值税**普通/专用**发票；`createInvoiceDraft()`
  开票校验（抬头/税号/合同一致）→ `draft_pending_human`；`createTaxFilingDraft()` 申报草稿
  （`ai_may_submit=false`）；**双人复核**（1 位不生效、2 位不同角色 finance+legal 才生效）；
  `approvalChainFor()` **组织审批链**（≤5000 1 级 / 5000–50000 2 级 / >50000 3 级）；
  `sealFlow()` 用印（**`ai_may_sign=false`，仅自然人可签**）；用工/派遣/资质类转人工；
  `acquireAgentSlot()` 多代理串行；**B8 `runDualModeOrders()`**（个人/企业各一单 + 6 类不一致阻断）；
  `boundaryRules30()` **30 条边界双模式标注表**
- [x] **30 条边界双模式标注表**：完整 30 行（EB-01…EB-30，个人/企业 × 已实现/人工/不适用），
  四类重点越界（EB-01 无证 / EB-02 借资质 / EB-03 陌生外呼 / EB-04 超预算）双模式 **deny**；
  全文见新建 `docs/zh-CN/enterprise.md` + `docs/en/enterprise.md`（来源
  `evidence-p3-2026-10-25_15-23-46/enterprise-run/boundary-table.md` 逐行一致）
- [x] `examples/demo-enterprise/`：纯虚构企业 fixtures——`enterprise.json`（主体/授权书/用印/对公账户/
  税号/双人复核/3 档审批链/多代理串行）+ `orders.json` 8 条订单（2 正常 + 6 不一致）
- [x] CLI 新增 `enterprise-demo [--json]`（别名 `demo-enterprise`）→ 业务命令 **19 个 + `help` 入口**
  （P1 18 → P2 +`fault-drill` → P3 +`enterprise-demo`；**0 个占位**；`steward help` 列出全部）
- [x] `tests/unit/enterprise.test.mjs` 18 条；测试 133 → **151/151**（共 16 个测试文件）
- [x] `npm run acceptance:p3` 一键验收（build + 151 测试 + 企业版全流程，**12/12 检查 ✅**）；
  证据 `docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.{md,json}` +
  `evidence-p3-2026-10-25_15-23-46/`（18 文件，已脱敏；企业 run `run-20261025-232357-2ce6f6`）
- [x] **B8 通过**：个人/企业双模式各跑一单（subject/invoice/payment consistent=true），
  **6 类不一致全部阻断**（`mismatch_scenarios` 1–6，冲突码可读；blocked 时不产生发票/收款）；
  企业 fixtures 8/8 交叉验证
- [x] CI 增加 P3 企业版演示步骤（B8 + 30 条边界，无网络）
- [x] P2/P3 提交已推送 `main`（P2 `a41fe68`、P3 `0185e50`）；版本升级与 GitHub Release 由 Lead 决定
  （**当前 `package.json` 仍 0.6.0，P2/P3 待发 v0.7.0 / v0.8.0**）

## 现在能做什么

| 操作 | 命令 | 说明 |
|---|---|---|
| 安装依赖 | `npm install` | Node.js ≥ 22.18；用 npm（不是 pnpm） |
| 构建 | `npm run build` | `tsc -p tsconfig.json` → `dist/`（单包布局） |
| 类型检查 / lint | `npm run lint` | `tsc --noEmit` |
| 单元+集成测试 | `npm test` | 先 build 再 `node --test "tests/unit/*.test.mjs"`；v0.8.0 共 **151/151** 通过（16 个测试文件） |
| 只跑测试（不 build） | `npm run test:unit` | `node --test "tests/unit/*.test.mjs"` |
| 提示词测试（A12） | `npm run test:prompts` | 4 角色安全条款、禁止项、无密钥/本机路径、sha256 校验 |
| M0 空回路演示 | `npm run demo` | MockHarness，无付费 API；产物写入 `runs/<run-id>/` |
| 证据包 | `npm run evidence` | 自动 build + tests + demo，输出 `docs/test-evidence/test-result-<stamp>.{md,json}` |
| 真实浏览器流程（A2） | `node dist/apps/cli/src/index.js browser-flow [--case normal\|login-timeout] [--headless]` | 本机有头默认；产物 `runs/<run-id>/e2e/...` + 每步截图 |
| 真实桌面流程（A3） | `node dist/apps/cli/src/index.js desktop-flow [--json]` | 本机真实 Windows 桌面；真实键鼠（SendInput）+ 每步截图，产物 `runs/<run-id>/e2e-desktop/` |
| Scout 客户分支（A7） | `node dist/apps/cli/src/index.js scout [--fixture <path>] [--json]` | fixture 驱动：ICP/三场景/四因子评分/3 条草稿/审批队列（只起草、0 发送），产物 `runs/<run-id>/scout-report.*`、`drafts.json`、`approval-queue.json`、`outreach-drafts/` |
| 只读 dummy 分支（A10） | `node dist/apps/cli/src/index.js dummy-branch [--json]` | 仅 BranchSpec + 已有 `reviewer@1.0.0` 提示词，不改核心；产物含 `role=dummy`/`tools=[echo]`/`prompt_ref` |
| 经营域业务线（B1/B2/B5/B6/B7） | `node dist/apps/cli/src/index.js business [--json]` | 选题/仿真业务线/账本 6 要素/承诺追溯/6 类接管包/月报/边界；产物 `runs/<run-id>/` 下 `proposal.json`、`business-result.json`、`ledger-facts.json`、`promise-traces.json`、`takeover-pack.json`、`boundary-check.json`、`monthly-report.{json,md}`、`summaries.json` |
| 边界规则自检（B7） | `node dist/apps/cli/src/index.js boundary-check [--json]` | 18 条个人模式边界规则；四类越界 100% 拒绝（deny）、支付→human、报价→draft_only |
| 故障演练（B3/B4） | `node dist/apps/cli/src/index.js fault-drill --case net-outage\|platform-ban [--outage-minutes N] [--ban-minutes N] [--json]` | **真实 localhost HTTP 故障注入**（非 mock）；断网承诺闸门/幂等 Outbox 重放/封禁检测/替代方案 + 本地通知；产物 `drill-net-outage.json`、`outbox.json`、`ledger.json`、`alternative-plan.json`、`notifications/` |
| 企业版演示（B8） | `node dist/apps/cli/src/index.js enterprise-demo [--json]` | 主体/授权/用印/对公/专票/双人复核/组织审批链/30 条边界；产物 `profile.json`、`entity-validation.json`、`seal-flow.json`、`dual-review.json`、`invoice-validation.json`、`org-approval.json`、`dual-mode-orders.json`、`boundary-table.{md,json}`、`fixture-checks.json` |
| 本地 Web 控制台 | `node dist/apps/cli/src/index.js console [--port 4180]` | 默认 http://127.0.0.1:4180；只监听本机、写操作 token 保护；看板/项目时间线/账本 6 要素抽屉/审批卡/接管键/月报 |
| 人工审批 | `node dist/apps/cli/src/index.js approve [--id <cardId> --decision approve\|reject] [--json]` | 审批卡默认 pending，超时=挂起不自动放行；决策人和时间必填 |
| 接管键 / 恢复（B6） | `node dist/apps/cli/src/index.js takeover [--json]` / `takeover --resume` | 停止所有新写操作并生成 6 类接管包（含凭据引用）；`--resume` 恢复运行 |
| 编码回路（A4） | `node dist/apps/cli/src/index.js code-loop [--json]` | CodeTask→补丁→隔离 worktree→真实浏览器红转绿 |
| 编码回路失败注入（A5） | `node dist/apps/cli/src/index.js code-loop --fail [--json]` | 坏补丁两轮失败后停止升级（exit 1，不无限重试） |
| 停止键 / 检查点 / 隔离自检（A8/A9） | `node dist/apps/cli/src/index.js safety-check [--json]` | 停止键 ≤5s（实测 305ms）、检查点 save/load/resume、凭据/ProfileLock/工具白名单隔离自检 |
| 检查点恢复运行（A8） | `node dist/apps/cli/src/index.js run --goal "<目标>" --resume <runId>` | 从最近检查点跳过已完成步骤、不重复执行 |
| M1 一键验收 | `npm run acceptance` | 本机有头真实浏览器；生成 `docs/test-evidence/m1-acceptance-<stamp>.*` + `evidence-m1-<stamp>/` |
| M2 一键验收 | `npm run acceptance:m2` | 本机真实 Windows 桌面；生成 `docs/test-evidence/m2-acceptance-<stamp>.*` + `evidence-m2-<stamp>/` |
| M3 一键验收 | `npm run acceptance:m3` | fixture 驱动 Scout（无网络、只起草）；生成 `docs/test-evidence/m3-acceptance-<stamp>.*` + `evidence-m3-<stamp>/` |
| M4 一键验收 | `npm run acceptance:m4` | M4 一键验收 | `npm run acceptance:m4` | 阶段一发布就绪（A10 dummy 分支 + A11 许可证/双语文档/无遥测/版本一致 + 发布文档 + 测试）；版本一致性为动态检查，可在后续版本重跑；生成 `docs/test-evidence/m4-acceptance-<stamp>.*` + `evidence-m4-<stamp>/` ||
| P1 一键验收 | `npm run acceptance:p1` | 本机有头真实浏览器（控制台 E2E）；B1/B2/B5/B6/B7 + 113 测试（12 项检查）；生成 `docs/test-evidence/p1-acceptance-<stamp>.*` + `evidence-p1-<stamp>/` |
| P2 一键验收（短跑） | `npm run acceptance:p2` | B3/B4 真实 localhost 故障演练**短跑**（约 2 分钟断网 + 2 分钟封禁），11 项检查；生成 `docs/test-evidence/p2-acceptance-<stamp>.*` + `evidence-p2-<stamp>/`；**真实长跑（2h 断网 + 15min 封禁）另跑，证据待入库** |
| P3 一键验收 | `npm run acceptance:p3` | 企业版：B8 双模式 + 30 条边界 + 双人复核/用印/发票/组织审批链，12 项检查；生成 `docs/test-evidence/p3-acceptance-<stamp>.*` + `evidence-p3-<stamp>/` |
| 真实浏览器 E2E | `node tests/e2e-browser/login-flow.mjs --case normal\|login-timeout\|all [--expect-red login-timeout] [--headless 1]` | normal 应绿；login-timeout 修复前应红；`adapter-smoke.mjs` 28/28 |
| 控制台真实浏览器 E2E | `node tests/e2e-console/run.mjs [--headless 1] [--evidence-dir <目录>]` | 有头默认；9 步 / 73 项检查 / 9 截图 / `measured_stop_ms`（本机实测 88ms ≤10000）；需先 `npm run build` |
| 真实桌面 E2E（A3） | `node tests/e2e-desktop/run.mjs [--evidence-dir <目录>]` | 真实 Windows 窗口 + 真实键鼠 + 20 张截图 + JSON 内容断言；需先 `npm run build` |
| 重新生成提示词 manifest | `npm run prompts:manifest` | 修改 `prompts/*.md` 后必须执行（sha256 会变） |
| 校验仓库配置 | `npm run check` | 必需文件/许可证一站式检查 |
| 密钥扫描 | `npm run check:secrets` | 扫描 `sk-*`、`ghp_*`、私钥等；发现即失败 |
| 同步交付快照（旧流程） | `npm run sync:delivery` | 原用于 C: → H: 交付目录复制；现在权威仓库就在 H:，一般不需要 |
| 查看路线图 | [ROADMAP.md](ROADMAP.md) | 里程碑与批准门 |

CLI 子命令：`demo` / `browser-flow` / `desktop-flow` / `scout` / `dummy-branch` / `business` /
`boundary-check` / `fault-drill` / `enterprise-demo` / `console` / `approve` / `takeover` / `code-loop` /
`run` / `branch` / `report` / `stop` / `safety-check` / `version` 已实现（**19 个业务命令 + `help` 入口，
0 个占位**；P2 新增 `fault-drill`、P3 新增 `enterprise-demo`；`takeover`/`approve` 自 P1 起为真实人工
命令）；别名 `demo-browser` / `demo-code-loop` / `demo-desktop` / `demo-dummy` / `demo-business` /
`demo-enterprise` 保留。`run` 支持 `--resume <runId>` 从检查点恢复；`scout` 支持 `--fixture <path>`
（只起草，不发送）；`console` 支持 `--port <端口>`（默认 4180）；`takeover --resume` 恢复运行；
`fault-drill --case net-outage|platform-ban` 支持 `--outage-minutes` / `--ban-minutes`。

## 还不能做什么

- **P2 长跑尚未完成**：短跑（约 2 分钟断网 + 2 分钟封禁）已通过；**真实 2 小时断网 + 15 分钟封禁长跑
  仍在后台运行**，长跑证据（`long-drill-*`）待 Lead 入库前不能宣布 P2 完整通过。
- **P4 尚未开始**：v1.0.0、GitHub Release、验收包、真实截图宣传片（BGM+静音）属于 P4；
  阶段一以真实命令演示脚本（`docs/demo-script.*`）替代宣传片，正式宣传片计划 P4。
- 桌面适配器暂无 **UIA 可访问性树**、拖拽、滚轮/触控板手势、右键菜单语义、剪贴板、多窗口批处理
  会话编排——M2 已实现真实键鼠 + 截图 + 白名单的核心能力，其余按契约留待后续迭代。
- Scout **没有真实来源抓取与真实发送通道**（按产品边界：M3 只做 fixture 驱动、只起草不发送；
  真实发送必须由审批后的人工流程完成，留给后续阶段）。
- **企业版未连接真实系统**：不接真实银行/税务/CA/电子签章平台；企业数据全部虚构；发票与申报仅草稿；
  用印仅记录人工签署状态、不生成真实签章文件；企业专属 UI 未新增（复用个人控制台）。
- 真实桌面 E2E 只能在未锁屏的真实交互 Windows 会话跑；托管 CI/无桌面环境不能跑（CI 跑控制台
  无头 E2E、Scout/business/boundary/fault/enterprise demo、`dummy-branch`、`safety-check` 与 build）。
- 不能调用真实 DSH / DeepSeek Harness——目前用 MockHarness + 脚本化补丁（真实浏览器/桌面/Scout/
  经营域/故障演练/企业版验收已跑通）。
- **v0.7.0（P2）/ v0.8.0（P3）尚未升级与发布**：P2/P3 代码已推送 `main`（`a41fe68` / `0185e50`），
  当前 `package.json` 仍 **0.6.0**；版本升级、tag 与 GitHub Release 由 Lead 决定
  （v0.5.0 / v0.6.0 Release 已存在）。

## 代码在哪

- **权威仓库（唯一开发位置）**：`H:\minzzj文件\技术部\项目\官方\代掌\daizhang-steward`
  （GitHub `main` 分支；**P3 提交 `0185e50` 已推送**（P2 `a41fe68`、P1 `2db8da3`）；
  不要 git commit，除非用户明确要求）
- **C: 旧副本为归档**：`C:\daizhang-build\daizhang-steward` 只读参考，**不要再在这里改文件**。
- **方案文档**：`H:\minzzj文件\技术部\项目\官方\代掌\代掌-实施总方案-v0.1.md`
- 工程已从 pnpm workspace 改为**单包布局**（H: 为 exFAT，不支持符号链接，pnpm workspace 装不起来）：
  `tsconfig.json` 把 `packages/*/src` + `apps/cli/src` 编译到 `dist/`，所有命令用 **npm**。
- H: exFAT 的写入限制见下方「本机踩坑」第 3/4 条。

## 发布状态（2026-10-25）

- **GitHub 公开仓库**：https://github.com/minzzj/daizhang-steward（2026-10-25 创建；发布验证见
  [`docs/test-evidence/2026-10-25-repo-publish.md`](docs/test-evidence/2026-10-25-repo-publish.md)）
- **v0.5.0 Release**：https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0
  （阶段一发布，2026-10-25；发布说明见 [`docs/RELEASE_NOTES_v0.5.0.md`](docs/RELEASE_NOTES_v0.5.0.md)）
- **v0.6.0（P1）**：已发布并验证（见 [`docs/test-evidence/release-v0.6.0-check.md`](docs/test-evidence/release-v0.6.0-check.md)、
  [`docs/RELEASE_NOTES_v0.6.0.md`](docs/RELEASE_NOTES_v0.6.0.md)）
- **代码位置**：GitHub `main` 分支（P3 提交 **`0185e50` 已推送**；当前 `package.json` 版本 **0.6.0**，
  CLI `VERSION` 同步 0.6.0；**P2/P3 版本 0.7.0 / 0.8.0 待 Lead 升级并发版**）。
- **M0 验证证据**：`runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md /
  events.jsonl / code-task.json / code-result.json 等）与
  [`docs/test-evidence/test-result-2026-10-25_09-52-08.md`](docs/test-evidence/test-result-2026-10-25_09-52-08.md)
  （该文件为 Windows CI 修复前快照，tests 34；**当前测试数为 151**，以 `npm test` 为准）；
  `npm run check` / `npm run check:secrets` / `npm run demo` / `npm run evidence` 均通过。
- **M1 验证证据**：`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
  `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件：A2 / A4 / A5 三组截图与日志；
  已用 `scripts/sanitize.mjs` 脱敏，无本机绝对路径）；`npm run acceptance` OK（本机有头真实 Chrome）。
- **M2 验证证据**：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件：A3 真实桌面 20 张截图 +
  `result.json`/`steps.json`/`project.json`/`checkpoint.json`，A8/A9 `safety-check-result.json`，
  `unit-tests.log`、`m2-runtime-tests.log`；已脱敏）；`npm run acceptance:m2` OK（本机真实 Windows
  桌面）；A3/A8/A9 通过。
- **M3 验证证据**：`docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
  `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件：`scout-run/` 的
  `scout-report.md/.json`、`leads-scored.json`、`drafts.json`、`approval-queue.json`、
  `outreach-drafts/`、`events.jsonl`、`report.md`、`checkpoint.json` + 74/74 `unit-tests.log`；
  已脱敏）；`npm run acceptance:m3` OK（fixture 驱动、无网络外联）；A7 通过。
- **M4 验证证据**：`docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` +
  `docs/test-evidence/evidence-m4-2026-10-25_13-43-07/`（A10 dummy 分支证据 + `unit-tests.log` 80/80 +
  A11 发布就绪检查，已脱敏）；`npm run acceptance:m4` OK；**A1–A12 全部通过**；`npm test` **80/80**（历史）。
- **P1 验证证据**：`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
  `docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`（39 文件：`business-run/` 的 proposal /
  business-result / ledger-facts / promise-traces / takeover-pack / boundary-check / monthly-report /
  summaries，`boundary-run/` 18 条规则，`console-e2e/` 9 步截图 + result.json，`console-cli/` 看板+账本
  截图，`takeover-result.json`、`unit-tests.log` 113/113；已脱敏、只保留最新）；`npm run acceptance:p1`
  OK（本机有头 Chrome，12/12 检查）；**B1/B2/B5/B6/B7 通过**；`npm test` **113/113**（P1 历史）。
- **P2 验证证据（短跑）**：`docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.{md,json}` +
  `docs/test-evidence/evidence-p2-2026-10-25_15-02-52/`（10 文件：`B3-net-outage/` 的
  drill-net-outage/outbox/ledger + 断网/恢复通知；`B4-platform-ban/` 的 drill-platform-ban /
  alternative-plan + 封禁/恢复通知；`unit-tests.log` 133/133；已脱敏）；短跑 **11/11 检查 ✅**
  （断网 `outage=120007ms`、25 次承诺被拒、25 条排队/重放、账本重复 0；封禁 11ms 检测、替代方案 5 条）。
  **长跑（2h 断网 + 15min 封禁）进行中**，`evidence-long-drill-*` 目录已预留（当前为空），
  长跑证据由 Lead 后续入库。
- **P3 验证证据**：`docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.{md,json}` +
  `docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`（18 文件：`enterprise-run/` 的 profile /
  entity-validation / seal-flow / org-approval / dual-review / invoice-validation / dual-mode-orders /
  boundary-table.{md,json} / boundary-checks / fixture-checks / report，+ `unit-tests.log` 151/151；
  已脱敏）；`npm run acceptance:p3` OK（12/12 检查）；**B8 通过**；`npm test` **151/151**
  （16 个测试文件）；企业 run `run-20261025-232357-2ce6f6`。

## 本机踩坑（2026-10-25 实测）

1. **无 `pwsh`**：只有 Windows PowerShell 5.1。脚本一律用
   `powershell -NoProfile -ExecutionPolicy Bypass -File <script>` 调用。
2. **PS 5.1 读无 BOM 的 UTF-8 会按 ANSI 解码**：含中文路径的 `.ps1` 必须存为
   **UTF-8 with BOM**（`scripts/sync-delivery.ps1` 已加 BOM，并在文件头注明）。
3. **H: 为 exFAT，符号链接/硬链接不可用**：pnpm workspace 与部分 AI 文件工具的原子写会失败。
   `edit` 可改已有文件，但 **`write` 工具在 H: exFAT 下无法新建文件**（会 EISDIR）——
   新建文件先写到 `C:\daizhang-build\staging\...`，再用 PowerShell `Copy-Item` 复制到 H:。
4. **H: 只能用 npm 单包构建**：`npm install` + `tsc -p tsconfig.json` 正常；不要用 pnpm workspace。
5. `npm run check` 在 PowerShell 中会把脚本横幅写到 stderr（`2>&1` 时显示成报错），
   直接看退出码或用 `node scripts/check-scaffold.mjs` 更清晰。
6. Playwright 直接用本机 Chrome/Edge 频道即可，无需下载 Chromium；桌面测试目标窗口用专用标题避免焦点误判。
7. **M1 真实浏览器验收**：本机有头 Chrome 实测通过；适配器默认有头、`chrome → msedge` 回退；
   托管 CI 无交互桌面，只能跑 `login-flow.mjs --case normal --headless 1`（开发自测），
   产品验收用本机 `npm run acceptance`。
8. **Windows CI 的 CRLF 风险**：Windows runner 曾把 `*.patch` 转成 CRLF 导致 `git apply` 失败
   （提交 `b4ed316` 修复：`.gitattributes` 全仓 `eol=lf` + `patch.ts` 归一化 CRLF + CRLF 回归测试）。
   修改 patch/diff 时注意行尾；`.ps1` 保持 CRLF。
9. **证据脱敏**：验收证据复制进仓库前用 `scripts/sanitize.mjs` 替换本机路径与临时 worktree 路径
   （M1/M2/M3 acceptance bundle 已脱敏）；自动生成的证据文件不要手改。
10. **M2 真实桌面验收**：必须在本机**真实交互桌面会话**（未锁屏）运行，`SendInput`/`BitBlt` 依赖前台
    会话；Session 0 / 托管 CI / RDP 断开 / UAC 安全桌面会失败。需要 **Python ≥ 3.8** 在 `PATH`
    （可用 `STEWARD_PYTHON` 或 `pythonCommand` 指定）。桌面 E2E 会先等真人输入空闲 ≥800ms 再操作，
    避免与真人抢焦点；焦点被抢会按白名单拒绝并留证，不会把键鼠打进其他窗口。
11. **桌面坐标与 DPI**：侧车是 Per-Monitor V2 DPI 感知进程，`click(x,y)` 用**屏幕物理像素**；
    操作 tkinter 等 DPI 未感知程序需按 `clientRect.width / 逻辑宽度` 换算（`tests/e2e-desktop/run.mjs`
    已内置换算）。真实桌面共享资源，不要与真人操作并行跑。
12. **M3 Scout 验收**：`npm run acceptance:m3` 全程 **fixture 驱动、无网络外联**，只起草不发送；
    会重建 `docs/test-evidence/m3-acceptance-*` + `evidence-m3-*`（只保留最新一份）。Scout 的
    `markSent` 只记录状态，真实发送不在阶段一范围内；fixture 用保留域名 `example.com`/`example.org`，
    不要替换成真实个人信息。
13. **M4 发布验收**：`npm run acceptance:m4` 会检查发布文档（`docs/good-first-issues.md` 至少 5 个
    GFI、中英演示脚本、`docs/RELEASE_NOTES_v0.5.0.md`）与版本一致性（`package.json` / CLI `VERSION`
    均 0.5.0），并重建 `m4-acceptance-*` + `evidence-m4-*`（只保留最新一份）。改版本号时必须三处同步：
    `package.json`、`apps/cli/src/index.ts` 的 `VERSION`、发布说明/CHANGELOG。
14. **P1 阶段二验收**：`npm run acceptance:p1` 需要 **已 build**（控制台 E2E / CLI 控制台都读 `dist/`）
    和**本机真实浏览器（有头 Chrome）**；会重建 `p1-acceptance-*` + `evidence-p1-*`（只保留最新一份），
    并在运行前清理 `.steward/`。控制台 E2E 默认随机端口、只监听 127.0.0.1；写操作必须带
    `X-Steward-Token`（测试断言无 token → 401）。`business`/`boundary-check` 为纯 fixture 离线运行，
    不会访问网络、不会外发。`npm run acceptance:p1` 只在本机跑（托管 CI 只跑无头控制台 E2E）。
15. **P2 故障演练验收**：`npm run acceptance:p2` 默认是**短跑**（约 2 分钟断网 + 2 分钟封禁，真实
    localhost HTTP），会重建 `p2-acceptance-*` + `evidence-p2-*`；`--outage-minutes` / `--ban-minutes`
    控制真实时长。**长跑（120 分钟断网 + 15 分钟封禁）必须单独后台运行**，完成后把
    `long-drill-*` 证据复制到 `docs/test-evidence/evidence-long-drill-*` 并更新本文件/ROADMAP；
    在长跑证据入库前 P2 不算完整通过。示例：
    `node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 120 --json`。
16. **P3 企业版验收**：`npm run acceptance:p3` 纯本地、无网络、无真实银行/税务系统；会重建
    `p3-acceptance-*` + `evidence-p3-*`。企业数据全部虚构（执照/税号/账号/签署人均编造），
    发票与申报只出草稿，用印 `ai_may_sign=false`；不要把 fixture 用于真实签约/收款/开票/申报。
    CI 只跑 `enterprise-demo`（B8 + 30 条边界），有头/真实数据验收仅本机。

## 下一步（按序执行）

0. **推送状态**：阶段一（v0.5.0）与阶段二 P1/P2/P3 代码均已推送 GitHub `main`（最新 `0185e50`）；
   v0.5.0 / v0.6.0 已发布；**P2/P3 待发 v0.7.0 / v0.8.0（由 Lead 升级版本并决定 Release/tag）**。
1. **P2 长跑收尾（下一步）**：等待后台真实 2 小时断网 + 15 分钟封禁长跑完成 → 由 Lead 把
   `long-drill-*` 证据入库到 `docs/test-evidence/evidence-long-drill-*` → 更新 P2 状态为「通过」，
   并在 delivery-checklist / ROADMAP / HANDOFF 补长跑结论。
2. **P4 发布与宣传片**：v1.0.0 版本号、GitHub Release、验收包、真实截图宣传片（BGM/静音双版本）+ 发布说明。
3. 按用户要求继续阶段二（或视额度停会话）；新会话从本文件 + [ROADMAP.md](ROADMAP.md) 续。

## 等待用户确认的事项

- [ ] 是否继续 P4（v1.0.0/宣传片）——默认按 ROADMAP 继续
- [ ] 测试 key 仅用于联调（默认是；建议联调后轮换）
- [x] GitHub 认证（已通过本机凭据完成建仓与推送；令牌未落盘）
- [x] 仓库名（`minzzj/daizhang-steward` 已创建）
- [x] 第一阶段发布平台（GitHub public 仓库已发布；v0.5.0 Release 已创建）
- [x] M0 验收（2026-10-25：A1/A6/A12 通过）
- [x] M1 验收（2026-10-25：A2/A4/A5/A6 通过；`npm run acceptance` OK）
- [x] M2 验收（2026-10-25：A3/A8/A9 通过；`npm run acceptance:m2` OK）
- [x] M3 验收（2026-10-25：A7 通过；`npm run acceptance:m3` OK）
- [x] M4 验收 / 阶段一完成（2026-10-25：A10/A11/A12 通过，A1–A12 全部通过；v0.5.0 Release）
- [x] P1 验收 / 阶段二个人版 MVP（2026-10-25：B1/B2/B5/B6/B7 通过；113/113 测试，v0.6.0）
- [x] P3 验收 / 阶段二企业版 MVP（2026-10-25：B8 通过 + 30 条边界；`npm run acceptance:p3` OK，
  151/151 测试，v0.8.0 待发版）
- [ ] P2 长跑（120min 断网 + 15min 封禁）完成确认与证据入库
- [ ] v0.7.0 / v0.8.0 是否升级并发布 GitHub Release / tag（代码已推送 `main`，由 Lead 按节奏决定）

## 已知风险

见 [ASSUMPTIONS.md](ASSUMPTIONS.md) 与方案 §11：DSH RC 版本漂移、Windows 桌面自动化稳定性、
GitHub 认证、非商用许可预期、法律边界需人工复核、额度控制。

## 交接给后续阶段（P4 及以后）的内容

- [x] M0 验收证据索引：`runs/run-20261025-172017-eb9116/` + `docs/test-evidence/test-result-2026-10-25_09-52-08.md`
- [x] M1 验收证据索引：`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
  `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（A2/A4/A5 三组 45 文件）
- [x] M2 验收证据索引：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（A3 桌面 20 张截图 + A8/A9 自检 + 测试日志，34 文件）
- [x] M3 验收证据索引：`docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
  `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（scout-run 证据 + 74/74 测试日志，15 文件）
- [x] M4 验收证据索引：`docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` +
  `docs/test-evidence/evidence-m4-2026-10-25_13-43-07/`（A10 dummy 分支 + A11 发布就绪 + 80/80 测试日志）
- [x] P1 验收证据索引：`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
  `docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`（business-run / boundary-run / console-e2e /
  console-cli / takeover-result / unit-tests.log，39 文件，已脱敏）
- [x] 阶段一 12 条验收证据索引（A1–A12 全部通过，见上 M0–M4；发布说明
  `docs/RELEASE_NOTES_v0.5.0.md`、演示脚本 `docs/demo-script.*`、GFI `docs/good-first-issues.md`）
- [x] P1 个人版 MVP 实施与验收（经营域 8 概念、控制台、审批/接管、月报、18 条个人模式边界、
  仿真业务线；`docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`）
- [x] P2 短跑验收与故障演练实现（fault 模块、demo-platform、fault-drill、短跑 11/11 通过；
  `docs/test-evidence/evidence-p2-2026-10-25_15-02-52/`）；**长跑证据待 Lead 入库**
- [x] P3 企业版实施与验收（enterprise 模块、30 条边界双模式表全文、B8 双模式、双人复核/用印/专票/
  申报草稿/组织审批链；`docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`；
  `docs/zh-CN/enterprise.md` + `docs/en/enterprise.md`）
- [ ] P2 长跑证据入库与 P2 完成结论（`long-drill-*` → `docs/test-evidence/evidence-long-drill-*`）
- [ ] P4 v1.0.0 发布与宣传片（BGM/静音双版本）
