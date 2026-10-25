/**
 * `steward-domain`：阶段二 P1 经营域引擎（个人版 MVP）。
 *
 * 纯逻辑、零第三方依赖、无网络。覆盖八概念数据模型：
 * 委托（范围/期限/额度/禁止项）/ 预算三层 / 项目 / 任务 / 代理 / 证据 / 账本 / 墓碑（+置信度），
 * 以及选题提案、预算校验、审批卡（超时挂起不自动放行）、接管键与接管包、月报与 L0/L1/L2 摘要、
 * ≥12 条个人模式边界规则（四类越界 100% deny）、仿真业务线端到端、events.jsonl 追加审计。
 */

export type {
  ActionCard,
  ActionCardKind,
  ActionSeverity,
  AddTaskInput,
  AgentRole,
  ApprovalCard,
  ApprovalCardStatus,
  ApprovalDecision,
  ApprovalKind,
  ApprovalOption,
  BoundaryCheckRequest,
  BoundaryCheckResult,
  BoundaryDecision,
  BoundaryMode,
  BoundaryMust,
  BoundaryRequestKind,
  BoundaryRule,
  BudgetCheckResult,
  BudgetKind,
  BudgetSnapshot,
  BusinessLine,
  BusinessLineProposal,
  BusinessLineSource,
  ComplianceEvent,
  Confidence,
  CreateApprovalCardInput,
  CreateMandateInput,
  DomainEngineOptions,
  DomainEvent,
  Evidence,
  EvidenceInput,
  EvidenceKind,
  LedgerEntry,
  LedgerFacts,
  LedgerFilter,
  LedgerType,
  Mandate,
  MandateBudgetLimits,
  MandateStatus,
  MonthlyReport,
  Project,
  ProjectStatus,
  ProjectSummary,
  ProposalDocument,
  ProposalOptions,
  ProposalRejectCategory,
  ProposalRejected,
  PromiseRecord,
  PromiseStatus,
  PromiseTrace,
  RecordLedgerInput,
  SimulatedBusinessLineResult,
  SummaryBundle,
  TakeoverCoverage,
  TakeoverPack,
  Task,
  TaskStatus,
  TimelineEntry,
  TimelineKind,
} from "./types.js";

export type { DomainErrorCode } from "./errors.js";
export { BoundaryDeniedError, BudgetExceededError, DomainValidationError, SystemHaltedError } from "./errors.js";

export type { BoundaryContext } from "./boundary.js";
export {
  BOUNDARY_RULES,
  boundaryRuleCount,
  digestBoundaryText,
  evaluateBoundary,
  listBoundaryRules,
} from "./boundary.js";

export {
  DEFAULT_BUSINESS_LINES,
  DEFAULT_CUSTOMER_INQUIRY,
  SIMULATED_HUMAN_APPROVER,
  defaultMandateInput,
} from "./fixtures.js";

export { DEFAULT_APPROVAL_TTL_HOURS, DOMAIN_STATE_VERSION, DomainEngine } from "./engine.js";
