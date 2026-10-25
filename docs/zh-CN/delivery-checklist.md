# 交付物与验收清单 / Delivery Checklist（中文）

> 每条验收 = 编号 + 命令/操作 + 证据路径 + 最近结果（证据必须能打开）。
> M3 完成后 A1 / A2 / A3 / A4 / A5 / A6 / A7 / A8 / A9 / A12 标记为 `通过`；其余条目随里程碑完成更新为 `通过 / 未通过 / 部分`。
> 最近一次更新：2026-10-25（M3 完成）

## A. 阶段一（文档 1，12 条）

| # | 验收 | 命令/操作 | 证据 | 状态 |
|---|---|---|---|---|
| A1 | 干净克隆可跑，无需付费 API | `npm install && npm run demo` | `runs/run-20261025-172017-eb9116/report.md` + `docs/test-evidence/test-result-2026-10-25_09-52-08.md`（MockHarness，无付费 API） | ✅ 通过（2026-10-25） |
| A2 | demo-web 登录/填表/提交/校验/截图 | `npm run acceptance`（或 `node tests/e2e-browser/login-flow.mjs --case normal`） | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A2-browser-flow/`：`e2e/normal/screenshots/001…007-*.png`（7 步 / 7 张真实截图）、`e2e/normal/result.json`、`e2e/server.log`、`report.md`；run `run-20261025-175213-9ea8ab` | ✅ 通过（2026-10-25） |
| A3 | demo-desktop 打开/填表/保存/校验/截图 | `node tests/e2e-desktop/run.mjs`（或 `npm run acceptance:m2`） | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/`：`e2e-desktop/screenshots/001…020-*.png`（20 张逐步真实截图）、`e2e-desktop/result.json`（36/36 检查）、`e2e-desktop/project.json`（真实落盘 JSON，内容核对通过）、`steps.json`、`sidecar.log`、`report.md`、`checkpoint.json`；run `run-20261025-185100-6a4d70` | ✅ 通过（2026-10-25；真实窗口 + 真实键鼠 SendInput） |
| A4 | 预置缺陷 → CodeTask → 补丁 → 应用 → 测试通过 | `node dist/apps/cli/src/index.js code-loop`（或 `npm run acceptance`） | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A4-code-loop/`：`patch.diff`、`code-loop-result.json`、`e2e/login-timeout/`（4 张截图 + `result.json`）、`report.md`；run `run-20261025-175216-fe8759` | ✅ 通过（2026-10-25；第 1 轮由红转绿） |
| A5 | 连续失败两次 → 升级，无无限循环 | `node dist/apps/cli/src/index.js code-loop --fail`（或 `npm run acceptance`） | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A5-escalation/`：`test.log`（两轮失败）、`code-loop-result.json`（`escalated=true`、`rounds=2`）、`e2e/login-timeout/screenshots/004-assert-timeout-recovery-fail.png`；run `run-20261025-175223-de0b95`；`codeLoopFail` exit 1 属预期 | ✅ 通过（2026-10-25） |
| A6 | 每次运行有 prompt/patch/test.log/截图/report 且无密钥 | `npm run demo` + `npm run evidence` + `npm run acceptance` + `npm run acceptance:m2` + `npm run acceptance:m3` | M0：`runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md / events.jsonl / console.log / meta.json / code-task.json / code-result.json / goal.md）+ `docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}`；M1：`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` + `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件，含真实 e2e 截图）；M2：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` + `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件，含真实桌面截图 + `checkpoint.json` + 53/53 测试日志）；M3：`docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` + `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件：scout-run 的 report/drafts/approval-queue/events 等 + 74/74 `unit-tests.log`；另复核仓库级 `npm run check:secrets` 通过） | ✅ 通过（2026-10-25；M3 已含 Scout 运行证据与审批队列） |
| A7 | Scout ≥10 线索（来源+评分），3 条草稿未发送 | `node dist/apps/cli/src/index.js scout --json`（或 `npm run acceptance:m3`） | `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/scout-run/`：`scout-report.json`（`leads_total=14`、`leads_discarded=4`、`qualified_count=8`、`drafts_count=3`、`pending_approval=3`、`sent_count=0`、`rejected_reasons` 4 条、`scenarios` 3 个）、`leads-scored.json`、`drafts.json`（110–113 字 ≤150、`cites_signal=true`）、`approval-queue.json`（3 条全 `pending`）、`outreach-drafts/lead-001.md`/`lead-004.md`/`lead-006.md`、`scout-report.md`、`report.md`；run `run-20261025-200457-17b4e7` | ✅ 通过（2026-10-25；fixture 驱动、无网络、0 发送） |
| A8 | 停止键 5 秒；重启恢复不重复 | `node dist/apps/cli/src/index.js safety-check`；运行中抢占与 resume 由 `tests/unit/m2-runtime.test.mjs`（`npm test` 内）覆盖 | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`（`stop.ok=true`，实测 **305ms** <5000ms；`checkpoint` save/load/completed）；`m2-runtime-tests.log`（停止在 5s 内抢占、resume 跳过已完成步骤不重复执行） | ✅ 通过（2026-10-25） |
| A9 | 分支隔离（凭据/浏览器配置） | `node dist/apps/cli/src/index.js safety-check`；`tests/unit/m2-safety.test.mjs`（`npm test` 内） | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`：跨分支凭据读取被拒（`CrossBranchAccessError`）、脱敏输出不含引用明文、同一 profile 重复占用被拒（`ProfileBusyError`）、白名单外工具被拒；隔离用例见 `tests/unit/m2-safety.test.mjs` | ✅ 通过（2026-10-25） |
| A10 | 新增只读 dummy 分支只靠配置 | `npm run demo:dummy-branch`（M4 实现） | 配置 + 报告 | 未实现（M4） |
| A11 | 测试/lint/文档/许可证齐全、无遥测 | `npm run lint && npm test` | CI 日志 | 未实现（M4 全量验收；当前已满足 lint / build / 74 测试 + CI headless E2E + Scout demo + safety-check） |
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

## B. 阶段二（文档 2，8 条）

| # | 验收 | 场景 | 证据 | 状态 |
|---|---|---|---|---|
| B1 | 选题：5 万预算 30 天 ≥3 条业务线，30 秒打开来源 | 仿真业务线提案 | 提案页 + 来源链接 | 未实现 |
| B2 | 记账：一笔支出 30 秒看到 6 要素 | 账本详情 | 账本 UI 截图 | 未实现 |
| B3 | 断网 2 小时不出新承诺，恢复 10 分钟补记 | 真实断网演练 | 缺口清单 + 补记日志 | 未实现 |
| B4 | 平台 B 封禁 15 分钟停止并出替代方案 | 封号故障注入 | 停止事件 + 替代方案 | 未实现 |
| B5 | 对外承诺可追溯到对话原文与授权条款 | 承诺追溯 | 追溯页截图 | 未实现 |
| B6 | 接管键 10 秒停止 + 30 分钟接管包 | 接管演练 | 接管包 + 计时 | 未实现 |
| B7 | 四类越界 100% 拒绝、理由可读留痕 | 边界测试 | 拒绝记录 | 未实现 |
| B8 | 个人/企业模式各跑一单，不一致阻断 | 双模式端到端 | 两单证据 | 未实现 |

## C. 用户增量要求（U1–U8）

| # | 要求 | 证据 | 状态 |
|---|---|---|---|
| U1 | 全部 UI 测试真实浏览器/真实桌面，不用 API 代替 | E2E 录像/截图 + CI 规则检查 | 未实现 |
| U2 | 通知与协助（审批卡/handoff/接管） | 通知日志 + 协助卡截图 | 未实现 |
| U3 | IoT 预留（契约 + 模拟 fixture） | 契约文档 + fixture 测试 | 未实现 |
| U4 | GitHub minzzj 发布、NC-SA 许可、双语文档 | 仓库链接 + LICENSE + 双语文档 | 未实现 |
| U5 | 宣传片（真实截图、双版本） | 成片 + STORYBOARD/FACTS | 未实现 |
| U6 | 阶段一完成输出 HANDOFF 并停会话 | HANDOFF.md 更新记录 | 进行中 |
| U7 | 测试 key 不入库、日志脱敏、可轮换 | secret scan 报告 | 已建立扫描脚本 |
| U8 | 按 DSH 插件体系实现并复用插件 | 复用清单 + 依赖锁 | 设计完成 |

## D. 证据规范

- 每条证据路径必须能从仓库内打开；截图由 E2E 自动生成（禁止手截）。
- 发布前在干净中性路径重跑全量，更新本表“最近结果”列。
- 文档数字必须与证据一致；`docs/test-evidence/test-result-<stamp>.{md,json}` 由 `npm run evidence`
  自动生成，不手工编辑；`npm run verify:docs`（M4 实现）用于跨文档校验。
