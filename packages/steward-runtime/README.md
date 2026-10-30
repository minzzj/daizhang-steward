# @daizhang/steward-runtime · 实时自动执行内核（v1.4-A）

> 状态：**已实现**。解决的问题：**「发消息之后不实时、还要手动点执行」** ——
> `createRun()` 一调用就自动 `sendMessage → startProject → 循环 runStep` 执行到完成（或按审批策略暂停等人工），
> 同时把 `run/plan/step/agent.turn/tool/token/approval/completed` 事件实时推给订阅者（SSE / 终端流式）。
>
> 零第三方依赖；纯逻辑 + JSON 持久化；**不发起任何网络请求**。与 `steward-orchestrator` 解耦（依赖注入端口）。

## 1. 一键自动执行（核心）

```
用户发消息 / 新建项目
        │  createRun({ goal })
        ▼
 ┌──────────────── RunManager ─────────────────┐
 │ 1) queued → 调度槽（maxConcurrentRuns=3）    │
 │ 2) sendMessage(goal) → 计划（模型/本地回退） │
 │ 3) startProject → 循环 runStep 直到：        │
 │    done / blocked / failed / paused /        │
 │    awaiting_approval / interrupted           │
 │ 4) 每步前后 + 每轮 agent.turn + token 事件    │
 └──────────────┬──────────────────────────────┘
                │ subscribeRun / subscribeAll（sinceSeq 回放 + 实时）
                ▼
        SSE  /api/chat/runs/:id/stream?since=<seq>  /  终端流式  /  控制台时间线
```

**无需任何「开始执行」按钮**：`createRun` 返回后自动运行；调用方可以立刻订阅事件流并渲染进度。

## 2. 文件结构

```
packages/steward-runtime/
├── src/
│   ├── types.ts    # 契约（RunRecord/RuntimeEvent/RuntimeSettingsView/OrchestratorRuntimePort…）
│   ├── errors.ts   # RuntimeValidationError / RuntimeNotFoundError / RuntimeTimeoutError
│   ├── policy.ts   # 审批策略纯函数（auto_low_risk/auto_all/manual/full_auto）
│   ├── store.ts    # runs.json + events-<runId>.jsonl 原子持久化（保留窗口）
│   ├── engine.ts   # RunManager（自动执行循环/队列/事件/暂停恢复打断/返工/持久化）
│   └── index.ts    # 唯一入口
└── README.md
```

## 3. API 摘要

```ts
import { RunManager, REWORK_PROMPT } from "../../packages/steward-runtime/src/index.js";

const manager = new RunManager({
  orchestrator: port,                       // 必需：OrchestratorRuntimePort（真实引擎适配见 §8）
  root: join(repoRoot, ".steward", "runtime"), // 可选：会话/事件持久化目录（默认 <cwd>/.steward/runtime）
  settings: {                               // 可选（部分覆盖默认）
    auto_run: true,
    approval_mode: "auto_low_risk",         // auto_low_risk | auto_all | manual
    full_auto: false,
    max_auto_steps: 200,
    rework_limit: 1,
    event_retention: 1000,
  },
  maxConcurrentRuns: 3,                     // 可选：并发 Run 上限（超出排队）
  pollIntervalMs: 50,                       // 可选：自动执行轮询间隔（事件粒度；测试可 1ms）
  now: () => new Date(),                    // 可选：时钟注入
});
```

| 方法 | 说明 |
|---|---|
| `createRun({goal, kind?, budget_cny?, token_limit?, mode?, autoStart?})` | **立即返回** `RunRecord`；默认自动开始执行（`autoStart` 缺省 = `settings.auto_run`） |
| `listRuns()` / `getRun(runId)` | 全部 / 单个 Run 记录（副本；不存在返回 null） |
| `startRun(runId)` | 手动开始 queued Run（`auto_run=false` 时） |
| `pauseRun(runId)` | 暂停（queued 立即暂停；running 在当前步骤结束后停止推进） |
| `resumeRun(runId)` | 恢复 paused / awaiting_approval / interrupted |
| `interruptRun(runId)` | 打断（orchestrator interrupt；步骤边界停止，可 resume） |
| `approve(runId, step, "approve"\|"reject", by?)` | 人工审批/确认；reject → 步骤 blocked + Run blocked（**不自动返工**） |
| `subscribeRun(runId, listener, sinceSeq?)` | 先回放 `seq > sinceSeq` 的保留事件，再实时；返回取消函数 |
| `subscribeAll(listener)` | 订阅全部 Run 的实时事件 |
| `eventLog(runId, sinceSeq?)` | 事件日志（保留窗口内） |
| `waitFor(runId, statuses[], timeoutMs?)` | 等待进入指定状态（测试/CLI；超时抛 `RuntimeTimeoutError`） |
| `settingsView` / `updateSettings(patch)` | 读取/更新设置（校验；影响后续调度与审批判定） |

错误：`RuntimeValidationError`（`code: INVALID_INPUT/CONFIG`）、`RuntimeNotFoundError`、`RuntimeTimeoutError`。

## 4. 事件表（`RuntimeEvent`）

`{ seq, at, run_id, session_id, type, data }`；**每 run 内 seq 从 1 连续递增**（保留窗口外的旧事件被丢弃，seq 不重排）。

| type | 何时 | data 关键字段 |
|---|---|---|
| `run.queued` | createRun 入队 | `goal, kind, auto_start, session_id` |
| `run.started` | 调度槽开始执行 | `goal, kind, session_id` |
| `plan.generating` | 调总调度生成计划 | `goal, kind` |
| `plan.ready` | 计划就绪 | `steps_total, steps[{step,agent_role,action,summary,risk,requires_confirmation}]` |
| `step.started` | 步骤开始 | `step, agent_role, action, summary, risk, requires_confirmation` |
| `step.completed` | 步骤结束 | `step, agent_role, action, status` |
| `tool.called` / `tool.result` | 步骤工具动作前后 | `tool(action), step, status` |
| `agent.turn` | 每轮智能体完成 | `seq, agent_role, input_summary, output_summary, tokens, status, model_mode, detail` |
| `token.updated` | Token 增长 | `token_used, tokens_delta, source` |
| `approval.required` | 审批策略判定需人工 | `step, agent_role, action, summary, risk, dangerous, requires_confirmation, approval_mode, reason, message` |
| `run.paused` | 暂停/等待审批 | `reason`（user_pause / awaiting_approval / orchestrator_paused） |
| `run.resumed` | 恢复/自动批准/返工 | `reason`（user_resume / human_approved / auto_approved / interrupt_resume / rework） |
| `run.interrupted` | 打断 | `reason` |
| `run.completed` | 完成 | `steps_total, steps_done, token_used, reworks` |
| `run.blocked` | 阻塞（步骤失败/人工驳回） | `reason` |
| `run.failed` | 失败（orchestrator 抛错/超步数上限） | `error` |

## 5. 审批策略（不需要人工时全自动，需要时只暂停那一步）

| 策略 | 行为 |
|---|---|
| `auto_low_risk`（默认） | **仅** `risk=high/critical` 或 `requires_confirmation=true` 的步骤暂停（`awaiting_approval` + `approval.required`）；其余（含 project finance 的 requires_approval）自动批准继续 |
| `auto_all` | 全部自动批准（含高风险） |
| `manual` | 任何 `requires_approval`/`requires_confirmation` 步骤都暂停等人工 |
| `full_auto` | 开关：为 true 时等价 auto_all（控制台显式开启才生效） |

- 暂停时 Run 记录 `status="awaiting_approval"` + `pending_approval{step,summary,risk}`；`approve(...)` 后继续到完成。
- `reject` → 该步骤 blocked、Run blocked、`rejected_by_human=true`：**拒绝不会被自动返工覆盖**（安全）。

## 6. 并发 / 恢复 / 打断 / 返工 / 持久化

- **并发队列**：最多 `maxConcurrentRuns`（默认 3）并行；超出 `queued` 并由调度器自动开始，不阻塞调用者。
- **暂停**：queued 立即暂停；running 在**步骤边界**停止（当前步骤可能执行完）；`resumeRun` 继续。
- **打断**：`interruptRun` → orchestrator interrupt → `interrupted`；`resumeRun` → 继续剩余步骤。
- **自动返工**：run `blocked` 且非人工驳回且 `rework_limit>0` → 自动 `sendMessage(REWORK_PROMPT)` 重新规划重试，`run.resumed{reason:"rework",attempt}`，最多 `rework_limit` 次。
- **持久化**：`<root>/runs.json`（全部 Run + 恢复字段）+ `<root>/events-<runId>.jsonl`（只保留最近 `event_retention` 条，原子写）。重启后 `listRuns/getRun/eventLog` 可恢复；重启时未完成的 Run 标为 `paused`（调用 `resumeRun` 继续）。
- **错误处理**：orchestrator 抛错 → `run.failed` + `run.failed` 事件；自动循环内部兜底，无 unhandled rejection。

## 7. 接入 SSE（控制台 v1.4-B 已内置该路由）

控制台 v1.4-B 的 `ConsoleRuntimeProvider` 契约（`packages/steward-console/src/runtime.ts`）与 RunManager 一一对应，
Lead 只需把 RunManager 适配成 `ConsoleRuntimeProvider`（见 §9），SSE 路由即复用：

```ts
// 控制台内置（v1.4-B）：GET /api/chat/runs/:id/stream?since=<seq>
// 内部即 provider.subscribeRun(runId, since, onEvent) → 逐条写 SSE：
//   id: <seq>
//   data: {"seq":..,"type":"step.completed","data":{...}}
//
// 若在自有网关/CLI 里直接暴露 SSE，可用（只监听 127.0.0.1）：
import type { ServerResponse } from "node:http";
import { RunManager } from "../../packages/steward-runtime/src/index.js";

export function attachRunSse(server: import("node:http").Server, manager: RunManager): void {
  server.prependListener("request", (req, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/api\/chat\/runs\/([A-Za-z0-9._-]+)\/stream$/.exec(url.pathname);
    if (match === null || req.method !== "GET") return;
    const runId = match[1] ?? "";
    const since = Number(url.searchParams.get("since") ?? "0") || 0;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    const off = manager.subscribeRun(runId, (event) => {
      res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    }, since);
    req.on("close", () => off());
  });
}
```

前端（无外链、浏览器自带）：

```js
const source = new EventSource(`/api/chat/runs/${runId}/stream?since=${lastSeq}`);
source.onmessage = (message) => {
  const event = JSON.parse(message.data);
  lastSeq = event.seq; // 断线重连带上 since，自动补齐
  renderEvent(event);  // plan.ready → 计划卡；step/agent.turn → 时间线；approval.required → 确认按钮
};
```

## 8. 接入真实 OrchestratorEngine（`OrchestratorRuntimePort` 适配器）

```ts
import type { OrchestratorRuntimePort } from "../../packages/steward-runtime/src/index.js";
import { OrchestratorEngine } from "../../packages/steward-orchestrator/src/index.js";

export function toRuntimePort(engine: OrchestratorEngine): OrchestratorRuntimePort {
  return {
    createSession(input) {
      const session = engine.createSession({
        goal: input.goal,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.budget_cny === undefined ? {} : { budget_cny: input.budget_cny }),
        ...(input.token_limit === undefined ? {} : { token_limit: input.token_limit }),
      });
      return { id: session.id };
    },
    sendMessage: (sessionId, text) => engine.sendMessage(sessionId, text),
    startProject: (sessionId) => engine.startProject(sessionId),
    runStep: (sessionId) => engine.runStep(sessionId),
    getSession(sessionId) {
      const session = engine.getSession(sessionId);
      return {
        id: session.id,
        status: session.status,
        plan: session.plan,
        approvals: session.approvals,
        messages: session.messages,
        children: session.children,
        tokens_used: session.tokens_used,
      };
    },
    decideApproval: (sessionId, step, decision) => engine.decideApproval(sessionId, step, decision, "human:runtime"),
    interrupt: (sessionId, reason) => engine.interrupt(sessionId, reason),
    resume: (sessionId) => engine.resume(sessionId),
  };
}
```

## 9. 接入控制台（RunManager → `ConsoleRuntimeProvider` 映射）

```ts
import type { ConsoleRuntimeProvider } from "../../packages/steward-console/src/index.js";
import { RunManager } from "../../packages/steward-runtime/src/index.js";

// 事件名映射：控制台 v1.4-B 事件 → 由 RunManager 事件等价转换
function mapEvent(event: import("../../packages/steward-runtime/src/index.js").RuntimeEvent) {
  const base = { seq: event.seq, at: event.at, run_id: event.run_id, session_id: event.session_id };
  switch (event.type) {
    case "plan.generating": return { ...base, type: "conductor.thinking", data: event.data };
    case "plan.ready": return { ...base, type: "plan.created", data: event.data };
    case "agent.turn": return { ...base, type: "agent.turn.completed", data: event.data };
    case "run.started": return { ...base, type: "run.started", data: event.data };
    case "step.started":
    case "step.completed":
    case "approval.required":
    case "run.interrupted":
    case "run.resumed":
    case "run.completed":
    case "run.failed":
    case "run.paused":
    case "run.blocked": return { ...base, type: event.type, data: event.data };
    default: return { ...base, type: "run.updated", data: event.data };
  }
}

export function createConsoleRuntimeProvider(manager: RunManager, toChatSession: (id: string) => unknown): ConsoleRuntimeProvider {
  const toConsoleRun = (runId: string) => {
    const run = manager.getRun(runId);
    if (run === null) return null;
    return {
      run_id: run.run_id,
      session_id: run.session_id,
      goal: run.goal,
      status: run.status,
      steps_total: run.steps_total,
      steps_done: run.steps_done,
      token_used: run.token_used,
      created_at: run.created_at,
      updated_at: run.updated_at,
      ...(run.current_step === undefined ? {} : { current_step: run.current_step }),
      ...(run.pending_approval === undefined ? {} : { pending_approval: run.pending_approval }),
      ...(run.error === undefined ? {} : { error: run.error }),
    };
  };
  const toResult = (runId: string) => {
    const run = manager.getRun(runId);
    if (run === null) throw new Error(`Run 不存在：${runId}`);
    return { session: toChatSession(run.session_id), run: toConsoleRun(runId) };
  };
  return {
    createAndStart: async (input) => {
      const run = await manager.createRun({ goal: input.goal, ...(input.budget_cny === undefined ? {} : { budget_cny: input.budget_cny }), ...(input.token_limit === undefined ? {} : { token_limit: input.token_limit }) });
      return toResult(run.run_id); // 发送即执行：不等待完成，SSE 会自动推事件
    },
    listRuns: () => manager.listRuns().map((run) => toConsoleRun(run.run_id)),
    getRun: (runId) => toConsoleRun(runId),
    approve: async (runId, step, decision) => {
      await manager.approve(runId, step, decision, "human:console");
      return toConsoleRun(runId);
    },
    interrupt: async (runId) => {
      await manager.interruptRun(runId);
      return toConsoleRun(runId);
    },
    resume: async (runId) => {
      await manager.resumeRun(runId);
      return toConsoleRun(runId);
    },
    subscribeRun: (runId, sinceSeq, onEvent) =>
      manager.subscribeRun(runId, (event) => onEvent(mapEvent(event) as never), sinceSeq),
    eventLog: (runId, sinceSeq = 0) => manager.eventLog(runId, sinceSeq).map((event) => mapEvent(event) as never),
    getSession: (sessionId) => toChatSession(sessionId) as never,
    listSessions: () => [], // 由 console-real.ts 的 OrchestratorEngine 适配器提供（可复用）
    getRunDetail: () => null, // 由 console-real.ts 的 OrchestratorEngine 适配器提供
    getAgentTranscripts: () => [],
  };
}
```

## 10. CLI 对接片段（`steward run "<目标>"`，发送即执行 + 终端流式）

```ts
// apps/cli/src/run-cli.ts（由 Lead 接线）
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { createRuntime } from "./agent-cli.js";
import { RunManager } from "../../../packages/steward-runtime/src/index.js";

export async function cmdRun(parsed: { flags: Record<string, string | boolean> }): Promise<number> {
  const root = findRepoRoot();
  const goal = typeof parsed.flags.goal === "string" ? parsed.flags.goal : parsed.flags._?.toString();
  if (!goal || goal.trim().length === 0) {
    console.error('用法：steward run --goal "帮我做一个报价页面" [--approval auto_low_risk|auto_all|manual] [--json]');
    return 2;
  }
  const runtime = createRuntime(root);                    // ConfigEngine + OrchestratorEngine + SystemController + MoneyEngine
  const manager = new RunManager({
    orchestrator: runtime.orchestrator as never,           // 用 §8 的 toRuntimePort(runtime.orchestrator) 更严格
    root: join(root, ".steward", "runtime"),
    settings: { approval_mode: (parsed.flags.approval as never) ?? "auto_low_risk", rework_limit: 1 },
  });
  const run = await manager.createRun({ goal: String(goal) });
  const verbose = parsed.flags.json !== true;
  const off = manager.subscribeRun(run.run_id, (event) => {
    if (!verbose) {
      process.stdout.write(`${JSON.stringify(event)}\n`);   // 机器可读（每行一个事件，等价 SSE data）
      return;
    }
    switch (event.type) {
      case "plan.ready":
        console.log(`\n计划（${event.data.steps_total} 步）：`);
        for (const step of event.data.steps as Array<Record<string, unknown>>) {
          console.log(`  ${String(step.step)}. ${String(step.agent_role)} / ${String(step.action)} — ${String(step.summary)}`);
        }
        break;
      case "step.completed": console.log(`  ✓ 步骤 ${String(event.data.step)} ${String(event.data.status)}`); break;
      case "run.resumed":
        if (event.data.reason === "auto_approved") console.log(`  ⚙ 自动批准步骤 ${String(event.data.step)}（${String(event.data.risk)}）`);
        break;
      case "approval.required":
        console.error(`\n⚠ 需要人工确认：步骤 ${String(event.data.step)}「${String(event.data.summary)}」`);
        console.error(`  批准：steward run --approve ${run.run_id} --step ${String(event.data.step)}  驳回：--reject`);
        break;
      case "run.completed": console.log(`\n完成：${String(event.data.steps_done)}/${String(event.data.steps_total)} 步，token=${String(event.data.token_used)}`); break;
      case "run.failed": console.error(`\n失败：${String(event.data.error)}`); break;
      default: break;
    }
  }, 0);
  const final = await manager.waitFor(run.run_id, ["done", "blocked", "failed", "awaiting_approval"], 10 * 60 * 1000);
  off();
  if (final.status === "awaiting_approval" && final.pending_approval) {
    console.error(`等待人工确认（step=${final.pending_approval.step}）；确认后 resume。`);
    return 3;
  }
  return final.status === "done" ? 0 : 1;
}
```

`--json` 模式输出 `{run_id, session_id, status, steps_total, steps_done, token_used}` 便于脚本消费；外联/付款等危险动作仍按审批策略暂停（不因 CLI 而绕过）。

## 11. 安全边界

1. **不会静默越权执行**：审批策略默认 `auto_low_risk`，`high/critical` 或 `requires_confirmation=true` 一律暂停等人工；
   `full_auto` 必须显式开启（控制台可加二次确认）。
2. **人工驳回不可被返工覆盖**：`reject` 后 `rejected_by_human=true`，不会自动重新规划。
3. **注入即执行边界**：本模块只调用注入的 orchestrator 端口；真实系统动作的受管白名单/备份/二次确认仍由
   `steward-orchestrator` + `steward-system` 负责，RunManager 不直接触碰文件系统以外的东西（只写自己的 sessions/events JSON）。
4. **零网络**：不发起任何网络请求；SSE 只适用于本地控制台（控制台本身只监听 127.0.0.1）。
5. **持久化脱敏**：Run/事件只存目标、摘要、事件数据；密钥/凭据不经过本模块。

## 12. 测试与已知限制

```bash
npm run build                                # tsc（随 packages/*/src 编译）
node --test tests/unit/runtime.test.mjs      # 既有 AgentRuntime 4 条 + 本模块 21 条，全绿
node --test "tests/unit/*.test.mjs"          # 全量套件
```

测试全部零网络（fake orchestrator 端口 / 真实 OrchestratorEngine + LocalPlannerAdapter）：
创建即自动完成、事件类型/seq 连续/顺序、auto_low_risk 高风险暂停+approval.required、auto_all、manual、
approve 继续、reject→blocked、并发 3 并行、排队、interrupt→resume、pause 不推进、sinceSeq 回放+实时订阅、
持久化重载、返工最多 N 次、token 事件、错误 failed、事件保留上限、waitFor 超时、system Run 自动执行。

已知限制：
- 单进程异步执行；pause/interrupt 在**步骤边界**生效（当前步骤的本地写入可能已发生）。
- 事件保留窗口外的旧事件无法回放（SSE 断线太久需从 Run 记录重建视图）。
- 重启后未完成 Run 一律标 `paused`（不自动恢复执行，避免无人值守时重复执行危险动作）。
- 并发上限是单进程内的；多进程/多实例需外部队列（本模块不提供分布式锁）。
