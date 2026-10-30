/**
 * v1.4-A「实时自动执行内核」数据契约。
 *
 * 用户痛点：发消息之后不实时、还要手动点执行。`RunManager` 在 `createRun` 后自动
 * `sendMessage → startProject → 循环 runStep` 直到完成（或按审批策略暂停等人工），
 * 同时提供可订阅的实时事件流（SSE/终端流式）、并发队列、打断/恢复、返工、持久化。
 *
 * 与 orchestrator 解耦：只依赖注入的 `OrchestratorRuntimePort`（真实 OrchestratorEngine
 * 由使用方写一个薄适配器接入；单测用 fake）。零第三方依赖。
 */

// ---------------------------------------------------------------------------
// 1) 事件
// ---------------------------------------------------------------------------

export type RuntimeEventType =
  | "run.started"
  | "run.queued"
  | "plan.generating"
  | "plan.ready"
  | "step.started"
  | "step.completed"
  | "agent.turn"
  | "tool.called"
  | "tool.result"
  | "approval.required"
  | "run.paused"
  | "run.resumed"
  | "run.interrupted"
  | "run.completed"
  | "run.blocked"
  | "run.failed"
  | "token.updated";

/** 一条实时事件（seq 每 run 内连续递增；保留上限外的旧事件会被丢弃但 seq 不重排）。 */
export interface RuntimeEvent {
  seq: number;
  at: string;
  run_id: string;
  session_id: string;
  type: RuntimeEventType;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 2) Run 记录与设置
// ---------------------------------------------------------------------------

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "interrupted"
  | "done"
  | "blocked"
  | "failed";

export type ApprovalMode = "auto_low_risk" | "auto_all" | "manual";

/** Run 对外记录（持久化到 `<root>/runs.json`）。 */
export interface RunRecord {
  run_id: string;
  session_id: string;
  goal: string;
  kind: "project" | "system";
  status: RunStatus;
  created_at: string;
  updated_at: string;
  steps_total: number;
  steps_done: number;
  token_used: number;
  current_step?: number;
  pending_approval?: { step: number; summary: string; risk?: string | undefined } | undefined;
  error?: string;
  event_seq: number;
}

/** 运行设置（可被 CLI/控制台读取与更新）。 */
export interface RuntimeSettingsView {
  /** 创建 Run 后是否自动开始（默认 true）。 */
  auto_run: boolean;
  /** 审批策略：auto_low_risk（仅高风险/需确认暂停，默认）/ auto_all / manual。 */
  approval_mode: ApprovalMode;
  /** 完全自动：等价于所有步骤自动批准（含高风险；控制台显式开启才生效）。 */
  full_auto: boolean;
  /** 单 Run 自动执行循环上限（安全阀，默认 200）。 */
  max_auto_steps: number;
  /** 失败/阻塞时自动重新规划返工的最多次数（默认 1；0 = 不返工）。 */
  rework_limit: number;
  /** 每 run 事件保留条数（默认 1000）。 */
  event_retention: number;
}

// ---------------------------------------------------------------------------
// 3) Orchestrator 依赖注入端口（由使用方用真实 OrchestratorEngine 适配）
// ---------------------------------------------------------------------------

export interface RuntimePlanStepView {
  step: number;
  agent_role: string;
  action: string;
  summary: string;
  status: string;
  requires_approval?: boolean | undefined;
  action_plan?: {
    risk?: string | undefined;
    requires_confirmation?: boolean | undefined;
  } | undefined;
}

export interface RuntimeAgentTurnView {
  seq: number;
  agent_role: string;
  input_summary: string;
  output_summary: string;
  tokens: number;
  status: string;
  model_mode?: string | undefined;
  detail?: string | undefined;
}

export interface RuntimeChatMessageView {
  role?: string | undefined;
  kind?: string | undefined;
  text?: string | undefined;
  summary?: string | undefined;
}

export interface RuntimeSessionView {
  id: string;
  status: string;
  plan: RuntimePlanStepView[];
  approvals?: Record<string, { status: string }> | undefined;
  messages?: RuntimeChatMessageView[] | undefined;
  children?: Record<string, RuntimeAgentTurnView[]> | undefined;
  /** 会话级累计 token（真实 OrchestratorEngine 提供；缺失时由 children 汇总）。 */
  tokens_used?: number | undefined;
}

export interface RuntimeCreateSessionInput {
  goal: string;
  kind?: "project" | "system" | undefined;
  budget_cny?: number | undefined;
  token_limit?: number | undefined;
  mode?: string | undefined;
}

/** 编排内核端口（方法尽量少；真实实现见 README 的 adapter 片段）。 */
export interface OrchestratorRuntimePort {
  createSession(input: RuntimeCreateSessionInput): { id: string };
  sendMessage(sessionId: string, text: string): Promise<unknown>;
  startProject(sessionId: string): Promise<unknown>;
  runStep(sessionId: string): Promise<unknown>;
  getSession(sessionId: string): RuntimeSessionView;
  decideApproval(sessionId: string, step: number, decision: "approve" | "reject"): unknown;
  interrupt(sessionId: string, reason?: string): unknown;
  resume(sessionId: string): unknown;
}

// ---------------------------------------------------------------------------
// 4) 构造参数 / 创建 Run 入参
// ---------------------------------------------------------------------------

export interface RuntimeOptions {
  orchestrator: OrchestratorRuntimePort;
  settings?: Partial<RuntimeSettingsView> | undefined;
  /** 数据根目录；默认 `<cwd>/.steward/runtime`（runs.json + events-<runId>.jsonl）。 */
  root?: string | undefined;
  now?: (() => Date) | undefined;
  /** 最大并行 Run 数（默认 3；超出排队）。 */
  maxConcurrentRuns?: number | undefined;
  /** 自动执行轮询间隔（默认 50ms；测试可调 1ms，用于实时事件粒度）。 */
  pollIntervalMs?: number | undefined;
}

export interface CreateRunInput {
  goal: string;
  kind?: "project" | "system" | undefined;
  budget_cny?: number | undefined;
  token_limit?: number | undefined;
  mode?: string | undefined;
  /** 是否自动开始；缺省 = settings.auto_run。 */
  autoStart?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// 5) 持久化结构与内部字段
// ---------------------------------------------------------------------------

/** 一条 Run 的持久化状态（runs.json；可选内部字段便于重启后恢复）。 */
export interface PersistedRunState {
  run: RunRecord;
  reworks: number;
  project_started: boolean;
  plan_ready: boolean;
  rejected_by_human: boolean;
}

export interface PersistedRunsFile {
  version: 1;
  generated_at: string;
  runs: PersistedRunState[];
}

/** 审批策略判定结果（纯函数，便于测试/控制台解释）。 */
export interface ApprovalPolicyDecision {
  decision: "approve_now" | "wait_human";
  risk: string;
  dangerous: boolean;
  /** 可读原因（写入事件 data.reason / UI 提示）。 */
  reason: string;
}
