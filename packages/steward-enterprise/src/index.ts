/**
 * `@daizhang/steward-enterprise`：阶段二 P3 企业版核心模块。
 *
 * 纯逻辑、零第三方依赖、无网络、无真实资金/开票/税务动作。
 * 覆盖：企业认证主体（营业执照/经办人/授权书人签/用印）、用印流程（AI 不代签）、
 * 对公账户与增值税普票/专票、开票校验（抬头/税号/合同一致）、申报草稿（人确认）、
 * 双人复核（收款账户变更）、组织级审批链、多代理串行、
 * 30 条边界双模式标注表（四类越界双模式 deny）、B8 双模式一致性阻断。
 */

export type {
  AccountChangeInput,
  AccountChangeRequest,
  ApprovalChain,
  ApprovalSubmission,
  AuditEntry,
  AuditResult,
  AuthorizationLetter,
  BankAccount,
  BoundaryDecision30,
  BoundaryImplementation,
  BoundaryMust30,
  BoundaryRow30,
  BoundaryRowMode,
  BusinessEntity,
  ClientType,
  ConflictSeverity,
  DualModeChecks,
  DualModeMismatchEvidence,
  DualModeOrderEvidence,
  DualModeResult,
  EnterpriseBoundaryKind,
  EnterpriseBoundaryRequest,
  EnterpriseBoundaryResult,
  EnterpriseEngineOptions,
  EnterpriseProfile,
  EntityKind,
  EntityValidation,
  InvoiceChecks,
  InvoiceDefaults,
  InvoiceType,
  InvoiceValidation,
  ModeConflict,
  OrderContext,
  OrderMode,
  OrderRunResult,
  PaymentCheck,
  PaymentMethod,
  ReviewPolicy,
  SealFlow,
  SealFlowInput,
  SealRecord,
  SerialSlotResult,
  SignatureCheck,
  SignTaskStatus,
  TaxFilingDraft,
} from "./types.js";

export type { EnterpriseErrorCode } from "./errors.js";
export {
  DualReviewRequiredError,
  EnterpriseValidationError,
  InvalidInvoiceError,
  ModeConflictError,
} from "./errors.js";

export type { EnterpriseBoundaryContext } from "./boundary.js";
export {
  BOUNDARY_ROWS_30,
  boundaryRuleCount30,
  boundaryRows30,
  boundaryTableMarkdown,
  evaluateBoundary30,
} from "./boundary.js";

export {
  DEFAULT_ENTERPRISE_PROFILE,
  DEFAULT_PERSONAL_ENTITY,
  defaultEnterpriseProfile,
  defaultPersonalEntity,
} from "./fixtures.js";

export {
  APPROVAL_TIER_MEDIUM_CNY,
  APPROVAL_TIER_SMALL_CNY,
  DUAL_REVIEW_REQUIRED_COUNT,
  EnterpriseEngine,
  MODE_CONFLICT_CODES,
  PERSONAL_CONTRACT_INVOICE_TYPE,
  isAiLikeSigner,
  isCorporateAccount,
} from "./engine.js";
