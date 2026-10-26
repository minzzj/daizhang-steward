# 代掌 Steward

**可托管的 AI 经营代理 / A composable operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations · evidence-first.

> 状态：**v1.0.0 已发布 —— 两阶段交付完成（Latest，2026-10-26）**。代掌分两阶段交付：
> **阶段一 —— 开源自托管操作型 AI 内核**（v0.5.0）：真实有头浏览器 Operator（A2/A4/A5）、真实 Windows
> 桌面 Operator（A3）、安全模块（A8/A9）、Scout 客户分支（A7）、A10 只读 dummy 分支、A11 发布就绪、
> A12 提示词 —— **A1–A12 全部通过**。
> **阶段二 —— 经营代理**（v0.6.0 / v0.8.0，最终随 v1.0.0 发布）：**个人版 MVP**（P1：经营域引擎、仿真业务线、本地 Web 控制台、
> 审批/接管/月报；B1/B2/B5/B6/B7，v0.6.0）、**真实故障演练**（P2：短跑 + **真实 120 分钟断网 / 15 分钟
> 封禁长跑**——断网 **1435 次承诺被拒/0 新增**、1435 条动作全部补记、**`duplicates_found=0`**；封禁
> **9ms 检测**、**180 次尝试 0 成功**、**5 条替代方案** + 通知、解禁恢复；B3/B4）与**企业版**
> （P3：主体/授权/用印人签、对公账户、增值税专票校验、发票与申报仅草稿（AI 不代提交）、双人复核、
> 组织审批链、**AI 不代签**、**B8 双模式一致且 6 类不一致全部阻断**、**30 条边界双模式标注表**）——
> **B1–B8 全部通过**。
> **151/151** 单元+集成测试通过（16 个测试文件）；CLI 现为 **19 个已实现命令 + `help` 入口**，0 个占位。
> **GitHub Release [v1.0.0](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0)（Latest，
> 两阶段交付完成）** 附**真实截图宣传片** Asset：
> [`带 BGM 版`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-bgm.mp4) ·
> [`静音版`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-silent.mp4) ·
> [`封面`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-poster.jpg)
> （110 秒 / 1280×720 / 30fps，素材全部来自真实 E2E 截图；工程与分镜见
> [`docs/media/promo/`](docs/media/promo/)）。详见
> [`docs/zh-CN/enterprise.md`](docs/zh-CN/enterprise.md) / [`docs/en/enterprise.md`](docs/en/enterprise.md)、
> [ROADMAP.md](ROADMAP.md) 与 [`docs/zh-CN/delivery-checklist.md`](docs/zh-CN/delivery-checklist.md)。
> Status: **v1.0.0 released — two-phase delivery complete** (Latest, 2026-10-26): Phase 1 (v0.5.0)
> operating-AI core — A1–A12 all pass; Phase 2 (v0.8.0) business steward — P1 personal-edition MVP
> (v0.6.0), P2 real fault drills including the real 120-min outage / 15-min ban long run (1435 promises
> blocked / 0 new, 1435 replayed, 0 duplicate ledger entries; ban detected in 9 ms with 180 attempts /
> 0 successes and 5 alternatives) and P3 enterprise edition (B8 + 30-rule dual-mode table) — B1–B8 all
> pass. 151/151 tests (16 files); 19 implemented commands + `help`, 0 placeholders. GitHub Release
> **v1.0.0** (Latest) ships the real-screenshot promo video as assets (110 s, 1280×720 @30 fps; project
> in `docs/media/promo/`).

---


> **v1.3.0（2026-10-26）**：配置中心支持**多模型与 API 密钥**（一键同步、各智能体独立选模型、密钥只存引用）；新增**两层总调度**（系统总控 supervisor + 项目总调度 conductor）、**控制台对话/每轮摘要/证据灯箱/系统总控/变现&易支付**页面；CLI 新增 `chat` / `supervisor` / `project` / `system` / `money`；290/290 单测 + 真实浏览器 E2E 25 步全绿。详见 `docs/RELEASE_NOTES_v1.3.0.md` 与 `docs/zh-CN/{configuration,chat,system,money}.md`。
## 它是什么 / What it is

代掌（Steward）是一个**可组合的操作型 AI**：

1. **Operator**（手）— 用真实浏览器与真实桌面软件完成任务：观察、操作、验证、留证。
2. **Conductor**（脑）— 决定方向：拆目标、派生分支、分配预算、验收与汇总。
3. **Harness loop**（代码来源）— 失败时写 CodeTask 交给 DeepSeek Harness 生成补丁，隔离应用、跑测试、最多两轮，超限交人。
4. **Scout**（客户分支）— 只在公开合规来源找线索、评分、起草外联，人类批准后才发送。

所有对外动作写入只追加的事件账本（`events.jsonl` + 哈希链），每步有截图/日志/回执；
高风险动作默认拒绝，验证码、2FA、人脸核验一律停止交人。

A composable operating-AI core: **Operator** drives real browsers and desktop apps, **Conductor**
sets direction and spawns branches, a **Harness loop** turns failures into reproducible CodeTasks
and patches, and **Scout** drafts compliant outreach (human approval required). Every external
action is appended to a tamper-evident event ledger with screenshot/log evidence; high-risk actions
are denied by default and CAPTCHAs/2FA/human-verification always hand off to a human.

## 不是什么 / What it is not

- 不是自动签约、自动付款、自动开票的工具；这些默认拒绝或只出草稿。
- 不绕过验证码、风控、平台规则；不抓登录后页面；不批量外呼。
- 不替代法律主体：不担任法定代表人、股东、董事、监事或高级管理人员。
- 阶段一不做多租户 SaaS、计费与复杂前端。

## 两阶段路线 / Two phases

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 开源「操作型 AI 内核」：Operator + Harness 编码回路 + Scout + Conductor；12 条可复现验收 | ✅ **已完成（v0.5.0，A1–A12 全部通过）** |
| Phase 2 | 代掌经营代理：**个人版优先**（一条仿真业务线跑通），再企业版；8 条验收 + 30 条边界 | ✅ **已完成（v0.8.0，B1–B8 全部通过）—— P1 个人版（v0.6.0）；P2 故障演练（含真实 120 分钟断网 + 15 分钟封禁长跑）；P3 企业版（B8 + 30 条边界）** |
| 发布 | 最终发布 v1.0.0：双语文档、真实截图宣传片、证据索引 | ✅ **已发布（v1.0.0，Latest —— 两阶段交付完成）** |

两阶段均已交付：阶段一发布为 **v0.5.0**，阶段二发布为 **v0.6.0（P1）** 与 **v0.8.0（P2+P3）**，
最终 **v1.0.0**（[GitHub Release，Latest](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0)）
为两阶段交付完成版：**A1–A12 与 B1–B8 全部通过**、中英双语文档、完整证据归档，并附**真实截图宣传片**
（3 个 Release Assets；工程与分镜见 [`docs/media/promo/`](docs/media/promo/)）。

## 架构一览 / Architecture at a glance

```text
人 (owner) ── 审批卡 / 接管键 / 月报 ──┐
                                       ▼
                     Conductor (direction, branches, budget)
                                       │
              ┌────────────────────────┼────────────────────────┐
        Operator (browser/desktop)  Scout (leads)        Reviewer (evidence)
              │                        │                        │
       Playwright real browser   public-source fixtures   policy + audit
       Windows real desktop      scoring + drafts         events.jsonl
       (ctypes 侧车 + SendInput)
              └─────────── CodeTask → Harness → patch → tests ──────────┘
```

更完整的设计见 [`docs/zh-CN/architecture.md`](docs/zh-CN/architecture.md) / [`docs/en/architecture.md`](docs/en/architecture.md)。

阶段二 P1 在内核之上新增**经营代理**：经营域引擎（`steward-domain`：委托、预算三层、项目、任务、代理、
证据、账本、墓碑；审批 / 接管包 / 月报 / L0-L1-L2 摘要 / 18 条个人模式边界规则）与**只监听本机的
Web 控制台**（`steward-console`，127.0.0.1 + 写操作 token 保护），渲染看板、项目时间线、账本 6 要素
抽屉、审批卡与接管键；数据来自一条纯虚构仿真业务线（`examples/demo-business`）。

阶段二 P2 新增**故障演练模块**（`steward-fault`）：对 `examples/demo-platform` 注入**真实** localhost
HTTP 故障（真实 `ECONNREFUSED` 断网，或真实返回 `403 + x-platform-ban: true`），断网期间**不产生新承诺**、
动作进入**幂等 Outbox**，恢复后重放（账本重复 0），封禁时停止动作并生成可读**替代方案** + 本地通知；
`steward fault-drill --case net-outage | platform-ban` 执行演练。短跑验收实测 `outage=120007ms`、
25 次承诺被拒、25 条排队/重放、重复 0、封禁检测 11ms、替代方案 5 条。

阶段二 P3 新增**企业版**（`steward-enterprise`）：主体/授权/用印校验、对公账户、增值税专票校验
（抬头/税号/合同一致，仅草稿待人工确认）、申报草稿（AI 不代提交）、双人复核（2 位不同角色）、
按金额分档的组织审批链、用印仅自然人（`ai_may_sign=false`）、用工/资质类转人工、多代理串行、
**B8 双模式一致性**（个人/企业各跑一单，6 类不一致 100% 阻断）与**30 条边界双模式标注表**——详见
[`docs/zh-CN/enterprise.md`](docs/zh-CN/enterprise.md) / [`docs/en/enterprise.md`](docs/en/enterprise.md)。

## 仓库结构 / Repository layout

本仓库为**单包布局**（无 pnpm workspace）：`tsconfig.json` 把 `packages/*/src` 与
`apps/cli/src` 用 `tsc -p tsconfig.json` 编译到 `dist/`；命令一律用 npm。

```text
packages/   core packages (steward-core: runtime/policy/events/artifacts/prompts + M2 的
            stop-controller/checkpoint/isolation；steward-harness: MockHarness + 隔离 worktree 补丁 +
            两轮编码回路；steward-browser: Playwright 真实浏览器适配器；steward-desktop: 真实 Windows
            桌面适配器——ctypes 侧车 + SendInput；steward-scout: 客户分支引擎——ICP/评分/草稿/审批队列，
            纯逻辑零网络；steward-domain: 阶段二经营域引擎；steward-console: 本地 Web 控制台；
            steward-fault: P2 真实故障演练——断网闸门/幂等 Outbox/封禁检测/替代方案；
            steward-enterprise: P3 企业版——主体/授权/用印、对公发票、双人复核、组织审批链、30 条边界)
apps/       CLI entry (steward: demo/browser-flow/desktop-flow/scout/dummy-branch/business/console/
            boundary-check/fault-drill/enterprise-demo/approve/takeover/code-loop/run/branch/report/
            stop/safety-check/version/help — 19 个已实现命令，0 个占位)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness（脚本化补丁）, scout-fixtures（14 条虚构合规线索）,
            demo-business（仿真个人版业务线）, demo-platform（P2 真实 localhost 故障注入平台）,
            demo-enterprise（P3 企业 fixtures：8 条订单 = 2 正常 + 6 不一致）
tests/      unit tests（v0.8.0 共 16 文件 / 151 条）+ e2e-browser + e2e-desktop + e2e-console
docs/       双语文档（en/ 与 zh-CN/）+ 测试证据
scripts/    校验/构建辅助、密钥扫描、证据包 / 验收脚本、交付同步
runs/       每次运行的产物（gitignored；证据在此）
dist/       构建输出（gitignored；单包构建）
```

## 快速开始 / Quickstart（M0 → v1.0.0）

> 两阶段均已完成，最终 **v1.0.0** 已发布（Latest），全部里程碑都可在本机离线复现。M0 克隆后即可
> 离线运行（MockHarness，无需付费 API）；M1 增加真实浏览器回路；M2 增加真实 Windows 桌面回路与安全
> 模块；M3 增加 fixture 驱动的 Scout 客户分支；M4 增加 A10 只读 dummy 分支与发布就绪验收；**P1 增加
> 经营域、本地 Web 控制台与仿真业务线（B1/B2/B5/B6/B7）**；**P2 增加真实 localhost 故障演练
>（B3/B4 短跑 + 真实 120 分钟/15 分钟长跑）**；**P3 增加企业版、B8 与 30 条边界双模式表**：

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm；真实浏览器验收需本机 Chrome/Edge；
# 真实桌面验收需 PATH 中的 Python >= 3.8
npm install
npm run check          # 校验仓库配置 / repo-config check
npm run check:secrets  # 密钥扫描 / secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 151/151 单元+集成测试（16 文件）/ unit + integration tests
npm run demo           # M0 空回路 → runs/<run-id>/ + report.md（MockHarness）
npm run test:prompts   # 提示词版本/安全测试（验收 A12）
npm run evidence       # 离线证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance     # M1 本机有头真实浏览器验收（A2/A4/A5）→ docs/test-evidence/m1-acceptance-<stamp>.*
npm run acceptance:m2  # M2 真实桌面 + 停止键/检查点/隔离验收（A3/A8/A9），仅本机
npm run acceptance:m3  # M3 Scout 验收（A7：14 线索 → 丢弃 4 → 合格 8 → 3 草稿，0 发送）
npm run acceptance:m4  # M4（阶段一）发布就绪验收（版本一致性为动态检查，可在后续版本重跑）
npm run acceptance:p1  # P1 个人版 MVP 验收（B1/B2/B5/B6/B7 + 控制台 E2E + 113 测试），仅本机
npm run acceptance:p2  # P2 故障演练**短跑**（B3/B4：约 2 分钟断网 + 2 分钟封禁，真实 localhost HTTP），仅本机
npm run drill:long     # P2 **真实长跑**（B3：断网 120 分钟 / B4：封禁 15 分钟，真实时长），仅本机；生成 long-drill-* 证据
npm run acceptance:p3  # P3 企业版验收（B8 + 30 条边界 + 双人复核/用印/发票/组织审批链），仅本机
# 阶段二 P1 快速体验（全部离线、纯虚构数据）：
node dist/apps/cli/src/index.js business          # 选题/仿真业务线/账本 6 要素/承诺追溯/接管包/月报/边界
node dist/apps/cli/src/index.js boundary-check    # 18 条个人模式边界规则；四类越界 100% 拒绝
node dist/apps/cli/src/index.js console           # 本地 Web 控制台 http://127.0.0.1:4180（写操作 token 保护）
node dist/apps/cli/src/index.js approve --json    # 人工审批队列（超时=挂起，绝不自动放行）
node dist/apps/cli/src/index.js takeover --json   # 接管键：停止新动作 + 6 类接管包；--resume 恢复
# 阶段二 P2/P3 快速体验：
node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 0.2 --json   # 真实断网演练（短）
node dist/apps/cli/src/index.js fault-drill --case platform-ban --ban-minutes 0.2 --json   # 真实 403 封禁演练（短）
node dist/apps/cli/src/index.js enterprise-demo --json  # B8 双模式订单 + 6 类不一致阻断 + 30 条边界表
```

CI 跑仓库自检、密钥扫描、build、151 条测试、demo 证据、fixture 驱动 `scout` 演示（只起草、绝不自动
发送）、阶段二 `business`/`boundary-check` 演示、A10 `dummy-branch` 演示、`safety-check` 自检、
**真实 localhost 故障演练（B3/B4 短跑）**、**P3 企业版演示（B8 + 30 条边界）**、
**无头真实浏览器控制台 E2E** 与无头真实浏览器 demo-web E2E；有头 `npm run acceptance` /
`acceptance:p1` / `acceptance:p2` / `acceptance:p3` 与真实桌面 `npm run acceptance:m2` 仅本机运行
（托管 CI 无交互桌面）。

v0.8.0 能跑什么：CLI 已实现 `demo`、`browser-flow`、`desktop-flow`、`scout`、`dummy-branch`、
`business`、`console`、`boundary-check`、`fault-drill`、`enterprise-demo`、`approve`、`takeover`、
`code-loop`、`run`、`branch`、`report`、`stop`、`safety-check`、`version`（**19 个业务命令，0 个占位**；
`steward help` 列出全部）。`browser-flow` 在有头 Chrome 里跑真实 demo-web 登录/项目流程并逐步截图；
`desktop-flow` 用真实键鼠（SendInput，中文 Unicode 真实键盘输入）操作真实 `demo-desktop` 窗口并逐步
截图；`scout` 读取虚构合规 fixtures，构建 ICP + 3 个高价值场景，按四因子评分（需求 40% / 预算 20% /
可触达 20% / 合规 20%）评分、来源硬校验与去重，最多起草 3 条外联草稿（≤150 字、均引用具体信号），
全部进入**人工审批队列**（全部 `pending`、`sent=0`；每日每渠道 ≤10；支持退订；无任何网络 IO）；
`dummy-branch` 演示 A10——新增只读分支只需 BranchSpec + 已有提示词（`reviewer@1.0.0`），不改核心；
**`business`** 端到端跑阶段二经营代理：选题（3 条候选业务线、来源可查）→ 一条仿真业务线（项目→任务→
交付→验收→收款/开票）→ 账本**6 要素** → **承诺追溯**（对话原文→委托条款→项目；未记录=未授权）→
**6 类接管包** → 月报 → 18 条个人模式边界规则；**`console`** 起本地 Web 控制台（**只监听 127.0.0.1**、
写操作需 `X-Steward-Token`、无 CDN/外链；看板/项目时间线/账本 6 要素抽屉/审批卡/接管键/月报）；
**`boundary-check`** 自检边界规则（四类越界 100% 拒绝、支付→human、报价→draft_only）；
**`approve`** 与 **`takeover`** 是真实人工命令（审批超时=挂起不自动放行；接管停止所有新写操作并生成
接管包，`--resume` 恢复），验收控制台 E2E（有头 Chrome）实测接管停止 **88ms**（上限 10000ms）；
**`fault-drill --case net-outage` / `--case platform-ban`** 对 `examples/demo-platform` 注入**真实**
localhost HTTP 故障：断网期间不产生新承诺、动作进入幂等 Outbox 并在恢复后重放（**账本重复 0**），
真实 `403+x-platform-ban` 时停止动作（**11ms 内检测**）并生成替代方案 + 本地通知；
**`enterprise-demo`** 跑 P3 企业版流程：主体/授权校验、对公账户、增值税专票校验（草稿待人工）、
双人复核（1 人不生效、2 位不同角色生效）、按金额分档的组织审批链、用印仅自然人
（`ai_may_sign=false`）、**B8 双模式一致性 6 类不一致全部阻断**、**30 条边界双模式标注表**
（支付/开票/申报均不自动执行）。`code-loop` 跑 CodeTask → 补丁 → 隔离 git worktree → 真实浏览器验收，
`code-loop --fail` 注入坏补丁并在两轮失败后升级；`safety-check` 自检停止键（≤5s）、检查点
save/load/resume 与分支隔离；`run --resume <runId>` 从最近检查点恢复并跳过已完成步骤。每次运行把证据
写入 `runs/<run-id>/`：`prompt.md`、`report.md`、`console.log`、`meta.json`、`events.jsonl`（哈希链
账本）、`checkpoint.json`，以及 `patch.diff`、`test.log`、`code-task.json`、`code-result.json`、
`e2e/<case>/screenshots/`、`e2e-desktop/screenshots/`；Scout 运行另含 `scout-report.md/.json`、
`leads-scored.json`、`drafts.json`、`approval-queue.json`、`outreach-drafts/`；P1 `business` 运行
另含 `proposal.json`、`business-result.json`、`ledger-facts.json`、`promise-traces.json`、
`takeover-pack.json`、`boundary-check.json`、`monthly-report.{json,md}`、`summaries.json`；P2 `fault-drill`
运行另含 `drill-net-outage.json`/`outbox.json`/`ledger.json`/通知，或 `drill-platform-ban.json`/
`alternative-plan.json`/通知；P3 `enterprise-demo` 运行另含 `profile.json`、`entity-validation.json`、
`seal-flow.json`、`dual-review.json`、`invoice-validation.json`、`org-approval.json`、
`dual-mode-orders.json`、`boundary-table.{md,json}`、`boundary-checks.json`、`fixture-checks.json`。
也可直接调用构建产物：`node dist/apps/cli/src/index.js help`。

最新 P3 企业版验收（2026-10-25，纯本地，`npm run acceptance:p3` OK，**12/12 检查**）：
[`docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.md`](docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.md)
（· [`.json`](docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.json)）；证据包
[`docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`](docs/test-evidence/evidence-p3-2026-10-25_15-23-46/)
（18 个文件，已脱敏，企业 run `run-20261025-232357-2ce6f6`）：B8 双模式订单（主体/抬头/收款/发票类型
一致 + **6/6 不一致阻断**，阻断时不产生发票/收款）、**30 行边界双模式标注表**（四类重点越界双模式
deny）、双人复核（1 人 `applied=false`、2 位不同角色 `applied=true`）、用印 `ai_may_sign=false`
（人签）、专票校验 `draft_pending_human`、申报草稿（`ai_may_submit=false`）、组织审批链 1/2/3 级
（3000/20000/80000）、用工/资质转人工、企业 fixtures 交叉验证 8/8；**151/151** 测试。详见
[`docs/zh-CN/enterprise.md`](docs/zh-CN/enterprise.md)（30 条边界表全文）。

最新 P2 故障演练验收——**完成：短跑 + 真实长跑均通过**（2026-10-26，`npm run acceptance:p2` OK，短跑
**11/11 检查**；真实长跑 `npm run drill:long`）：短跑证据
[`docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.md`](docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.md)
（· [`.json`](docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.json)）+ 证据包
[`docs/test-evidence/evidence-p2-2026-10-25_15-02-52/`](docs/test-evidence/evidence-p2-2026-10-25_15-02-52/)
（10 文件，已脱敏：短跑断网 120007ms、25 次承诺被拒、25 条排队/重放、账本重复 0；封禁 11ms 检测、
替代方案 5 条、通知留痕）。**真实长跑**（真实时长，不加速）：
[`docs/test-evidence/long-drill-2026-10-25_15-02-52.md`](docs/test-evidence/long-drill-2026-10-25_15-02-52.md)
（· [`.json`](docs/test-evidence/long-drill-2026-10-25_15-02-52.json)）+ 证据包
[`docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/`](docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/)
（11 文件，已脱敏）：**B3 真实断网 120 分钟（7215 秒）** → **1435 次承诺被拒、0 新增**，1435 条动作入
Outbox 且恢复后**全部补记**、**`duplicates_found=0`**、二次对账 `entries_added=0`；**B4 真实封禁
15 分钟（900 秒）** → **9ms 检测**、**180 次尝试 0 成功**、停止动作 + **5 条替代方案** + 通知、解禁恢复。
**B1–B8 全部通过。**

最终 **v1.0.0** 发布 —— **两阶段交付完成**（2026-10-26，Latest）：
[GitHub Release v1.0.0](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0) 附
**真实截图宣传片**（HyperFrames + 代码合成 BGM，素材为 M1/M2/P1 真实 E2E 截图；110 秒 / 1280×720 /
30fps；`hyperframes check` ok:true，WCAG AA 对比度 45/45）：
[**带 BGM 版**](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-bgm.mp4)
（12,947,989 B）·
[**静音版**](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-silent.mp4)
（10,169,266 B）·
[**封面**](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-poster.jpg)
（85,200 B）；工程与分镜见 [`docs/media/promo/`](docs/media/promo/)。发布说明：
[`docs/RELEASE_NOTES_v1.0.0.md`](docs/RELEASE_NOTES_v1.0.0.md)；发布验证：
[`docs/test-evidence/release-v1.0.0-check.md`](docs/test-evidence/release-v1.0.0-check.md) +
[`docs/images/release-v1.0.0.png`](docs/images/release-v1.0.0.png)。

最新 P1 个人版 MVP 验收（2026-10-25，本机有头 Chrome，`npm run acceptance:p1` OK，12/12 检查）：
[`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md)
（· [`.json`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.json)）；证据包
[`docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`](docs/test-evidence/evidence-p1-2026-10-25_14-18-54/)
（39 个文件，已脱敏：`business-run/` 含 `proposal.json`、`ledger-facts.json`（2 笔 × 6 要素）、
`promise-traces.json`（3 段授权链）、`takeover-pack.json`（6 类）、`boundary-check.json`（18 条规则；
4/4 拒绝 + human + draft_only）、`monthly-report.{json,md}`；`console-e2e/` 9 步截图 / 73 项检查 /
浏览器接管停止 **88ms**；`console-cli/` CLI 控制台真实浏览器截图；`unit-tests.log` 113/113）。
B1/B2/B5/B6/B7 通过（历史验收，B8 已由 P3 补齐）。

最新 M4 阶段一发布验收（2026-10-25，`npm run acceptance:m4` OK，10/10 检查）：A10 只读 `dummy-branch`、
A11 发布就绪（CC BY-NC-SA 4.0 许可证全文、第三方 NOTICE、商用说明、双语文档、无遥测、
`package.json`/CLI 版本一致、发布文档齐全）以及全量 **80/80** 测试。证据：
[`docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.md`](docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.md)
（· [`.json`](docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.json)）+
[`docs/test-evidence/evidence-m4-2026-10-25_13-43-07/`](docs/test-evidence/evidence-m4-2026-10-25_13-43-07/)。
发布说明：[`docs/RELEASE_NOTES_v0.5.0.md`](docs/RELEASE_NOTES_v0.5.0.md)（后续版本：
[`v0.6.0`](docs/RELEASE_NOTES_v0.6.0.md) P1、[`v0.8.0`](docs/RELEASE_NOTES_v0.8.0.md) P2+P3、
[`v1.0.0`](docs/RELEASE_NOTES_v1.0.0.md) 最终版）。

最新 M3 验收（2026-10-25，本机 fixture 驱动 Scout 运行，无网络，`npm run acceptance:m3` OK，
12/12 检查）：[`docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.md`](docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.md)
（· [`.json`](docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.json)）；证据包
[`docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`](docs/test-evidence/evidence-m3-2026-10-25_12-04-47/)
（15 个文件，已脱敏：Scout run `run-20261025-200457-17b4e7` —— 14 条线索 → 丢弃 4 → 合格 8 →
3 条草稿（110–113 字），全部待审批、0 发送；另含 74/74 的 `unit-tests.log`）。

最新 M2 验收（2026-10-25，本机真实 Windows 桌面会话，`npm run acceptance:m2` OK）：
[`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.md`](docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.md)
（· [`.json`](docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.json)）；证据包
[`docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`](docs/test-evidence/evidence-m2-2026-10-25_10-50-51/)
（34 个文件，已脱敏：A3 真实桌面 run `run-20261025-185100-6a4d70` + 20 张逐步截图 +
`result.json`/`steps.json`/`project.json`，A8/A9 `safety-check-result.json`，测试日志）。检查项：
build、53/53 测试、A3 桌面流程 36/36 检查、A8 停止键约 305ms（`<5000ms`）+ 检查点/恢复、
A9 凭据/profile/工具白名单隔离 —— 全部 ✅。

最新 M1 验收（2026-10-25，本机有头 Chrome，`npm run acceptance` OK）：
[`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.md`](docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.md)
（· [`.json`](docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.json)）；证据包
[`docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`](docs/test-evidence/evidence-m1-2026-10-25_09-52-12/)
（45 个文件：A2 / A4 / A5 三组截图与日志）；run `run-20261025-175213-9ea8ab`（A2）、
`run-20261025-175216-fe8759`（A4）、`run-20261025-175223-de0b95`（A5）。

最新 M0 离线空回路运行：`runs/run-20261025-172017-eb9116/` — 证据见
[`docs/test-evidence/test-result-2026-10-25_09-52-08.md`](docs/test-evidence/test-result-2026-10-25_09-52-08.md)。

## 真实测试承诺 / Real-test pledge

- UI 验收使用**真实 Chromium/Edge（有头）**与**真实 Windows 窗口真实键鼠（SendInput）**，不用 API 或假 DOM 代替；
- 每个对外动作自动截图，失败保留现场；重试最多两轮，超限升级人类；
- **Scout 绝不自行发送**：只起草（≤150 字、引用具体信号），每条外联都进入人工审批队列（`pending`），
  每日每渠道 ≤10 条，退订后永久停止触达；模块**零网络 IO**，`markSent` 只记录状态；
- **阶段二本地控制台是真实浏览器 UI**：控制台**只监听 127.0.0.1**、写操作需 `X-Steward-Token`、无 CDN/
  外链；E2E 用有头真实 Chrome 走完 看板→项目时间线→账本 6 要素抽屉→审批→接管停止→恢复→月报，
  浏览器实测接管停止 **88ms**（上限 10000ms）。数据为纯虚构仿真业务线（无真实客户/资金/外联）；
  `approve`/`takeover` 始终由人执行——审批超时=挂起，绝不自动放行；
- **P2 故障演练是真实网络故障，不是 mock**：演练启动真实 localhost 平台，注入真实 `ECONNREFUSED`
  断网或真实 `403 + x-platform-ban` 封禁；断网期间不产生新承诺，动作进入幂等 Outbox 并在恢复后重放
  （账本重复 0）；封禁时停止动作并生成可读替代方案 + 本地通知留痕。
- **P3 企业版全程人工控制**：企业数据全部虚构（执照/税号/银行账号/签署人均为编造），不连接真实
  银行/税务/CA/电子签章系统；发票与申报**只出草稿**，AI **不代签**（`ai_may_sign=false`）、
  不自动开票、不代提交申报、不自动变更账户；双人复核需 2 位不同角色、组织审批链由人执行；
  B8 双模式一致性在产生任何发票/收款前阻断全部 6 类不一致。
- CI 使用 MockHarness（无需付费密钥），跑仓库自检、密钥扫描、build、151 条测试、demo 证据、
  fixture 驱动 `scout` 演示（只起草、绝不自动发送）、阶段二 `business`/`boundary-check` 演示、A10
  `dummy-branch` 演示、`safety-check` 自检、**真实 localhost 故障演练（B3/B4 短跑）**、
  **P3 企业版演示（B8 + 30 条边界）** 与无头真实浏览器（控制台 + demo-web）E2E；有头
  `npm run acceptance` / `acceptance:p1` / `acceptance:p2` / `acceptance:p3` 与真实桌面
  `npm run acceptance:m2` 仅本地；发布前在干净路径重跑全量。

## 许可证 / License

自有代码按 **[CC BY-NC-SA 4.0](LICENSE)**：允许下载、使用、修改与分发；**禁止商业用途**；
分发修改后的作品必须采用相同许可证。这不是 OSI 定义的开源许可，准确说法是
**source-available（非商业共享）**。商用授权见 [`COMMERCIAL.md`](COMMERCIAL.md)。
第三方组件（DeepSeek Harness、dsh-browser、dsh-computer-use 等，均为 MIT）保留各自许可证，
见 [`NOTICE`](NOTICE)。

The project's own code is licensed **CC BY-NC-SA 4.0** — source-available, **non-commercial**,
share-alike on distribution. Third-party components keep their MIT/Apache-2.0 licenses (see `NOTICE`).

## 安全 / Security

无遥测；密钥只从环境变量读取；日志脱敏；提交前密钥扫描。报告方式见 [`SECURITY.md`](SECURITY.md)。

## 文档索引 / Docs index

- [ROADMAP.md](ROADMAP.md) — 里程碑与批准门（两阶段完成；**v1.0.0 已发布**）
- [docs/RELEASE_NOTES_v0.5.0.md](docs/RELEASE_NOTES_v0.5.0.md) · [v0.6.0](docs/RELEASE_NOTES_v0.6.0.md) · [v0.8.0](docs/RELEASE_NOTES_v0.8.0.md) · [**v1.0.0**](docs/RELEASE_NOTES_v1.0.0.md) — 发布说明（中英；v1.0.0 为最终版）
- [docs/zh-CN/enterprise.md](docs/zh-CN/enterprise.md) / [docs/en/enterprise.md](docs/en/enterprise.md) — P3 企业版 + 30 条边界双模式标注表
- [docs/media/promo/README.md](docs/media/promo/README.md) — **v1.0.0 真实截图宣传片**（成片在 GitHub Release Assets；分镜与事实见本目录）
- [docs/demo-script.zh-CN.md](docs/demo-script.zh-CN.md) / [docs/demo-script.md](docs/demo-script.md) — 3 分钟演示脚本
- [docs/good-first-issues.md](docs/good-first-issues.md) — 5 个 Good First Issues（中英）
- [docs/zh-CN/delivery-checklist.md](docs/zh-CN/delivery-checklist.md) / [docs/en/delivery-checklist.md](docs/en/delivery-checklist.md) — 验收条目与证据（**A1–A12 + B1–B8 全部通过**；最终 v1.0.0 结论）
- [docs/test-evidence/](docs/test-evidence/) — 测试证据归档（`test-result-*`、`m1-acceptance-*`…`m4-acceptance-*`，`p1-acceptance-*` + `evidence-p1-*`、`p2-acceptance-*` + `evidence-p2-*`（短跑）、`long-drill-2026-10-25_15-02-52.*` + `evidence-long-drill-2026-10-25_15-02-52/`（真实长跑）、`p3-acceptance-*` + `evidence-p3-*`，以及 `release-v0.5.0/v0.6.0/v0.8.0/v1.0.0-check.md`）
- [docs/zh-CN/architecture.md](docs/zh-CN/architecture.md) / [docs/en/architecture.md](docs/en/architecture.md)
- [docs/zh-CN/adapters.md](docs/zh-CN/adapters.md) / [docs/en/adapters.md](docs/en/adapters.md)
- [packages/steward-desktop/README.md](packages/steward-desktop/README.md) — 真实 Windows 桌面适配器
- [packages/steward-scout/README.md](packages/steward-scout/README.md) — Scout 客户分支引擎
- [packages/steward-domain/README.md](packages/steward-domain/README.md) — 阶段二经营域引擎
- [packages/steward-console/README.md](packages/steward-console/README.md) — 本地 Web 控制台
- [packages/steward-fault/README.md](packages/steward-fault/README.md) — P2 故障演练模块（B3/B4）
- [packages/steward-enterprise/README.md](packages/steward-enterprise/README.md) — P3 企业版
- [examples/scout-fixtures/README.zh-CN.md](examples/scout-fixtures/README.zh-CN.md) — 14 条虚构合规线索
- [examples/demo-business/README.zh-CN.md](examples/demo-business/README.zh-CN.md) — 仿真个人版业务线
- [examples/demo-platform/README.zh-CN.md](examples/demo-platform/README.zh-CN.md) — P2 真实 localhost 故障注入平台
- [examples/demo-enterprise/README.zh-CN.md](examples/demo-enterprise/README.zh-CN.md) — P3 企业 fixtures（8 条订单）
- [docs/zh-CN/contracts.md](docs/zh-CN/contracts.md) / [docs/en/contracts.md](docs/en/contracts.md)
- [docs/zh-CN/threat-model.md](docs/zh-CN/threat-model.md) / [docs/en/threat-model.md](docs/en/threat-model.md)
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — 假设与未覆盖清单
- [HANDOFF.md](HANDOFF.md) — 当前交接状态

## 致谢 / Acknowledgements

架构与工具链大量借鉴 **DeepSeek Harness** 的插件体系（MIT）；真实测试与开源发布流程沿用
作者既有项目 `asset-lineage` / `DramaCore` 的经验。感谢开源社区。

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted, and handed over — not sold._
