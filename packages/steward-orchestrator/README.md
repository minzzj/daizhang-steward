# @daizhang/steward-orchestrator · 编排内核（两层总调度）

> 状态：**v1.2-C / v1.3 已实现**。总调度对话 → 计划 → 派发执行 → 每轮摘要/证据 → 打断/恢复/审批（确认）
> → 多模型适配（DeepSeek / OpenAI 兼容 / 本地规则回退）→ 会话 JSON 持久化。
>
> 纯逻辑、零第三方依赖；项目动作只写本地证据文件，受管系统动作只经**注入接口**执行（未注入即阻断），
> 不自动外发、不自动收款、不绕过人工确认。

## 1. 两层总调度架构

```
用户
 │  系统级命令（管理程序/插件、切模型/提示词、读日志、委派项目）
 ▼
supervisor（system 会话）──────────────┐
 │  每步 ActionPlan（risk / requires_confirmation）        │
 │  高危动作必须人工确认（/approve、/reject）               │
 │  依赖注入：SystemActions + ConfigBridge                │
 │                                                       │
 └── delegateProject ──► conductor（project 会话，parent_id=supervisor）
                          │  拆解计划 → operator / harness / reviewer / finance /
                          │  backend / scout / customer / content / research
                          └── 真实本地动作（交付物/质检/核查/事件/收款请求/调研草稿）
```

- **supervisor（`kind: "system"`）**：接收用户亲自下达的系统级命令；受管系统动作必须经注入的
  `SystemActions` 执行、模型/提示词切换经 `ConfigBridge`；**删除类动作永远需要人工确认**（autoApprove 也不能绕过）；
  supervisor 不能再派生 supervisor，也不执行项目交付动作。
- **conductor（`kind: "project"`，默认）**：项目计划与派发，执行真实本地动作；不得操作系统、不得反向委派。

## 2. 文件结构

```
packages/steward-orchestrator/
├── src/
│   ├── types.ts       # 契约类型（会话/消息/计划/AgentTurn/ActionPlan/SystemActions/ConfigBridge/审计…）
│   ├── errors.ts      # OrchestratorValidationError / OrchestratorNotFoundError / OrchestratorPersistenceError
│   ├── model.ts       # OpenAICompatibleAdapter（真实 fetch）+ LocalPlannerAdapter（本地回退）+ 计划生成/解析/风险分级
│   ├── tools.ts       # project 本地动作（交付物/质检/核查/事件/收款请求/调研草稿）+ 系统动作证据
│   ├── store.ts       # 会话原子写 + 启动恢复（<root>/orchestrator/sessions-<id>.json）
│   ├── resolver.ts    # createModelResolverFromConfig：把配置中心结构适配成 ModelResolver（密钥不泄露）
│   ├── engine.ts      # OrchestratorEngine（两层总调度/计划/执行/确认/打断/审计/持久化）
│   └── index.ts       # 唯一入口
└── README.md
```

## 3. API 摘要

```ts
import {
  OrchestratorEngine,
  OpenAICompatibleAdapter,
  LocalPlannerAdapter,
  createModelResolverFromConfig,
  type ModelResolver,
  type SystemActions,
  type ConfigBridge,
  type LedgerSink,
} from "../../packages/steward-orchestrator/src/index.js";

const engine = new OrchestratorEngine({
  resolver,                       // 必需：模型/密钥/提示词/Token 预算（见 §6）
  adapter,                        // 可选：缺省 OpenAICompatibleAdapter（真实 fetch；无 key 自动本地回退）
  root: join(repoRoot, "runs"),   // 可选：会话 <root>/orchestrator/、证据 <root>/<sessionId>/
  now: () => new Date(),          // 可选：时钟注入（测试确定性）
  maxStepsPerRun: 8,              // 可选：单次 startProject/runStep 最多推进步数
  autoApprove: false,             // 可选：false（默认）时项目 finance 步骤需审批、系统动作需确认
  systemActions,                  // 可选：supervisor 受管动作（未注入时系统动作 blocked）
  configBridge,                   // 可选：模型/提示词切换（未注入时只记录变更意图）
  ledger,                         // 可选：finance 记账（未注入时写本地 ledger.json）
});
```

| 方法 | 说明 |
|---|---|
| `createSession({goal, kind?, budget_cny?, token_limit?, mode?, title?})` | 新建会话：`kind:"system"`=supervisor，`"project"`=conductor（默认） |
| `sendMessage(sessionId, text)` | 调总调度（模型/本地回退）生成计划 → 更新会话；conductor 计划为项目步骤，supervisor 计划为系统动作 |
| `startProject(sessionId)` | 创建项目/系统工作区并开始执行（遇到审批/确认/打断则暂停） |
| `runStep(sessionId)` | 单步执行下一个 pending 步骤（便于 UI 逐步展示/打断） |
| `interrupt(sessionId, reason?)` | 打断：AbortController + 状态检查；当前步骤回退 pending，下一步前停止（≤1s） |
| `resume(sessionId)` | 恢复 interrupted/paused 会话继续执行 |
| `decideApproval(sessionId, step, "approve" \| "reject", by?)` | 人工审批/确认；驳回 → 该步 blocked、会话 blocked |
| `delegateProject(supervisorSessionId, goal, title?)` | **仅 supervisor** 可委派 → 创建 conductor 子会话（`parent_id`/`child_sessions`） |
| `readLogs(sessionId?)` | supervisor 读取全部会话 + 审计快照（`RecordsSnapshot`） |
| `auditLog()` | 全量审计（时间/操作/对象/结果/原因；追加写 `<root>/orchestrator/audit.jsonl`） |
| `getRunDetail(sessionId)` | `{session, turns, evidence}`（turns 按 seq 排序；evidence 为证据文件清单） |
| `getAgentTranscripts(sessionId, role?)` | 每个智能体每轮：`input_summary` / `output_summary` / `detail` / `tokens` / `evidence_refs` |
| `getConductorConversation(sessionId)` | 用户 + 总调度/supervisor 对话记录（计划/审批/结果） |
| `listEvidence(sessionId)` / `listSessions()` / `getSession(id)` | 查询 |

错误：`OrchestratorValidationError`（`code: INVALID_INPUT/MISSING_PLAN/…`）、`OrchestratorNotFoundError`、
`OrchestratorPersistenceError`。

## 4. 计划 / 每轮摘要 / 证据

- `PlanStep`：`step / agent_role / action / summary / status`；system 会话额外带 `action_plan`：
  `{action, target, args, risk, requires_confirmation, summary}`。
- `AgentTurn`（每个智能体每一轮）：`seq / at / agent_role / input_summary / output_summary / detail(全文) /
  tokens / status(done|blocked|failed) / evidence_refs / model_mode(remote|local_fallback) / interrupted?`。
- 证据：project 会话写入 `<root>/<sessionId>/`（`deliverable.html/md`、`quality-check.json`、`review.json`、
  `events.jsonl`、`evidence-index.json`、`payment-request.json`、`ledger.json`、调研/客户/内容草稿等）；
  system 会话写入 `<root>/<sessionId>/system-actions/step-<n>-<action>.json`（含 risk/确认人/结果）。

## 5. 模型适配与本地回退

- `OpenAICompatibleAdapter`（缺省）：`POST ${base_url}/chat/completions`，`Authorization: Bearer <key>`，
  解析 `choices[0].message.content` 与 `usage.total_tokens`；超时（默认 20s）/中断/4xx/5xx/网络错误分类返回可读错误。
- `LocalPlannerAdapter`：无密钥/远程失败时确定性回退，`mode:"local_fallback"`，文案明确标注
  「本地规则模式·未调用远程模型」；conductor 计划/agent 摘要都有规则模板。
- 回退链：`has_key=false` → 直接本地；`has_key=true` 但调用失败/响应为空 → 本地回退并记录 `回退原因` 到
  `AgentTurn.detail` 与消息 `model_mode`；模型计划 JSON 解析失败 → 本地计划 + 明确回退说明。
- **密钥安全**：`ModelResolver.getApiKey` 只在适配器内部运行时使用；`ModelResolution` 只含 `has_key/key_source`，
  会话/证据/审计中不落明文。

## 6. 接入配置中心（模型/密钥/提示词/Token 预算）

```ts
import { ConfigEngine } from "../../packages/steward-config/src/index.js";
import { createModelResolverFromConfig, OrchestratorEngine } from "../../packages/steward-orchestrator/src/index.js";

const config = new ConfigEngine({ root: join(repoRoot, ".steward") });
const resolver = createModelResolverFromConfig(config); // 结构适配：resolveAgentModel/getApiKeyForProvider/
                                                        // getConductorPrompt/getSystemPrompt/consumeTokens/剩余 Token
const engine = new OrchestratorEngine({ resolver, root: join(repoRoot, "runs") });
```

Token：每次模型/回退调用前 `resolver.consumeTokens(估算, {agentRole, action})`；另有会话级
`token_limit` 双保险；任一超限 → 会话 `blocked` + `error` 消息 + `AgentTurn(status=blocked)`。

## 7. 接入受管系统（supervisor → steward-system）

`SystemActions` 由 Lead 用 `packages/steward-system` 的 `SystemController` 适配（接口注入，编排内核不直接依赖）：

```ts
import { SystemController } from "../../packages/steward-system/src/index.js";
import { newActionRequestId, type ActionRequest } from "../../packages/steward-system/src/index.js";
import type { SystemActions } from "../../packages/steward-orchestrator/src/index.js";

class SystemActionsAdapter implements SystemActions {
  constructor(private readonly controller: SystemController) {}
  private async run(request: ActionRequest) {
    const plan = this.controller.plan(request);            // 风险评估 + 是否需要确认 + 一次性 token
    if (!plan.allowed) return { ok: false, summary: plan.summary, data: plan.details };
    const receipt = await this.controller.execute({
      ...request,
      ...(plan.confirmation_token === undefined ? {} : { confirmation_token: plan.confirmation_token }),
    });
    return { ok: receipt.ok, summary: receipt.audit_id, detail: receipt.error, data: { backup_path: receipt.backup_path } };
  }
  listApps = () => ({ ok: true, summary: `受管程序 ${this.controller.listApps().length} 个`, data: this.controller.listApps() });
  startApp = (id: string) => this.run({ id: newActionRequestId(), action: "app.start", target: id, requested_by: "supervisor" });
  stopApp = (id: string) => this.run({ id: newActionRequestId(), action: "app.stop", target: id, requested_by: "supervisor" });
  restartApp = (id: string) => this.run({ id: newActionRequestId(), action: "app.restart", target: id, requested_by: "supervisor" });
  removeApp = (id: string) => this.run({ id: newActionRequestId(), action: "app.remove", target: id, requested_by: "supervisor" });
  listPlugins = () => ({ ok: true, summary: "受管插件", data: this.controller.listPlugins() });
  enablePlugin = (id: string) => this.run({ id: newActionRequestId(), action: "plugin.enable", target: id, requested_by: "supervisor" });
  disablePlugin = (id: string) => this.run({ id: newActionRequestId(), action: "plugin.disable", target: id, requested_by: "supervisor" });
  removePlugin = (id: string) => this.run({ id: newActionRequestId(), action: "plugin.remove", target: id, requested_by: "supervisor" });
  changeAgentModel = (role, binding) => ({ ok: true, summary: `模型意图 ${role}→${binding.provider_id}/${binding.model}` });
  setPrompt = (role, prompt) => ({ ok: true, summary: `提示词意图 ${role}（${[...prompt].length} 字）` });
  delegateProject = (goal, sessionId) => ({ ok: true, summary: `登记委派 ${sessionId}`, data: { goal } });
}
```

**确认语义**：编排内核在调用 `SystemActions` 之前先完成人工确认（`requires_confirmation=true` 的步骤在
`startProject/runStep` 时挂起 `paused`，必须 `decideApproval(...,"approve")` 才执行；`reject` 则 blocked 且
**不调用** SystemActions）。删除类动作（`removeApp/removePlugin`）`risk=high`，即使 `autoApprove:true` 也必须确认。

## 8. 接入配置桥（模型/提示词切换动作）

```ts
const configBridge: ConfigBridge = {
  setAgentModel: (role, binding) => config.setAgentModel(role, binding),
  setSystemPrompt: (role, prompt) => config.setSystemPrompt(role, prompt),
  setConductorPrompt: (prompt) => config.setConductorPrompt(prompt),
  listAgents: () => config.listAgents(),
  getTokenUsage: () => config.getTokenBudget(),
};
```

`changeAgentModel` / `setPrompt` 作为 supervisor 动作执行，会写 `AgentTurn` + 审计 + 动作证据；
未注入 `ConfigBridge` 时只记录“变更意图”（`ok:true` 但在摘要里明确“未真实切换”）。

## 9. 接入控制台（console 对接片段）

控制台 v1.2 `ConsoleChatProvider` 可用一个薄适配器把编排内核接上（两者都是纯内存同步/异步 API）：

```ts
import type { ConsoleChatProvider } from "../../packages/steward-console/src/index.js";
import { OrchestratorEngine } from "../../packages/steward-orchestrator/src/index.js";

function createConsoleChatProvider(engine: OrchestratorEngine): ConsoleChatProvider {
  const toChatSession = (session: ReturnType<OrchestratorEngine["getSession"]>) => ({
    id: session.id,
    title: session.title,
    goal: session.goal,
    mode: session.mode,
    status: session.status,
    created_at: session.created_at,
    updated_at: session.updated_at,
    project_id: session.project_id,
    messages: session.messages,
    plan: session.plan.map((step) => ({
      step: step.step,
      agent_role: step.agent_role,
      action: step.action,
      summary: step.summary,
      status: step.status,
      risk: step.action_plan?.risk,
      requires_confirmation: step.action_plan?.requires_confirmation ?? step.requires_approval ?? false,
    })),
    budget_cny: session.budget_cny,
    token_limit: session.token_limit,
    interruptible: !["done", "blocked"].includes(session.status),
  });
  return {
    listSessions: () => engine.listSessions().map(toChatSession),
    createSession: (input) => toChatSession(engine.createSession(input)),
    getSession: (id) => toChatSession(engine.getSession(id)),
    sendMessage: async (id, text) => toChatSession(await engine.sendMessage(id, text)),
    startProject: async (id) => toChatSession(await engine.startProject(id)),
    interrupt: (id) => toChatSession(engine.interrupt(id)),
    resume: (id) => toChatSession(engine.resume(id)),
    decideApproval: (id, step, decision) => toChatSession(engine.decideApproval(id, step, decision)),
    listRuns: () => engine.listSessions().map((session) => ({ run_id: session.id, goal: session.goal, status: session.status })),
    getRunDetail: (runId) => {
      const detail = engine.getRunDetail(runId);
      return {
        run_id: runId,
        goal: detail.session.goal,
        status: detail.session.status,
        started_at: detail.session.created_at,
        finished_at: detail.session.status === "done" ? detail.session.updated_at : undefined,
        events: [],
        evidence: detail.evidence.map((item) => ({ path: item.path, kind: item.kind, title: item.title })),
        agents: Object.entries(detail.session.children).map(([role, turns]) => ({
          agent_role: role,
          title: role,
          turns: turns.map((turn) => ({
            seq: turn.seq,
            at: turn.at,
            input_summary: turn.input_summary,
            output_summary: turn.output_summary,
            tokens: turn.tokens,
            status: turn.status,
            evidence_ref: turn.evidence_refs[0],
          })),
        })),
        token_used: detail.session.tokens_used ?? 0,
        budget_used_cny: 0,
      };
    },
    getAgentTranscripts: (runIdOrRole) => {
      // 传入 role 时返回该角色全部轮次；传入 runId 时返回全部轮次
      const sessions = engine.listSessions();
      const session = sessions.find((item) => item.id === runIdOrRole);
      const rows = session === undefined ? [] : engine.getAgentTranscripts(session.id);
      return rows.map((turn) => ({
        seq: turn.seq,
        at: turn.at,
        input_summary: turn.input_summary,
        output_summary: turn.output_summary,
        tokens: turn.tokens,
        status: turn.status,
        evidence_ref: turn.evidence_refs[0],
      }));
    },
    listEvidence: (runId) => engine.listEvidence(runId).map((item) => ({ path: item.path, kind: item.kind, title: item.title })),
  } as unknown as ConsoleChatProvider;
}
```

CLI/console 侧命令建议：`steward orchestrator --json`（跑一个 project 会话）、`steward supervisor --json`
（system 会话 + 确认/委派），证据直接来源 `getRunDetail()` + `engine.root`。

## 10. 账本/收款（finance 动作）

`finance.collect_payment` 默认生成 `payment-request.json`（演示渠道，`status:"pending"`，需人工确认到账），
并写本地 `ledger.json`；若注入 `ledger: LedgerSink` 则调用 `recordIncome()`（可接 `packages/steward-money`），
金额从目标里的 `¥880` / `880 元` 解析（缺省 100 元）。**AI 不自动确认到账、不接真实支付**。

## 11. 安全边界（产品底线）

1. **supervisor 不能绕过确认**：`requires_confirmation` 的步骤必须 `decideApproval` 批准才执行；
   未确认时 `startProject/runStep` 都只挂起，绝不调用 `SystemActions`；删除类动作永远需要确认。
2. **未注入即阻断**：系统动作未注入 `SystemActions` → blocked + 可读原因，绝不假装成功；
   未注入 `ConfigBridge` → 只记录“变更意图”并明确标注未真实生效。
3. **conductor 不越权**：project 会话不能委派项目（不能派生 supervisor），不产生系统动作；system 会话不执行项目交付动作。
4. **AI 不代签/不自动外发**：调研/客户/内容动作只出草稿；收款只出 pending 请求；不连接真实支付/银行。
5. **失败升级**：本地动作失败/质检未通过 → 步骤 blocked、会话 blocked、写错误消息与审计，不无限重试。
6. **审计只追加**：`<root>/orchestrator/audit.jsonl`（时间/会话/操作/对象/结果/原因，脱敏截断）。

## 12. 测试与已知限制

```bash
npm run build                                  # tsc（随 packages/*/src 编译）
node --test tests/unit/orchestrator.test.mjs   # 27 条，全绿
node --test "tests/unit/*.test.mjs"            # 全量套件
```

测试全部零网络（fake resolver / fake ModelAdapter / LocalPlannerAdapter / fake SystemActions / fake ConfigBridge）：
project 计划/执行/每轮摘要/证据/打断恢复/审批/Token/持久化/模型适配与回退/账本注入；
system 系统动作计划、确认/拒绝/执行、危险动作未确认不执行、supervisor 委派子会话、模型与提示词切换、
日志读取、system/project 隔离。

已知限制：
- 一次执行是**单进程串行**；`interrupt` 依靠 AbortController + 步骤边界检查（本地同步写文件动作本身不可中断）。
- 计划由模型/规则生成，系统动作目标 id 需与受管清单一致；真实执行前仍由 `steward-system` 做白名单/路径/确认校验。
- 模型上下文只保留最近 8 条对话（避免上下文无限增长）；长项目需上层做摘要压缩（后续迭代）。
- 会话文件含证据目录绝对路径；迁移数据根目录后建议通过 CLI 迁移工具重写（本模块不做路径重写）。
