# Changelog / 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned — 交付后的可选后续扩展（不属于 v1.0.0 范围）
- 强杀恢复、72h 失联、循环超限等扩展故障演练（`tests/fault/` 端到端）
- 通知与协助：Windows Toast / 邮件 / Webhook / 交接流程
- IoT 适配器契约（stub）+ MCP server
- 真实 DSH / DeepSeek Harness 接入
- 企业专属 UI（企业看板/工作流页面）
- 真实银行/税务/CA/电子签章系统对接

## [1.5.6] — 2026-10-31

### Changed
- **名称与功能对齐（项目名不变）**：导航 `对话`→`AI 总控`、`系统`→`系统管理`、`智能体`→`AI 团队`、`项目`→`项目调度`；`/chat` 标题→`AI 总控`；`/agents` 标题→`AI 团队（智能体中心）`；顶栏→`AI 公司总控台`；品牌副标→`LOCAL AI COMPANY OS`；对话空态→`开始新的对话 · 调度你的 AI 公司`。
- **搜索关键词 / 引流**：新增 `docs/zh-CN/overview.md`、`docs/en/overview.md`（关键词版项目简介）、`docs/SEO.md`（关键词地图 + GitHub About/Topics 建议）；README/README.zh-CN 顶部加入定位 + 中英关键词；`package.json` 增加 description/keywords；控制台页面加入 `<meta name=description/keywords>`。
- GitHub 仓库 About 描述与 Topics 同步更新（AI 公司/AI 自动化/多智能体/AI Agent/工作流自动化/本地 AI/DeepSeek Harness 等）。

### Tests
- 单元测试 414/414；全量回归 E2E 38/38 步、415/415 检查；对话 E2E 10/10 步、42/42 检查（0 截图）。
## [1.5.5] — 2026-10-31

### Fixed
- **智能体卡片整卡点击无反应**：标题承诺"点击卡片可展开详情"，但只有「展开详情」按钮绑定了事件。现整卡可点击展开/收起（链接/按钮/输入除外），加指针样式。
- **页面脚本异常/控制台重启后所有点击无反应的静默失败**：所有页面新增运行时守护——捕获 JS 错误/未处理 Promise 显示错误条；每 6 秒探测 `/health`，版本或启动时间变化时提示"控制台已更新/重启"；连接中断提示；均带「重新加载」按钮。
- E2E 补充：整卡点击断言、每智能体「点名发任务」入口、运行时守护存在且正常隐藏。

### Changed
- 版本 1.5.5；回归 E2E 38 步 / 415 检查全绿（0 截图）；单元测试 414 条。

## [1.5.4] — 2026-10-31

### Added
- **点名发送**：`/chat` 输入框新增智能体选择器（自动调度 + 11 个角色）；选择后消息自动带 `@role`；也支持 `@operator …` / `财务：…` / `请编码代理…` / `点名核查复核…` 等中英文点名写法；`/agents` 卡片新增「点名发任务 →」（`/chat?agent=<role>` 预选）。
- **独立智能体上下文**：被点名智能体在独立工作区与独立历史 `.steward/chat/agents/<role>/history.json` 中执行（最多 8 条），总控对话上下文不进入该智能体；总控只收摘要/结果，避免上下文污染与漂移。
- 项目总调度/系统总控被点名时转项目执行器（conductor 拆解派发，专项智能体各自隔离）；其它角色直接用真实 Harness + 角色提示词执行。
- E2E `chat-agent-route`、单元测试点名路由/别名/任务文本剥离；单测 **414/414**。

### Fixed
- "点名发送发不出去"：此前没有点名识别/路由，消息被当成普通闲聊；现支持点名并真实执行。
- 复杂任务不再塞给单一对话上下文：按角色/项目调度分发到独立智能体。

## [1.5.3] — 2026-10-31

### Changed
- **功能去重**：对话/调度统一到 AI 总控 `/chat`；系统页 `/system` 移除独立的超级总调度对话面板，改为「系统管理 + 统一入口 + 快捷查询链接」（6 个链接支持 `/chat?prompt=...` 自动发送）。
- 历史会话页 `/chat/:id` 降级为「运行详情（历史版）」：移除独立对话/调度表单与「＋新建项目」，只读展示并提示统一入口；新版运行详情用 `/runs/:id`。
- 系统页标题改为「系统管理」，保留两层结构/程序/插件/模型/日志/危险动作。

### Added
- `/chat?prompt=`：打开 AI 总控时自动发送问题并展示最终结果（发送后清理 URL 参数）。
- 对话页操作失败时页面级错误提示（新建/重命名/删除/审批），不再静默。
- E2E：system-control 去重断言、chat-quick-prompt 自动发送断言；对话 E2E 9 步、回归 38 步全绿（0 截图）。

### Fixed
- 系统页 supervisor 对话面板为空/发送无响应造成的"对话功能用不了"观感：移除重复入口。
- 移除对话面板后 system.js 初始化空值保护，避免影响系统管理按钮。

## [1.5.2] — 2026-10-31

### Added
- **消息分相**：`ChatPart.phase`（thinking/result）、`ChatMessage.result_text/thinking_summary`；`applyMessagePhases`/`mergeToolParts`/`splitPartsByPhase`；`/chat` 默认只显示"用户输入 + 思考过程（折叠）+ 最终结果"，展开思考才是工具/数据/记忆等详细内容。
- **交付物/审批可见**：报告/产物卡片显示在结果区；审批卡与错误始终可见、不可折叠；运行深度链接可见。
- **审批闭环**：等待审批（pending_approval）不再报失败，批准后继续执行并在对话中推送进展；系统动作审批走 `SystemController.plan → 确认 → execute`（一次性 token），支持批准/驳回。
- **工具单卡**：tool_call + tool_result 合并成一张卡（状态/耗时/结果预览），修复"永远调用中…"。
- **新增测试**：`tests/unit/chat-phase.test.mjs` 8 条（分相/合并/等待审批/系统审批/追加消息/记忆噪音）；总计 **412/412**。

### Fixed
- 用户消息"我 我"重复 → 头像/名称统一为"你"。
- 纯查询不再批量产生产物/报告级记忆噪音。
- 危险动作目标 id 归一化（"受管程序 demo-app"→`demo-app`），策略拒绝明确提示而非要求批准。
- 系统审批卡不再伪造 run_id；演示标签仅用于演示数据。

### Changed
- 版本 1.5.2；控制台 health `1.5.2`。
- 对话 E2E 8 步 + 回归 E2E 38 步全绿（0 截图）。

## [1.5.1] — 2026-10-30

### Added
- **DeepSeek Harness 真实智能体**：新包 `steward-harness-runtime`（headless NDJSON 事件解析、思考/工具/产物/报告、并发池、超时/取消/回退、自动 report.md）；编排层注入 `agentExecutor`，10 个业务智能体优先真实 Harness 执行，证据写入 `runs/<sid>/harness/` 并实时推送。
- **Harness 配置中心**：`harness` 设置（总开关/profile/dsh_bin/timeout/并发/产物保留/report_required/11 角色；supervisor 固定关闭）+ 11 agent harness 元数据（profile/workspace/tools）。
- **专业提示词 v3**：`prompts/v3/` 11 篇真实代理提示词（工具使用/产物落盘/report.md/证据/角色专属产物/安全）；配置默认提示词、`HARNESS_AGENT_DIRECTIVE`、`composeHarnessPrompt`。
- **对话式 AI 总控**：新包 `steward-chat`（18 类意图、查询 0 token、任务流式、危险动作只给审批卡、长期记忆、多会话）。
- **控制台 `/chat` ChatGPT 式重做**：会话历史/记忆抽屉/内嵌 thinking·工具·产物·报告·数据·审批卡片、SSE 逐段渲染、9 个快捷查询；真实 Provider 接入。
- **`steward ai` CLI**：`steward ai "..."` / `--history` / `--memory` / `--conversation` / `--delete-memory`，实时显示思考/工具/产物/报告/数据。
- **真实数据读取层**：`harness-data`（产物/报告/metrics/内容/下载、去重、脱敏、路径穿越防护）；真实 Provider 接入 artifacts/reports/metrics API 与 harness 事件 SSE。
- **测试**：新增 Harness 19 条、config 16 条、chat 19 条、harness-data 9 条（真实 run 证据 + 假数据混合）；总计 **404/404**。
- 文档：`docs/zh-CN/harness.md`、`docs/en/harness.md`、`docs/zh-CN/conversation.md`、`docs/en/conversation.md`、`docs/RELEASE_NOTES_v1.5.1.md`。

### Fixed
- 真实密钥解析 bug：配置中心 `getApiKeyForProvider` 返回 `{ok,value}`，编排层按字符串判断导致误判无 key → 全部 `local_fallback`；已修复。
- Harness 单步 Token 上限过低导致大任务阻断（20 万 → 可配，默认 200 万），且超限仍保留产物/报告/证据。
- H: exFAT 上 Harness `write` 工具 EISDIR/rename 失败：工作区移至系统临时盘、ChatStore 原子写增加 rename 失败回退。
- `steward runtime` 执行结束后进程偶发挂起：显式退出。
- 产物列表重复、报告含本机绝对路径：去重 + 脱敏。

### Changed
- 版本 1.5.1；控制台 health 返回 `1.5.1`、`chat_engine_enabled`。
- 控制台 E2E 默认不保存截图（按要求，仅 result.json/断言）。

## [1.4.0] — 2026-10-30

### Added
- **发送即执行**：`/chat` 发送目标后自动创建 Run 并执行（无需手动点开始）；CLI `steward runtime --goal` 一条命令自动跑完。
- **steward-runtime 包**：Run 队列/自动执行循环/实时事件（17 类）/审批策略（auto_low_risk/auto_all/manual、full_auto）/并发（默认 3）/暂停恢复打断/自动返工/持久化/断线 since 回放。
- **SSE 实时流**：`GET /api/chat/runs/:id/stream?since=`（心跳、Last-Event-ID 续传）；控制台实时显示思考/计划/每步/每轮摘要+Token/审批卡/完成，刷新可恢复。
- **配置中心 runtime 设置**：auto_run、approval_mode、full_auto、max_auto_steps、rework_limit、event_retention；`/settings` 可视化并校验（full_auto 与 manual 互斥）。
- **模型输出兜底**：本地动作未实现/失败时保存模型输出为证据，含 HTML 提取为 deliverable.html（不再因单个动作阻断整条 Run）。
- **系统总控扩展**：受管工作区文件/目录、打开应用/白名单 URL、服务状态、定时任务 scheduler.json、受管程序安装/卸载（备份+确认+审计）。
- 文档：`docs/zh-CN/runtime.md`、`docs/en/runtime.md`、`docs/RELEASE_NOTES_v1.4.0.md`；测试 339 条。

### Fixed
- 配置中心 `getApiKeyForProvider` 返回 `{ok, value}` 与编排 resolver 期望字符串不匹配导致真实模型被误判为无 key、全部走本地回退的问题。
- 控制台真实 `startProject` 未调用引擎执行、导致需手动点开始的问题（v1.4 统一为发送即执行 + RunManager 驱动）。
- 模型计划中的未实现动作（如 harness.build_deliverable）导致整条 Run 阻塞的问题。

## [1.3.0] — 2026-10-26

### Added
- **多模型与 API 密钥**：4 类 provider（DeepSeek/OpenAI 兼容/Anthropic/本地）、base_url/模型/密钥引用可配、一键同步密钥、11 个智能体独立选模型、密钥只存引用与掩码（config.json 无明文）、真实模型适配 + 本地回退标注。
- **两层总调度**：L1 系统总控 supervisor（受管程序/插件、切换模型与提示词、读全部日志、委派项目、**危险动作二次确认+回收站备份**）+ L2 项目总调度 conductor（计划/派发/预算/验收）+ L3 专项智能体；每轮 AgentTurn（输入/输出摘要、全文、Token、证据、模型来源）。
- **控制台 v1.3**：/chat 对话与新建项目、打断/恢复/审批；/agents/:role 每轮摘要；/runs/:id 时间线+证据灯箱；/money 变现与易支付；/system 系统总控与危险确认；/settings 模型密钥/系统提示词/易支付分组。
- **变现/易支付**：收款请求→确认到账→账本 6 要素+发票草稿；彩虹易支付兼容 MD5 签名、收银台链接、notify 验签自动到账；demo/live 模式。
- **CLI**：steward chat/supervisor/project/system/money/config/agents/data（均支持 --json）。
- **系统动作层**：受管应用/插件白名单、风险分级、一次性确认令牌（120s）、回收站备份与恢复、审计 JSONL。
- 文档：docs/{zh-CN,en}/{configuration,chat,system,money}.md、docs/RELEASE_NOTES_v1.3.0.md、prompts/v2 + manifest-v2.json；测试 290 条。

### Changed
- 版本 1.1.0 → **1.3.0**；控制台管理页与对话/系统/变现全部接入真实引擎（OrchestratorEngine + SystemController + MoneyEngine + ConfigEngine）；运营页为演示数据并标注。

### Fixed
- 演示质检证据缺失时 reviewer 自行做结构/金额/外链复核并留证（不再误判阻断）。
- 插件 manifest 带 BOM 时拒绝改写的问题（演示插件文件改为无 BOM）。
- 控制台真实对话 start 未调用引擎 startProject 的问题。

## [1.1.0] — 2026-10-26

### Added
- **配置中心 `packages/steward-config`**（零依赖，本地 JSON 持久化）：
  - **三种运行模式**：体验模式（demo，内置演示数据）/ **个人模式**（微信支付、支付宝、个人银行卡；无合同/无签字/无双人复核）/ **企业模式**（对公账户、增值税专票、授权书、用印 AI 不代签、双人复核、组织审批链）
  - **全部参数可配置**：14 项功能逐项启用/禁用（含禁用原因）、预算三层 + **0 元极限模式**、**Token 预算上限/单步/超限策略**（测试值 10,000,000）、支付渠道与**银行卡/收款账户配置**（只存掩码）、发票设置、智能体开关与 Token 限额、审批与接管策略
  - 配置校验/导入导出/重置、**数据清空**（白名单 + 防路径穿越，保留配置）、变更审计、Token 用量历史与按 agent 统计、10 个智能体注册表
- **控制台专业版 v1.1**：左侧导航 + 顶部状态栏（模式徽章/预算余量/Token 余量/接管状态/最近事件）；新增 `/settings` 配置中心（三模式 + 支付银行卡高亮分组）、`/agents` 智能体中心（含写代码 Harness、核查 reviewer、后台 backend）、`/backend` 全流程时间线、`/data` 数据管理（统计/二次确认清空/重置演示/导出配置）；18 个管理 API（写操作 token 保护）
- **CLI**：`steward config`（get/mode/set/reset/export/import/validate）、`steward agents`、`steward data`（stats/reset）、`steward limit-run`
- **0 元预算极限测试（个人模式，真实运行）**：小项目真实 HTML 周报交付 → 真实有头浏览器验收 → **¥1 外部付费被 0 元预算拒绝** → **Token 12,000 / 10,000,000** → **收入 ¥10** 记账（个人收款、无合同/无签字、账本 6 要素完整）；证据 `docs/test-evidence/evidence-limit-2026-10-26_22-17-54/`
- 控制台 v1.1 真实浏览器验收：**15/15 步、178/178 检查、15 张截图**（`docs/test-evidence/evidence-console-v11-2026-10-26_22-17-54/`）

### Changed
- 版本 1.0.0 → **1.1.0**；`steward console` 管理页（配置/智能体/后台/数据）接入真实 `ConfigEngine` 与 `runs/` 数据（运营页为演示数据并在页面标注）
- 测试：185/185（新增 config 34 条）

### Fixed
- A11「源码无遥测」扫描对配置项 `telemetry: false` 的误报：改为只检测真实遥测/分析 SDK 依赖与上报调用。
## [1.0.0] — 2026-10-26

### Added — 最终发布：两阶段交付完成（Two-Phase Delivery Complete）

- **版本 1.0.0**：`package.json` 与 CLI `VERSION` 同步 `1.0.0`；全量 **151/151** 单元+集成测试通过
  （16 个测试文件）；CLI **19 个已实现命令 + `help` 入口**（0 占位）。
- **GitHub Release v1.0.0（Latest，两阶段交付完成）**：
  https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0 （tag 指向提交 `1e3b89f`；名称
  「v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete」；非 draft/prerelease；发布说明
  `docs/RELEASE_NOTES_v1.0.0.md` 中英双语）。
- **真实截图宣传片（Release Assets，3 个）**：`daizhang-steward-promo-v1.0-bgm.mp4`
  （12,947,989 B，110s / 1280×720@30fps / H.264+AAC 立体声）、`daizhang-steward-promo-v1.0-silent.mp4`
  （10,169,266 B，静音无音轨）、`daizhang-steward-promo-v1.0-poster.jpg`（85,200 B）；制作
  HyperFrames（HTML/GSAP）+ 代码合成 BGM（120 BPM、无人声、无外部素材/字体/网络请求），素材全部为
  M1 真实浏览器 / M2 真实 Windows 桌面 / P1 控制台真实 E2E 截图（15 张，无重绘），
  `hyperframes check` ok:true（lint 0 error/0 warning、contrast 45/45 WCAG AA）。
- **媒体工程 `docs/media/promo/`**：README / STORYBOARD / FACTS / poster.jpg（分镜与事实核对，
  可复现制作过程）。
- **发布验证**：`docs/test-evidence/release-v1.0.0-check.md` + `docs/images/release-v1.0.0.png`
  （GitHub REST API + 真实浏览器双通道：Release 页面、Latest 徽标、tag/提交、双语说明、3 个 Assets
  state=uploaded 且大小/SHA256 与本地一致）。
- **交付结论**：阶段一 **A1–A12 全部通过**（v0.5.0）、阶段二 **B1–B8 全部通过**（v0.6.0 P1 /
  v0.8.0 P2+P3）；中英双语文档、CC BY-NC-SA 4.0 许可证、完整证据归档（M0–M4 + P1/P2/P3 + 真实长跑 +
  发布验证）；**两阶段交付完成**。

### Changed
- 文档全量更新到「v1.0.0 已发布 / 两阶段交付完成」最终状态：README 中英（Release + 宣传片 3 个
  Assets 链接 + 两阶段全 ✅）、ROADMAP（P4 ✅ + 完成结论块 + 后续可选扩展）、HANDOFF（最终版）、
  CHANGELOG `[1.0.0]`、delivery-checklist 中英（最终结论 + U 表）、architecture 中英、
  docs/README、test-evidence/README、images/README、packages/apps/tests/examples README、ASSUMPTIONS。

## [0.8.0] — 2026-10-26

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
- 验收：**B8 通过**；30 条边界双模式标注表完成；企业 run `run-20261025-232357-2ce6f6`；**阶段二
  P2+P3 合并发布 v0.8.0**（GitHub Release，Latest，tag `95b609a`；发布说明
  `docs/RELEASE_NOTES_v0.8.0.md`；发布验证 `docs/test-evidence/release-v0.8.0-check.md` +
  `docs/images/release-v0.8.0.png`）。
- **P2 真实长跑已通过（2026-10-26）**：`npm run drill:long` 真实时长（断网 120 分钟 / 封禁 15 分钟）——
  B3：1435 次承诺被拒/0 新增、1435 条动作全部补记、`duplicates_found=0`、二次对账 `entries_added=0`；
  B4：9ms 检测、180 次尝试 0 成功、5 条替代方案 + 通知、解禁恢复；证据
  `docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` +
  `evidence-long-drill-2026-10-25_15-02-52/`（11 文件，已脱敏）。**B3/B4 通过 → 阶段二 B1–B8 全部通过。**
- 文档同步：README 中英、ROADMAP、HANDOFF、ASSUMPTIONS、docs/README、delivery-checklist 中英、
  architecture 中英、packages/apps/tests/examples README 更新到「阶段二 P2+P3 完成 / v0.8.0 已发布」，
  并新增 `docs/zh-CN/enterprise.md` + `docs/en/enterprise.md`。

## [0.7.0] — 2026-10-25

### Added — 阶段二 P2 故障演练（B3 / B4 短跑 + 真实长跑均通过）

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
- **`npm run drill:long`（真实长跑，2026-10-26 通过）**：真实时长不加速——**B3 断网 120 分钟
  （7215 秒）** → **1435 次承诺被拒、0 新增**，1435 条动作入 Outbox 并**全部补记**、
  **`duplicates_found=0`**、二次对账 `entries_added=0`、恢复在 10 分钟内；**B4 封禁 15 分钟（900 秒）**
  → **9ms 检测**、**180 次尝试 0 成功**、停止动作 + **5 条替代方案** + 通知、解禁恢复；证据
  `docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` +
  `evidence-long-drill-2026-10-25_15-02-52/`（11 文件，已脱敏）。

### Changed
- 验收：**B3/B4 通过**（短跑 11/11 + 真实长跑）；阶段二 **B1–B8 全部通过**；P2 与 P3 合并发布
  **v0.8.0**（GitHub Release，Latest，tag `95b609a`）。
- 文档同步：README 中英、ROADMAP、HANDOFF、ASSUMPTIONS、docs/README、delivery-checklist 中英、
  architecture 中英、packages/apps/tests/examples README 更新到「阶段二 P2+P3 完成 / v0.8.0 已发布」。

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

[Unreleased]: https://github.com/minzzj/daizhang-steward/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0
[0.8.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.8.0
[0.7.0]: https://github.com/minzzj/daizhang-steward/compare/v0.6.0...a41fe68
[0.6.0]: https://github.com/minzzj/daizhang-steward/compare/v0.5.0...2db8da3
[0.5.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0
[0.4.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.4.0
[0.3.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.3.0
[0.2.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.2.0
[0.1.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.1.0
[0.0.1]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.0.1
