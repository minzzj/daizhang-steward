# 测试证据 / Test Evidence

本目录保存**测试与发布证据索引**，不是截图本体：

```text
docs/test-evidence/
├── test-result-<YYYY-MM-DD_HH-MM-SS>.md      # 人读：离线证据包（npm run evidence 生成：build + 单测 + demo）
├── test-result-<YYYY-MM-DD_HH-MM-SS>.json    # 机读：步骤/退出码/demo run-id/证据文件清单
├── m1-acceptance-<stamp>.md / .json          # M1 本机有头真实浏览器验收（npm run acceptance 生成）
├── evidence-m1-<stamp>/                      # M1 验收证据副本：A2/A4/A5 三组截图 + 日志 + result.json
├── m2-acceptance-<stamp>.md / .json          # M2 本机真实 Windows 桌面 + 安全验收（npm run acceptance:m2 生成）
├── evidence-m2-<stamp>/                      # M2 验收证据副本：A3 真实桌面截图与结果 + A8/A9 自检 + 测试日志
├── m3-acceptance-<stamp>.md / .json          # M3 本机 fixture 驱动 Scout 验收（npm run acceptance:m3 生成）
├── evidence-m3-<stamp>/                      # M3 验收证据副本：scout-run 证据 + unit-tests.log
├── m4-acceptance-<stamp>.md / .json          # M4 发布就绪验收（npm run acceptance:m4 生成：A10/A11 + 80 测试）
├── evidence-m4-<stamp>/                      # M4 验收证据副本：A10 dummy 分支证据 + unit-tests.log
├── p1-acceptance-<stamp>.md / .json          # 阶段二 P1 个人版 MVP 验收（npm run acceptance:p1 生成）
├── evidence-p1-<stamp>/                      # P1 验收证据副本：business-run / boundary-run / console-e2e / console-cli
├── release-v0.5.0-check.md                   # v0.5.0 Release 发布验证记录
├── 2026-10-25-repo-publish.md                # GitHub 仓库发布验证记录
└── README.md
```

## 已有证据 / Existing evidence

| 文件 | 内容 |
|---|---|
| [test-result-2026-10-25_09-52-08.md](test-result-2026-10-25_09-52-08.md) · [.json](test-result-2026-10-25_09-52-08.json) | 离线证据包（`npm run evidence`）：build / unit-tests / steward-demo 三步退出码 0，**tests 34 / pass 34 / fail 0**；demo run-id `run-20261025-175211-feffd3`；无本机绝对路径。该文件是 **Windows CI 修复前**的历史快照（当时 34）；**当前测试数为 113**，以 `npm test` 与 P1 acceptance 为准 |
| [m1-acceptance-2026-10-25_09-52-12.md](m1-acceptance-2026-10-25_09-52-12.md) · [.json](m1-acceptance-2026-10-25_09-52-12.json) | M1 验收（`npm run acceptance`，本机有头真实 Chrome）：build + A2 浏览器流程 + A4 编码回路 + A5 两轮升级全部 ✅；runs `run-20261025-175213-9ea8ab` / `run-20261025-175216-fe8759` / `run-20261025-175223-de0b95` |
| [evidence-m1-2026-10-25_09-52-12/](evidence-m1-2026-10-25_09-52-12/) | M1 验收证据副本（45 文件）：`A2-browser-flow/`（7 张真实截图 + result.json）、`A4-code-loop/`（patch.diff + code-loop-result.json + 4 张截图）、`A5-escalation/`（两轮失败日志 + 升级结果） |
| [m2-acceptance-2026-10-25_10-50-51.md](m2-acceptance-2026-10-25_10-50-51.md) · [.json](m2-acceptance-2026-10-25_10-50-51.json) | M2 验收（`npm run acceptance:m2`，本机真实 Windows 桌面）：build + **53 tests / 53 pass** + A3 真实桌面流程 + A8 停止键/检查点 + A8 resume runtime + A9 分支隔离全部 ✅；A3 run `run-20261025-185100-6a4d70`；A8/A9 自检结果见下方 evidence-m2 副本（原始 run 在 gitignored `runs/run-safety-check-*`） |
| [evidence-m2-2026-10-25_10-50-51/](evidence-m2-2026-10-25_10-50-51/) | M2 验收证据副本（34 文件）：`A3-desktop-flow/`（20 张真实桌面截图 + `result.json` 36/36 检查 + `project.json` + `steps.json` + `checkpoint.json` + `report.md`）、`A8-A9-safety-check/safety-check-result.json`（停止 305ms / 检查点 / 跨分支凭据 / profile / 白名单）、`unit-tests.log`、`m2-runtime-tests.log` |
| [m3-acceptance-2026-10-25_12-04-47.md](m3-acceptance-2026-10-25_12-04-47.md) · [.json](m3-acceptance-2026-10-25_12-04-47.json) | M3 验收（`npm run acceptance:m3`，本机 fixture 驱动 Scout，无网络）：build + **74 tests / 74 pass** + A7 的 12 项检查全部 ✅（≥10 线索 / ≥8 合格 / 3 场景 / 3 草稿 / 草稿合规 / 审批全 pending / 0 发送 / 丢弃有记录 / 无自动发送 API）；Scout run `run-20261025-200457-17b4e7` |
| [evidence-m3-2026-10-25_12-04-47/](evidence-m3-2026-10-25_12-04-47/) | M3 验收证据副本（15 文件）：`scout-run/`（`scout-report.md/.json`、`leads-scored.json`、`drafts.json` 3 条 110–113 字、`approval-queue.json` 3 条全 pending、`outreach-drafts/lead-001.md`/`lead-004.md`/`lead-006.md`、`events.jsonl`、`report.md`、`checkpoint.json` 等）+ `unit-tests.log`（74/74） |
| [m4-acceptance-2026-10-25_13-43-07.md](m4-acceptance-2026-10-25_13-43-07.md) · [.json](m4-acceptance-2026-10-25_13-43-07.json) | M4 发布就绪验收（`npm run acceptance:m4`，阶段一 v0.5.0）：build + **80 tests / 80 pass** + A10 只读 `dummy-branch` + A11 发布就绪检查（许可证/第三方声明/商用说明/双语文档配对/无遥测/版本一致 0.5.0/发布文档齐全）全部 ✅ |
| [evidence-m4-2026-10-25_13-43-07/](evidence-m4-2026-10-25_13-43-07/) | M4 验收证据副本（7 文件）：`A10-dummy-branch/`（prompt/meta/console/events/checkpoint/report）+ `unit-tests.log`（80/80） |
| [p1-acceptance-2026-10-25_14-18-54.md](p1-acceptance-2026-10-25_14-18-54.md) · [.json](p1-acceptance-2026-10-25_14-18-54.json) | 阶段二 P1 个人版 MVP 验收（`npm run acceptance:p1`，本机有头真实 Chrome，12/12 检查）：build + **113 tests / 113 pass** + B1 选题 3 条业务线（来源可查）+ B2 账本 2 笔 6 要素 + B5 承诺授权链 3 段（未记录=未授权）+ B6 接管 stop_ms=3（≤10000）+ 6 类接管包 + B7 18 条个人模式边界规则（四类越界 4/4 拒绝、支付→human、报价→draft_only）+ 月报 + 控制台真实浏览器 E2E（9 步 / 73 检查 / 9 截图 / 实测接管停止 88ms）+ CLI 控制台真实浏览器 + 人工审批；runs `run-20261025-221904-b56b1a`（business）/ `run-20261025-221904-89b2f3`（boundary）；B3/B4/B8 延后 P2/P3 |
| [evidence-p1-2026-10-25_14-18-54/](evidence-p1-2026-10-25_14-18-54/) | P1 验收证据副本（39 文件）：`business-run/`（proposal.json、business-result.json、ledger-facts.json 2 笔 × 6 要素、promise-traces.json、takeover-pack.json、boundary-check.json、monthly-report.{json,md}、summaries.json、report.md、checkpoint.json 等）、`boundary-run/`（boundary-rules.json 18 条 + boundary-check.json）、`console-e2e/`（9 步截图 + result.json / console-server.log / console.log）、`console-cli/`（`dashboard.png`、`ledger.png` 真实浏览器截图）、`takeover-result.json`、`unit-tests.log`（113/113） |
| [release-v0.5.0-check.md](release-v0.5.0-check.md) | v0.5.0 GitHub Release 发布验证记录（API + 真实浏览器截图） |
| [2026-10-25-repo-publish.md](2026-10-25-repo-publish.md) | GitHub 公开发布验证（REST API + 真实浏览器 + CI #1/#2） |

- 截图与日志本体在 `runs/<run-id>/`（gitignored），测试结果文件引用其相对路径。
- 发布用的证据必须来自**干净中性路径**重跑，且不包含本机用户名/绝对路径。
- 每个数字必须能追溯到一份结果文件，禁止手填。
- 失败证据保留现场（截图 + 控制台日志 + 最小复现）。
- `test-result-*` 由 `npm run evidence`（`scripts/run-evidence.mjs`）自动生成，**不要手工编辑**。
- M1 验收由 `npm run acceptance`（`scripts/run-acceptance.mjs`，本机有头真实浏览器）生成
  `m1-acceptance-*` + `evidence-m1-*`；脚本会先删除旧的 acceptance bundle，仓库只保留最新一份。
- M2 验收由 `npm run acceptance:m2`（`scripts/run-acceptance-m2.mjs`，本机真实 Windows 桌面会话）
  生成 `m2-acceptance-*` + `evidence-m2-*`；同样只保留最新一份（脚本在生成前清理旧的 M2 bundle）。
- M3 验收由 `npm run acceptance:m3`（`scripts/run-acceptance-m3.mjs`，fixture 驱动、无网络外联）
  生成 `m3-acceptance-*` + `evidence-m3-*`（scout-run 证据 + `unit-tests.log`）；同样只保留最新一份。
- M4 发布验收由 `npm run acceptance:m4`（`scripts/run-acceptance-m4.mjs`，无 GUI / 无网络 / 不外发）
  生成 `m4-acceptance-*` + `evidence-m4-*`（A10 dummy 分支证据 + `unit-tests.log` + A11 发布就绪检查）；
  发布前必须存在 `docs/good-first-issues.md`、`docs/demo-script.*` 与 `docs/RELEASE_NOTES_v0.5.0.md`。
- P1 阶段二验收由 `npm run acceptance:p1`（`scripts/run-acceptance-p1.mjs`，本机有头真实浏览器控制台；
  business/boundary 为纯 fixture 离线运行）生成 `p1-acceptance-*` + `evidence-p1-*`
  （business-run / boundary-run / console-e2e / console-cli / takeover-result / unit-tests.log）；
  运行前会清理 `.steward/`，只保留最新一份。
- M1–M4 / P1 acceptance bundle 复制进仓库前用 `scripts/sanitize.mjs` 脱敏（替换本机绝对路径与临时
  worktree 路径），因此 `evidence-m1-*`…`evidence-p1-*` 内不含本机路径；
  `scripts/sanitize-evidence.mjs` 仅用于对既有 bundle 做一次性脱敏。

_最后更新：2026-10-25（阶段二 P1 个人版 MVP 完成，v0.6.0）。_
