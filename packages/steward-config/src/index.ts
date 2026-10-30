/**
 * `steward-config`：配置中心（v1.1 三模式 + v1.2 多模型/API 密钥/系统提示词 + v1.3 supervisor/epay/系统策略）。
 *
 * 零第三方依赖；纯逻辑 + JSON 原子持久化（`<root>/config.json`）。
 * 覆盖用户核心诉求：全部参数可配置、demo/personal/enterprise 三模式、所有功能逐项可禁用、
 * 银行卡/支付配置明确（含易支付 epay）、Token 预算可配置（测试值 10,000,000）、0 元极限预算模式、
 * 数据可清空；v1.2：各智能体可配不同模型、用户自配 API 密钥引用（env/本地 secrets，绝不入库）、
 * 一键同步同一密钥、专业系统提示词；v1.3：两层总调度（supervisor 系统总控 + conductor 总调度）、
 * 系统动作策略（受管程序/插件/危险动作二次确认）。
 */

export type {
  AgentConfig,
  AgentModelBinding,
  AgentUpdate,
  ApiKeyResolution,
  ApprovalMode,
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
  EpayConfig,
  EpayConfigUpdate,
  EpayMode,
  EpayPayType,
  FeatureCheckResult,
  FeatureName,
  FeatureToggle,
  FeatureUpdate,
  Features,
  InvoiceConfig,
  InvoiceDefaultType,
  Language,
  LocalApiKeyResult,
  ManagedAppConfig,
  ModeDefaults,
  ModeDiff,
  ModelProviderConfig,
  ModelProviderKind,
  ModelProviderRemovalResult,
  ModelRoutingConfig,
  ModelSyncMode,
  ModelSyncModeResult,
  OperatorType,
  OrchestratorSettings,
  OrchestratorUpdate,
  PaymentProvider,
  PaymentProviderKind,
  PaymentProviderMode,
  PaymentProviderUpdate,
  PaymentsConfig,
  PayoutAccount,
  PayoutAccountUpdate,
  Profile,
  ProviderKeyRefUpdate,
  ResetDataResult,
  ResolvedAgentModel,
  RunMode,
  RuntimeSettings,
  RuntimeSettingsUpdate,
  SetModeOptions,
  StewardConfig,
  SyncApiKeyResult,
  SystemPolicyConfig,
  SystemPolicyUpdate,
  SystemPromptConfig,
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
  SUPERVISOR_TOKEN_LIMIT,
  defaultAgentModels,
  defaultAgents,
  defaultEpayConfig,
  defaultModelProviders,
  defaultModelRouting,
  defaultRuntimeSettings,
  defaultSystemPolicy,
  defaultsForMode,
  featureToggle,
  isAgentRole,
  isFeatureName,
  isRunMode,
  type AgentRoleName,
} from "./defaults.js";

export {
  DEFAULT_CONDUCTOR_PROMPT,
  PROMPT_SAFETY_KEYWORDS,
  SYSTEM_PROMPT_ROLES,
  buildDefaultOrchestratorSettings,
  buildDefaultSystemPrompts,
  hasSafetyKeyword,
  validateSystemPromptText,
  type SystemPromptRole,
} from "./prompts.js";

export {
  SECRETS_FILE_NAME,
  describeApiKeyRef,
  isValidApiKeyRef,
  maskApiKeyRef,
  parseApiKeyRef,
  resolveApiKeyRef,
  secretsFilePathFor,
} from "./api-key-refs.js";

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
