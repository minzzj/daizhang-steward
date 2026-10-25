# 代掌 Steward v0.5.0 — 阶段一发布说明 / Phase 1 Release Notes

- **版本 / Version**：v0.5.0（2026-10-25）
- **阶段 / Phase**：阶段一（Phase 1）完成 —— Operator + Harness 编码回路 + Scout + Conductor 内核
- **仓库 / Repository**：https://github.com/minzzj/daizhang-steward
- **发布 / Release**：https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0
- **许可 / License**：CC BY-NC-SA 4.0（source-available，**非商业 / non-commercial**）
- **测试 / Tests**：**80/80 通过**（12 个测试文件；M0–M3 的 74 条 + M4 发布就绪 6 条）
- **CLI**：**13 个已实现命令 + 2 个占位**（占位：`takeover`、`approve`）
- **验收 / Acceptance**：**A1–A12 全部通过**（每条均可打开证据，见下表）

---

## 亮点 / Highlights

### 1. Operator：真实浏览器 + 真实 Windows 桌面 / real browser & desktop
- **真实浏览器**（Playwright，`packages/steward-browser`）：本机 Chrome/Edge **有头默认**、
  `chrome → msedge` 回退、每 run 独立 `userDataDir`、每步截图/DOM/console、5 类失败分类、风控关键词 →
  停止交人（A2）。
- **真实 Windows 桌面**（`packages/steward-desktop`）：Python ctypes 长驻侧车执行真实 Win32 调用
  （窗口枚举/聚焦、BitBlt 截图 + 自写 PNG 编码、`SendInput` 真实鼠标与 Unicode 真实键盘）；白名单默认
  拒绝、Per-Monitor V2 DPI 感知、每步截图、凭据/安全提示命中即停止交人（A3）。
- Real headed Chromium/Edge and real Windows windows driven by `SendInput`; no API mocks, no fake DOM.

### 2. Harness 编码回路 / harness code loop（A4/A5）
失败 → 可复现 `CodeTask` → patch（unified diff）→ **隔离 git worktree** 应用 → 真实浏览器验收；
失败最多两轮，超限 `escalated=true` 并以退出码 1 交人，**不无限重试**（脚本化补丁在
`examples/mock-harness/`，无需付费 API）。

### 3. Scout 客户分支 / Scout customer branch（A7）
`packages/steward-scout` 的 `ScoutEngine`：ICP + 恰好 3 个高价值场景、四因子评分（需求 40% / 预算 20% /
可触达 20% / 合规 20%）、来源硬校验（缺 `source_url`/非 http(s)/空 `signal`/空 `consent_basis` 即丢弃并
留证）、`org+signal` 归一化去重、≤150 字草稿（引用具体信号）、**人工审批队列（全部 `pending`）**、
每日每渠道 ≤10、退订拦截、回复/会议统计、`ScoutReport`。模块**纯逻辑、零依赖、零网络 IO**：只起草，
**绝不自动发送**。fixtures 为 14 条纯虚构合规线索（`examples/scout-fixtures/`）。

### 4. 安全三模块 / safety modules（A8/A9）
- `stop-controller.ts`：200ms watchdog + `AbortController` + `withAbort`，停止键实测 **305ms**（≤5s）。
- `checkpoint.ts`：检查点原子写、`listResumable`、每步 `markStepDone`；`run --resume <runId>` 跳过已完成
  步骤、不重复执行。
- `isolation.ts`：`CredentialVault` 跨分支凭据隔离 + 脱敏、`ProfileLock` 同一 profile 独占、
  `assertBranchToolsAllowed` 工具白名单断言。

### 5. 可复现的验收与证据体系 / reproducible acceptance & evidence
- `npm run evidence`（离线证据包）、`npm run acceptance`（M1 有头浏览器）、`npm run acceptance:m2`
  （真实桌面）、`npm run acceptance:m3`（Scout）、**`npm run acceptance:m4`（发布就绪）**；
  证据统一归档到 `docs/test-evidence/`（命名 `<milestone>-acceptance-<stamp>.{md,json}` +
  `evidence-<milestone>-<stamp>/`，已脱敏、只保留最新一份）。
- CI（GitHub Actions）在 Windows + Ubuntu 上跑 check / secret scan / build / 80 测试 / demo 证据 /
  Scout demo / dummy-branch / safety-check / 无头真实浏览器 E2E；最近一次 **CI #10 success**。
- 运行时提示词 v1：4 个角色（conductor/operator/scout/reviewer）+ `prompts/manifest.json` sha256 +
  `npm run test:prompts`（A12）。

---

## 验收对照 A1–A12 / Acceptance matrix

| # | 验收项 | 结果 | 证据 / Evidence |
|---|---|---|---|
| A1 | 干净克隆可跑，无需付费 API | ✅ | `npm install && npm run demo`；`docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}`；run `runs/run-20261025-172017-eb9116/` |
| A2 | demo-web 登录/填表/提交/校验/截图 | ✅ | `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` + `evidence-m1-2026-10-25_09-52-12/`；run `run-20261025-175213-9ea8ab`（7 步 / 7 张真实截图） |
| A3 | demo-desktop 打开/填表/保存/校验/截图 | ✅ | `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` + `evidence-m2-2026-10-25_10-50-51/`；run `run-20261025-185100-6a4d70`（36/36 检查、20 张真实截图） |
| A4 | 预置缺陷 → CodeTask → 补丁 → 应用 → 测试通过 | ✅ | `evidence-m1-2026-10-25_09-52-12/A4-code-loop/`（`patch.diff`、`code-loop-result.json`、红→绿 4 张截图）；run `run-20261025-175216-fe8759` |
| A5 | 连续失败两次 → 升级，无无限循环 | ✅ | `evidence-m1-2026-10-25_09-52-12/A5-escalation/`（两轮失败日志、`escalated=true`、exit 1）；run `run-20261025-175223-de0b95` |
| A6 | 每次运行有 prompt/patch/test.log/截图/report 且无密钥 | ✅ | M0/M1/M2/M3 证据包均含完整产物；M4 发布就绪验收见 `m4-acceptance-*` / `evidence-m4-*`；仓库密钥扫描 `npm run check:secrets` 通过 |
| A7 | Scout ≥10 线索（来源+评分），3 条草稿未发送 | ✅ | `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` + `evidence-m3-2026-10-25_12-04-47/`；run `run-20261025-200457-17b4e7`（14→丢4→合格8→3 草稿；审批全 pending、`sent_count=0`） |
| A8 | 停止键 5 秒；重启恢复不重复 | ✅ | `evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`（停止 305ms）+ `m2-runtime-tests.log`（运行中停止抢占、resume 跳过已完成步骤） |
| A9 | 分支隔离（凭据/浏览器配置） | ✅ | 同上 `safety-check-result.json`：跨分支凭据不可读（`CrossBranchAccessError`）、同 profile 并发占用被拒（`ProfileBusyError`）、白名单外工具拒绝 |
| A10 | 新增只读 dummy 分支只靠配置 | ✅ | `steward dummy-branch --json`（`role=dummy`、`tools=[echo]`、复用 `reviewer@1.0.0`，不改核心）+ `tests/unit/m4-release.test.mjs`；`npm run acceptance:m4` 的 A10 检查 |
| A11 | 测试/lint/文档/许可证齐全、无遥测 | ✅ | `npm run acceptance:m4` 的 A11 检查（LICENSE/NOTICE/COMMERCIAL、双语文档配对、无遥测、版本一致、发布文档）；`tests/unit/m4-release.test.mjs`；CI #10；80/80 测试 |
| A12 | 提示词版本化、有测试、可替换 | ✅ | `prompts/manifest.json`（4 角色 + sha256）+ `tests/unit/prompts.test.mjs`；`npm run test:prompts` |

> M4 发布验收由 `npm run acceptance:m4` 生成 `docs/test-evidence/m4-acceptance-<stamp>.{md,json}` +
> `evidence-m4-<stamp>/`（A10/A11 + 全量测试 + 版本一致性）；生成后与 M0–M3 证据一起归档。

---

## 安装与快速开始 / Install & quickstart

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18 + npm；真实浏览器验收需本机 Chrome/Edge；
# 真实桌面验收需 Windows 交互桌面 + Python >= 3.8
npm install
npm run check          # 仓库/许可证/提示词/路径自检
npm run check:secrets  # 密钥扫描
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 80/80 单元+集成测试
npm run demo           # M0 离线空回路（MockHarness，无付费 API）
npm run evidence       # 离线证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance     # M1 有头真实浏览器（A2/A4/A5），仅本机
npm run acceptance:m2  # M2 真实 Windows 桌面（A3/A8/A9），仅本机
npm run acceptance:m3  # M3 Scout（A7，fixture 驱动、无网络）
npm run acceptance:m4  # M4 发布就绪（A10/A11 + 80 测试 + 版本一致性）
```

**CLI（13 个已实现命令 + 2 个占位）**：
`demo` / `browser-flow` / `desktop-flow` / `code-loop` / `scout` / `dummy-branch` / `run` / `branch` /
`report` / `stop` / `safety-check` / `version` / `help`；占位：`takeover`、`approve`。
构建后直接运行：`node dist/apps/cli/src/index.js help`；3 分钟演示见
[`docs/demo-script.zh-CN.md`](demo-script.zh-CN.md)（English: [`docs/demo-script.md`](demo-script.md)）。

---

## 许可证 / License

本项目自有代码采用 **[CC BY-NC-SA 4.0](https://github.com/minzzj/daizhang-steward/blob/main/LICENSE)**：
允许下载、使用、修改与分发；**禁止商业用途 / non-commercial**；分发修改后的作品必须采用相同许可证。
这不是 OSI 定义的开源许可，准确说法是 **source-available**。商用授权见
[`COMMERCIAL.md`](https://github.com/minzzj/daizhang-steward/blob/main/COMMERCIAL.md)。
第三方组件（DeepSeek Harness、dsh-browser、dsh-computer-use 等，MIT）保留各自许可证，见
[`NOTICE`](https://github.com/minzzj/daizhang-steward/blob/main/NOTICE)。

Project code is licensed **CC BY-NC-SA 4.0** — source-available, **non-commercial**, share-alike on
distribution; commercial use requires a separate license.

---

## 已知限制 / Known limitations

1. **真实 DSH / DeepSeek Harness 未接入**：当前使用 MockHarness + 脚本化补丁；真实浏览器/桌面/Scout
   验收均不依赖付费 API。`DshHeadlessHarness` / `DeepSeekApiHarness` 仍为规划。
2. **Scout 只起草、不发送，且无真实来源抓取**：无自动发送、无真实外联通道；真实发送必须由审批后的
   人工流程完成。fixtures 为纯虚构数据。
3. **真实桌面 Windows 优先**：需真实交互 Windows 会话 + Python ≥ 3.8；**UIA 可访问性树、拖拽、
   滚轮/触控板手势、右键菜单语义、剪贴板、多窗口批处理**尚未实现；有头浏览器与真实桌面验收
   只能在**本机**运行（托管 CI 无交互桌面）。
4. 工程为**单包布局 + npm**（无 pnpm workspace）；阶段一不做多租户 SaaS、计费与复杂前端。

---

## 下一步 / Next

阶段二（Phase 2，个人版 → 企业版）第一步 **P1 个人版 MVP**：
- 经营域数据模型（委托/预算/项目/任务/代理/证据/账本/墓碑 + L0/L1/L2 摘要）；
- 一条仿真业务线端到端（客户/交易/交付/收款/发票状态）；
- 本地 Web 控制台（看板、审批卡、接管键、月报）+ 审批/接管流程；
- 之后 P2 故障演练（断网/强杀恢复/封号模拟/72h 失联）、P3 企业版（30 条边界）、P4 v1.0.0 + 宣传片。

路线与批准门见 [`ROADMAP.md`](https://github.com/minzzj/daizhang-steward/blob/main/ROADMAP.md)；
当前交接状态见 [`HANDOFF.md`](https://github.com/minzzj/daizhang-steward/blob/main/HANDOFF.md)。

---

## English summary

**Phase 1 is complete and released as v0.5.0 (2026-10-25).** The open-source "operating-AI core" is a
composable, evidence-first steward with four roles (Operator / Conductor / Harness loop / Scout):

- **Operator**: real headed Chromium/Edge (A2/A4/A5) and real Windows windows driven by real
  mouse/keyboard `SendInput` (A3) — no API mocks, no fake DOM.
- **Harness code loop**: a failed run becomes a reproducible `CodeTask`; the patch is applied in an
  isolated git worktree and re-verified in a real browser; at most two rounds, then escalate (A4/A5).
- **Scout customer branch**: fixture-driven ICP + 3 scenarios + four-factor scoring + source hard-checks
  + dedupe + ≤150-char drafts citing a concrete signal; everything waits for **human approval**
  (all `pending`, `sent=0`, ≤10 per channel per day, unsubscribe honoured, zero network I/O) (A7).
- **Safety modules**: stop key ≤5s (measured 305 ms), checkpoint/resume (`run --resume` skips completed
  steps, no duplicates) and branch isolation (cross-branch credentials unreadable, profile lock, tool
  allowlist) (A8/A9).
- **A10** read-only dummy branch via config + an existing prompt (no core change); **A11** release
  readiness (CC BY-NC-SA 4.0 license text, NOTICE/COMMERCIAL, bilingual docs, no telemetry, version
  consistency, release docs); **A12** versioned/tested runtime prompts (4 roles + sha256 manifest).
- **Tests**: 80/80 (12 test files); **CLI**: 13 implemented commands + 2 placeholders — `demo`,
  `browser-flow`, `desktop-flow`, `code-loop`, `scout`, `dummy-branch`, `run`, `branch`, `report`,
  `stop`, `safety-check`, `version`, `help`; placeholders `takeover`, `approve`.
- **Acceptance**: A1–A12 all pass; evidence is archived under `docs/test-evidence/` (M0 offline bundle,
  M1/M2/M3 acceptance bundles, and M4 `m4-acceptance-*` + `evidence-m4-*` generated by
  `npm run acceptance:m4`).

Install: `npm install && npm run build && npm test` (Node ≥ 22.18). All acceptance commands work offline
(no paid API); real-browser and real-desktop acceptance are local-only. A 3-minute demo script is in
[`docs/demo-script.md`](demo-script.md); good first issues are in
[`docs/good-first-issues.md`](good-first-issues.md).

License: **CC BY-NC-SA 4.0** — source-available, **non-commercial**, share-alike on distribution.

Known limitations: real DSH/DeepSeek Harness not wired yet (MockHarness + scripted patches); Scout never
sends and has no real source scraping; the desktop adapter is Windows-first (UIA, drag, scroll and other
secondary capabilities pending) and needs an interactive desktop session + Python ≥ 3.8.

Next: Phase 2 P1 personal-edition MVP — business-domain data model, one simulated business line
end-to-end (customers/trades/deliveries/receivables/invoices), local web console with approval/takeover
and a monthly report; then P2 fault drills, P3 enterprise edition (30 boundaries) and P4 v1.0.0 +
promo video.

---

## 参与 / Contribute

- Good First Issues（5 个，中英双语）：[`docs/good-first-issues.md`](good-first-issues.md)
- 贡献指南：[`CONTRIBUTING.md`](https://github.com/minzzj/daizhang-steward/blob/main/CONTRIBUTING.md)；
  行为准则：[`CODE_OF_CONDUCT.md`](https://github.com/minzzj/daizhang-steward/blob/main/CODE_OF_CONDUCT.md)
- 证据索引：[`docs/test-evidence/`](test-evidence/)
- 真机演示脚本：[`docs/demo-script.zh-CN.md`](demo-script.zh-CN.md) · [`docs/demo-script.md`](demo-script.md)

_发布说明最后更新：2026-10-25。/ Last updated: 2026-10-25._
