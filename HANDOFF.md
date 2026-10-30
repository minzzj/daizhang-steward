# HANDOFF / 交接状态

> 给下一次会话（或下一位执行者）的现状交接。每次里程碑结束更新。
> 最后更新：2026-10-26（**v1.0.0 已发布 —— 两阶段交付完成（Latest）**；项目交付完成，
> 之后仅按需做可选扩展）

## 当前状态（一句话）

**v1.0.0 已发布（GitHub Release，Latest，两阶段交付完成）**：阶段一（v0.5.0）操作型 AI 内核
（A1–A12 全部通过）+ 阶段二经营代理（v0.6.0 P1 个人版、v0.8.0 P2 真实故障演练 / P3 企业版，
B1–B8 全部通过）。最终版本 **1.0.0**（package.json/CLI 同步）、**151/151** 测试（16 文件）、
**19 个已实现命令 + `help`**（0 占位）、中英双语文档、CC BY-NC-SA 4.0 许可证、完整证据归档，并附
**真实截图宣传片 3 个 Release Assets**（BGM / silent / poster；110s / 1280×720@30fps，工程与分镜
`docs/media/promo/`）；发布验证 `docs/test-evidence/release-v1.0.0-check.md` +
`docs/images/release-v1.0.0.png`，发布说明 `docs/RELEASE_NOTES_v1.0.0.md`。**项目交付完成；后续仅可选扩展。**

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

## P2 已完成清单（2026-10-26，故障演练 → 短跑 + 真实长跑均通过，随 v0.8.0 发布）

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
- [x] **真实长跑完成并通过（2026-10-26）**：`npm run drill:long`（真实时长不加速）——**B3 断网
  120 分钟（7215 秒）** → **1435 次承诺被拒、0 新增**，1435 条动作入 Outbox、恢复后**全部补记**，
  **`duplicates_found=0`**、二次对账 `entries_added=0`；**B4 封禁 15 分钟（900 秒）** → **9ms 检测**、
  **180 次尝试 0 成功**、停止动作 + **5 条替代方案** + 通知、解禁恢复。证据
  `docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` +
  `docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/`（11 文件，已脱敏）；**B3/B4 通过**

## P3 已完成清单（2026-10-25，企业版 MVP → v0.8.0 已发布）

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
- [x] P2/P3 提交已推送 `main`（P2 `a41fe68`、P3 `0185e50`）；**`package.json` 与 CLI 已升 0.8.0，
  P2+P3 已通过 GitHub Release v0.8.0 发布（tag `95b609a`）**

## P4 已完成清单（2026-10-26，最终发布 → **v1.0.0 已发布，两阶段交付完成**）

- [x] **版本 1.0.0**：`package.json` + CLI `VERSION` 同步 1.0.0；全量 **151/151** 测试（16 文件）、
  **19 个业务命令 + `help`**、0 占位
- [x] **最终双语文档终审**：README 中英、docs/zh-CN + docs/en 配对、`enterprise.md` 中英、
  `RELEASE_NOTES_v1.0.0.md` 双语；A1–A12 / B1–B8 验收对照完整写入发布说明
- [x] **真实截图宣传片**：HyperFrames（HTML/GSAP）+ 代码合成 BGM（120 BPM、无人声、无外部素材/字体/
  网络请求），素材为 M1 真实浏览器 / M2 真实 Windows 桌面 / P1 控制台真实 E2E 截图（15 张，无重绘）；
  `hyperframes check` ok:true（lint 0/0、runtime 0、layout 0、motion 0、contrast 45/45 WCAG AA）——
  `daizhang-steward-promo-v1.0-bgm.mp4` 12,947,989 B / `-silent.mp4` 10,169,266 B /
  `-poster.jpg` 85,200 B（110s / 1280×720@30fps / H.264+AAC）；工程与分镜 `docs/media/promo/`
- [x] **GitHub Release v1.0.0（Latest，两阶段交付完成）**：tag 指向 `1e3b89f`，名称
  「v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete」，非 draft/prerelease；3 个宣传片 Assets
  `state=uploaded`，大小/SHA256 与本地渲染一致；发布说明 `docs/RELEASE_NOTES_v1.0.0.md`
- [x] 发布验证：`docs/test-evidence/release-v1.0.0-check.md` + `docs/images/release-v1.0.0.png`
  （GitHub REST API + 真实浏览器双通道核对 Release 页面/Assets）
- [x] 文档全量更新到「v1.0.0 已发布 / 两阶段交付完成」：README 中英、ROADMAP、HANDOFF、
  CHANGELOG `[1.0.0]`、delivery-checklist 中英、architecture 中英、docs/README、
  test-evidence/README、images/README、packages/apps/tests/examples README、ASSUMPTIONS

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
| M4 一键验收 | `npm run acceptance:m4` | 阶段一发布就绪（A10 dummy 分支 + A11 许可证/双语文档/无遥测/版本一致 + 发布文档 + 测试）；版本一致性为动态检查，可在后续版本重跑；生成 `docs/test-evidence/m4-acceptance-<stamp>.*` + `evidence-m4-<stamp>/` |
| P1 一键验收 | `npm run acceptance:p1` | 本机有头真实浏览器（控制台 E2E）；B1/B2/B5/B6/B7 + 113 测试（12 项检查）；生成 `docs/test-evidence/p1-acceptance-<stamp>.*` + `evidence-p1-<stamp>/` |
| P2 一键验收（短跑） | `npm run acceptance:p2` | B3/B4 真实 localhost 故障演练**短跑**（约 2 分钟断网 + 2 分钟封禁），11 项检查；生成 `docs/test-evidence/p2-acceptance-<stamp>.*` + `evidence-p2-<stamp>/` |
| P2 真实长跑 | `npm run drill:long` | B3 断网 120 分钟 / B4 封禁 15 分钟（真实时长，不加速）；生成 `docs/test-evidence/long-drill-<stamp>.*` + `evidence-long-drill-<stamp>/`（本次 11 文件、已脱敏） |
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

## 还不能做什么（v1.0.0 已交付；以下为**可选后续扩展**，不属于本次交付）

- **可选扩展**：通知通道（Windows Toast/邮件/Webhook/交接流程）、IoT 适配器（stub）、MCP server、
  真实 DSH/DeepSeek Harness 接入、真实银行/税务/CA/电子签章系统对接、企业专属 UI、
  强杀恢复/72h 失联/循环超限等扩展故障演练——均为交付后的可选增强，v1.0.0 不包含。
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
- **版本与发布已完成**：`package.json` 与 CLI 均为 **1.0.0**；v1.0.0 已通过 GitHub Release 发布
  （Latest）；v0.5.0 / v0.6.0 / v0.8.0 为历史版本。**项目交付完成、无阻塞待办。**

## 代码在哪

- **权威仓库（唯一开发位置）**：`H:\minzzj文件\技术部\项目\官方\代掌\daizhang-steward`
  （GitHub `main` 分支；**v1.0.0 tag 指向提交 `1e3b89f`**；发布验证提交 `ae6618f`；
  不要 git commit，除非用户明确要求）
- **C: 旧副本为归档**：`C:\daizhang-build\daizhang-steward` 只读参考，**不要再在这里改文件**。
- **方案文档**：`H:\minzzj文件\技术部\项目\官方\代掌\代掌-实施总方案-v0.1.md`
- 工程已从 pnpm workspace 改为**单包布局**（H: 为 exFAT，不支持符号链接，pnpm workspace 装不起来）：
  `tsconfig.json` 把 `packages/*/src` + `apps/cli/src` 编译到 `dist/`，所有命令用 **npm**。
- H: exFAT 的写入限制见下方「本机踩坑」第 3/4 条。

## 发布状态（2026-10-26，最终）

- **GitHub 公开仓库**：https://github.com/minzzj/daizhang-steward（2026-10-25 创建；发布验证见
  [`docs/test-evidence/2026-10-25-repo-publish.md`](docs/test-evidence/2026-10-25-repo-publish.md)）
- **v1.0.0 Release（Latest，最终版 —— 两阶段交付完成）**：
  https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0 （2026-10-26；tag 指向提交
  `1e3b89f`；名称「v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete」；非 draft/prerelease；
  发布说明 [`docs/RELEASE_NOTES_v1.0.0.md`](docs/RELEASE_NOTES_v1.0.0.md)；验证
  [`docs/test-evidence/release-v1.0.0-check.md`](docs/test-evidence/release-v1.0.0-check.md) +
  [`docs/images/release-v1.0.0.png`](docs/images/release-v1.0.0.png)）
  - **宣传片 3 个 Release Assets（真实截图）**：
    [`daizhang-steward-promo-v1.0-bgm.mp4`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-bgm.mp4)
    （12,947,989 B，110s / 1280×720@30fps，H.264+AAC）·
    [`silent`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-silent.mp4)
    （10,169,266 B，无音轨）·
    [`poster`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-poster.jpg)
    （85,200 B）；工程与分镜 [`docs/media/promo/`](docs/media/promo/)（README/STORYBOARD/FACTS/poster.jpg）
- **v0.8.0 Release（历史）**：https://github.com/minzzj/daizhang-steward/releases/tag/v0.8.0
  （阶段二 P2+P3 合并发布，2026-10-26；验证
  [`docs/test-evidence/release-v0.8.0-check.md`](docs/test-evidence/release-v0.8.0-check.md)）
- **v0.6.0（P1，历史）**：已发布并验证（见 [`docs/test-evidence/release-v0.6.0-check.md`](docs/test-evidence/release-v0.6.0-check.md)、
  [`docs/RELEASE_NOTES_v0.6.0.md`](docs/RELEASE_NOTES_v0.6.0.md)）
- **v0.5.0 Release（历史，阶段一）**：https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0
  （发布说明 [`docs/RELEASE_NOTES_v0.5.0.md`](docs/RELEASE_NOTES_v0.5.0.md)）
- **代码位置**：GitHub `main` 分支（v1.0.0 tag `1e3b89f`；当前 `package.json` 版本 **1.0.0**，
  CLI `VERSION` 同步 1.0.0；**两阶段交付完成，无后续发版计划**）。
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
- **P2 验证证据（短跑 + 真实长跑）**：短跑 `docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.{md,json}` +
  `docs/test-evidence/evidence-p2-2026-10-25_15-02-52/`（10 文件：`B3-net-outage/` 的
  drill-net-outage/outbox/ledger + 断网/恢复通知；`B4-platform-ban/` 的 drill-platform-ban /
  alternative-plan + 封禁/恢复通知；`unit-tests.log` 133/133；已脱敏）；短跑 **11/11 检查 ✅**
  （断网 `outage=120007ms`、25 次承诺被拒、25 条排队/重放、账本重复 0；封禁 11ms 检测、替代方案 5 条）。
  **真实长跑**：`docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` +
  `docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/`（11 文件，已脱敏）——**B3 断网
  120 分钟（7215 秒）**：1435 次承诺被拒/0 新增、1435 条动作入 Outbox 并全部补记、
  `duplicates_found=0`、二次对账 `entries_added=0`；**B4 封禁 15 分钟（900 秒）**：9ms 检测、
  180 次尝试 0 成功、5 条替代方案 + 通知、解禁恢复；**B3/B4 通过（2026-10-26）**。
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
    localhost HTTP），会重建 `p2-acceptance-*` + `evidence-p2-*`；**真实长跑**用 `npm run drill:long`
    （B3 断网 120 分钟 / B4 封禁 15 分钟，真实时长不加速；需约 2.5 小时），生成
    `long-drill-*` + `evidence-long-drill-*`（本次 11 文件、已脱敏、2026-10-26 通过）。长跑完成后把
    证据复制到 `docs/test-evidence/` 并更新本文件/ROADMAP/delivery-checklist。
    也可分步手跑：`node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 120 --json`。
16. **P3 企业版验收**：`npm run acceptance:p3` 纯本地、无网络、无真实银行/税务系统；会重建
    `p3-acceptance-*` + `evidence-p3-*`。企业数据全部虚构（执照/税号/账号/签署人均编造），
    发票与申报只出草稿，用印 `ai_may_sign=false`；不要把 fixture 用于真实签约/收款/开票/申报。
    CI 只跑 `enterprise-demo`（B8 + 30 条边界），有头/真实数据验收仅本机。

## 下一步（顺序可选，均为交付后增强）

0. **推送状态**：两阶段全部完成并发布——v0.5.0 / v0.6.0 / v0.8.0 / **v1.0.0（最终版，Latest）**；
   `main` 最新发布验证提交 `ae6618f`，v1.0.0 tag `1e3b89f`。**项目交付完成。**
1. **可选后续扩展（非必须）**：通知通道（Toast/邮件/Webhook）、IoT 适配器（stub）、MCP server、
   真实 DSH/DeepSeek Harness 接入、真实银行/税务/CA/电子签章对接、企业专属 UI、扩展故障演练
   （强杀恢复/72h 失联/循环超限）——按用户新需求再启动，不属于 v1.0.0 范围。
2. 新会话从本文件 + [ROADMAP.md](ROADMAP.md) 续。

## 等待用户确认的事项（最终）

- [x] **两阶段交付完成，v1.0.0 已发布（Latest）**
- [x] GitHub 认证（已通过本机凭据完成建仓与推送；令牌未落盘）
- [x] 仓库名（`minzzj/daizhang-steward` 已创建）
- [x] M0 验收（2026-10-25：A1/A6/A12 通过）
- [x] M1 验收（2026-10-25：A2/A4/A5/A6 通过；`npm run acceptance` OK）
- [x] M2 验收（2026-10-25：A3/A8/A9 通过；`npm run acceptance:m2` OK）
- [x] M3 验收（2026-10-25：A7 通过；`npm run acceptance:m3` OK）
- [x] M4 验收 / 阶段一完成（2026-10-25：A10/A11/A12 通过，A1–A12 全部通过；v0.5.0 Release）
- [x] P1 验收 / 阶段二个人版 MVP（2026-10-25：B1/B2/B5/B6/B7 通过；113/113 测试，v0.6.0）
- [x] P2 验收 / 阶段二故障演练（2026-10-26：B3/B4 短跑 11/11 + 真实长跑通过；v0.8.0）
- [x] P3 验收 / 阶段二企业版 MVP（2026-10-25：B8 通过 + 30 条边界；`npm run acceptance:p3` OK，
  151/151 测试，v0.8.0）
- [x] 阶段二发布（2026-10-26：GitHub Release **v0.8.0** 已发布并验证）
- [x] **最终发布（2026-10-26：GitHub Release v1.0.0 已发布并验证，Latest；宣传片 3 Assets 上传完成）**
- [ ] （可选）后续增强的需求与优先级（通知/IoT/MCP/真实系统对接/企业 UI 等）——按需再启动

## 已知风险

见 [ASSUMPTIONS.md](ASSUMPTIONS.md) 与方案 §11：DSH RC 版本漂移、Windows 桌面自动化稳定性、
GitHub 认证、非商用许可预期、法律边界需人工复核、额度控制。

## 交接给后续（可选扩展）的内容

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
- [x] P2 故障演练实施与验收（fault 模块、demo-platform、fault-drill；短跑 11/11 通过）
- [x] **P2 真实长跑验收**：`docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` +
  `docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/`（11 文件，已脱敏；B3 断网 120min →
  1435 次承诺被拒/0 新增、1435 条动作全部补记、`duplicates_found=0`；B4 封禁 15min → 9ms 检测、
  180 次尝试 0 成功、5 条替代方案、通知与恢复）
- [x] P3 企业版实施与验收（enterprise 模块、30 条边界双模式表全文、B8 双模式、双人复核/用印/专票/
  申报草稿/组织审批链；`docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`；
  `docs/zh-CN/enterprise.md` + `docs/en/enterprise.md`）
- [x] 阶段二发布验证：`docs/test-evidence/release-v0.8.0-check.md` + `docs/images/release-v0.8.0.png`
- [x] **最终发布（v1.0.0）**：`docs/test-evidence/release-v1.0.0-check.md` +
  `docs/images/release-v1.0.0.png`；发布说明 `docs/RELEASE_NOTES_v1.0.0.md`；宣传片 3 Assets
  （BGM/silent/poster，工程与分镜 `docs/media/promo/`）；**两阶段交付完成**
- [ ] 可选后续扩展（通知通道、IoT、MCP、真实 DSH Harness、真实银行/税务/CA 对接、企业 UI、扩展故障演练）


## v1.3.0 交付（2026-10-26）

- 版本 **1.3.0**；真实模型端到端（DeepSeek API，密钥仅本地）、两层总调度与系统总控、控制台对话/证据/变现/系统页、易支付验签、系统动作二次确认与回收站备份。
- 测试：290/290 单测；控制台真实浏览器 E2E 25/25 步、303/303 检查、30 张截图。
- 文档：docs/{zh-CN,en}/{configuration,chat,system,money}.md、docs/RELEASE_NOTES_v1.3.0.md；证据：docs/test-evidence/evidence-console-v13-*、evidence-v13-real、evidence-limit-*。
- 复跑：`npm run build && node --test "tests/unit/*.test.mjs" && node tests/e2e-console/run.mjs`；控制台 `node dist/apps/cli/src/index.js console --port 4180`。


## v1.4.0 交付（2026-10-30）

- **发送即执行 + SSE 实时流**：/chat 发送即自动执行，实时事件（思考/计划/每步/每轮摘要/Token/审批/完成）；CLI `steward runtime`；断线 since 回放与刷新恢复。
- **steward-runtime**（RunManager）：自动执行循环、审批策略（auto_low_risk/auto_all/manual/full_auto）、并发 3、暂停恢复打断、自动返工、持久化；配置中心 runtime 设置 + `/settings` UI。
- **稳健性**：本地动作未实现/失败时模型输出兜底并保存证据（含 HTML 提取为 deliverable.html），真实 DeepSeek 实测「简单方案」5 步自动完成并产出 HTML。
- **系统总控扩展**：受管工作区文件/目录、打开应用/URL、服务状态、定时任务、受管程序安装/卸载（备份+确认+审计）。
- 验证：339/339 单测；真实浏览器 E2E 31 步/338 检查/35 截图；CI Windows+Ubuntu 全绿；Release v1.4.0（含证据资产）。
- 文档：docs/{zh-CN,en}/runtime.md、docs/RELEASE_NOTES_v1.4.0.md；证据：docs/test-evidence/evidence-console-v14-*、evidence-v14-real。


## v1.5.1（2026-10-30）— DeepSeek Harness Agents + ChatGPT 式对话总控

- 10 个业务智能体换成真实 DeepSeek Harness 代理（thinking/工具/产物/report.md/证据，实时可见）。
- `/chat` 重做为对话式总控：一个入口控制全部，AI 自己查系统/执行任务，危险动作只给审批卡；内嵌思考/工具/产物/报告/数据/审批卡片。
- 长期记忆 + 多会话；`steward ai` CLI。
- 404/404 单元测试；有头 Chrome E2E（对话 8 步、回归 38 步，0 截图）全绿。
- 证据：`docs/test-evidence/evidence-v15-harness-real/`、`docs/test-evidence/evidence-v15.1/`。
