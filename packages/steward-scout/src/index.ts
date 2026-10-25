/**
 * `@daizhang/steward-scout`：客户线索分支（Scout）核心模块。
 *
 * 纯逻辑、零依赖、无网络：ICP/三个高价值场景、四因子评分、来源硬校验与去重、
 * 合规外联草稿（≤150 字符/引用 signal/不冒充人类）、人工审批队列、每日每渠道频控、
 * 退订拦截、ScoutReport。
 *
 * 合规边界（与 prompts/scout.md 一致）：
 * - 只起草不发送；approve 必须由人调用；markSent 只记录状态且需已批准；
 * - 每日每渠道 ≤10（可配置）；退订后永久不可发送；不群发、不伪造来源、不采集无依据个人信息。
 */

export type {
  ApprovalItem,
  ApprovalStatus,
  BudgetRange,
  ChannelStats,
  DraftStatus,
  ICP,
  OutreachDraft,
  RejectedReason,
  Scenario,
  ScoreBreakdown,
  ScoredLead,
  ScoutChannel,
  ScoutEngineOptions,
  ScoutFixtureLead,
  ScoutReport,
} from "./types.js";

export type { ScoutErrorCode } from "./errors.js";
export { ScoutComplianceError, ScoutValidationError } from "./errors.js";

export {
  BUDGET_SCORES,
  CHANNEL_REACHABILITY,
  NEED_KEYWORDS,
  charLength,
  clamp01,
  excerptText,
  heuristicBudget,
  heuristicComplianceRisk,
  heuristicNeed,
  heuristicReachability,
  isBudgetRange,
} from "./heuristics.js";

export {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_QUALIFIED_THRESHOLD,
  DRAFT_BODY_MAX_CHARS,
  DRAFT_SUBJECT_MAX_CHARS,
  MAX_AUTO_DRAFTS,
  ScoutEngine,
} from "./engine.js";
