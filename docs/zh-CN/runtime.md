# 实时自动执行（v1.4）

> 解决「发消息之后为什么不实时处理、为什么还要手动点执行」：从 v1.4 起，**发送目标 = 立即创建 Run 并自动执行**，全程实时事件流；只有高风险/危险动作才暂停等你确认。

## 1. 发送即执行

- 控制台 `/chat`：输入目标 → 发送 → **自动** 生成计划 → 自动派发 → 自动执行 → 自动验收；**不需要点「开始执行」**。
- CLI：`steward runtime --goal "帮我写一个简单方案"` 一条命令自动跑完（无需人工点执行）。
- 完成后给出：交付物路径 + 证据 + 每轮摘要 + Token 消耗 + 状态。

## 2. 实时事件流（SSE）

控制台页面通过 `GET /api/chat/runs/:id/stream?since=<seq>` 订阅（Server-Sent Events），实时显示：

| 事件 | 含义 |
|---|---|
| `run.queued` / `run.started` | 排队 / 开始执行 |
| `plan.generating` | 总调度思考中（生成计划） |
| `plan.ready` | 计划就绪（逐步显示步骤） |
| `step.started` / `step.completed` | 步骤开始 / 完成 |
| `agent.turn` | 某个智能体的一轮完成（输入摘要 + 输出摘要 + Token + 模型来源） |
| `tool.called` / `tool.result` | 工具调用 / 结果 |
| `approval.required` | 高风险/危险动作，暂停等人工确认（附风险与摘要） |
| `run.paused` / `run.resumed` / `run.interrupted` | 暂停 / 恢复 / 打断 |
| `run.completed` / `run.blocked` / `run.failed` | 完成 / 阻塞 / 失败 |
| `token.updated` | Token 用量更新 |

- 每个事件有连续 `seq`，断线重连带 `since=最后序号` 自动补齐；刷新页面可恢复当前进度。
- CLI 实时打印同样事件：`steward runtime --action stream --run <id>`；`--json` 输出事件数组。

## 3. 审批策略（可配置）

控制台 `/settings` 或配置中心 `runtime` 设置：

| 配置 | 默认 | 含义 |
|---|---|---|
| `auto_run` | true | 发消息后自动执行 |
| `approval_mode` | `auto_low_risk` | `auto_low_risk`：仅高风险/危险动作暂停；`auto_all`：全自动；`manual`：需人工逐步确认 |
| `full_auto` | false | 完全自动开关（除破坏性动作外全自动） |
| `max_auto_steps` | 20 | 单 Run 自动执行步骤上限（安全阀） |
| `rework_limit` | 1 | 失败/阻塞时自动重新规划返工次数 |
| `event_retention` | 1000 | 每个 Run 保留事件数 |

**危险动作永远需要人工确认**（删除程序/插件、破坏性文件操作等），自动模式也不会绕过；审批超时挂起，不自动放行。

## 4. 运行管理

- `/chat` 顶部：Run 状态（排队/思考中/执行中/等待审批/完成/失败）、进度、Token。
- 可随时 **打断 / 暂停 / 恢复**；审批卡可 **批准 / 驳回**。
- `/runs/:id`：实时时间线 + 证据（截图/报告/日志）。
- CLI：

```bash
steward runtime --goal "帮我做一个报价单页面"            # 发送即执行（自动跑完）
steward runtime --goal "..." --manual                    # 仅创建不自动跑
steward runtime --action list
steward runtime --action status --run <id>
steward runtime --action stream --run <id>               # 实时事件
steward runtime --action approve --run <id> --step 3
steward runtime --action reject  --run <id> --step 3
steward runtime --action interrupt --run <id>
steward runtime --action resume --run <id>
```

## 5. 并发与恢复

- 默认最多 **3 个 Run 并行**，超出自动排队。
- 刷新/断线：`subscribeRun(runId, fn, sinceSeq)` 先回放事件再实时；页面恢复当前进度。
- 进程重启：未完成 Run 标记为 `paused`（防止无人值守重复执行危险动作），执行 `resume` 继续。
- 事件保留 `event_retention` 条，超出后旧事件不可回放（可从 Run 记录/证据重建视图）。

## 6. 架构

```
控制台 /chat ──POST /api/chat/runs──▶ RunManager（steward-runtime）
     ▲                                     │ createRun → 自动执行循环
     │  EventSource(SSE)                   ▼
     └──── /api/chat/runs/:id/stream ── OrchestratorEngine（conductor/agents/工具）
                                          │
                                          └─ 事件/证据持久化（runs/ + .steward/runtime/）
```

- 真实模型：OpenAI 兼容适配器（DeepSeek）；无 key/失败时本地回退并明确标注 `local_fallback`。
- 危险动作：SystemController 二次确认 + 回收站备份 + 审计（见 `docs/zh-CN/system.md`）。

## 7. 安全边界

- 自动执行 ≠ 无限制：预算/Token 上限、单 Run 步骤上限、审批策略三层保护。
- 危险动作（删除程序/插件、破坏性文件操作、对外付款等）必须人工二次确认；自动模式不绕过。
- 所有事件/动作/审批写审计；本地单机、只监听 `127.0.0.1`。
