# 交付物与验收清单 / Delivery Checklist（中文）

> 每条验收 = 编号 + 命令/操作 + 证据路径 + 最近结果（证据必须能打开）。
> M0 完成后 A1 / A6 / A12 标记为 `通过`；其余条目随里程碑完成更新为 `通过 / 未通过 / 部分`。
> 最近一次更新：2026-10-25（M0 完成）

## A. 阶段一（文档 1，12 条）

| # | 验收 | 命令/操作 | 证据 | 状态 |
|---|---|---|---|---|
| A1 | 干净克隆可跑，无需付费 API | `npm install && npm run demo` | `runs/run-20261025-172017-eb9116/report.md` + `docs/test-evidence/test-result-2026-10-25_09-20-15.md`（MockHarness，无付费 API） | ✅ 通过（2026-10-25） |
| A2 | demo-web 登录/填表/提交/校验/截图 | `npm run test:e2e`（M1 实现） | `runs/<id>/screenshots/` | 未实现（M1） |
| A3 | demo-desktop 打开/填表/保存/校验/截图 | `npm run test:desktop`（M2 实现） | `runs/<id>/screenshots/` | 未实现（M2） |
| A4 | 预置缺陷 → CodeTask → 补丁 → 应用 → 测试通过 | `npm run demo:code-loop`（M1 实现） | `runs/<id>/code-task.json` 等 | 未实现（M1；M0 已有 MockHarness 骨架） |
| A5 | 连续失败两次 → 升级，无无限循环 | 同上（注入失败） | 两轮日志 + 升级事件 | 未实现（M1） |
| A6 | 每次运行有 prompt/patch/test.log/截图/report 且无密钥 | `npm run demo` + `npm run evidence` | `runs/run-20261025-172017-eb9116/`：`prompt.md` / `patch.diff` / `test.log` / `report.md` / `events.jsonl` / `console.log` / `meta.json` / `code-task.json` / `code-result.json` / `goal.md`；索引 `docs/test-evidence/test-result-2026-10-25_09-20-15.{md,json}` | ✅ 通过（2026-10-25；真实 UI 截图随 M1 补齐） |
| A7 | Scout ≥10 线索（来源+评分），3 条草稿未发送 | `npm run demo:scout`（M3 实现） | `scout-report.md` + 审批队列 | 未实现（M3） |
| A8 | 停止键 5 秒；重启恢复不重复 | `npm run test:stop`（M2 实现） | 停止事件 + 恢复日志 | 未实现（M2；M0 有 StopSignal 最小实现） |
| A9 | 分支隔离（凭据/浏览器配置） | `npm run test:isolation`（M2 实现） | 隔离用例 + events | 未实现（M2） |
| A10 | 新增只读 dummy 分支只靠配置 | `npm run demo:dummy-branch`（M4 实现） | 配置 + 报告 | 未实现（M4） |
| A11 | 测试/lint/文档/许可证齐全、无遥测 | `npm run lint && npm test` | CI 日志 | 未实现（M4 全量验收；M0 已满足 lint / build / 30 测试） |
| A12 | 提示词版本化、有测试、可替换 | `npm run test:prompts` | `prompts/manifest.json`（4 角色 + sha256）+ `tests/unit/prompts.test.mjs`（5 项断言） | ✅ 通过（2026-10-25） |

> **M0 验收结论（2026-10-25）**：A1 / A6 / A12 通过。`npm run check`、`npm run check:secrets`、
> `npm test`（30/30）、`npm run demo`、`npm run evidence` 全部退出码 0；证据文件由
> `npm run evidence` 自动生成，不手工编辑。

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
