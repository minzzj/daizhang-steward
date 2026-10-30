# @daizhang/steward-chat · 对话式 AI 总控内核（v1.5.1-A）

> 状态：**已实现**。用户诉求：像 ChatGPT 一样和「AI 总控」对话，一个入口控制全部——
> 用户发一句话，AI **自己查系统**（系统/运行/产物/报告/日志/配置/账本/智能体/metrics）、
> **自己干**（小任务走真实 DSH harness、项目类交项目执行器）、**危险动作只返回审批卡**；
> 有**长期记忆**与**多会话历史**；简单查询走规则回答（**0 token**），只有任务才用 harness。
>
> 过程（思考/工具调用/产物/报告/数据/审批卡）全部以**内嵌卡片**出现在同一条对话消息里，不需要跳页。
> 零第三方依赖；数据工具 `ChatTools` 由控制台/CLI 注入，测试用 fake。

## 1. 对话流程

```
用户：「帮我做一个报价页面项目」
        │
        ▼  classifyIntent（规则，0 token，18 类）
 ┌─────────────── ChatEngine.send ───────────────┐
 │ 1) 保存 user 消息（含标题自动生成=前 20 字）    │
 │ 2) memoryRecall 召回相关长期记忆（≤5 条）      │
 │ 3) 意图路由：                                   │
 │    · 查询类 → ChatTools 只读工具 → text+卡片    │
 │    · execute_goal → tools.executeGoal(goal,onPart) │
 │      onPart 实时写回 assistant parts（流式）    │
 │    · harness_task → tools.harnessTask(task,onPart) │
 │    · danger_action → tools.systemActionPreview → 审批卡 │
 │    · approve → tools.approve(run,step,决策)     │
 │    · memory/chat → 0 token 规则回答 + 建议      │
 │ 4) 抽取长期记忆（偏好/项目/决策/run/产物/报告）│
 │ 5) assistant 消息落盘（status done/error）      │
 └──────────────────────┬────────────────────────┘
                        ▼
     同一条对话内嵌卡片：text / thinking / tool_call / tool_result /
     artifact / report / data / approval / markdown / error
```

关键点：**用户只说一句话**；不需要知道页面在哪——AI 自己决定查还是干；危险动作永远只给审批卡。

## 2. 文件结构

```
packages/steward-chat/
├── src/
│   ├── types.ts   # 契约（ChatPart/ChatMessage/ChatTools/ChatEngineOptions…）
│   ├── errors.ts  # ChatError（INVALID_INPUT/NOT_FOUND/CONFIG）
│   ├── intent.ts  # 18 类意图规则 + 实体抽取（run/step/artifact/report/decision/action/target）
│   ├── memory.ts  # 记忆召回（中文 bigram/相关度）与自动抽取
│   ├── store.ts   # ChatStore：会话/消息/记忆 JSON 原子持久化
│   ├── engine.ts  # ChatEngine：路由/查询卡片/任务流式/审批/记忆/多会话
│   └── index.ts
└── README.md
```

## 3. 意图表（18 类，规则、0 token）

| 意图 | 触发示例 | 行为 |
|---|---|---|
| `system` | 查看系统状态 | `tools.systemSummary()` → 系统卡片 |
| `runs` | 列出最近的运行 | `tools.listRuns(10)` → run 列表卡片 |
| `run_detail` | 看看 run-demo-1 的详情 | `tools.runDetail(runId)` |
| `artifacts` | 列出所有产物 | `tools.listArtifacts()` → artifact 卡片 |
| `artifact_preview` | 预览产物 art-1 | `tools.artifactPreview(id)` |
| `reports` | 有哪些报告 | `tools.listReports()` |
| `report_content` | 打开报告 rep-1 的内容 | `tools.reportContent(id)` → report 卡片（markdown） |
| `metrics` | token 用量多少 | `tools.runMetrics()` |
| `logs` | 看看最近日志 | `tools.readLogs(20)` |
| `config` | 当前配置是什么 | `tools.configSummary()`（密钥脱敏） |
| `ledger` | 账本余额 | `tools.ledgerSummary()` |
| `agents` | 智能体列表 | `tools.agentsSummary()` |
| `execute_goal` | 帮我做一个报价页面项目 | `tools.executeGoal(goal,onPart)`（项目执行器，实时卡片） |
| `harness_task` | 写个 plan.md 文件 | `tools.harnessTask(task,onPart)`（真实 DSH harness；`dshEnabled=false` 时提示不可用） |
| `approve` | 批准 run-demo-1 第 2 步 / 驳回 … | `tools.approve(runId,step,decision)` |
| `danger_action` | 删除程序 demo-app / 付款给客户 | **只** `tools.systemActionPreview()` → 审批卡，**绝不执行** |
| `chat` | 今天天气怎么样 | 闲聊兜底 + 可操作建议（不调模型、不调工具） |
| `memory` | 记住我的偏好是… / 你还记得我的偏好吗 | 写入/检索长期记忆（data 卡片） |

优先级：记忆 > 审批 > 危险动作 > 报告内容 > 产物预览 > 报告 > 指标 > 日志 > 配置 > 账本 >
智能体 > 系统 > 产物 > run 详情 > run 列表 > 项目执行 > harness 小任务 > 闲聊。
实体抽取：`run-[id]`、`第 N 步`、`art-[id]`、`rep-[id]`、批准/驳回、危险动作+目标。

## 4. 卡片类型（同一条消息内嵌，无需跳页）

| type | 用途 | 关键字段 |
|---|---|---|
| `text` | 对话文字回答/总结 | `text` |
| `markdown` | 建议、说明 | `markdown, title?` |
| `thinking` | 思考过程（可折叠） | `text, collapsed?` |
| `tool_call` | AI 正在调用什么 | `tool, input, status?` |
| `tool_result` | 工具结果摘要 | `tool, ok, summary, data?` |
| `artifact` | 产物卡片（可预览/下载） | `id, title, kind, size, preview_url?, download_url?, preview_text?, run_id?, agent_role?, step?` |
| `report` | 报告卡片（全文 markdown） | `id, title, markdown, created_at, run_id?, agent_role?` |
| `data` | 结构化数据卡片 | `title, items[{label,value}]` |
| `approval` | 审批卡（人工确认/签字） | `run_id, step, risk, summary, reason?, expires_at?` |
| `error` | 可读错误 | `message` |

消息字段：`status: streaming|done|error`、`model_mode: rule|harness|local_fallback|remote`
（查询/闲聊=`rule`，DSH 任务=`harness`，项目执行=`local_fallback`）。

## 5. 记忆模型

- 种类 `kind`：`preference`（偏好）、`project`（项目事实）、`decision`（决策）、`run`（run 摘要）、
  `artifact`（产物引用）、`report`（报告引用）、`note`。
- 重要度 `importance: 1|2|3`；`tags[]`；`created_at`；`source`（user_explicit/execute_goal/harness_task/conversation）。
- 自动抽取：`记住/我的偏好是/以后请`→preference；`决定/同意/选择`→decision；项目类任务→project；
  execute_goal 结果→run（含 run_id + 摘要）；harness 任务→run；产物/报告卡片→artifact/report。
- 去重：同内容（规范化后大小写不敏感）不重复，合并 tags、取更高 important。
- 上限：`maxMemoryEntries`（默认 200），超出丢弃低重要度最旧条目。
- 召回：`memoryRecall(query, 5)` → 中文 bigram + 拉丁词相关度，按 相关度 → 重要度 → 时间排序；
  查询/任务/闲聊回复前注入卡片（`data` 卡「参考的记忆」）。
- 查看/搜索/删除：`listMemory({query, kind, limit})` / `deleteMemory(id)`；持久化在 `<root>/memory.json`。

## 6. 多会话

`createConversation(title?)`、`listConversations()`（按 updated_at 倒序）、`getConversation(id)`（含 messages+memories）、
`renameConversation(id,title)`、`deleteConversation(id)`；标题自动取首条用户消息前 20 字；消息 `message_count/last_message`
自动维护。持久化：`<root>/index.json`、`<root>/conversations/<id>.json`、`<root>/memory.json`（均 tmp+rename 原子写）。

## 7. 与真实 providers 对接（Lead 实现 ChatTools 清单）

```ts
import { ChatEngine, type ChatTools } from "../../packages/steward-chat/src/index.js";
import { RunManager } from "../../packages/steward-runtime/src/index.js";
import { HarnessAgentRunner } from "../../packages/steward-harness-runtime/src/index.js";

const tools: ChatTools = {
  // ---- 只读查询：全部是 0 token（直接读本地引擎/文件） ----
  systemSummary: async () => ({ tool: "systemSummary", ok: true, summary: `系统正常：${runningApps} 个程序运行中`,
    parts: [{ type: "data", data: { title: "系统状态", items: [{ label: "程序", value: `${running} 运行` }, { label: "插件", value: `${plugins} 启用` }] } }] }),
  listRuns: async (limit = 10) => {
    const runs = manager.listRuns().slice(0, limit);
    return { tool: "listRuns", ok: true, summary: `最近 ${runs.length} 个 run`,
      parts: [{ type: "data", data: { title: "Run 列表", items: runs.map((r) => ({ label: r.run_id, value: `${r.status} · ${r.steps_done}/${r.steps_total} 步` })) } }] };
  },
  runDetail: async (runId) => { const run = manager.getRun(runId!); /* + eventLog */ ... },
  listArtifacts: async (query) => {
    // 复用 harness-runtime 的产物信息：<evidence>/steps/<n>/ 下文件 → classifyArtifactKind + sha256
    const files = collectArtifactFiles(query);
    return { tool: "listArtifacts", ok: true, summary: `找到 ${files.length} 个产物`,
      parts: files.map((file) => ({ type: "artifact", artifact: { id: file.id, title: file.name, kind: file.kind, size: file.size, run_id: file.run_id, preview_url: `/api/artifacts/${file.id}` } })) };
  },
  artifactPreview: async (id) => ({ /* 读取内容 → preview_text / preview_url */ }),
  listReports: async (query) => { /* 扫描 <evidence>/report.md 与 harness 报告 */ },
  reportContent: async (id) => ({ tool: "reportContent", ok: true, summary: "报告已加载",
    parts: [{ type: "report", report: { id, title, markdown, created_at } }] }),
  runMetrics: async (runId) => { /* manager.getRun + eventLog 的 token.updated 汇总 */ },
  readLogs: async (limit = 20) => { /* orchestrator.auditLog()/readLogs() 尾部 */ },
  configSummary: async () => { /* ConfigEngine.load() 的脱敏子集（不输出 key） */ },
  ledgerSummary: async () => { /* MoneyEngine 收款/支出 + epay 状态 */ },
  agentsSummary: async () => { /* ConfigEngine.listAgents() + 模型（key 脱敏为 has_key） */ },

  // ---- 任务类：实时 onPart（流式写回对话） ----
  executeGoal: async (goal, onPart) => {
    const run = await manager.createRun({ goal });
    // RunManager 事件 → ChatPart
    const off = manager.subscribeRun(run.run_id, (event) => {
      switch (event.type) {
        case "plan.generating": onPart({ type: "thinking", text: "项目总调度正在生成计划…" }); break;
        case "plan.ready": onPart({ type: "data", data: { title: "执行计划", items: event.data.steps.map((s) => ({ label: `${s.step}. ${s.agent_role}`, value: String(s.summary) })) } }); break;
        case "step.started": onPart({ type: "tool_call", tool: String(event.data.action), input: { step: event.data.step } }); break;
        case "step.completed": onPart({ type: "tool_result", tool: String(event.data.action), ok: event.data.status === "done", summary: `步骤 ${event.data.step} ${event.data.status}` }); break;
        case "agent.turn": onPart({ type: "thinking", text: String(event.data.output_summary) }); break;
        case "approval.required": onPart({ type: "approval", approval: { run_id: run.run_id, step: Number(event.data.step), risk: String(event.data.risk ?? "high"), summary: String(event.data.summary), reason: String(event.data.reason) } }); break;
        case "run.completed": onPart({ type: "text", text: `已完成 ${event.data.steps_done}/${event.data.steps_total} 步` }); break;
        default: break;
      }
    });
    const final = await manager.waitFor(run.run_id, ["done", "blocked", "failed", "awaiting_approval"], 30 * 60_000);
    off();
    return { ok: final.status === "done", run_id: run.run_id, session_id: run.session_id, summary: `项目${final.status}：${final.steps_done}/${final.steps_total} 步` };
  },
  harnessTask: async (task, onPart) => {
    const workspace = join(repoRoot, ".steward", "chat", "harness", `task-${Date.now()}`); mkdirSync(workspace, { recursive: true });
    const result = await harnessRunner.run({
      role: "operator", task, workspace_dir: workspace,
      system_prompt: "你是代掌的编码执行代理：真实执行、写文件、留证、最后中文总结。",
      timeout_ms: 300_000, max_output_bytes: 65_536,
      on_event: (event) => {
        switch (event.type) {
          case "thinking": onPart({ type: "thinking", text: String(event.data.text ?? "") }); break;
          case "tool_call": onPart({ type: "tool_call", tool: String(event.data.tool ?? "tool"), input: event.data.input ?? {} }); break;
          case "tool_result": onPart({ type: "tool_result", tool: "tool", ok: event.data.status === "completed", summary: String(event.data.result ?? "").slice(0, 300) }); break;
          case "final": onPart({ type: "text", text: String(event.data.text ?? "") }); break;
          default: break;
        }
      },
      on_usage: (usage) => onPart({ type: "data", data: { title: "Token", items: [{ label: "total", value: String(usage.total_tokens) }] } }),
    });
    for (const artifact of result.artifacts) {
      onPart({ type: "artifact", artifact: { id: artifact.sha256.slice(0, 12), title: artifact.rel_path, kind: artifact.kind, size: artifact.size, preview_text: undefined } });
    }
    if (result.report_path !== undefined) {
      onPart({ type: "report", report: { id: result.report_path, title: `${task.slice(0, 20)} · Harness 报告`, markdown: readFileSync(result.report_path, "utf8"), created_at: new Date().toISOString() } });
    }
    return { ok: result.ok, summary: result.ok ? result.final_text.slice(0, 300) : (result.error ?? "DSH harness 执行失败") };
  },

  // ---- 审批 / 危险动作 ----
  approve: async (runId, step, decision) => {
    await manager.approve(runId, step, decision, "human:chat");
    return { tool: "approve", ok: true, summary: `已${decision === "approve" ? "批准" : "驳回"} ${runId} 第 ${step} 步`,
      parts: [{ type: "data", data: { title: "审批结果", items: [{ label: "run", value: runId }, { label: "step", value: String(step) }] } }] };
  },
  systemActionPreview: async (action, target) => {
    // 只做 plan/preview，不 execute！审批卡给用户确认，签字后另行调用 system.execute(...)
    const plan = system.plan({ id: newActionRequestId(), action: mapAction(action), target, params: {}, reason: "chat 危险动作审批" });
    return { tool: "systemActionPreview", ok: true, summary: `${action} ${target ?? ""} 需要人工确认（风险 ${plan.risk}）`,
      parts: [{ type: "approval", approval: { run_id: `pending-${plan.confirmation_token ?? Date.now()}`, step: 1, risk: plan.risk, summary: plan.summary, reason: "高危/不可逆操作，需人工确认" } }] };
  },
};

const chat = new ChatEngine({ tools, root: join(repoRoot, ".steward", "chat"), dshEnabled: config.getSystemPolicy().dsh_enabled !== false });
```

### 控制台/CLI 接线

```ts
// 控制台（SSE 流式）：POST /api/chat/send { conversation_id, text }
//   → chat.send(conversationId, text, (part, message) => sse.write({ part, status: message.status }))
//   → 响应返回最终 assistantMessage（含全部卡片）
// 会话列表/新建/重命名/删除：chat.listConversations/createConversation/renameConversation/deleteConversation
// 记忆管理：chat.listMemory({query,kind}) / chat.deleteMemory(id)
// CLI：`steward ai "查一下系统状态"`、`steward ai --conversation <id> "写个 plan.md"`、`steward ai --history`
```

## 8. 成本控制（用户明确要求：简单查询不花 token）

| 场景 | 模型调用 | 说明 |
|---|---|---|
| 查询（系统/run/产物/报告/metrics/日志/配置/账本/智能体） | **0 token** | 规则意图 + 直接读本地数据工具 |
| 闲聊/建议 | **0 token** | 规则回复（可选注入 `polish` 才润色） |
| DSH 小任务 | 有 token | 由 `tools.harnessTask` 执行；应设 `timeout_ms`、`max_output_bytes`、token 上限 |
| 项目类 | 有 token | 由项目执行器（RunManager/Orchestrator）执行，遵循其预算/审批策略 |

`ChatEngine` 自身**从不调用模型**；`polish` 是可选注入（默认无）。任务超 token/超时由注入的 tools 实现返回
可读错误（`ok:false` + `error`/`summary`），ChatEngine 以 `error` 卡片展示。

## 9. 安全边界

1. **危险动作永不直接执行**：`danger_action` 只调 `systemActionPreview` 返回审批卡；真正执行必须人工
   批准后另行调用 `system.execute`（带 confirmation_token/备份）。测试断言 executeGoal/harnessTask/approve 均不被调用。
2. **审批是一等公民**：`approve` 只做 run 步骤的批准/驳回；危险动作审批卡由控制台渲染「确认签字」按钮。
3. **密钥不泄露**：`configSummary/agentsSummary` 必须脱敏（`has_key` 布尔而非 key）；记忆/对话不存密钥。
4. **工具白名单**：`ChatEngine` 只调用 `ChatTools` 的 16 个方法；不存在任意命令执行入口。
5. **本地数据**：会话/记忆写 `<root>` 下 JSON；无第三方依赖、无网络请求；harness 任务的网络调用由
   DSH 子进程（用户已配置的 provider）完成。
6. **人工签字才生效**：付款/删除等高危动作必须人工确认；本轮只需确认/签字，不需要导航。

## 10. 测试

```bash
npm run build
node --test tests/unit/chat.test.mjs        # 19 条，零网络/零真实模型（fake ChatTools + 临时目录）
node --test "tests/unit/*.test.mjs"        # 全量
```

覆盖：18 类意图分类、查询回复（摘要+内嵌卡片、model_mode=rule、0 模型调用）、12 个只读工具路由、
execute_goal 流式 onPart 顺序/卡片/run 记忆、harness 流式（model_mode=harness）、dshEnabled=false 提示、
危险动作只返回审批卡（不执行）、批准/驳回、审批信息缺失提示、记忆抽取/去重/召回/删除/上限/持久化、
多会话隔离/重命名/删除、标题前 20 字、空消息/不存在会话、持久化重载、未知问题建议、ChatStore 直接 API、
记忆召回纯函数。

## 11. 已知限制

- 意图识别为**规则分类**（覆盖 18 类常见中文句式）；更复杂的自然语言可后续加 LLM 分类（会增加 token），
  当前设计优先「0 token 简单查询」。
- 查询类回复不含模型润色（默认 0 token）；需要自然语言更顺时可注入 `polish`（会花 token）。
- `execute_goal`/`harness_task` 的实时流式质量取决于注入的 tools 实现（是否按事件回调 onPart）。
- 危险动作审批卡与真实执行之间的「确认签字」流程由控制台 UI 完成（本包只负责返回审批卡与审批 API）。
- 记忆为本地关键词召回（中文 bigram），语义等价改写（如「回复短点」vs「简洁」）可能召不回；可后续加向量召回。
