/**
 * `steward-config`：v1.1 配置中心（体验 demo / 个人 personal / 企业 enterprise 三模式）。
 *
 * 零第三方依赖；纯逻辑 + JSON 原子持久化（`<root>/config.json`）。
 * 覆盖用户核心诉求：全部参数可配置、三种运行模式、所有功能逐项可禁用、银行卡/支付配置明确、
 * Token 预算可配置（测试值 10,000,000）、0 元极限预算模式、数据可清空。
 */

export type {
  AgentConfig,
  AgentUpdate,
  ApprovalPolicy,
  AuditEntry,
  AuditResult,
  Autonomy,
  BudgetCheckResult,
  BudgetKind,
  Budgets,
  CompanyProfile,
  ConfigEngineOptions,
  Currency,
  DataConfig,
  FeatureCheckResult,
  FeatureName,
  FeatureToggle,
  FeatureUpdate,
  Features,
  InvoiceConfig,
  InvoiceDefaultType,
  Language,
  ModeDefaults,
  ModeDiff,
  OperatorType,
  PaymentProvider,
  PaymentProviderKind,
  PaymentProviderMode,
  PaymentProviderUpdate,
  PaymentsConfig,
  PayoutAccount,
  PayoutAccountUpdate,
  Profile,
  ResetDataResult,
  RunMode,
  SetModeOptions,
  StewardConfig,
  TokenBudgetConfig,
  TokenConsumeMeta,
  TokenConsumeResult,
  TokenUsageByAgent,
  TokenUsageEntry,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

export type { ConfigErrorCode } from "./errors.js";
export { BudgetLimitError, ConfigIOError, ConfigValidationError, FeatureDisabledError, TokenLimitError } from "./errors.js";

export {
  AGENT_ROLES,
  CONFIG_VERSION,
  FEATURE_NAMES,
  defaultAgents,
  defaultsForMode,
  featureToggle,
  isAgentRole,
  isFeatureName,
  isRunMode,
  type AgentRoleName,
} from "./defaults.js";

export {
  isMaskedValue,
  looksLikePlaintextCard,
  looksLikePlaintextPhone,
  maskAccount,
  maskAccountId,
  maskBankCard,
  maskLicenseNo,
  maskTaxNo,
} from "./mask.js";

export type { TokenBudgetHost, TokenBudgetHistoryHost } from "./token-budget.js";
export { TokenBudget } from "./token-budget.js";

export type { AgentRegistryHost } from "./agent-registry.js";
export { AgentRegistry, isAutonomy } from "./agent-registry.js";

export {
  AUDIT_FILE_NAME,
  CONFIG_FILE_NAME,
  ConfigEngine,
  RESETTABLE_SUBDIRS,
  TOKEN_USAGE_FILE_NAME,
  agentRolesForMode,
  validateConfig,
} from "./engine.js";
