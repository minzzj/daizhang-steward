# Roadmap / 路线图

> 本文件是**批准门**与**停止点**的唯一事实来源。每个里程碑必须先通过验收、附证据、经用户确认，
> 才进入下一个。**任何里程碑不通过验收，不进入下一里程碑。**

## 总览

| 阶段 | 里程碑 | 内容 | 验收（见 docs/*/delivery-checklist.md） | 状态 |
|---|---|---|---|---|
| 0 | S0 脚手架 | 仓库、许可证、治理文件、双语文档骨架、CI 自检、目标与路线图 | `npm run check` 绿、CI 绿 | ✅ 完成（2026-10-25，GitHub 仓库已发布） |
| 1 | M0 骨架 | 内核最小闭环：AgentRuntime/BranchSpec/PolicyEngine/ArtifactBus/PromptManager/EventLog/BudgetGuard/StopSignal；CLI（7 命令 + 2 占位）；MockHarness；demo-web/demo-desktop；prompts v1；单包构建；CI | A1、A6、A12 | ✅ 完成（2026-10-25；A1/A6/A12 通过，证据 `runs/run-20261025-172017-eb9116/` + `docs/test-evidence/test-result-2026-10-25_09-20-15.md`） |
| 1 | M1 浏览器回路 | Playwright Operator；CodeTask→CodeResult→补丁→测试；失败两轮升级 | A2、A4、A5、A6 | ⏳ 下一步 |
| 1 | M2 桌面与安全 | Windows 桌面适配器；PolicyEngine；停止键；审计；检查点恢复；分支隔离 | A3、A8、A9 | ⏳ |
| 1 | M3 客户分支 | Scout：ICP、来源清单、评分、外联草稿、审批队列、ScoutReport | A7 | ⏳ |
| 1 | M4 开源发布 | 双语文档、LICENSE 校验、CI、Release、5 个 good-first-issue、3 分钟演示 | A10、A11、A12 | ⏳ |
| — | **阶段一停止点** | 输出 `HANDOFF.md`，**结束会话省额度**（按用户要求），等待阶段二启动 | 用户确认 | ⏳ |
| 2 | P1 个人版 MVP | 经营域（委托/预算/项目/任务/代理/证据/账本/墓碑）、五能力、控制台、审批、接管、月报 | B1、B2、B5、B6、B7 | ⏳ |
| 2 | P2 个人版故障 | 断网 2h、强杀恢复、封号模拟、72h 失联、循环超限 | B3、B4 | ⏳ |
| 2 | P3 企业版 | 对公/专票/授权书用印/多账号串行/用工资质转人工/模式一致性；30 条边界表 | B8 + 边界 100% 拒绝 | ⏳ |
| 2 | P4 发布与宣传片 | v1.0.0、GitHub Release、验收包、真实截图宣传片（BGM+静音） | 全部证据 + 用户确认 | ⏳ |

> **M0 验收结论（2026-10-25）**：A1 / A6 / A12 通过；`npm run check`、`npm run check:secrets`、
> `npm test`（30/30）、`npm run demo`、`npm run evidence` 全部退出码 0。证据：
> `runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md / events.jsonl /
> code-task.json / code-result.json）、`docs/test-evidence/test-result-2026-10-25_09-20-15.{md,json}`、
> `prompts/manifest.json`（4 角色 sha256 校验）。
>
> 公开仓库：https://github.com/minzzj/daizhang-steward（2026-10-25 创建；发布验证见
> `docs/test-evidence/2026-10-25-repo-publish.md`）。开发遵循“先契约后实现、每个里程碑一个 PR、
> 真实浏览器/真实桌面取证”。

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

_Last updated: 2026-10-25 (M0 complete)._
