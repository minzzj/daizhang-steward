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
├── p2-acceptance-<stamp>.md / .json          # 阶段二 P2 故障演练**短跑**验收（npm run acceptance:p2 生成）
├── evidence-p2-<stamp>/                      # P2 短跑证据副本：B3-net-outage / B4-platform-ban + unit-tests.log
├── long-drill-<stamp>.md / .json             # 阶段二 P2 故障演练**真实长跑**验收（npm run drill:long 生成）
├── evidence-long-drill-<stamp>/              # P2 长跑证据副本：B3-net-outage-120min / B4-platform-ban-15min
│                                             #   + 演练日志（本次 11 文件，2026-10-26 通过）
├── p3-acceptance-<stamp>.md / .json          # 阶段二 P3 企业版验收（npm run acceptance:p3 生成）
├── evidence-p3-<stamp>/                      # P3 验收证据副本：enterprise-run（profile/entity/seal/dual-review/
│                                             #   invoice/org-approval/dual-mode-orders/boundary-table/fixture-checks）
├── release-v0.5.0-check.md                   # v0.5.0 Release 发布验证记录
├── release-v0.6.0-check.md                   # v0.6.0 Release 发布验证记录
├── release-v0.8.0-check.md                   # v0.8.0 Release 发布验证记录（P2+P3）
├── release-v1.0.0-check.md                   # v1.0.0 Release 发布验证记录（最终版，Latest，含宣传片 Assets）
├── 2026-10-25-repo-publish.md                # GitHub 仓库发布验证记录
└── README.md
```

## 已有证据 / Existing evidence

| 文件 | 内容 |
|---|---|
| [test-result-2026-10-25_09-52-08.md](test-result-2026-10-25_09-52-08.md) · [.json](test-result-2026-10-25_09-52-08.json) | 离线证据包（`npm run evidence`）：build / unit-tests / steward-demo 三步退出码 0，**tests 34 / pass 34 / fail 0**；demo run-id `run-20261025-175211-feffd3`；无本机绝对路径。该文件是 **Windows CI 修复前**的历史快照（当时 34）；**当前测试数为 151**，以 `npm test` 与 P3 acceptance 为准 |
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
| [p2-acceptance-2026-10-25_15-02-52.md](p2-acceptance-2026-10-25_15-02-52.md) · [.json](p2-acceptance-2026-10-25_15-02-52.json) | 阶段二 P2 故障演练**短跑**验收（`npm run acceptance:p2`，真实 localhost HTTP 故障注入）：build + **133 tests / 133 pass** + **11/11 检查 ✅**；B3 断网（`outage=120007ms`、blocked_promises=25、queued_actions=25、replayed=25、duplicates_found=0、recovered_within_10min=true）；B4 封禁（ban_detected_within_ms=11、stopped=true、actions_attempted_during_ban=24、alternative_items=5、通知留痕） |
| [evidence-p2-2026-10-25_15-02-52/](evidence-p2-2026-10-25_15-02-52/) | P2 短跑证据副本（10 文件）：`B3-net-outage/`（`drill-net-outage.json`、`outbox.json`、`ledger.json`、断网/恢复通知）、`B4-platform-ban/`（`drill-platform-ban.json`、`alternative-plan.json`、封禁/恢复通知）、`unit-tests.log`（133/133） |
| [long-drill-2026-10-25_15-02-52.md](long-drill-2026-10-25_15-02-52.md) · [.json](long-drill-2026-10-25_15-02-52.json) | 阶段二 P2 故障演练**真实长跑**验收（`npm run drill:long`，真实时长不加速，2026-10-26 通过）：**B3 断网 120 分钟（7215 秒）** → **1435 次承诺被拒、0 新增**、1435 条动作入 Outbox 并**全部补记**、**`duplicates_found=0`**、二次对账 `entries_added=0`、恢复在 10 分钟内；**B4 封禁 15 分钟（900 秒）** → **9ms 检测**、**180 次尝试 0 成功**、停止动作、**5 条替代方案**、通知留痕、解禁恢复 |
| [evidence-long-drill-2026-10-25_15-02-52/](evidence-long-drill-2026-10-25_15-02-52/) | P2 长跑证据副本（11 文件，已脱敏）：`B3-net-outage-120min/`（`drill-net-outage.json`、`outbox.json`、`ledger.json`、断网/恢复通知）、`B4-platform-ban-15min/`（`drill-platform-ban.json`、`alternative-plan.json`、封禁/恢复通知）、`B3-net-outage-120min.log`、`B4-platform-ban-15min.log` |
| [p3-acceptance-2026-10-25_15-23-46.md](p3-acceptance-2026-10-25_15-23-46.md) · [.json](p3-acceptance-2026-10-25_15-23-46.json) | 阶段二 P3 企业版验收（`npm run acceptance:p3`，纯本地、无真实银行/税务系统）：build + **151 tests / 151 pass** + **12/12 检查 ✅**；B8 双模式（subject/invoice/payment consistent=true、6 类不一致阻断、blocked 时无发票/收款）；30 条边界双模式表（4 类重点越界双模式 deny）；双人复核（1 人 applied=false、2 位不同角色 applied=true）；用印 ai_may_sign=false（人签）；专票校验 draft_pending_human；申报草稿 ai_may_submit=false；组织审批链 1/2/3 级（3000/20000/80000）；用工/资质转人工；企业 fixtures 8/8 交叉验证；企业 run `run-20261025-232357-2ce6f6` |
| [evidence-p3-2026-10-25_15-23-46/](evidence-p3-2026-10-25_15-23-46/) | P3 验收证据副本（18 文件）：`enterprise-run/`（`profile.json`、`entity-validation.json`、`seal-flow.json`、`dual-review.json`、`invoice-validation.json`、`org-approval.json`、`dual-mode-orders.json`、`boundary-table.{md,json}`（30 条）、`boundary-checks.json`、`fixture-checks.json`、`report.md`、`checkpoint.json` 等）+ `unit-tests.log`（151/151） |
| [release-v0.5.0-check.md](release-v0.5.0-check.md) | v0.5.0 GitHub Release 发布验证记录（API + 真实浏览器截图） |
| [release-v0.6.0-check.md](release-v0.6.0-check.md) | v0.6.0 GitHub Release 发布验证记录（API + 真实浏览器截图） |
| [release-v0.8.0-check.md](release-v0.8.0-check.md) | **v0.8.0 GitHub Release 发布验证记录**（P2+P3 合并发布，tag `95b609a`；API + 真实浏览器截图，截图见 [../images/release-v0.8.0.png](../images/release-v0.8.0.png)） |
| [release-v1.0.0-check.md](release-v1.0.0-check.md) | **v1.0.0 GitHub Release 发布验证记录（最终版，Latest —— 两阶段交付完成）**：tag 1e3b89f、名称「v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete」、非 draft/prerelease；**宣传片 3 个 Assets**（bgm 12,947,989 B / silent 10,169,266 B / poster 85,200 B，state=uploaded 且大小/SHA256 一致）；API + 真实浏览器截图，截图见 [../images/release-v1.0.0.png](../images/release-v1.0.0.png) |
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
- P2 故障演练：短跑由 `npm run acceptance:p2`（`scripts/run-acceptance-p2.mjs`，真实 localhost HTTP，
  约 2 分钟）生成 `p2-acceptance-*` + `evidence-p2-*`；**真实长跑**由 `npm run drill:long`
  （`scripts/run-long-drill.mjs`，B3 断网 120 分钟 / B4 封禁 15 分钟，真实时长不加速，约 2.5 小时）
  生成 `long-drill-*` + `evidence-long-drill-*`（本次 11 文件，已脱敏，2026-10-26 通过）。
- P3 企业版验收由 `npm run acceptance:p3`（`scripts/run-acceptance-p3.mjs`，纯本地、无网络、无真实
  银行/税务系统）生成 `p3-acceptance-*` + `evidence-p3-*`（enterprise-run 全量证据 + `unit-tests.log`）。
- **v0.8.0 Release 验证**：[`release-v0.8.0-check.md`](release-v0.8.0-check.md) + 截图
  [`../images/release-v0.8.0.png`](../images/release-v0.8.0.png)（Release 页面 Latest、tag、说明与
  B1–B8 对照均由真实浏览器核对）。
- **v1.0.0 Release 验证（最终版）**：[`release-v1.0.0-check.md`](release-v1.0.0-check.md) + 截图
  [`../images/release-v1.0.0.png`](../images/release-v1.0.0.png)（API + 真实浏览器双通道：Latest、
  tag `1e3b89f`、双语说明、A1–A12/B1–B8 对照、宣传片 3 Assets）；宣传片工程与分镜见
  [`../media/promo/`](../media/promo/)。
- M1–M4 / P1/P2/P3 acceptance bundle 复制进仓库前用 `scripts/sanitize.mjs` 脱敏（替换本机绝对路径与临时
  worktree 路径），因此 `evidence-m1-*`…`evidence-p3-*` 内不含本机路径；
  `scripts/sanitize-evidence.mjs` 仅用于对既有 bundle 做一次性脱敏。

_最后更新：2026-10-26（两阶段交付完成，v1.0.0 已发布（Latest）；含真实截图宣传片 3 Assets）。_
