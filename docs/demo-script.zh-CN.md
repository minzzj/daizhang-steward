# 3 分钟演示脚本 / 3-Minute Demo Script（v0.5.0）

> 用 3 分钟展示「代掌 Steward」阶段一 v0.5.0 的真实能力：真实浏览器、真实 Windows 桌面、编码回路、
> Scout 客户分支、以及可复查的证据体系。**全程可离线**：不付费 API、不访问真实业务外网、不外发任何消息。
> A 3-minute walkthrough of the phase-1 v0.5.0 capabilities: real browser, real Windows desktop, the
> harness code loop, the Scout customer branch and the reviewable evidence system. Runs **fully offline**:
> no paid API, no real external network, nothing is ever sent.

## 录制前置条件 / Prerequisites

- Node.js ≥ 22.18、npm；仓库已 `npm install` 且 `npm run build` 通过（下文 `steward` 均指
  `node dist/apps/cli/src/index.js`）。
- 浏览器段需要本机 Chrome 或 Edge（有头窗口会真实弹出）。
- 桌面段需要 **真实交互 Windows 桌面会话** + Python ≥ 3.8；若录制环境没有交互桌面（如 RDP 断开 /
  无头 CI），**跳过 01:50–02:15 段**，改为展示 `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`
  里的 20 张真实桌面截图（A3 证据）。
- 录制准备：终端字体 ≥ 16pt、窗口至少 1280×720；先清理旧的 `runs/` 便于观众看清新目录；关闭通知。
- 所有产物写入 `runs/<run-id>/`（gitignored）；发布证据索引在 `docs/test-evidence/`。

## 分镜总表 / Shot list

| 时间 | 镜头 | 命令 | 预期可见输出 / 证据 | 旁白（一句话） | 建议耗时 |
|---|---|---|---|---|---|
| 0:00–0:10 | 开场 | `steward version` | `steward 0.5.0 (node v…)` | 代掌 Steward：证据优先的操作型 AI 内核，阶段一 v0.5.0。 | 10s |
| 0:10–0:40 | 离线内核闭环（A1/A6） | `npm run demo` | 新建 `runs/<run-id>/`，含 `prompt.md`、`report.md`、`events.jsonl`（哈希链），退出码 0 | 不联网、不花钱，计划→行动→观察→反思→报告全链路可跑。 | 30s |
| 0:40–1:10 | 真实浏览器（A2） | `steward browser-flow` | 真实有头 Chrome/Edge 弹出并完成登录→提交→校验；`runs/<run-id>/e2e/normal/screenshots/001…007` | 所有 UI 操作都是真实浏览器 + 真实点击，每步自动截图留证。 | 30s |
| 1:10–1:45 | 编码回路（A4） | `steward code-loop` | `patch.diff`、`test.log`、`code-loop-result.json`，e2e `login-timeout` 由红转绿（第 1 轮） | 失败先写可复现 CodeTask，补丁在隔离 worktree 应用后再用真实浏览器验收。 | 35s |
| 1:45–2:10 | 真实桌面（A3，本机） | `steward desktop-flow` | 真实 Windows 窗口完成打开→填表→保存→校验；`e2e-desktop/screenshots/` 20 张逐步截图 + `result.json` | 真实窗口 + 真实键鼠（SendInput），不是 API 模拟；无交互桌面时切到已归档截图。 | 25s |
| 2:10–2:35 | Scout 客户分支（A7） | `steward scout --json` | `14 条线索 → 丢弃 4 → 合格 8 → 3 条草稿`；`approval-queue.json` 全 `pending`、`sent_count=0` | Scout 只起草不发送：全部进人工审批队列，0 自动外发。 | 25s |
| 2:35–3:00 | 证据与收尾 | `npm test`（可选展示）+ 打开 `docs/test-evidence/`、`docs/RELEASE_NOTES_v0.5.0.md` | 80/80 测试通过；M0–M3 验收证据目录；发布说明与 Good First Issues | 每个结论都有证据可查；下一步是阶段二个人版 MVP。 | 25s |

> 加场（超出 3 分钟时单独录）：`steward safety-check --json` 展示 A8/A9 —— 停止键 ≤5s、检查点恢复、
> 分支隔离自检；`steward dummy-branch --json` 展示 A10 —— 新增只读分支只靠配置 + 已有提示词，不改核心。

## 分镜细节 / Shot details

### 0:00–0:10 开场 / Cold open
- 命令：`steward version`
- 预期输出：`steward 0.5.0 (node vXX.XX.X)`
- 旁白：代掌 Steward 是一个证据优先、可组合的操作型 AI 内核；今天演示阶段一 v0.5.0。
- 提示：画面右上角放标题条「Phase 1 · v0.5.0」。

### 0:10–0:40 离线内核闭环（A1/A6）
- 命令：`npm run demo`
- 预期输出：`run <run-id> … ok`；终端打印 `runs/<run-id>/` 路径；退出码 0。
- 镜头：打开 `runs/<run-id>/report.md` 与 `events.jsonl`，指出事件账本带 `seq` 与哈希链。
- 旁白：MockHarness 让内核无需付费 API 即可完整跑通，每步有证据。

### 0:40–1:10 真实浏览器（A2）
- 命令：`steward browser-flow`
- 预期输出：真实浏览器窗口弹出并自动操作 demo-web；结束后终端打印 run 目录；截图在
  `runs/<run-id>/e2e/normal/screenshots/001-open-login-page.png … 007-assert-project-submitted.png`。
- 旁白：真实 Chromium/Chrome 有头模式 + 真实点击输入，不是 mock DOM。
- 提示：录屏时把浏览器窗口放在终端右侧，便于同时看到命令与操作。

### 1:10–1:45 编码回路（A4）
- 命令：`steward code-loop`
- 预期输出：`code-task.json`、`patch.diff`、`test.log`、`code-loop-result.json`；`e2e/login-timeout/`
  下 4 张截图；终端摘要显示第 1 轮由红转绿。
- 镜头：先用 `git --no-pager diff --stat`（或打开 `patch.diff`）展示补丁，再展示红→绿结果。
- 旁白：失败先写成可复现任务，补丁在隔离 worktree 里应用并再次真实验收，超两轮交人。

### 1:45–2:10 真实桌面（A3，本机）
- 命令：`steward desktop-flow`（Windows 真实交互桌面；需 Python ≥ 3.8）
- 预期输出：真实窗口完成打开→填表→保存→校验；`runs/<run-id>/e2e-desktop/screenshots/001…020`
  与 `result.json`（含 36/36 检查项）；`e2e-desktop/project.json` 为真实保存的表单内容。
- 无桌面兜底：跳过本段，直接展示 `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/`。
- 旁白：真实 Windows 窗口 + 真实键鼠（SendInput）+ 真实截图，白名单默认拒绝其他窗口。

### 2:10–2:35 Scout 客户分支（A7）
- 命令：`steward scout --json`
- 预期输出：`14 条线索 → 丢弃 4 → 合格 8 → 3 条草稿`；`scout-report.json`、`drafts.json`（110–113 字、
  `cites_signal=true`）、`approval-queue.json`（3 条全 `pending`）、`outreach-drafts/lead-001|004|006.md`。
- 镜头：放大 `approval-queue.json`，强调 `"sent_count": 0` 与全 `pending`。
- 旁白：Scout 只起草、不发送；每条都要人工审批，每日每渠道 ≤10，支持退订，模块零网络 IO。

### 2:35–3:00 证据与收尾
- 命令（可选）：`npm test` → 展示 **80/80** 通过；随后打开
  `docs/test-evidence/`（M0 test-result、M1/M2/M3 acceptance 证据索引）与
  `docs/RELEASE_NOTES_v0.5.0.md`、`docs/good-first-issues.md`。
- 旁白：所有验收结论都有可打开的 repo 内证据；阶段一完成，下一步阶段二个人版 MVP。
- 结束画面：仓库地址 https://github.com/minzzj/daizhang-steward 。

## 录制与发布建议 / Recording & publishing tips

1. 先完整彩排一次（尤其 `browser-flow`/`code-loop` 要真实浏览器，约 1–2 分钟/段）。
2. 桌面段建议单独录制后剪辑；录制时不要同时操作鼠标键盘，避免与真实键鼠互相打断。
3. 视频描述里贴 `docs/RELEASE_NOTES_v0.5.0.md` 与 `docs/test-evidence/` 链接，便于观众复核。
4. 如需静音版，去掉旁白保留字幕即可；画面中不要出现任何真实个人信息或本机绝对路径。

_最后更新：2026-10-25（v0.5.0 发布）。/ Last updated: 2026-10-25 (v0.5.0 release)._
