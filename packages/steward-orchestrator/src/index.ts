/**
 * `@daizhang/steward-orchestrator`：v1.2 编排内核。
 *
 * 总调度对话（conductor）→ 模型/本地回退生成计划 → 派发专项智能体执行真实本地动作 →
 * 每个智能体每轮记录摘要 + 全文 + tokens + 证据 → 支持打断/恢复/审批 → 会话 JSON 持久化。
 *
 * 纯本地动作（生成交付物/质检/核查/事件/收款请求/调研草稿），不自动外发、不自动收款；
 * 模型调用走注入的 ModelAdapter（OpenAI 兼容真实 fetch，可注入 fake 便于零网络测试）。
 */

export type {
  ActionPlan,
  ActionRisk,
  AgentConfigSummary,
  AgentTurn,
  AgentTurnStatus,
  ApprovalRecord,
  ChatKind,
  ChatMessage,
  ChatRole,
  ConductorPlan,
  ConductorPlanStep,
  CreateSessionInput,
  EvidenceItem,
  EvidenceKind,
  KeySource,
  LedgerExpenseEntry,
  LedgerIncomeEntry,
  LedgerSink,
  ModelAdapter,
  ModelCallMode,
  ModelChatInput,
  ModelChatMessage,
  ModelChatResult,
  ModelChatRole,
  ModelOutcome,
  ModelProviderKind,
  ModelProviderView,
  ModelResolution,
  AuditEntry,
  AuditResult,
  ConfigBridge,
  ConfigBridgeResult,
  MaybePromise,
  ModelResolver,
  OrchestratorDeps,
  OrchestratorMode,
  OrchestratorSession,
  PlanStep,
  PlanStepStatus,
  RecordsSnapshot,
  RunDetail,
  SessionKind,
  SessionStatus,
  SystemActionName,
  SystemActionResult,
  SystemActions,
  SystemAppInfo,
  SystemPluginInfo,
  TokenConsumeMeta,
  TokenConsumeResult,
} from "./types.js";

export type { OrchestratorErrorCode } from "./errors.js";
export {
  OrchestratorNotFoundError,
  OrchestratorPersistenceError,
  OrchestratorValidationError,
} from "./errors.js";

export type { ConfigResolverSource } from "./resolver.js";
export { createModelResolverFromConfig } from "./resolver.js";

export {
  AGENT_SUMMARY_MARKER,
  ALLOWED_AGENT_ROLES,
  LocalPlannerAdapter,
  SUPERVISOR_PLAN_MARKER,
  SYSTEM_ACTIONS,
  OpenAICompatibleAdapter,
  PLAN_MARKER,
  buildLocalPlan,
  buildLocalSystemPlan,
  defaultActionForRole,
  estimateTokens,
  parseConductorPlan,
  parseSystemPlan,
  requiresConfirmationFor,
  riskForSystemAction,
  truncate,
} from "./model.js";
export type { OpenAICompatibleAdapterOptions } from "./model.js";

export {
  APPROVAL_REQUIRED_ROLES,
  DEFAULT_BUDGET_CNY,
  DEFAULT_CONDUCTOR_PROMPT,
  DEFAULT_SUPERVISOR_PROMPT,
  DEFAULT_MAX_STEPS_PER_RUN,
  DEFAULT_TOKEN_LIMIT,
  ORCHESTRATOR_STORE_VERSION,
  OrchestratorEngine,
  SUPERVISOR_ROLE,
} from "./engine.js";

export { SessionStore } from "./store.js";
export type { LocalActionInput, LocalActionResult } from "./tools.js";
export {
  evidenceKindFor,
  listEvidenceFiles,
  parseAmountFromGoal,
  runLocalAction,
  writeSystemActionEvidence,
} from "./tools.js";
