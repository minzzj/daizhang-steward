/**
 * v1.2-C 编排内核数据契约。
 *
 * 总调度（conductor）对话 → 生成计划 → 派发专项智能体（operator/harness/reviewer/finance/
 * backend/scout/customer/content/research）执行真实本地动作 → 每轮 AgentTurn（摘要 + 全文 + tokens +
 * 证据）→ 打断/恢复/审批 → 持久化 sessions JSON。
 *
 * 设计原则：
 * - **依赖注入**：模型解析（ModelResolver）与模型调用（ModelAdapter）由外部注入，
 *   便于接 `packages/steward-config`（多 provider/密钥引用/Token 预算/系统提示词），
 *   单测可完全零网络（fake resolver + fake adapter / LocalPlannerAdapter）；
 * - 字段只增不减（控制台/CLI/验收脚本按此集成）；时间统一 ISO 8601。
 */

// ---------------------------------------------------------------------------
// 1) 模型适配（OpenAI 兼容 / DeepSeek / 本地回退）
// ---------------------------------------------------------------------------

export type ModelProviderKind = "deepseek" | "openai_compatible" | "anthropic" | "local";
export type KeySource = "env" | "file" | "missing";

/** 模型 provider 只读视图（不含密钥；密钥由 resolver 运行时解析）。 */
export interface ModelProviderView {
  id: string;
  name: string;
  kind: ModelProviderKind;
  /** 如 https://api.deepseek.com（不含 /chat/completions）。 */
  base_url: string;
  default_model: string;
  models: string[];
}

/** 某个智能体当前的模型解析结果（只暴露 has_key/key_source，绝不暴露明文密钥）。 */
export interface ModelResolution {
  provider: ModelProviderView;
  model: string;
  has_key: boolean;
  key_source?: KeySource | undefined;
}

export interface TokenConsumeMeta {
  agentRole: string;
  action: string;
}

/** 与 `packages/steward-config` 的 TokenConsumeResult 结构兼容（只取需要的字段）。 */
export interface TokenConsumeResult {
  ok: boolean;
  used_tokens: number;
  limit_tokens: number;
  remaining_tokens: number;
  reason?: string | undefined;
}

/** 模型/Token/提示词解析器（由配置中心提供；本模块不直接依赖 steward-config）。 */
export interface ModelResolver {
  resolveAgentModel(role: string): ModelResolution;
  /** 运行时解析 API 密钥（env/本地 secrets）；不得写入日志/会话文件。 */
  getApiKey(providerId: string): string | null;
  getConductorPrompt(): string;
  getSystemPrompt(role: string): string;
  /** 每次模型/回退调用前预扣估算 Token；超限返回 ok:false（不扣减）。 */
  consumeTokens(amount: number, meta: TokenConsumeMeta): TokenConsumeResult;
  remainingTokens(): number;
}

export type ModelChatRole = "system" | "user" | "assistant";

export interface ModelChatMessage {
  role: ModelChatRole;
  content: string;
}

export interface ModelChatInput {
  resolution: ModelResolution;
  messages: ModelChatMessage[];
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export type ModelCallMode = "remote" | "local_fallback";

export interface ModelChatResult {
  ok: boolean;
  content: string;
  tokens_used: number;
  error?: string | undefined;
  mode: ModelCallMode;
}

/** 模型适配器：真实远程调用（OpenAI 兼容）或确定性本地回退。 */
export interface ModelAdapter {
  chat(input: ModelChatInput): Promise<ModelChatResult>;
}

// ---------------------------------------------------------------------------
// 2) 会话 / 消息 / 计划 / 轮次 / 证据
// ---------------------------------------------------------------------------

export type OrchestratorMode = "demo" | "personal" | "enterprise";

export type SessionStatus =
  | "active"
  | "planning"
  | "running"
  | "paused"
  | "interrupted"
  | "done"
  | "blocked";

export type PlanStepStatus = "pending" | "running" | "done" | "blocked";
export type AgentTurnStatus = "done" | "blocked" | "failed";
export type ChatKind = "text" | "plan" | "approval" | "result" | "error" | "interrupt";
export type ChatRole = "user" | "conductor" | "supervisor" | "agent" | "system";

/** 每一次智能体执行（一轮）：摘要 + 全文 + tokens + 证据引用。 */
export interface AgentTurn {
  seq: number;
  at: string;
  agent_role: string;
  input_summary: string;
  output_summary: string;
  /** 全文细节（动作、模型/回退标注、本地结果、错误等，便于 UI 展开）。 */
  detail: string;
  tokens: number;
  status: AgentTurnStatus;
  evidence_refs: string[];
  /** 本轮模型来源（remote = 真实模型；local_fallback = 本地规则回退，必须明确标注）。 */
  model_mode?: ModelCallMode | undefined;
  /** 被打断的轮次（status=blocked 时可能为 true）。 */
  interrupted?: boolean | undefined;
}

/** 计划步骤（step 从 1 开始；status 由执行推进）。 */
export interface PlanStep {
  step: number;
  agent_role: string;
  action: string;
  summary: string;
  status: PlanStepStatus;
  /** 该步骤是否需要人工审批（默认 finance 类步骤需要；autoApprove=true 时豁免）。 */
  requires_approval?: boolean | undefined;
  /** system 会话（supervisor）的受管动作计划（risk/requires_confirmation 等）；project 会话为空。 */
  action_plan?: ActionPlan | undefined;
}

/** 会话消息（对话流 + 计划 + 审批 + 结果 + 错误 + 打断）。 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  agent_role?: string | undefined;
  text: string;
  summary?: string | undefined;
  at: string;
  kind: ChatKind;
  /** conductor/agent 消息对应的模型来源（本地回退必须标注）。 */
  model_mode?: ModelCallMode | undefined;
}

/** 审批记录（按步骤号索引）。 */
export interface ApprovalRecord {
  status: "pending" | "approved" | "rejected";
  by?: string | undefined;
  at?: string | undefined;
  reason?: string | undefined;
}

/** 编排会话（持久化到 `<root>/orchestrator/sessions-<id>.json`）。 */
export interface OrchestratorSession {
  id: string;
  title: string;
  goal: string;
  mode: OrchestratorMode;
  /** 会话类型：system = supervisor（系统总控）；project = conductor（项目总调度）。 */
  kind: SessionKind;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  project_id?: string | undefined;
  budget_cny: number;
  token_limit: number;
  messages: ChatMessage[];
  plan: PlanStep[];
  /** 每个 agent 角色的轮次记录（role -> AgentTurn[]）。 */
  children: Record<string, AgentTurn[]>;
  evidence_dir?: string | undefined;
  /** 委派来源：supervisor 委派生出的 conductor 子会话记录父会话 id。 */
  parent_id?: string | undefined;
  /** supervisor 委派出的子会话 id 列表。 */
  child_sessions?: string[] | undefined;
  // ---- 附加字段（只增不减）----
  /** 审批状态（key = 步骤号字符串）。 */
  approvals?: Record<string, ApprovalRecord> | undefined;
  /** 本会话累计预扣的 token（用于会话级上限）。 */
  tokens_used?: number | undefined;
  /** 持久化格式版本。 */
  store_version?: number | undefined;
}

export interface CreateSessionInput {
  goal: string;
  /** 会话类型：system（supervisor 系统总控）/ project（conductor 项目，默认）。 */
  kind?: SessionKind | undefined;
  budget_cny?: number | undefined;
  token_limit?: number | undefined;
  mode?: OrchestratorMode | undefined;
  title?: string | undefined;
}

// ---------------------------------------------------------------------------
// 3) 本地工具动作与账本依赖注入
// ---------------------------------------------------------------------------

/** 收款/记账依赖注入接口（由 `packages/steward-money` 或经营域提供；不注入时写本地 JSON）。 */
export interface LedgerIncomeEntry {
  amount_cny: number;
  basis: string;
  client: string;
  session_id: string;
}

export interface LedgerExpenseEntry {
  amount_cny: number;
  basis: string;
  payee: string;
  session_id: string;
}

export interface LedgerSink {
  recordIncome(entry: LedgerIncomeEntry): unknown;
  recordExpense(entry: LedgerExpenseEntry): unknown;
}

export interface OrchestratorDeps {
  resolver: ModelResolver;
  /** 模型适配器；缺省 = OpenAICompatibleAdapter（真实 fetch；无 key 时引擎自动回退本地规则）。 */
  adapter?: ModelAdapter | undefined;
  /** 时钟注入（测试确定性）。 */
  now?: (() => Date) | undefined;
  /**
   * 数据根目录；缺省 `<cwd>/runs`。
   * 会话：`<root>/orchestrator/sessions-<id>.json`；证据：`<root>/<sessionId>/`
   * （即仓库内 `runs/orchestrator/...` 与 `runs/<sessionId>/`）。
   */
  root?: string | undefined;
  /** 单次 startProject/runStep 最多推进的步骤数（默认 8，防止失控循环）。 */
  maxStepsPerRun?: number | undefined;
  /** true = 所有步骤免审批自动执行（演示/测试）；默认 false（finance 类步骤需人工审批）。 */
  autoApprove?: boolean | undefined;
  /** 记账依赖注入（finance 动作使用）。 */
  ledger?: LedgerSink | undefined;
  /** 受管系统动作依赖注入（supervisor/system 会话使用；未注入时系统动作 blocked）。 */
  systemActions?: SystemActions | undefined;
  /** 配置中心桥（模型/提示词切换动作使用；未注入时写本地意图证据）。 */
  configBridge?: ConfigBridge | undefined;
}

// ---------------------------------------------------------------------------
// 4) 证据 / 运行详情 / 计划 JSON
// ---------------------------------------------------------------------------

export type EvidenceKind = "html" | "report" | "json" | "log" | "screenshot" | "other";

export interface EvidenceItem {
  /** 仓库相对路径（相对 deps.root）。 */
  path: string;
  kind: EvidenceKind;
  title: string;
}

export interface RunDetail {
  session: OrchestratorSession;
  turns: AgentTurn[];
  evidence: EvidenceItem[];
}

/** 模型生成计划的 JSON 结构（解析失败 → 本地规则回退）。 */
export interface ConductorPlanStep {
  agent_role: string;
  action: string;
  summary: string;
  /** system 计划：系统动作目标。 */
  target?: string | undefined;
  /** system 计划：系统动作参数。 */
  args?: Record<string, unknown> | undefined;
  /** system 计划：动作风险（缺省按动作类型判定）。 */
  risk?: ActionRisk | undefined;
}

export interface ConductorPlan {
  title?: string;
  steps: ConductorPlanStep[];
}

/** 一次模型调用的内部结果（含回退原因与 Token 超限 blocked）。 */
export interface ModelOutcome {
  ok: boolean;
  content: string;
  tokens: number;
  mode: ModelCallMode;
  reason?: string | undefined;
  blocked?: boolean | undefined;
  /** 调用被 AbortSignal 中断（引擎据此记录 interrupted 轮次）。 */
  aborted?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// 5) v1.3 两层总调度：supervisor（系统总控）与受管系统动作 / 配置桥
// ---------------------------------------------------------------------------

/** 同步或异步结果（依赖注入接口返回值）。 */
export type MaybePromise<T> = T | Promise<T>;

/** 会话类型：system = supervisor 系统总控（受管系统动作）；project = conductor 项目总调度。 */
export type SessionKind = "system" | "project";

/** 受管系统动作的风险级别（high/critical 一律需要确认）。 */
export type ActionRisk = "low" | "medium" | "high" | "critical";

/** supervisor 可执行/计划的受管系统动作。 */
export type SystemActionName =
  | "listApps"
  | "startApp"
  | "stopApp"
  | "restartApp"
  | "removeApp"
  | "listPlugins"
  | "enablePlugin"
  | "disablePlugin"
  | "removePlugin"
  | "changeAgentModel"
  | "setPrompt"
  | "delegateProject"
  | "readLogs";

/** 系统动作执行计划（每步生成；risk + requires_confirmation 决定是否需要人工确认）。 */
export interface ActionPlan {
  action: SystemActionName;
  /** 目标（程序 id / 插件 id / 角色 / 项目目标等）。 */
  target: string;
  args: Record<string, unknown>;
  risk: ActionRisk;
  requires_confirmation: boolean;
  summary: string;
}

/** 受管程序信息（SystemActions.listApps 返回）。 */
export interface SystemAppInfo {
  id: string;
  name: string;
  running: boolean;
  version?: string | undefined;
}

/** 受管插件信息（SystemActions.listPlugins 返回）。 */
export interface SystemPluginInfo {
  id: string;
  name: string;
  enabled: boolean;
  version?: string | undefined;
  backup_path?: string | undefined;
}

/** 系统动作执行结果。 */
export interface SystemActionResult {
  ok: boolean;
  summary: string;
  detail?: string | undefined;
  data?: unknown;
  evidence_refs?: string[] | undefined;
}

/** 受管系统动作依赖注入（由 Lead 用 steward-system 实现；测试用 fake）。 */
export interface SystemActions {
  listApps(): MaybePromise<SystemActionResult>;
  startApp(app_id: string): MaybePromise<SystemActionResult>;
  stopApp(app_id: string): MaybePromise<SystemActionResult>;
  restartApp(app_id: string): MaybePromise<SystemActionResult>;
  removeApp(app_id: string): MaybePromise<SystemActionResult>;
  listPlugins(): MaybePromise<SystemActionResult>;
  enablePlugin(plugin_id: string): MaybePromise<SystemActionResult>;
  disablePlugin(plugin_id: string): MaybePromise<SystemActionResult>;
  removePlugin(plugin_id: string): MaybePromise<SystemActionResult>;
  changeAgentModel(role: string, binding: { provider_id: string; model: string }): MaybePromise<SystemActionResult>;
  setPrompt(role: string, prompt: string): MaybePromise<SystemActionResult>;
  delegateProject(goal: string, conductor_session_id: string): MaybePromise<SystemActionResult>;
}

// ---------------------------------------------------------------------------
// 6) 配置桥（模型/提示词切换作为 supervisor 动作）
// ---------------------------------------------------------------------------

export interface AgentConfigSummary {
  role: string;
  name?: string | undefined;
  provider_id?: string | undefined;
  model?: string | undefined;
  enabled?: boolean | undefined;
}

export interface ConfigBridgeResult {
  ok: boolean;
  summary: string;
  detail?: string | undefined;
  data?: unknown;
}

/** 配置中心桥（模型/提示词/Token 用量；由 Lead 用 steward-config 实现）。 */
export interface ConfigBridge {
  setAgentModel(role: string, binding: { provider_id: string; model: string }): MaybePromise<ConfigBridgeResult>;
  setSystemPrompt(role: string, prompt: string): MaybePromise<ConfigBridgeResult>;
  setConductorPrompt(prompt: string): MaybePromise<ConfigBridgeResult>;
  listAgents(): MaybePromise<AgentConfigSummary[]>;
  getTokenUsage(): MaybePromise<{ used_tokens: number; limit_tokens: number; remaining_tokens: number }>;
}

// ---------------------------------------------------------------------------
// 7) 审计（所有动作追加，含 supervisor 系统动作）
// ---------------------------------------------------------------------------

export type AuditResult = "ok" | "blocked" | "pending" | "error";

export interface AuditEntry {
  seq: number;
  at: string;
  session_id: string;
  action: string;
  object: string;
  result: AuditResult;
  reason: string;
}

/** supervisor 读取全部日志/记录的结果。 */
export interface RecordsSnapshot {
  generated_at: string;
  sessions: Array<{
    id: string;
    kind: SessionKind;
    status: SessionStatus;
    goal: string;
    parent_id: string | null;
    messages: number;
    turns: number;
    plan_steps: number;
  }>;
  audit: AuditEntry[];
}
