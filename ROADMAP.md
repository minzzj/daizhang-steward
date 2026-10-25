# Roadmap / 路线图

> 本文件是**批准门**与**停止点**的唯一事实来源。每个里程碑必须先通过验收、附证据、经用户确认，
> 才进入下一个。**任何里程碑不通过验收，不进入下一里程碑。**

## 总览

| 阶段 | 里程碑 | 内容 | 验收（见 docs/*/delivery-checklist.md） | 状态 |
|---|---|---|---|---|
| 0 | S0 脚手架 | 仓库、许可证、治理文件、双语文档骨架、CI 自检、目标与路线图 | `npm run check` 绿、CI 绿 | ✅ 完成（2026-10-25，GitHub 仓库已发布） |
| 1 | M0 骨架 | 内核最小闭环：AgentRuntime/BranchSpec/PolicyEngine/ArtifactBus/PromptManager/EventLog/BudgetGuard/StopSignal；CLI（7 命令 + 2 占位）；MockHarness；demo-web/demo-desktop；prompts v1；单包构建；CI | A1、A6、A12 | ✅ 完成（2026-10-25；A1/A6/A12 通过，证据 `runs/run-20261025-172017-eb9116/` + `docs/test-evidence/test-result-2026-10-25_09-52-08.md`） |
| 1 | M1 浏览器回路 | 真实浏览器回路：`steward-browser`（Playwright 有头/回退）、CodeTask→补丁→隔离 worktree→真实浏览器验收、失败两轮升级、`tests/e2e-browser`、CLI `browser-flow`/`code-loop`、Windows CI CRLF 修复（`b4ed316`） | A2、A4、A5、A6 | ✅ 完成（2026-10-25；A2/A4/A5/A6 通过，`npm run acceptance` OK；证据 `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` + `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`） |
| 1 | M2 桌面与安全 | Windows 桌面适配器；PolicyEngine；停止键；审计；检查点恢复；分支隔离 | A3、A8、A9 | ✅ 完成（2026-10-25；A3/A8/A9 通过，`npm run acceptance:m2` OK；证据 `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` + `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`） |
| 1 | M3 客户分支 | Scout：ICP、来源清单、评分、外联草稿、审批队列、ScoutReport | A7 | ✅ 完成（2026-10-25；A7 通过，`npm run acceptance:m3` OK；证据 `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` + `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`） |
| 1 | M4 开源发布 | 双语文档、LICENSE 校验、CI、Release、5 个 good-first-issue、3 分钟演示 | A10、A11、A12 | ✅ 完成（2026-10-25；阶段一收尾，**v0.5.0 已发布**；`npm run acceptance:m4` OK；证据 `docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` + `evidence-m4-2026-10-25_13-43-07/`；Release https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0） |
| — | **阶段一停止点** | 输出 `HANDOFF.md`，**结束会话省额度**（按用户要求），等待阶段二启动 | 用户确认 | ✅ 完成（2026-10-25 v0.5.0 发布；阶段二已启动） |
| 2 | P1 个人版 MVP | 经营域（委托/预算/项目/任务/代理/证据/账本/墓碑）、五能力、控制台、审批、接管、月报 | B1、B2、B5、B6、B7 | ✅ 完成（2026-10-25；B1/B2/B5/B6/B7 通过，`npm run acceptance:p1` OK，**v0.6.0**；证据 `docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` + `evidence-p1-2026-10-25_14-18-54/`） |
| 2 | P2 个人版故障 | 断网 2h、强杀恢复、封号模拟、72h 失联、循环超限 | B3、B4 | ✅ 完成（2026-10-26；**B3/B4 短跑 + 真实长跑均通过**：断网 120min → 1435 次承诺被拒/0 新增、1435 条动作全部补记、`duplicates_found=0`；封禁 15min → 9ms 检测、180 次尝试 0 成功、5 条替代方案；`npm run acceptance:p2` 短跑 11/11 OK、`npm run drill:long` 长跑通过；证据 `docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.{md,json}` + `evidence-p2-2026-10-25_15-02-52/`（短跑）与 `long-drill-2026-10-25_15-02-52.{md,json}` + `evidence-long-drill-2026-10-25_15-02-52/`（长跑，11 文件）；已随 **v0.8.0** 发布） |
| 2 | P3 企业版 | 对公/专票/授权书用印/多账号串行/用工资质转人工/模式一致性；30 条边界表 | B8 + 边界 100% 拒绝 | ✅ 完成（2026-10-25；**B8 通过** + 30 条边界双模式表，`npm run acceptance:p3` OK，**v0.8.0 已发布**；证据 `docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.{md,json}` + `evidence-p3-2026-10-25_15-23-46/`；边界表全文见 `docs/zh-CN/enterprise.md`） |
| 2 | P4 发布与宣传片 | v1.0.0、GitHub Release、验收包、真实截图宣传片（BGM+静音） | 全部证据 + 用户确认 | ✅ 完成（2026-10-26；**v1.0.0 已发布（Latest，两阶段交付完成）**；宣传片 3 个 Release Assets：BGM 12,947,989 B / silent 10,169,266 B / poster 85,200 B，110s / 1280×720@30fps，真实 E2E 截图；工程与分镜 `docs/media/promo/`；发布验证 `docs/test-evidence/release-v1.0.0-check.md` + `docs/images/release-v1.0.0.png`；发布说明 `docs/RELEASE_NOTES_v1.0.0.md`） |

> **M0 验收结论（2026-10-25）**：A1 / A6 / A12 通过；`npm run check`、`npm run check:secrets`、
> `npm test`（30/30）、`npm run demo`、`npm run evidence` 全部退出码 0。证据：
> `runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md / events.jsonl /
> code-task.json / code-result.json）、`docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}`、
> `prompts/manifest.json`（4 角色 sha256 校验）。
>
> 公开仓库：https://github.com/minzzj/daizhang-steward（2026-10-25 创建；发布验证见
> `docs/test-evidence/2026-10-25-repo-publish.md`）。开发遵循“先契约后实现、每个里程碑一个 PR、
> 真实浏览器/真实桌面取证”。
>
> **M1 验收结论（2026-10-25）**：A2 / A4 / A5 / A6 通过（本机有头真实 Chrome，`npm run acceptance` OK）。
> A2 浏览器流程 `run-20261025-175213-9ea8ab`（7 步 / 7 张真实截图）；A4 编码回路
> `run-20261025-175216-fe8759`（CodeTask→补丁→隔离 worktree→login-timeout 由红转绿，第 1 轮通过）；
> A5 两轮升级 `run-20261025-175223-de0b95`（坏补丁连续两轮失败后停止升级，exit 1，不无限重试）。
> 测试 **35/35**（M0 的 30 条 + `tests/unit/code-loop.test.mjs` 5 条，含 Windows CRLF 补丁归一化回归）；`npm run lint` /
> `npm run check` / `npm run check:secrets` 通过。Windows CI 的 `*.patch` CRLF 问题已修复
> （提交 `b4ed316`：`.gitattributes` 全仓 `eol=lf` + `patch.ts` 归一化 CRLF + CRLF 回归测试）。证据：
> `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
> `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件：A2 / A4 / A5 三组截图与日志，已脱敏）。
>
> **M2 验收结论（2026-10-25）**：A3 / A8 / A9 通过（本机真实 Windows 桌面会话，`npm run acceptance:m2` OK；
> build + **53/53** 测试 + 桌面流程 + 停止键/检查点 + 隔离自检全部 ✅）。A3 真实桌面
> `run-20261025-185100-6a4d70`：真实 Windows 窗口 + 真实键鼠（SendInput）完成
> 打开→填表→保存→校验→截图，36/36 检查通过、20 张逐步截图、`project.json` 内容核对通过；
> A8 停止键实测 **305ms**（<5000ms），runtime 集成测试证明运行中停止可抢占，检查点 resume 跳过已完成
> 步骤、不重复执行；A9 跨分支凭据不可读（`CrossBranchAccessError`）、同一 profile 不能并发占用
> （`ProfileBusyError`）、白名单外工具拒绝。测试 **53/53**（M1 的 35 条 + `m2-safety` 14 条 +
> `m2-runtime` 4 条）；CLI 现为 **11 个已实现命令 + 2 个占位**（新增 `desktop-flow`、`safety-check`、
> `run --resume`）。证据：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
> `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件：A3 截图与结果、A8/A9 自检结果、
> 测试日志，已脱敏）。
>
> **M3 验收结论（2026-10-25）**：A7 通过（本机 fixture 驱动 Scout 运行，无网络外联，
> `npm run acceptance:m3` OK，**12/12 检查全 ✅**）。Scout run `run-20261025-200457-17b4e7`：
> fixtures **14 条**线索 → 丢弃 **4**（缺 `source_url` / 非法 URL / 空 `consent_basis` / 重复各 1）
> → 通过来源硬校验 10 条、其中 **8** 条达到默认 0.5 合格阈值 → **3 条外联草稿**（110–113 字，均
> ≤150 字且引用具体信号）→ 审批队列 **3 条全部 `pending`**、**0 发送**；ICP + **3 个高价值场景**；
> 丢弃原因全部留证。测试 **74/74**（M2 的 53 条 + `tests/unit/scout.test.mjs` 21 条）；CLI 现为
> **12 个已实现命令 + 2 个占位**（新增 `scout`）。证据：
> `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
> `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`（15 文件：scout-run 证据 + `unit-tests.log`，
> 已脱敏）。
>
> **M4 验收结论（2026-10-25，阶段一收尾）**：A10 / A11 / A12 通过，`npm run acceptance:m4` OK。
> A10：`steward dummy-branch --json` 只读 dummy 分支（`role=dummy`、`tools=[echo]`、复用
> `reviewer@1.0.0` 提示词，核心 runtime/CLI 分支机制未改动）；A11：发布就绪检查全部通过
> （CC BY-NC-SA 4.0 许可证全文 + 非商用条款、NOTICE 第三方声明、COMMERCIAL 商用说明、中英双语文档
> 配对、源码无遥测、`package.json` 与 CLI `VERSION` 均为 **0.5.0**、发布文档齐全）；A12：提示词版本化
> 与测试不变。测试 **80/80**（M1–M3 的 74 条 + `tests/unit/m4-release.test.mjs` 6 条，共 12 个测试文件）；
> CLI 现为 **13 个已实现命令 + 2 个占位**（M4 新增 `dummy-branch`）。CI #10 在 Windows + Ubuntu 全绿。
> 证据：`docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `evidence-m4-<stamp>/`（由
> `npm run acceptance:m4` 生成、已脱敏）。
>
> **阶段一验收结论（2026-10-25，v0.5.0）**：**A1–A12 全部通过**，阶段一（M0–M4）完成并发布
> **v0.5.0**。交付物：Operator（真实浏览器 A2/A4/A5 + 真实 Windows 桌面 A3）、Harness 编码回路、
> Scout 客户分支（A7，只起草不发送）、安全三模块（A8/A9）、prompts v1（A12）、只读 dummy 分支
> （A10）、发布就绪（A11）；**80/80** 测试、**13 命令 + 2 占位**、双语文档与证据体系齐全。
> 证据索引：M0 `docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}`；M1/M2/M3 acceptance
> 证据包（见上）；M4 `m4-acceptance-*` + `evidence-m4-*`。发布说明
> `docs/RELEASE_NOTES_v0.5.0.md`，3 分钟演示 `docs/demo-script.zh-CN.md` / `docs/demo-script.md`，
> Good First Issues `docs/good-first-issues.md`。
>
> **P1 验收结论（2026-10-25，阶段二个人版 MVP，v0.6.0）**：B1 / B2 / B5 / B6 / B7 通过，
> `npm run acceptance:p1` OK（**12/12 检查全 ✅**；build + **113/113** 测试 + 阶段二业务 + 控制台 E2E）。
> B1 选题：3 条候选业务线（来源 URL 可查）+ 提案；B2 账本 2 笔、6 要素全齐；B5 承诺授权链 3 段
> （对话原文→委托条款→项目，未记录=未授权）；B6 接管 `stop_ms=3`（≤10000）且 6 类接管包（含凭据引用）；
> B7 18 条个人模式边界规则、四类越界 4/4 拒绝（deny）、支付→human、报价→draft_only。真实浏览器
> （有头 Chrome）：控制台 E2E **9 步 / 73 项检查 / 9 张截图**，浏览器实测接管停止 **88ms**；
> CLI 控制台真实浏览器打开（看板 + 账本 6 要素，`console-cli/ledger.png`）；审批/接管命令人工批准生效；
> 月报 收入 ¥20000 / 成本 ¥0 / 毛利 ¥20000 / 预算余 ¥50000。测试 **113/113**（阶段一 80 +
> domain 30 + phase2-cli 3，共 14 个测试文件）；CLI 现为 **18 个已实现命令 + 0 个占位**（新增
> `business`、`boundary-check`、`console`、`approve`、`takeover`）。**B3（断网 2h）/ B4（封号 15min）
> → P2 故障演练；B8（个人/企业双模式）→ P3 企业版**。证据：
> `docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
> `docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`（39 文件：business-run / boundary-run /
> console-e2e / console-cli / takeover-result / unit-tests.log，已脱敏）。
>
> **P2 验收结论（2026-10-26，故障演练，完成：短跑 + 真实长跑均通过）**：`npm run acceptance:p2` 短跑
> **11/11 检查 ✅**（build + 133/133 测试 + B3/B4 演练）；短跑：B3 断网 `outage=120007ms`、25 次承诺被拒、
> 25 条排队/重放、重复 0；B4 封禁 11ms 检测、替代方案 5 条、通知留痕。**真实长跑（`npm run drill:long`，
> 真实时长不加速）**：**B3 断网 120 分钟（7215 秒）** → **1435 次承诺被拒、0 新增**、1435 条动作入
> Outbox、恢复后**全部补记**、**`duplicates_found=0`**、二次对账 `entries_added=0`；**B4 封禁
> 15 分钟（900 秒）** → **9ms 检测**、**180 次尝试 0 成功**、停止动作 + 5 条替代方案 + 通知、解禁恢复。
> 证据：短跑 `docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.{md,json}` +
> `evidence-p2-2026-10-25_15-02-52/`（10 文件）；长跑
> `docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` +
> `docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/`（11 文件，已脱敏）。**B3/B4 通过 → B1–B8
> 全部通过；P2/P3 已合并发布 v0.8.0。**
>
> **P3 验收结论（2026-10-25，企业版，v0.8.0 已发布）**：**B8 通过**，`npm run acceptance:p3` OK
> （**12/12 检查全 ✅**；build + **151/151** 测试 + 企业版流程）。B8：个人/企业双模式各跑一单，
> 主体/抬头/收款/发票类型一致（subject/invoice/payment consistent=true），**6 类不一致全部阻断**
> （阻断时不产生发票/收款）；**30 条边界双模式标注表**（个人/企业 × 已实现/人工/不适用；四类重点
> 越界 EB-01/02/03/04 双模式 deny）；双人复核（1 人 `applied=false`、2 位不同角色 `applied=true`）；
> 用印 **`ai_may_sign=false`**（仅自然人签署）；专票校验（抬头/税号/合同一致）→ `draft_pending_human`；
> 申报草稿 `ai_may_submit=false`；组织审批链 **1/2/3 级**（3000/20000/80000）；用工/资质类转人工；
> 企业 fixtures 8 条（2 正常 + 6 不一致）交叉验证 8/8；企业 run `run-20261025-232357-2ce6f6`。
> 测试 **151/151**（P1 113 + fault 20 + enterprise 18，共 16 个测试文件）；CLI 现为 **19 个已实现
> 命令 + 0 个占位**（P2 新增 `fault-drill`、P3 新增 `enterprise-demo`）。边界表全文与已知限制见
> `docs/zh-CN/enterprise.md` / `docs/en/enterprise.md`；证据：
> `docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.{md,json}` +
> `docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`（18 文件：enterprise-run 的
> profile/entity/seal/dual-review/invoice/org-approval/dual-mode-orders/boundary-table/fixture-checks +
> `unit-tests.log`，已脱敏）。
>
> **P4 验收结论（2026-10-26，最终发布，v1.0.0）**：**v1.0.0 已公开发布**（
> [GitHub Release](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0)，Latest，tag 指向
> 提交 `1e3b89f`，名称「v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete」，非 draft/prerelease）。
> 发布内容：版本 **1.0.0**（package.json/CLI 同步）、**151/151** 测试（16 文件）、**19 业务命令 +
> `help`**、阶段一 **A1–A12** 与阶段二 **B1–B8 全部通过**、中英双语文档、CC BY-NC-SA 4.0 许可证、
> 完整证据归档；**真实截图宣传片 3 个 Release Assets**（`daizhang-steward-promo-v1.0-bgm.mp4`
> 12,947,989 B / `daizhang-steward-promo-v1.0-silent.mp4` 10,169,266 B / `daizhang-steward-promo-v1.0-poster.jpg`
> 85,200 B；110s / 1280×720 / 30fps，HyperFrames + 代码合成 BGM，素材为真实 E2E 截图，
> `hyperframes check` ok:true、WCAG AA 对比度 45/45）；工程与分镜 `docs/media/promo/`。发布验证
> `docs/test-evidence/release-v1.0.0-check.md` + `docs/images/release-v1.0.0.png`（API + 真实浏览器双通道，
> 3 个资产 state=uploaded 且大小/SHA256 一致）。**两阶段交付完成。**
>
> **后续可选扩展（不属于 v1.0.0 交付范围，未来按需推进）**：通知通道（Toast/邮件/Webhook）、
> IoT 适配器（stub）、MCP server、真实 DSH/DeepSeek Harness 接入、真实银行/税务/CA/电子签章系统对接、
> 企业专属 UI、强杀恢复/72h 失联/循环超限等扩展故障演练。

## 每个里程碑的 Definition of Done

1. 对应验收条目**全部通过**，且有可打开的证据路径（截图/日志/回执/报告）。
2. `npm run lint && npm test` 绿；真实浏览器/桌面用例在本地 headed 模式下通过。
3. 文档同步更新（中英双语），CHANGELOG 记录。
4. Lead 复核 diff；一个里程碑一个 PR。
5. 向用户汇报：做了什么、证据在哪、没做什么、下一步。

## 阶段边界（必须显式降级，不能删边界）

- 支付/退款/合同/账号权限/批量外联/生产部署：默认拒绝或只出草稿。
- 验证码/2FA/人脸：停止交人，不绕过。
- 无资质业务、借用资质、陌生外呼、超预算：100% 拒绝并留痕。
- 个人/企业模式冲突（主体、抬头、收款、发票）：阻断并说明原因（P3 已实现 6 类阻断）。
- 企业版：AI 不代签（`ai_may_sign=false`）、不自动开票（仅草稿待人工）、不代提交申报、不自动变更账户；
  对公/专票/授权书人签/双人复核/组织审批链均由人完成。

## 额度与停止点策略

- 每个里程碑完成即汇报，等用户确认（或用户明确“连续做完阶段二”）。
- 阶段一完成 → 输出 HANDOFF → **结束会话**；阶段二在新会话从 HANDOFF 继续。
- 当前：**两阶段全部完成**——阶段一 v0.5.0、阶段二 v0.6.0（P1）/ v0.8.0（P2+P3）/ **v1.0.0（最终版，Latest）**；
  v1.0.0 之后仅按需做可选扩展。
- 重活交给子代理/Agent Teams，Lead 保留契约与最终验收。

_Last updated: 2026-10-26 (v1.0.0 released — two-phase delivery complete; optional future extensions only)._
