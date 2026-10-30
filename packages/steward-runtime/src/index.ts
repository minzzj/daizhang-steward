/**
 * `@daizhang/steward-runtime`：v1.4-A 实时自动执行内核。
 *
 * 解决「发消息后不实时、还要手动点执行」：createRun 即自动执行（sendMessage→startProject→runStep 循环），
 * 实时事件流（run/plan/step/agent.turn/tool/token/approval/completed）→ SSE/终端流式；
 * 审批策略（auto_low_risk/auto_all/manual）+ 并发队列（默认 3）+ pause/resume/interrupt + 自动返工 +
 * 事件与 Run 记录持久化（刷新/重连 `sinceSeq` 回放）。
 *
 * 与 orchestrator 解耦：只依赖注入的 OrchestratorRuntimePort（真实 OrchestratorEngine 适配见 README）。
 * 零第三方依赖、纯逻辑 + JSON 持久化；不发起任何网络请求。
 */

export type {
  ApprovalMode,
  ApprovalPolicyDecision,
  CreateRunInput,
  OrchestratorRuntimePort,
  PersistedRunState,
  PersistedRunsFile,
  RunRecord,
  RunStatus,
  RuntimeAgentTurnView,
  RuntimeChatMessageView,
  RuntimeCreateSessionInput,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeOptions,
  RuntimePlanStepView,
  RuntimeSessionView,
  RuntimeSettingsView,
} from "./types.js";

export type { RuntimeErrorCode } from "./errors.js";
export { RuntimeNotFoundError, RuntimeTimeoutError, RuntimeValidationError } from "./errors.js";

export { APPROVAL_MODES, DANGEROUS_RISKS, evaluateApprovalPolicy } from "./policy.js";
export { RunStore } from "./store.js";
export {
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RUNTIME_SETTINGS,
  REWORK_PROMPT,
  RunManager,
  normalizeRuntimeSettings,
} from "./engine.js";
