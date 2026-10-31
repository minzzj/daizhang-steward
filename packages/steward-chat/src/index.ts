/**
 * `@daizhang/steward-chat`：v1.5.1-A 对话式 AI 总控内核。
 *
 * 一个对话框控制全部：AI 自己查系统（系统/run/产物/报告/metrics/日志/配置/账本/智能体）、
 * 小任务走真实 DSH harness、项目类交项目执行器、危险动作只返回审批卡；
 * 长期记忆 + 多会话；简单查询规则回答（0 token），任务才用 harness。
 *
 * 零第三方依赖；数据工具 ChatTools 由控制台/CLI 注入，测试用 fake。
 */

export type {
  ChatApprovalCard,
  ChatArtifactCard,
  ChatClassification,
  ChatConversation,
  ChatConversationView,
  ChatDataCard,
  ChatEngineOptions,
  ChatEntities,
  ChatGoalResult,
  ChatHarnessResult,
  ChatIntent,
  ChatMemoryEntry,
  ChatMemoryFilter,
  ChatMessage,
  ChatModelMode,
  ChatPart,
  ChatQueryResult,
  ChatReportCard,
  ChatRole,
  ChatSendResult,
  ChatThinkingSummary,
  ChatTools,
  MemoryKind,
} from "./types.js";

export {
  CHAT_DEFAULT_CONVERSATION_TITLE,
  CHAT_DEFAULT_MAX_CONTEXT_MESSAGES,
  CHAT_DEFAULT_MAX_MEMORY_ENTRIES,
  CHAT_MAX_TITLE_CHARS,
} from "./types.js";

export type { ChatErrorCode } from "./errors.js";
export { ChatError } from "./errors.js";

export { CHAT_DANGER_ACTIONS, analyzeIntent, classifyIntent } from "./intent.js";
export type { ExtractMemoryInput, MemoryCandidate } from "./memory.js";
export { extractMemoryCandidates, hasCjk, recallMemories, tokenizeForRecall } from "./memory.js";
export type { ChatStoreOptions } from "./store.js";
export { ChatStore, summarizeMessage } from "./store.js";
export { ChatEngine } from "./engine.js";
export type { ChatPhase } from "./phase.js";
export { applyMessagePhases, mergeToolParts, splitPartsByPhase } from "./phase.js";
