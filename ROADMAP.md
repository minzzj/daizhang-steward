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
| 1 | M4 开源发布 | 双语文档、LICENSE 校验、CI、Release、5 个 good-first-issue、3 分钟演示 | A10、A11、A12 | ✅ 完成（2026-10-25；阶段一收尾，**v0.5.0 已发布**；`npm run acceptance:m4` OK；证据 `docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `evidence-m4-<stamp>/`；Release https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0） |
| — | **阶段一停止点** | 输出 `HANDOFF.md`，**结束会话省额度**（按用户要求），等待阶段二启动 | 用户确认 | ✅ 完成（2026-10-25 v0.5.0 发布；HANDOFF 已更新，等待阶段二启动） |
| 2 | P1 个人版 MVP | 经营域（委托/预算/项目/任务/代理/证据/账本/墓碑）、五能力、控制台、审批、接管、月报 | B1、B2、B5、B6、B7 | ⏳ 下一步（阶段二第一步） |
| 2 | P2 个人版故障 | 断网 2h、强杀恢复、封号模拟、72h 失联、循环超限 | B3、B4 | ⏳ |
| 2 | P3 企业版 | 对公/专票/授权书用印/多账号串行/用工资质转人工/模式一致性；30 条边界表 | B8 + 边界 100% 拒绝 | ⏳ |
| 2 | P4 发布与宣传片 | v1.0.0、GitHub Release、验收包、真实截图宣传片（BGM+静音） | 全部证据 + 用户确认 | ⏳ |

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
> Good First Issues `docs/good-first-issues.md`。下一步：阶段二 P1 个人版 MVP。

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
- 个人/企业模式冲突（主体、抬头、收款、发票）：阻断并说明原因。

## 额度与停止点策略

- 每个里程碑完成即汇报，等用户确认（或用户明确“连续做完阶段一”）。
- 阶段一完成 → 输出 HANDOFF → **结束会话**；阶段二在新会话从 HANDOFF 继续。
- 重活交给子代理/Agent Teams，Lead 保留契约与最终验收。

_Last updated: 2026-10-25 (Phase 1 complete — v0.5.0 released; next milestone: Phase 2 P1 personal-edition MVP)._
