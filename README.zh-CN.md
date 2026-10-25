# 代掌 Steward

**可托管的 AI 经营代理 / A composable operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations · evidence-first.

> 状态：**阶段一完成，v0.5.0 已发布**（2026-10-25）。操作型 AI 内核包含：真实有头 Chromium/Edge
> Operator（A2/A4/A5）、真实 Windows 桌面 Operator + 真实键鼠（A3）、停止键/检查点/分支隔离（A8/A9）、
> fixture 驱动且**绝不自动发送**的 Scout 客户分支（A7）、以及 A10 只读 dummy 分支（仅配置 + 已有提示词，
> 不改核心）。**80/80** 单元+集成测试通过（12 个测试文件）；CLI 现为 **13 个已实现命令 + 2 个占位**；
> 验收 **A1–A12 全部通过**。发布：[v0.5.0](https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0)
> · [发布说明](docs/RELEASE_NOTES_v0.5.0.md) · [3 分钟演示脚本](docs/demo-script.zh-CN.md) ·
> [Good First Issues](docs/good-first-issues.md)。路线见 [ROADMAP.md](ROADMAP.md) 与
> [`docs/zh-CN/delivery-checklist.md`](docs/zh-CN/delivery-checklist.md)。
> Status: **Phase 1 complete — v0.5.0 released** (2026-10-25): real headed browser operator (A2/A4/A5),
> real Windows desktop operator with real mouse/keyboard (A3), stop-key/checkpoint/branch isolation
> (A8/A9), a fixture-driven Scout branch that only drafts and never auto-sends (A7), and an A10
> read-only dummy branch via config + an existing prompt (no core change). 80/80 tests pass
> (12 test files); the CLI ships 13 implemented commands + 2 placeholders; acceptance A1–A12 all pass.

---

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
| Phase 2 | 代掌经营代理：**个人版优先**（一条仿真业务线跑通），再企业版；8 条验收 + 30 条边界 | ⏳ 下一步 |

阶段一已完成并以 **v0.5.0** 发布；接下来进入阶段二（个人版 → 企业版），见 [ROADMAP.md](ROADMAP.md)。

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

## 仓库结构 / Repository layout

本仓库为**单包布局**（无 pnpm workspace）：`tsconfig.json` 把 `packages/*/src` 与
`apps/cli/src` 用 `tsc -p tsconfig.json` 编译到 `dist/`；命令一律用 npm。

```text
packages/   core packages (steward-core: runtime/policy/events/artifacts/prompts + M2 的
            stop-controller/checkpoint/isolation；steward-harness: MockHarness + 隔离 worktree 补丁 +
            两轮编码回路；steward-browser: Playwright 真实浏览器适配器；steward-desktop: 真实 Windows
            桌面适配器——ctypes 侧车 + SendInput；steward-scout: 客户分支引擎——ICP/评分/草稿/审批队列，
            纯逻辑零网络)
apps/       CLI entry (steward: demo/browser-flow/desktop-flow/scout/dummy-branch/code-loop/run/branch/
            report/stop/safety-check/version/help)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness（脚本化补丁）, scout-fixtures（14 条虚构合规线索）,
            demo-business
tests/      unit tests（v0.5.0 共 12 文件 / 80 条）+ e2e-browser + e2e-desktop；contract / fault 后续里程碑
docs/       双语文档（en/ 与 zh-CN/）+ 测试证据
scripts/    校验/构建辅助、密钥扫描、证据包 / 验收脚本、交付同步
runs/       每次运行的产物（gitignored；证据在此）
dist/       构建输出（gitignored；单包构建）
```

## 快速开始 / Quickstart（M0 → v0.5.0）

> 阶段一已完成，全部里程碑都可在本机离线复现。M0 克隆后即可离线运行（MockHarness，无需付费 API）；
> M1 增加真实浏览器回路；M2 增加真实 Windows 桌面回路与安全模块；M3 增加 fixture 驱动的 Scout 客户
> 分支（离线、只起草不发送）；M4 增加 A10 只读 dummy 分支与发布就绪验收：

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm；真实浏览器验收需本机 Chrome/Edge；
# 真实桌面验收需 PATH 中的 Python >= 3.8
npm install
npm run check          # 校验仓库配置 / repo-config check
npm run check:secrets  # 密钥扫描 / secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 80/80 单元+集成测试 / unit + integration tests
npm run demo           # M0 空回路 → runs/<run-id>/ + report.md（MockHarness）
npm run test:prompts   # 提示词版本/安全测试（验收 A12）
npm run evidence       # 离线证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance     # M1 本机有头真实浏览器验收（A2/A4/A5）→ docs/test-evidence/m1-acceptance-<stamp>.*
npm run acceptance:m2  # M2 真实桌面 + 停止键/检查点/隔离验收（A3/A8/A9），仅本机
npm run acceptance:m3  # M3 Scout 验收（A7：14 线索 → 丢弃 4 → 合格 8 → 3 草稿，0 发送）
npm run acceptance:m4  # M4 发布就绪验收（A10 dummy 分支 + A11 许可证/文档/版本检查 + 80 测试）
```

CI 跑仓库自检、密钥扫描、build、80 条测试、demo 证据、fixture 驱动 `scout` 演示（只起草、绝不自动
发送）、A10 `dummy-branch` 演示、`safety-check` 自检与无头真实浏览器 E2E（CI #10 在 Windows + Ubuntu
全绿）；有头 `npm run acceptance` 与真实桌面 `npm run acceptance:m2` 仅本机运行（托管 CI 无交互桌面）。

v0.5.0 能跑什么：CLI 已实现 `demo`、`browser-flow`、`desktop-flow`、`scout`、`dummy-branch`、
`code-loop`、`run`、`branch`、`report`、`stop`、`safety-check`、`version`、`help`（**13 个命令**；
`takeover`、`approve` 为占位）。`browser-flow` 在有头 Chrome 里跑真实 demo-web 登录/项目流程并逐步
截图；`desktop-flow` 用真实键鼠（SendInput，中文 Unicode 真实键盘输入）操作真实 `demo-desktop` 窗口
并逐步截图；`scout` 读取虚构合规 fixtures，构建 ICP + 3 个高价值场景，按四因子评分（需求 40% /
预算 20% / 可触达 20% / 合规 20%）评分、来源硬校验与去重，最多起草 3 条外联草稿（≤150 字、均引用
具体信号），全部进入**人工审批队列**（全部 `pending`、`sent=0`；每日每渠道 ≤10；支持退订；无任何
网络 IO）；`dummy-branch` 演示 A10——新增只读分支只需 BranchSpec + 已有提示词（`reviewer@1.0.0`），
不改核心；`code-loop` 跑 CodeTask → 补丁 → 隔离 git worktree → 真实浏览器验收，`code-loop --fail`
注入坏补丁并在两轮失败后升级；`safety-check` 自检停止键（≤5s）、检查点 save/load/resume 与分支隔离；
`run --resume <runId>` 从最近检查点恢复并跳过已完成步骤。每次运行把证据写入 `runs/<run-id>/`：
`prompt.md`、`report.md`、`console.log`、`meta.json`、`events.jsonl`（哈希链账本）、`checkpoint.json`，
以及 `patch.diff`、`test.log`、`code-task.json`、`code-result.json`、`e2e/<case>/screenshots/`、
`e2e-desktop/screenshots/`；Scout 运行另含 `scout-report.md/.json`、`leads-scored.json`、
`drafts.json`、`approval-queue.json`、`outreach-drafts/`。也可直接调用构建产物：
`node dist/apps/cli/src/index.js help`。

最新 M4 阶段一发布验收（由 `npm run acceptance:m4` 生成，2026-10-25）：检查 A10 只读 `dummy-branch`、
A11 发布就绪（CC BY-NC-SA 4.0 许可证全文、第三方 NOTICE、商用说明、双语文档、无遥测、
`package.json`/CLI 版本一致、发布文档齐全）以及全量 **80/80** 测试。证据归档为
`docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `evidence-m4-<stamp>/`（已脱敏、只保留最新）。
发布说明：[`docs/RELEASE_NOTES_v0.5.0.md`](docs/RELEASE_NOTES_v0.5.0.md)。

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
- CI 使用 MockHarness（无需付费密钥），跑仓库自检、密钥扫描、build、80 条测试、demo 证据、
  fixture 驱动 `scout` 演示（只起草、绝不自动发送）、A10 `dummy-branch` 演示、`safety-check` 自检与
  无头真实浏览器 E2E（CI #10 Windows + Ubuntu 全绿）；有头 `npm run acceptance` 与真实桌面
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

- [ROADMAP.md](ROADMAP.md) — 里程碑与批准门（阶段一完成，阶段二下一步）
- [docs/RELEASE_NOTES_v0.5.0.md](docs/RELEASE_NOTES_v0.5.0.md) — v0.5.0 发布说明（中英）
- [docs/demo-script.zh-CN.md](docs/demo-script.zh-CN.md) / [docs/demo-script.md](docs/demo-script.md) — 3 分钟演示脚本
- [docs/good-first-issues.md](docs/good-first-issues.md) — 5 个 Good First Issues（中英）
- [docs/zh-CN/delivery-checklist.md](docs/zh-CN/delivery-checklist.md) / [docs/en/delivery-checklist.md](docs/en/delivery-checklist.md) — 验收条目与证据（A1–A12 全部通过）
- [docs/test-evidence/](docs/test-evidence/) — 测试证据归档（`test-result-*`、`m1-acceptance-*`、`evidence-m1-*`、`m2-acceptance-*`、`evidence-m2-*`、`m3-acceptance-*`、`evidence-m3-*`、`m4-acceptance-*`、`evidence-m4-*`）
- [docs/zh-CN/architecture.md](docs/zh-CN/architecture.md) / [docs/en/architecture.md](docs/en/architecture.md)
- [docs/zh-CN/adapters.md](docs/zh-CN/adapters.md) / [docs/en/adapters.md](docs/en/adapters.md)
- [packages/steward-desktop/README.md](packages/steward-desktop/README.md) — 真实 Windows 桌面适配器
- [packages/steward-scout/README.md](packages/steward-scout/README.md) — Scout 客户分支引擎
- [examples/scout-fixtures/README.zh-CN.md](examples/scout-fixtures/README.zh-CN.md) — 14 条虚构合规线索
- [docs/zh-CN/contracts.md](docs/zh-CN/contracts.md) / [docs/en/contracts.md](docs/en/contracts.md)
- [docs/zh-CN/threat-model.md](docs/zh-CN/threat-model.md) / [docs/en/threat-model.md](docs/en/threat-model.md)
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — 假设与未覆盖清单
- [HANDOFF.md](HANDOFF.md) — 当前交接状态

## 致谢 / Acknowledgements

架构与工具链大量借鉴 **DeepSeek Harness** 的插件体系（MIT）；真实测试与开源发布流程沿用
作者既有项目 `asset-lineage` / `DramaCore` 的经验。感谢开源社区。

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted, and handed over — not sold._
