# 交付物与验收清单 / Delivery Checklist（中文）

> 每条验收 = 编号 + 命令/操作 + 证据路径 + 最近结果（证据必须能打开）。
> **阶段一（M0–M4）已完成并以 v0.5.0 发布：A1–A12 全部 `通过`。阶段二 P1（个人版 MVP）已完成并以
> v0.6.0 交付：B1/B2/B5/B6/B7 通过；B3/B4 待 P2、B8 待 P3。**
> 最近一次更新：2026-10-25（阶段二 P1 完成，v0.6.0）

## A. 阶段一（文档 1，12 条）

| # | 验收 | 命令/操作 | 证据 | 状态 |
|---|---|---|---|---|
| A1 | 干净克隆可跑，无需付费 API | `npm install && npm run demo` | `runs/run-20261025-172017-eb9116/report.md` + `docs/test-evidence/test-result-2026-10-25_09-52-08.md`（MockHarness，无付费 API） | ✅ 通过（2026-10-25） |
| A2 | demo-web 登录/填表/提交/校验/截图 | `npm run acceptance`（或 `node tests/e2e-browser/login-flow.mjs --case normal`） | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A2-browser-flow/`：`e2e/normal/screenshots/001…007-*.png`（7 步 / 7 张真实截图）、`e2e/normal/result.json`、`e2e/server.log`、`report.md`；run `run-20261025-175213-9ea8ab` | ✅ 通过（2026-10-25） |
| A3 | demo-desktop 打开/填表/保存/校验/截图 | `node tests/e2e-desktop/run.mjs`（或 `npm run acceptance:m2`） | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/`：`e2e-desktop/screenshots/001…020-*.png`（20 张逐步真实截图）、`e2e-desktop/result.json`（36/36 检查）、`e2e-desktop/project.json`（真实落盘 JSON，内容核对通过）、`steps.json`、`sidecar.log`、`report.md`、`checkpoint.json`；run `run-20261025-185100-6a4d70` | ✅ 通过（2026-10-25；真实窗口 + 真实键鼠 SendInput） |
| A4 | 预置缺陷 → CodeTask → 补丁 → 应用 → 测试通过 | `node dist/apps/cli/src/index.js code-loop`（或 `npm run acceptance`） | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A4-code-loop/`：`patch.diff`、`code-loop-result.json`、`e2e/login-timeout/`（4 张截图 + `result.json`）、`report.md`；run `run-20261025-175216-fe8759` | ✅ 通过（2026-10-25；第 1 轮由红转绿） |
| A5 | 连续失败两次 → 升级，无无限循环 | `node dist/apps/cli/src/index.js code-loop --fail`（或 `npm run acceptance`） | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A5-escalation/`：`test.log`（两轮失败）、`code-loop-result.json`（`escalated=true`、`rounds=2`）、`e2e/login-timeout/screenshots/004-assert-timeout-recovery-fail.png`；run `run-20261025-175223-de0b95`；`codeLoopFail` exit 1 属预期 | ✅ 通过（2026-10-25） |
| A6 | 每次运行有 prompt/patch/test.log/截图/report 且无密钥 | `npm run demo` + `npm run evidence` + `npm run acceptance` + `npm run acceptance:m2` + `npm run acceptance:m3` + `npm run acceptance:m4` | M0：`runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md / events.jsonl / console.log / meta.json / code-task.json / code-result.json / goal.md）+ `docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}`；M1：`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` + `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件，含真实 e2e 截图）；M2：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` + `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件，含真实桌面截图 + `checkpoint.json` + 53/53 测试日志）；M3：`docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` + `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件：scout-run 的 report/drafts/approval-queue/events 等 + 74/74 `unit-tests.log`）；M4：`docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `docs/test-evidence/evidence-m4-<stamp>/`（A10 dummy 分支证据 + 80/80 `unit-tests.log` + A11 发布就绪检查；仓库级 `npm run check:secrets` 通过） | ✅ 通过（2026-10-25；M4 已含发布就绪与 A10 证据） |
| A7 | Scout ≥10 线索（来源+评分），3 条草稿未发送 | `node dist/apps/cli/src/index.js scout --json`（或 `npm run acceptance:m3`） | `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/scout-run/`：`scout-report.json`（`leads_total=14`、`leads_discarded=4`、`qualified_count=8`、`drafts_count=3`、`pending_approval=3`、`sent_count=0`、`rejected_reasons` 4 条、`scenarios` 3 个）、`leads-scored.json`、`drafts.json`（110–113 字 ≤150、`cites_signal=true`）、`approval-queue.json`（3 条全 `pending`）、`outreach-drafts/lead-001.md`/`lead-004.md`/`lead-006.md`、`scout-report.md`、`report.md`；run `run-20261025-200457-17b4e7` | ✅ 通过（2026-10-25；fixture 驱动、无网络、0 发送） |
| A8 | 停止键 5 秒；重启恢复不重复 | `node dist/apps/cli/src/index.js safety-check`；运行中抢占与 resume 由 `tests/unit/m2-runtime.test.mjs`（`npm test` 内）覆盖 | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`（`stop.ok=true`，实测 **305ms** <5000ms；`checkpoint` save/load/completed）；`m2-runtime-tests.log`（停止在 5s 内抢占、resume 跳过已完成步骤不重复执行） | ✅ 通过（2026-10-25） |
| A9 | 分支隔离（凭据/浏览器配置） | `node dist/apps/cli/src/index.js safety-check`；`tests/unit/m2-safety.test.mjs`（`npm test` 内） | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`：跨分支凭据读取被拒（`CrossBranchAccessError`）、脱敏输出不含引用明文、同一 profile 重复占用被拒（`ProfileBusyError`）、白名单外工具被拒；隔离用例见 `tests/unit/m2-safety.test.mjs` | ✅ 通过（2026-10-25） |
| A10 | 新增只读 dummy 分支只靠配置 | `node dist/apps/cli/src/index.js dummy-branch [--json]`（或 `npm run acceptance:m4`） | `docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` 的 A10 检查 + `evidence-m4-2026-10-25_13-43-07/A10-dummy-branch/`（dummy 分支运行产物）；`tests/unit/m4-release.test.mjs`（断言 `role=dummy`、`tools=[echo]`、`promptRef=reviewer@1.0.0`、有运行报告）；复用 `prompts/reviewer.md`，核心未改 | ✅ 通过（2026-10-25；仅配置 + 已有 reviewer 提示词） |
| A11 | 测试/lint/文档/许可证齐全、无遥测 | `npm run lint && npm test` + `npm run acceptance:m4` | `docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` 的 A11 检查（CC BY-NC-SA 4.0 许可证全文 + 非商用、NOTICE 第三方声明、COMMERCIAL 商用说明、中英双语文档配对、无遥测、版本一致 0.5.0、发布文档齐全）+ `tests/unit/m4-release.test.mjs` + CI #10（Windows + Ubuntu 全绿）+ 80/80 测试 | ✅ 通过（2026-10-25；v0.5.0 发布就绪） |
| A12 | 提示词版本化、有测试、可替换 | `npm run test:prompts` | `prompts/manifest.json`（4 角色 + sha256）+ `tests/unit/prompts.test.mjs`（5 项断言） | ✅ 通过（2026-10-25） |

> **M0 验收结论（2026-10-25）**：A1 / A6 / A12 通过。`npm run check`、`npm run check:secrets`、
> `npm test`（30/30）、`npm run demo`、`npm run evidence` 全部退出码 0；证据文件由
> `npm run evidence` 自动生成，不手工编辑。
>
> **M1 验收结论（2026-10-25）**：A2 / A4 / A5 / A6 通过（本机有头真实 Chrome，`npm run acceptance` OK）。
> A2：7 步 / 7 张真实截图；A4：第 1 轮由红转绿；A5：两轮失败后停止升级（exit 1，不无限重试）。
> M1 历史结论：测试 **35/35**、CLI **9 命令 + 2 占位**；`npm run lint`、`npm run check`、
> `npm run check:secrets` 通过。证据：
> `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
> `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件：A2 / A4 / A5 三组）。
>
> **M2 验收结论（2026-10-25）**：A3 / A8 / A9 通过（本机真实 Windows 桌面会话，
> `npm run acceptance:m2` OK：build + **53/53** 测试 + 桌面流程 + 停止键/检查点 + 隔离自检全部 ✅）。
> A3：真实窗口 + 真实键鼠（SendInput）完成打开→填表→保存→校验→截图，**36/36 检查通过、20 张真实
> 截图、JSON 内容核对通过**（run `run-20261025-185100-6a4d70`）；A8：停止键实测 **305ms**（<5000ms），
> runtime 集成测试证明运行中停止可抢占，检查点 resume 跳过已完成步骤、不重复执行；A9：跨分支凭据
> 不可读（`CrossBranchAccessError`）、同一 profile 不能并发占用（`ProfileBusyError`）、白名单外工具
> 拒绝。测试 **53/53**（M1 的 35 条 + `m2-safety` 14 条 + `m2-runtime` 4 条）。CLI 现为 **11 个已实现
> 命令 + 2 个占位**。证据：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
> `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件，已脱敏）。
>
> **M3 验收结论（2026-10-25）**：A7 通过（本机 fixture 驱动 Scout 运行，无网络外联，
> `npm run acceptance:m3` OK，**12/12 检查全 ✅**）。Scout run `run-20261025-200457-17b4e7`：
> fixtures **14 条**线索 → 丢弃 **4**（缺 `source_url` / 非法 URL / 空 `consent_basis` / 重复各 1）
> → 通过来源硬校验 10 条、其中 **8** 条达到默认 0.5 合格阈值 → **3 条外联草稿**（110–113 字，
> 均 ≤150 字且引用具体信号）→ 审批队列 **3 条全部 `pending`**、**0 发送**；含 ICP 与 **3 个高价值
> 场景**，丢弃原因全部留证。测试 **74/74**（M2 的 53 条 + `scout.test.mjs` 21 条，共 11 个测试文件）；
> CLI 现为 **12 个已实现命令 + 2 个占位**（新增 `scout`）。证据：
> `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
> `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件：scout-run 证据 + `unit-tests.log`，
> 已脱敏）。
>
> **M4 验收结论（2026-10-25，阶段一收尾）**：A10 / A11 / A12 通过，`npm run acceptance:m4` OK
> （10 项检查全 ✅）。A10：`steward dummy-branch` 只读分支（`role=dummy`、`tools=[echo]`、复用
> `reviewer@1.0.0` 提示词，核心未改）；A11：发布就绪检查全部通过（许可证/第三方声明/商用说明/
> 中英双语文档配对/无遥测/版本一致 0.5.0/发布文档齐全），CI #10 Windows + Ubuntu 全绿；
> A12：提示词版本化不变。测试 **80/80**（M1–M3 的 74 条 + `m4-release` 6 条，共 12 个测试文件）；
> CLI 现为 **13 个已实现命令 + 2 个占位**（新增 `dummy-branch`）。证据：
> `docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `evidence-m4-<stamp>/`（由
> `npm run acceptance:m4` 生成、已脱敏）。
>
> **P1 验收结论（2026-10-25，阶段二个人版 MVP，v0.6.0）**：B1 / B2 / B5 / B6 / B7 通过，
> `npm run acceptance:p1` OK（**12/12 检查全 ✅**；build + **113/113** 测试 + 业务 + 控制台 E2E）。
> B1：3 条候选业务线（来源 URL 可查）+ 提案；B2：账本 2 笔、**6 要素**全齐；B5：承诺授权链 **3 段**
> （对话原文→委托条款→项目；未记录=未授权）；B6：接管 `stop_ms=3`（≤10000）+ **6 类接管包**（含凭据
> 引用）；B7：**18 条个人模式边界规则**、四类越界 **4/4 拒绝**（deny）、支付→human、报价→draft_only。
> 真实浏览器（有头 Chrome）：控制台 E2E **9 步 / 73 项检查 / 9 张截图**，浏览器实测接管停止 **88ms**；
> CLI 控制台真实浏览器打开（看板 + 账本 6 要素，`console-cli/ledger.png`）；审批/接管命令人工批准生效；
> 月报 收入 ¥20000 / 成本 ¥0 / 毛利 ¥20000 / 预算余 ¥50000。测试 **113/113**（阶段一 80 +
> domain 30 + phase2-cli 3，共 14 个测试文件）；CLI 现为 **18 个已实现命令 + 0 个占位**（新增
> `business`/`boundary-check`/`console`/`approve`/`takeover`）。**B3/B4 待 P2 故障演练、B8 待 P3
> 企业版**。证据：`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
> `docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`（39 文件：business-run / boundary-run /
> console-e2e / console-cli / takeover-result / unit-tests.log，已脱敏）。

## B. 阶段二（文档 2，8 条）

> P1（个人版 MVP）覆盖 **B1 / B2 / B5 / B6 / B7**（均已通过）；**B3 / B4 → P2 故障演练**，
> **B8 → P3 企业版**。

| # | 验收 | 场景 | 证据 | 状态 |
|---|---|---|---|---|
| B1 | 选题：5 万预算 30 天 ≥3 条业务线，30 秒打开来源 | 仿真业务线提案 | `evidence-p1-2026-10-25_14-18-54/business-run/proposal.json`（3 条合格、来源 URL 可查、proposal=true；business 命令 157ms）；run `run-20261025-221904-b56b1a` | ✅ 通过（2026-10-25，P1） |
| B2 | 记账：一笔支出 30 秒看到 6 要素 | 账本详情 | `evidence-p1-2026-10-25_14-18-54/business-run/ledger-facts.json`（2 笔 × 6 要素全齐）；控制台 `/ledger` 详情抽屉 + `console-e2e/screenshots/004-ledger-facts.png` | ✅ 通过（2026-10-25，P1） |
| B3 | 断网 2 小时不出新承诺，恢复 10 分钟补记 | 真实断网演练 | 缺口清单 + 补记日志 | 未实现（P2 故障演练） |
| B4 | 平台 B 封禁 15 分钟停止并出替代方案 | 封号故障注入 | 停止事件 + 替代方案 | 未实现（P2 故障演练） |
| B5 | 对外承诺可追溯到对话原文与授权条款 | 承诺追溯 | `evidence-p1-.../business-run/promise-traces.json`（授权链 3 段：对话原文→委托条款→项目；未记录返回“未授权”） | ✅ 通过（2026-10-25，P1） |
| B6 | 接管键 10 秒停止 + 30 分钟接管包 | 接管演练 | `evidence-p1-.../takeover-result.json`（`stop_ms=3` ≤10000）+ `business-run/takeover-pack.json`（6 类：开放订单/待处理对话/应付款/凭据引用/风险/覆盖度）；控制台 E2E `006-takeover-stop.png` / `007-takeover-resume.png`（浏览器实测 88ms） | ✅ 通过（2026-10-25，P1） |
| B7 | 四类越界 100% 拒绝、理由可读留痕 | 边界测试 | `evidence-p1-.../business-run/boundary-check.json` + `boundary-run/boundary-rules.json`（18 条个人模式规则；四类越界 4/4 deny、支付→human、报价→draft_only，均含可读 user_message） | ✅ 通过（2026-10-25，P1） |
| B8 | 个人/企业模式各跑一单，不一致阻断 | 双模式端到端 | 两单证据 | 未实现（P3 企业版） |

## C. 用户增量要求（U1–U8）

| # | 要求 | 证据 | 状态 |
|---|---|---|---|
| U1 | 全部 UI 测试真实浏览器/真实桌面，不用 API 代替 | E2E 截图（M1 A2/A4/A5、M2 A3，P1 控制台 `tests/e2e-console` 9 步/73 检查）+ CI 无头真实浏览器 E2E | ✅ 已满足（阶段一 + P1；CI 规则检查可在 P2 加强） |
| U2 | 通知与协助（审批卡/handoff/接管） | 通知日志 + 协助卡截图 | 部分满足（P1 已有审批卡/接管键 + 交接包；Toast/邮件/Webhook 待 P3/P4） |
| U3 | IoT 预留（契约 + 模拟 fixture） | 契约文档 + fixture 测试 | 未实现（P3/P4 stub） |
| U4 | GitHub minzzj 发布、NC-SA 许可、双语文档 | 仓库 https://github.com/minzzj/daizhang-steward + LICENSE（CC BY-NC-SA 4.0）+ 双语文档 + Release v0.5.0 | ✅ 已完成（2026-10-25，v0.5.0） |
| U5 | 宣传片（真实截图、双版本） | 成片 + STORYBOARD/FACTS | 未实现（P4；当前以真实命令演示脚本替代） |
| U6 | 阶段一完成输出 HANDOFF 并停会话 | [HANDOFF.md](../../HANDOFF.md) 已更新到「阶段二 P1 完成，v0.6.0」，阶段一已按约定交接 | ✅ 已完成（2026-10-25） |
| U7 | 测试 key 不入库、日志脱敏、可轮换 | `npm run check:secrets` 通过；证据包已脱敏 | ✅ 已满足 |
| U8 | 按 DSH 插件体系实现并复用插件 | 复用清单 + 依赖锁 | 设计完成（P3/P4 落地 MCP/插件集成） |

## D. 证据规范

- 每条证据路径必须能从仓库内打开；截图由 E2E 自动生成（禁止手截）。
- 发布前在干净中性路径重跑全量，更新本表“最近结果”列。
- 文档数字必须与证据一致；`docs/test-evidence/test-result-<stamp>.{md,json}` 由 `npm run evidence`
  自动生成，不手工编辑；跨文档数字/链接校验目前由发布文档任务人工 grep 与链接检查完成
  （`npm run verify:docs` 尚未实现，可作为后续 good-first-issue）。
