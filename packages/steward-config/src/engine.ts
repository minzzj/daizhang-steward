/**
 * ConfigEngine：v1.1 配置中心核心。
 *
 * 能力总览（回应用户 7 项核心诉求）：
 * 1. 全部参数可配置：setProfile / setFeature / setBudgets / setTokenBudget / setPaymentProvider /
 *    setPayoutAccount / setInvoiceConfig / setPaymentsPolicy / setApprovalPolicy / setData / agents.*；
 * 2. 三种运行模式：demo（体验）/ personal（个人）/ enterprise（企业），`defaultsForMode` + `setMode`；
 * 3. 所有功能可逐项禁用：14 个 FeatureToggle，`checkFeature` 返回可读原因；
 * 4. 银行卡与支付配置明确：`payments.providers[]`（渠道）+ `payments.payout_account`（银行卡/微信/支付宝掩码）
 *    + `payments.invoice`（发票）；敏感字段只存掩码，不存明文；
 * 5. Token 预算可配置：`token_budget.limit_tokens`（测试值 10,000,000）+ 单步上限 + 用量历史；
 * 6. 预算三层 + 0 元极限模式：`budgets.zero_budget_mode` 下任何支出拒绝，免费本地动作可放行；
 * 7. 数据可清空：`resetData(dataRoot)` 只删白名单子目录（防路径穿越），保留配置文件。
 *
 * 持久化：`<root>/config.json`（原子写）+ `<root>/config-audit.jsonl`（只追加审计）+
 * `<root>/token-usage.jsonl`（Token 用量历史）。纯逻辑、零第三方依赖、无网络。
 */

import { existsSync, lstatSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve as resolvePath, sep } from "node:path";

import { AgentRegistry } from "./agent-registry.js";
import {
  AGENT_ROLES,
  CONFIG_VERSION,
  FEATURE_NAMES,
  defaultEpayConfig,
  defaultModelProviders,
  defaultSystemPolicy,
  defaultsForMode as buildDefaults,
  isAgentRole,
  isFeatureName,
  isRunMode,
  type AgentRoleName,
} from "./defaults.js";
import { BudgetLimitError, ConfigIOError, ConfigValidationError, FeatureDisabledError } from "./errors.js";
import { appendJsonLineSync, atomicWriteJsonSync, ensureDirSync, readJsonFileSync, readJsonLinesSync } from "./io.js";
import { isMaskedValue, looksLikePlaintextCard, looksLikePlaintextPhone, maskAccount as maskAccountValue, maskAccountId, maskBankCard, maskLicenseNo, maskTaxNo } from "./mask.js";
import { DEFAULT_CONDUCTOR_PROMPT, PROMPT_SAFETY_KEYWORDS, SYSTEM_PROMPT_ROLES, buildDefaultOrchestratorSettings, buildDefaultSystemPrompts, validateSystemPromptText } from "./prompts.js";
import { isValidApiKeyRef, maskApiKeyRef, resolveApiKeyRef, secretsFilePathFor, setLocalSecret, removeLocalSecret, SECRETS_FILE_NAME } from "./api-key-refs.js";
import { TokenBudget } from "./token-budget.js";
import type {
  AgentConfig,
  AgentHarnessMeta,
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
  DataConfig,
  EpayConfig,
  EpayConfigUpdate,
  EpayMode,
  EpayPayType,
  FeatureCheckResult,
  FeatureName,
  FeatureToggle,
  Features,
  HarnessRoleSettings,
  HarnessSettings,
  HarnessSettingsUpdate,
  InvoiceConfig,
  InvoiceDefaultType,
  LocalApiKeyResult,
  ManagedAppConfig,
  ModeDiff,
  ModelProviderConfig,
  ModelProviderKind,
  ModelProviderRemovalResult,
  ModelRoutingConfig,
  ModelSyncMode,
  ModelSyncModeResult,
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
  TokenUsageEntry,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const CONFIG_FILE_NAME = "config.json";
export const AUDIT_FILE_NAME = "config-audit.jsonl";
export const TOKEN_USAGE_FILE_NAME = "token-usage.jsonl";

/** resetData 允许清理的白名单子目录（其余一律保留，防误删/穿越）。 */
export const RESETTABLE_SUBDIRS: readonly string[] = [
  "runs",
  "domain",
  "evidence",
  "ledger",
  "events",
  "notifications",
  "drills",
  "fault",
  "console",
  "logs",
  "temp",
];

const BUDGET_KINDS: readonly BudgetKind[] = ["month", "project", "per_txn"];
const BUDGET_LABELS: Record<BudgetKind, string> = { month: "月", project: "项目", per_txn: "单笔" };
const BUDGET_LIMIT_KEYS: Record<BudgetKind, keyof Pick<Budgets, "month_cny" | "project_cny" | "per_txn_cny">> = {
  month: "month_cny",
  project: "project_cny",
  per_txn: "per_txn_cny",
};
const RUN_MODES: readonly RunMode[] = ["demo", "personal", "enterprise"];
const OPERATOR_TYPES = ["individual", "company"] as const;
const LANGUAGES = ["zh-CN", "en"] as const;
const ON_EXCEED = ["block", "notify"] as const;
const PAYMENT_KINDS: readonly PaymentProviderKind[] = ["wechat_pay", "alipay", "personal_bank_card", "corporate_account", "manual"];
const PAYMENT_MODES: readonly PaymentProviderMode[] = ["auto", "manual_approval", "disabled"];
const INVOICE_TYPES: readonly InvoiceDefaultType[] = ["none", "personal_receipt", "vat_general", "vat_special"];
const AUTONOMY_VALUES: readonly Autonomy[] = ["readonly", "draft", "approval_required", "autonomous_limited"];
const MODEL_PROVIDER_KINDS: readonly ModelProviderKind[] = ["deepseek", "openai_compatible", "anthropic", "local"];
const MODEL_SYNC_MODES: readonly ModelSyncMode[] = ["single_key_all", "per_provider"];
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/u;
const HTTPS_URL_PATTERN = /^https:\/\/[^\s]+$/u;
const EPAY_MODES: readonly EpayMode[] = ["demo", "live"];
const EPAY_PAY_TYPES: readonly EpayPayType[] = ["alipay", "wxpay"];
const APPROVAL_MODES: readonly ApprovalMode[] = ["auto_low_risk", "auto_all", "manual"];
/** v1.4 运行时设置的范围（必须与契约一致）。 */
const RUNTIME_MAX_AUTO_STEPS_RANGE = { min: 10, max: 200 } as const;
const RUNTIME_REWORK_LIMIT_RANGE = { min: 0, max: 3 } as const;
const RUNTIME_EVENT_RETENTION_RANGE = { min: 100, max: 5_000 } as const;
/** v1.5 Harness 设置范围（必须与契约一致）。 */
const HARNESS_TIMEOUT_RANGE = { min: 10, max: 1_800_000 } as const;
const HARNESS_MAX_TOKENS_RANGE = { min: 1_000, max: 2_000_000 } as const;
const HARNESS_MAX_CONCURRENCY_RANGE = { min: 1, max: 4 } as const;
const HARNESS_ARTIFACT_RETENTION_RANGE = { min: 1, max: 365 } as const;
/** Harness 工作区模板：安全相对路径（允许 `/` 分隔，不允许绝对路径/..）。 */
const HARNESS_WORKSPACE_PATTERN = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\/)[A-Za-z0-9._\-/<>]+$/u;
/** 安全相对路径（插件目录/密钥文件片段）：非空、非绝对、不含 ..。 */
const SAFE_RELATIVE_PATH_PATTERN = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/\\]+$/u;

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireString(value: unknown, field: string, message?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigValidationError(message ?? `${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ConfigValidationError(`${field} 必须是布尔值`, "INVALID_INPUT", field);
  return value;
}

function requireNumber(value: unknown, field: string, options: { min?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigValidationError(`${field} 必须是有限数字`, "INVALID_INPUT", field);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ConfigValidationError(`${field} 必须 ≥ ${options.min}`, "INVALID_INPUT", field);
  }
  return value;
}

function requireNonNegativeInt(value: unknown, field: string): number {
  const number = requireNumber(value, field, { min: 0 });
  if (!Number.isInteger(number)) throw new ConfigValidationError(`${field} 必须是整数`, "INVALID_INPUT", field);
  return number;
}

/** v1.4：整数范围校验（运行时设置用；越界直接拒绝，避免写入非法配置）。 */
function requireIntInRange(value: unknown, field: string, min: number, max: number): number {
  const number = requireNonNegativeInt(value, field);
  if (number < min || number > max) throw new ConfigValidationError(`${field} 必须在 ${min}-${max} 之间`, "INVALID_INPUT", field);
  return number;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ConfigValidationError(`${field} 取值非法：${String(value)}（允许 ${allowed.join("/")}）`, "INVALID_INPUT", field);
  }
  return value as T;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ConfigValidationError(`${field} 必须是字符串数组`, "INVALID_INPUT", field);
  return value.map((item) => requireString(item, `${field}[]`));
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field);
}

/** 深层 diff：返回变化字段路径（数组整体视为一个字段）。 */
function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (a === b) return [];
  const bothRecords = isRecord(a) && isRecord(b);
  const bothArrays = Array.isArray(a) && Array.isArray(b);
  if (bothArrays) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix === "" ? "(root)" : prefix];
  }
  if (bothRecords) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: string[] = [];
    for (const key of [...keys].sort()) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      out.push(...diffPaths(a[key], b[key], path));
    }
    return out;
  }
  return [prefix === "" ? "(root)" : prefix];
}

// ---------------------------------------------------------------------------
// 从 unknown JSON 归一化（构造/load/import 共用；缺失字段用该模式默认值兜底）
// ---------------------------------------------------------------------------

function normalizeToggle(raw: unknown, base: FeatureToggle, field: string): FeatureToggle {
  if (!isRecord(raw)) throw new ConfigValidationError(`${field} 必须是对象`, "INVALID_INPUT", field);
  const enabled = raw.enabled === undefined ? base.enabled : requireBoolean(raw.enabled, `${field}.enabled`);
  const requiresApproval =
    raw.requires_approval === undefined ? base.requires_approval : requireBoolean(raw.requires_approval, `${field}.requires_approval`);
  const toggle: FeatureToggle = { enabled, requires_approval: requiresApproval };
  const note = optionalString(raw.note, `${field}.note`);
  if (note !== undefined) toggle.note = note;
  else if (base.note !== undefined) toggle.note = base.note;
  return toggle;
}

function normalizeFeatures(raw: unknown, base: Features): Features {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("features 必须是对象", "INVALID_INPUT", "features");
  const out = {} as Features;
  for (const name of FEATURE_NAMES) {
    const rawToggle = source[name];
    out[name] = rawToggle === undefined ? cloneJson(base[name]) : normalizeToggle(rawToggle, base[name], `features.${name}`);
  }
  return out;
}

function normalizeBudgets(raw: unknown, base: Budgets): Budgets {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("budgets 必须是对象", "INVALID_INPUT", "budgets");
  const budgets: Budgets = {
    month_cny: source.month_cny === undefined ? base.month_cny : requireNumber(source.month_cny, "budgets.month_cny", { min: 0 }),
    project_cny: source.project_cny === undefined ? base.project_cny : requireNumber(source.project_cny, "budgets.project_cny", { min: 0 }),
    per_txn_cny: source.per_txn_cny === undefined ? base.per_txn_cny : requireNumber(source.per_txn_cny, "budgets.per_txn_cny", { min: 0 }),
    zero_budget_mode:
      source.zero_budget_mode === undefined ? base.zero_budget_mode : requireBoolean(source.zero_budget_mode, "budgets.zero_budget_mode"),
    allow_free_local_actions:
      source.allow_free_local_actions === undefined
        ? base.allow_free_local_actions
        : requireBoolean(source.allow_free_local_actions, "budgets.allow_free_local_actions"),
  };
  return budgets;
}

function normalizeTokenBudget(raw: unknown, base: TokenBudgetConfig): TokenBudgetConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("token_budget 必须是对象", "INVALID_INPUT", "token_budget");
  const config: TokenBudgetConfig = {
    limit_tokens:
      source.limit_tokens === undefined ? base.limit_tokens : requireNonNegativeInt(source.limit_tokens, "token_budget.limit_tokens"),
    per_action_limit:
      source.per_action_limit === undefined
        ? base.per_action_limit
        : requireNonNegativeInt(source.per_action_limit, "token_budget.per_action_limit"),
    used_tokens: source.used_tokens === undefined ? base.used_tokens : requireNonNegativeInt(source.used_tokens, "token_budget.used_tokens"),
    on_exceed: source.on_exceed === undefined ? base.on_exceed : requireEnum(source.on_exceed, ON_EXCEED, "token_budget.on_exceed"),
  };
  return config;
}

function normalizeCompany(raw: unknown, base: CompanyProfile | undefined): CompanyProfile {
  if (!isRecord(raw)) throw new ConfigValidationError("profile.company 必须是对象", "INVALID_INPUT", "profile.company");
  return {
    name: raw.name === undefined && base !== undefined ? base.name : requireString(raw.name, "profile.company.name"),
    license_no_masked:
      raw.license_no_masked === undefined && base !== undefined
        ? base.license_no_masked
        : requireString(raw.license_no_masked, "profile.company.license_no_masked"),
    tax_no_masked:
      raw.tax_no_masked === undefined && base !== undefined
        ? base.tax_no_masked
        : requireString(raw.tax_no_masked, "profile.company.tax_no_masked"),
    legal_representative:
      raw.legal_representative === undefined && base !== undefined
        ? base.legal_representative
        : requireString(raw.legal_representative, "profile.company.legal_representative"),
    agent_name:
      raw.agent_name === undefined && base !== undefined ? base.agent_name : requireString(raw.agent_name, "profile.company.agent_name"),
  };
}

function normalizeProfile(raw: unknown, base: Profile): Profile {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("profile 必须是对象", "INVALID_INPUT", "profile");
  const mode = source.mode === undefined ? base.mode : requireEnum(source.mode, RUN_MODES, "profile.mode");
  const profile: Profile = {
    mode,
    operator_type:
      source.operator_type === undefined ? base.operator_type : requireEnum(source.operator_type, OPERATOR_TYPES, "profile.operator_type"),
    language: source.language === undefined ? base.language : requireEnum(source.language, LANGUAGES, "profile.language"),
    currency: source.currency === undefined ? base.currency : requireEnum(source.currency, ["CNY"] as const, "profile.currency"),
    timezone: source.timezone === undefined ? base.timezone : requireString(source.timezone, "profile.timezone"),
    principal_name: source.principal_name === undefined ? base.principal_name : requireString(source.principal_name, "profile.principal_name"),
  };
  if (source.company !== undefined) {
    profile.company = normalizeCompany(source.company, base.company);
  } else if (base.company !== undefined && mode === "enterprise") {
    profile.company = cloneJson(base.company);
  }
  return profile;
}

function normalizePaymentProvider(raw: unknown, fallbackId: string): PaymentProvider {
  if (!isRecord(raw)) throw new ConfigValidationError("payments.providers[] 必须是对象", "INVALID_INPUT", "payments.providers");
  const provider: PaymentProvider = {
    id: raw.id === undefined ? fallbackId : requireString(raw.id, "payments.providers[].id"),
    kind: requireEnum(raw.kind, PAYMENT_KINDS, "payments.providers[].kind"),
    name: requireString(raw.name, "payments.providers[].name"),
    enabled: raw.enabled === undefined ? true : requireBoolean(raw.enabled, "payments.providers[].enabled"),
    mode: raw.mode === undefined ? "manual_approval" : requireEnum(raw.mode, PAYMENT_MODES, "payments.providers[].mode"),
    account_masked: raw.account_masked === undefined ? "—" : String(raw.account_masked),
  };
  const note = optionalString(raw.note, "payments.providers[].note");
  if (note !== undefined) provider.note = note;
  return provider;
}

function normalizePayout(raw: unknown, base: PayoutAccount): PayoutAccount {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("payments.payout_account 必须是对象", "INVALID_INPUT", "payments.payout_account");
  const payout: PayoutAccount = {
    holder: source.holder === undefined ? base.holder : requireString(source.holder, "payments.payout_account.holder"),
    bank_name: source.bank_name === undefined ? base.bank_name : requireString(source.bank_name, "payments.payout_account.bank_name"),
    card_no_masked:
      source.card_no_masked === undefined
        ? base.card_no_masked
        : requireString(source.card_no_masked, "payments.payout_account.card_no_masked"),
    type: source.type === undefined ? base.type : requireEnum(source.type, ["personal", "corporate"] as const, "payments.payout_account.type"),
  };
  const wechat = source.wechat_id_masked === undefined ? base.wechat_id_masked : optionalString(source.wechat_id_masked, "payments.payout_account.wechat_id_masked");
  if (wechat !== undefined) payout.wechat_id_masked = wechat;
  const alipay = source.alipay_id_masked === undefined ? base.alipay_id_masked : optionalString(source.alipay_id_masked, "payments.payout_account.alipay_id_masked");
  if (alipay !== undefined) payout.alipay_id_masked = alipay;
  return payout;
}

function normalizeInvoice(raw: unknown, base: InvoiceConfig): InvoiceConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("payments.invoice 必须是对象", "INVALID_INPUT", "payments.invoice");
  const invoice: InvoiceConfig = {
    default_type: source.default_type === undefined ? base.default_type : requireEnum(source.default_type, INVOICE_TYPES, "payments.invoice.default_type"),
    title: source.title === undefined ? base.title : String(source.title),
    draft_only: source.draft_only === undefined ? base.draft_only : requireBoolean(source.draft_only, "payments.invoice.draft_only"),
  };
  const taxNo = source.tax_no_masked === undefined ? base.tax_no_masked : optionalString(source.tax_no_masked, "payments.invoice.tax_no_masked");
  if (taxNo !== undefined) invoice.tax_no_masked = taxNo;
  return invoice;
}

/** v1.3：易支付（epay）配置归一化（旧 config 缺 epay 时补默认：demo/disabled）。 */
function normalizeEpay(raw: unknown, base: EpayConfig): EpayConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("payments.epay 必须是对象", "INVALID_INPUT", "payments.epay");
  const epay: EpayConfig = {
    enabled: source.enabled === undefined ? base.enabled : requireBoolean(source.enabled, "payments.epay.enabled"),
    gateway_url: source.gateway_url === undefined ? base.gateway_url : requireString(source.gateway_url, "payments.epay.gateway_url"),
    pid: source.pid === undefined ? base.pid : String(source.pid).trim(),
    key_ref: source.key_ref === undefined ? base.key_ref : normalizeApiKeyRefValue(source.key_ref, "payments.epay.key_ref"),
    pay_types:
      source.pay_types === undefined
        ? [...base.pay_types]
        : (() => {
            if (!Array.isArray(source.pay_types)) throw new ConfigValidationError("payments.epay.pay_types 必须是数组", "INVALID_INPUT", "payments.epay.pay_types");
            return source.pay_types.map((item) => requireEnum(item, EPAY_PAY_TYPES, "payments.epay.pay_types[]"));
          })(),
    notify_url: source.notify_url === undefined ? base.notify_url : requireString(source.notify_url, "payments.epay.notify_url"),
    return_url: source.return_url === undefined ? base.return_url : requireString(source.return_url, "payments.epay.return_url"),
    mode: source.mode === undefined ? base.mode : requireEnum(source.mode, EPAY_MODES, "payments.epay.mode"),
    sign_type: "MD5",
  };
  if (source.sign_type !== undefined && source.sign_type !== "MD5") {
    throw new ConfigValidationError("payments.epay.sign_type 目前只支持 MD5", "INVALID_INPUT", "payments.epay.sign_type");
  }
  return epay;
}

function normalizePayments(raw: unknown, base: PaymentsConfig): PaymentsConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("payments 必须是对象", "INVALID_INPUT", "payments");
  let providers: PaymentProvider[];
  if (source.providers === undefined) {
    providers = base.providers.map((provider) => cloneJson(provider));
  } else {
    if (!Array.isArray(source.providers)) throw new ConfigValidationError("payments.providers 必须是数组", "INVALID_INPUT", "payments.providers");
    providers = source.providers.map((provider, index) => normalizePaymentProvider(provider, `provider-${index + 1}`));
  }
  const payments: PaymentsConfig = {
    providers,
    payout_account: normalizePayout(source.payout_account, base.payout_account),
    invoice: normalizeInvoice(source.invoice, base.invoice),
    require_dual_review:
      source.require_dual_review === undefined ? base.require_dual_review : requireBoolean(source.require_dual_review, "payments.require_dual_review"),
    sign_contract: source.sign_contract === undefined ? base.sign_contract : requireBoolean(source.sign_contract, "payments.sign_contract"),
    ai_may_sign: false,
    epay: normalizeEpay(source.epay, base.epay ?? defaultEpayConfig()),
  };
  return payments;
}

function normalizeAgent(raw: unknown, fallback?: AgentConfig): AgentConfig {
  if (!isRecord(raw)) throw new ConfigValidationError("agents[] 必须是对象", "INVALID_INPUT", "agents");
  const role = raw.role === undefined && fallback !== undefined ? fallback.role : requireString(raw.role, "agents[].role");
  const agent: AgentConfig = {
    role,
    name: raw.name === undefined && fallback !== undefined ? fallback.name : requireString(raw.name, "agents[].name"),
    enabled: raw.enabled === undefined ? (fallback?.enabled ?? true) : requireBoolean(raw.enabled, "agents[].enabled"),
    autonomy:
      raw.autonomy === undefined
        ? (fallback?.autonomy ?? "readonly")
        : requireEnum(raw.autonomy, AUTONOMY_VALUES, "agents[].autonomy"),
    tools: raw.tools === undefined ? [...(fallback?.tools ?? [])] : requireStringArray(raw.tools, "agents[].tools"),
    token_limit:
      raw.token_limit === undefined
        ? (fallback?.token_limit ?? 0)
        : requireNonNegativeInt(raw.token_limit, "agents[].token_limit"),
    model_ref: raw.model_ref === undefined && fallback !== undefined ? fallback.model_ref : requireString(raw.model_ref, "agents[].model_ref"),
  };
  // v1.5：Agent Harness 元数据（旧 config 缺 harness 时从默认值补齐；supervisor 可空）
  if (raw.harness === undefined) {
    if (fallback?.harness !== undefined) agent.harness = cloneJson(fallback.harness);
  } else if (raw.harness !== null) {
    agent.harness = normalizeAgentHarnessMeta(raw.harness, fallback?.harness);
  }
  return agent;
}

function normalizeAgents(raw: unknown, base: AgentConfig[]): AgentConfig[] {
  if (raw === undefined) return base.map((agent) => cloneJson(agent));
  if (!Array.isArray(raw)) throw new ConfigValidationError("agents 必须是数组", "INVALID_INPUT", "agents");
  const baseByRole = new Map(base.map((agent) => [agent.role, agent]));
  const result: AgentConfig[] = base.map((agent) => cloneJson(agent));
  const seen = new Set<string>();
  for (const item of raw) {
    const agent = normalizeAgent(item, isRecord(item) && typeof item.role === "string" ? baseByRole.get(item.role) : undefined);
    if (seen.has(agent.role)) throw new ConfigValidationError(`代理角色重复：${agent.role}`, "INVALID_INPUT", "agents");
    seen.add(agent.role);
    const index = result.findIndex((existing) => existing.role === agent.role);
    if (index >= 0) result[index] = agent;
    else result.push(agent);
  }
  return result;
}

function normalizeApproval(raw: unknown, base: ApprovalPolicy): ApprovalPolicy {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("approval 必须是对象", "INVALID_INPUT", "approval");
  if (source.auto_approve === true) {
    throw new ConfigValidationError("approval.auto_approve 必须为 false：审批不得自动放行", "INVALID_INPUT", "approval.auto_approve");
  }
  return {
    timeout_minutes:
      source.timeout_minutes === undefined ? base.timeout_minutes : requireNonNegativeInt(source.timeout_minutes, "approval.timeout_minutes"),
    auto_approve: false,
    dual_review_threshold_cny:
      source.dual_review_threshold_cny === undefined
        ? base.dual_review_threshold_cny
        : requireNumber(source.dual_review_threshold_cny, "approval.dual_review_threshold_cny", { min: 0 }),
    takeover_shortcut:
      source.takeover_shortcut === undefined ? base.takeover_shortcut : requireString(source.takeover_shortcut, "approval.takeover_shortcut"),
  };
}

function normalizeData(raw: unknown, base: DataConfig): DataConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("data 必须是对象", "INVALID_INPUT", "data");
  if (source.telemetry === true) {
    throw new ConfigValidationError("data.telemetry 必须为 false：本产品无遥测", "INVALID_INPUT", "data.telemetry");
  }
  return {
    retention_days: source.retention_days === undefined ? base.retention_days : requireNonNegativeInt(source.retention_days, "data.retention_days"),
    telemetry: false,
  };
}

/** v1.3：系统动作策略归一化（受管应用白名单/插件目录/危险动作二次确认；旧 config 补默认）。 */
function normalizeManagedApp(raw: unknown, index: number, fallback?: ManagedAppConfig): ManagedAppConfig {
  if (!isRecord(raw)) throw new ConfigValidationError("system_policy.managed_apps[] 必须是对象", "INVALID_INPUT", "system_policy.managed_apps");
  const id = raw.id === undefined && fallback !== undefined ? fallback.id : requireString(raw.id, "system_policy.managed_apps[].id");
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new ConfigValidationError(`受管应用 id 非法：${id}（小写字母/数字/-/_，1-64 位）`, "INVALID_INPUT", "system_policy.managed_apps[].id");
  }
  const app: ManagedAppConfig = {
    id,
    name: raw.name === undefined && fallback !== undefined ? fallback.name : requireString(raw.name, "system_policy.managed_apps[].name"),
    command: raw.command === undefined && fallback !== undefined ? fallback.command : requireString(raw.command, "system_policy.managed_apps[].command"),
    allow_start: raw.allow_start === undefined ? (fallback?.allow_start ?? true) : requireBoolean(raw.allow_start, "system_policy.managed_apps[].allow_start"),
    allow_stop: raw.allow_stop === undefined ? (fallback?.allow_stop ?? true) : requireBoolean(raw.allow_stop, "system_policy.managed_apps[].allow_stop"),
    allow_remove: raw.allow_remove === undefined ? (fallback?.allow_remove ?? false) : requireBoolean(raw.allow_remove, "system_policy.managed_apps[].allow_remove"),
  };
  if (index < 0) throw new ConfigValidationError("managed_apps 索引非法", "INVALID_INPUT", "system_policy.managed_apps");
  return app;
}

function normalizeSystemPolicy(raw: unknown, base: SystemPolicyConfig): SystemPolicyConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("system_policy 必须是对象", "INVALID_INPUT", "system_policy");
  let managedApps: ManagedAppConfig[];
  if (source.managed_apps === undefined) {
    managedApps = base.managed_apps.map((app) => cloneJson(app));
  } else {
    if (!Array.isArray(source.managed_apps)) {
      throw new ConfigValidationError("system_policy.managed_apps 必须是数组", "INVALID_INPUT", "system_policy.managed_apps");
    }
    const baseById = new Map(base.managed_apps.map((app) => [app.id, app]));
    managedApps = source.managed_apps.map((item, index) =>
      normalizeManagedApp(item, index, isRecord(item) && typeof item.id === "string" ? baseById.get(item.id) : undefined),
    );
  }
  return {
    managed_apps: managedApps,
    plugins_dir: source.plugins_dir === undefined ? base.plugins_dir : requireString(source.plugins_dir, "system_policy.plugins_dir"),
    allow_destructive:
      source.allow_destructive === undefined ? base.allow_destructive : requireBoolean(source.allow_destructive, "system_policy.allow_destructive"),
    require_confirmation:
      source.require_confirmation === undefined ? base.require_confirmation : requireBoolean(source.require_confirmation, "system_policy.require_confirmation"),
    confirmation_ttl_seconds:
      source.confirmation_ttl_seconds === undefined
        ? base.confirmation_ttl_seconds
        : requireNonNegativeInt(source.confirmation_ttl_seconds, "system_policy.confirmation_ttl_seconds"),
  };
}

/** v1.4：运行时设置归一化（旧 config 缺 runtime 时补该模式默认值；范围/枚举非法直接拒绝）。 */
function normalizeRuntimeSettings(raw: unknown, base: RuntimeSettings): RuntimeSettings {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("runtime 必须是对象", "INVALID_INPUT", "runtime");
  return {
    auto_run: source.auto_run === undefined ? base.auto_run : requireBoolean(source.auto_run, "runtime.auto_run"),
    approval_mode:
      source.approval_mode === undefined ? base.approval_mode : requireEnum(source.approval_mode, APPROVAL_MODES, "runtime.approval_mode"),
    full_auto: source.full_auto === undefined ? base.full_auto : requireBoolean(source.full_auto, "runtime.full_auto"),
    max_auto_steps:
      source.max_auto_steps === undefined
        ? base.max_auto_steps
        : requireIntInRange(source.max_auto_steps, "runtime.max_auto_steps", RUNTIME_MAX_AUTO_STEPS_RANGE.min, RUNTIME_MAX_AUTO_STEPS_RANGE.max),
    rework_limit:
      source.rework_limit === undefined
        ? base.rework_limit
        : requireIntInRange(source.rework_limit, "runtime.rework_limit", RUNTIME_REWORK_LIMIT_RANGE.min, RUNTIME_REWORK_LIMIT_RANGE.max),
    event_retention:
      source.event_retention === undefined
        ? base.event_retention
        : requireIntInRange(source.event_retention, "runtime.event_retention", RUNTIME_EVENT_RETENTION_RANGE.min, RUNTIME_EVENT_RETENTION_RANGE.max),
  };
}

// ---------------------------------------------------------------------------
// v1.5：Harness 真实执行设置 归一化（旧 config 缺 harness / roles 时补默认）
// ---------------------------------------------------------------------------

/** Agent 的 Harness 元数据归一化（profile/workspace/tools）。 */
function normalizeAgentHarnessMeta(raw: unknown, fallback?: AgentHarnessMeta): AgentHarnessMeta {
  if (!isRecord(raw)) throw new ConfigValidationError("agents[].harness 必须是对象", "INVALID_INPUT", "agents[].harness");
  const meta: AgentHarnessMeta = {
    profile: raw.profile === undefined && fallback !== undefined ? fallback.profile : requireString(raw.profile, "agents[].harness.profile"),
    workspace: raw.workspace === undefined && fallback !== undefined ? fallback.workspace : requireString(raw.workspace, "agents[].harness.workspace"),
    tools: raw.tools === undefined ? [...(fallback?.tools ?? [])] : requireStringArray(raw.tools, "agents[].harness.tools"),
  };
  if (meta.tools.length === 0) throw new ConfigValidationError("agents[].harness.tools 至少需要一项工具", "INVALID_INPUT", "agents[].harness.tools");
  if (!HARNESS_WORKSPACE_PATTERN.test(meta.workspace)) {
    throw new ConfigValidationError(`agents[].harness.workspace 必须是安全相对路径：${meta.workspace}`, "INVALID_INPUT", "agents[].harness.workspace");
  }
  return meta;
}

/** 单个角色的 Harness 设置归一化（role 必须合法；supervisor 强制 enabled=false）。 */
function normalizeHarnessRoleSettings(raw: unknown, fallbackRole?: string, fallback?: HarnessRoleSettings): HarnessRoleSettings {
  if (!isRecord(raw)) throw new ConfigValidationError("harness.roles[] 必须是对象", "INVALID_INPUT", "harness.roles");
  const role = raw.role === undefined && fallbackRole !== undefined ? fallbackRole : requireString(raw.role, "harness.roles[].role");
  if (!(AGENT_ROLES as readonly string[]).includes(role)) {
    throw new ConfigValidationError(`harness.roles 角色非法：${role}（允许：${AGENT_ROLES.join("/")}）`, "INVALID_INPUT", "harness.roles[].role");
  }
  const settings: HarnessRoleSettings = {
    role,
    enabled: raw.enabled === undefined ? (fallback?.enabled ?? role !== "supervisor") : requireBoolean(raw.enabled, "harness.roles[].enabled"),
    workspace:
      raw.workspace === undefined && fallback !== undefined ? fallback.workspace : requireString(raw.workspace, "harness.roles[].workspace"),
    timeout_ms:
      raw.timeout_ms === undefined
        ? (fallback?.timeout_ms ?? 300_000)
        : requireIntInRange(raw.timeout_ms, "harness.roles[].timeout_ms", HARNESS_TIMEOUT_RANGE.min, HARNESS_TIMEOUT_RANGE.max),
    max_tokens_per_run:
      raw.max_tokens_per_run === undefined
        ? (fallback?.max_tokens_per_run ?? 200_000)
        : requireIntInRange(raw.max_tokens_per_run, "harness.roles[].max_tokens_per_run", HARNESS_MAX_TOKENS_RANGE.min, HARNESS_MAX_TOKENS_RANGE.max),
  };
  if (!HARNESS_WORKSPACE_PATTERN.test(settings.workspace)) {
    throw new ConfigValidationError(`harness.roles[${role}].workspace 必须是安全相对路径：${settings.workspace}`, "INVALID_INPUT", "harness.roles[].workspace");
  }
  if (role === "supervisor" && settings.enabled) {
    throw new ConfigValidationError("supervisor 不得走真实 Harness 执行（仅系统动作），enabled 必须为 false", "INVALID_INPUT", "harness.roles.supervisor.enabled");
  }
  return settings;
}

/** Harness 总设置归一化：缺字段补默认、roles 按角色合并并保证 11 角色齐全。 */
function normalizeHarnessSettings(raw: unknown, base: HarnessSettings): HarnessSettings {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("harness 必须是对象", "INVALID_INPUT", "harness");
  const settings: HarnessSettings = {
    enabled: source.enabled === undefined ? base.enabled : requireBoolean(source.enabled, "harness.enabled"),
    profile: source.profile === undefined ? base.profile : requireString(source.profile, "harness.profile"),
    dsh_bin: source.dsh_bin === undefined ? base.dsh_bin : String(source.dsh_bin).trim(),
    timeout_ms:
      source.timeout_ms === undefined
        ? base.timeout_ms
        : requireIntInRange(source.timeout_ms, "harness.timeout_ms", HARNESS_TIMEOUT_RANGE.min, HARNESS_TIMEOUT_RANGE.max),
    max_concurrency:
      source.max_concurrency === undefined
        ? base.max_concurrency
        : requireIntInRange(source.max_concurrency, "harness.max_concurrency", HARNESS_MAX_CONCURRENCY_RANGE.min, HARNESS_MAX_CONCURRENCY_RANGE.max),
    artifact_retention_days:
      source.artifact_retention_days === undefined
        ? base.artifact_retention_days
        : requireIntInRange(
            source.artifact_retention_days,
            "harness.artifact_retention_days",
            HARNESS_ARTIFACT_RETENTION_RANGE.min,
            HARNESS_ARTIFACT_RETENTION_RANGE.max,
          ),
    report_required: source.report_required === undefined ? base.report_required : requireBoolean(source.report_required, "harness.report_required"),
    roles: [],
  };
  if (settings.profile.trim() === "") throw new ConfigValidationError("harness.profile 不能为空", "INVALID_INPUT", "harness.profile");
  if (settings.dsh_bin.includes("\n") || settings.dsh_bin.includes("\r")) {
    throw new ConfigValidationError("harness.dsh_bin 不能包含换行", "INVALID_INPUT", "harness.dsh_bin");
  }
  const baseByRole = new Map(base.roles.map((entry) => [entry.role, entry]));
  const roleMap = new Map<string, HarnessRoleSettings>();
  for (const role of AGENT_ROLES) {
    const fallback = baseByRole.get(role);
    if (fallback !== undefined) roleMap.set(role, cloneJson(fallback));
  }
  if (source.roles !== undefined) {
    if (!Array.isArray(source.roles)) throw new ConfigValidationError("harness.roles 必须是数组", "INVALID_INPUT", "harness.roles");
    const seen = new Set<string>();
    for (const item of source.roles) {
      const roleGuess = isRecord(item) && typeof item.role === "string" ? item.role : undefined;
      const fallback = roleGuess === undefined ? undefined : (roleMap.get(roleGuess) ?? baseByRole.get(roleGuess));
      const normalized = normalizeHarnessRoleSettings(item, roleGuess, fallback);
      if (seen.has(normalized.role)) throw new ConfigValidationError(`harness.roles 角色重复：${normalized.role}`, "INVALID_INPUT", "harness.roles");
      seen.add(normalized.role);
      roleMap.set(normalized.role, normalized);
    }
  }
  // 缺 roles 时补全 11 个角色默认值（迁移）
  for (const role of AGENT_ROLES) {
    if (roleMap.has(role)) continue;
    roleMap.set(role, normalizeHarnessRoleSettings({ role }, role, baseByRole.get(role)));
  }
  settings.roles = AGENT_ROLES.map((role) => {
    const entry = roleMap.get(role);
    if (entry === undefined) throw new ConfigValidationError(`harness.roles 缺少角色：${role}`, "INVALID_INPUT", "harness.roles");
    return entry;
  });
  return settings;
}

// ---------------------------------------------------------------------------
// v1.2：模型路由 / API 密钥引用 / 系统提示词 归一化（旧 config 缺字段时用模式默认值迁移）
// ---------------------------------------------------------------------------

function normalizeApiKeyRefValue(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ConfigValidationError(`${field} 必须是字符串（env:NAME / file:path#key）`, "INVALID_INPUT", field);
  const ref = value.trim();
  if (ref === "") return "";
  if (!isValidApiKeyRef(ref)) {
    throw new ConfigValidationError(
      `${field} 密钥引用格式非法：${ref}（只允许 env:NAME 或 file:<相对路径>#<key>；不要把明文密钥写进配置）`,
      "INVALID_INPUT",
      field,
    );
  }
  return ref;
}

function normalizeModelProvider(raw: unknown, index: number, fallback?: ModelProviderConfig): ModelProviderConfig {
  if (!isRecord(raw)) throw new ConfigValidationError("models.providers[] 必须是对象", "INVALID_INPUT", "models.providers");
  const id = raw.id === undefined && fallback !== undefined ? fallback.id : requireString(raw.id, "models.providers[].id");
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new ConfigValidationError(`服务商 id 非法：${id}（小写字母/数字/-/_，1-64 位）`, "INVALID_INPUT", "models.providers[].id");
  }
  const provider: ModelProviderConfig = {
    id,
    name: raw.name === undefined && fallback !== undefined ? fallback.name : requireString(raw.name, "models.providers[].name"),
    kind: raw.kind === undefined && fallback !== undefined ? fallback.kind : requireEnum(raw.kind, MODEL_PROVIDER_KINDS, "models.providers[].kind"),
    base_url:
      raw.base_url === undefined && fallback !== undefined
        ? fallback.base_url
        : requireString(raw.base_url, "models.providers[].base_url"),
    api_key_ref: raw.api_key_ref === undefined ? (fallback?.api_key_ref ?? "") : normalizeApiKeyRefValue(raw.api_key_ref, "models.providers[].api_key_ref"),
    enabled: raw.enabled === undefined ? (fallback?.enabled ?? true) : requireBoolean(raw.enabled, "models.providers[].enabled"),
    default_model:
      raw.default_model === undefined && fallback !== undefined
        ? fallback.default_model
        : requireString(raw.default_model, "models.providers[].default_model"),
    models: raw.models === undefined ? [...(fallback?.models ?? [])] : requireStringArray(raw.models, "models.providers[].models"),
  };
  if (!HTTP_URL_PATTERN.test(provider.base_url)) {
    throw new ConfigValidationError(`服务商 base_url 必须是 http(s) 绝对地址：${provider.base_url}`, "INVALID_INPUT", "models.providers[].base_url");
  }
  if (provider.models.length === 0) {
    throw new ConfigValidationError(`服务商 ${provider.id} 至少需要一个模型名`, "INVALID_INPUT", "models.providers[].models");
  }
  const note = typeof raw.note === "string" && raw.note.trim() !== "" ? raw.note.trim() : fallback?.note;
  if (note !== undefined) provider.note = note;
  return provider;
}

function normalizeModelProviders(raw: unknown, base: ModelProviderConfig[]): ModelProviderConfig[] {
  if (raw === undefined) return base.map((provider) => cloneJson(provider));
  if (!Array.isArray(raw)) throw new ConfigValidationError("models.providers 必须是数组", "INVALID_INPUT", "models.providers");
  const baseById = new Map(base.map((provider) => [provider.id, provider]));
  const result: ModelProviderConfig[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const fallback = isRecord(item) && typeof item.id === "string" ? baseById.get(item.id) : undefined;
    const provider = normalizeModelProvider(item, index, fallback);
    if (seen.has(provider.id)) throw new ConfigValidationError(`服务商 id 重复：${provider.id}`, "INVALID_INPUT", "models.providers");
    seen.add(provider.id);
    result.push(provider);
  }
  if (result.length === 0) throw new ConfigValidationError("models.providers 至少需要一个服务商", "INVALID_INPUT", "models.providers");
  return result;
}

function normalizeAgentModelBinding(raw: unknown, field: string): AgentModelBinding {
  if (!isRecord(raw)) throw new ConfigValidationError(`${field} 必须是对象`, "INVALID_INPUT", field);
  const binding: AgentModelBinding = {
    provider_id: requireString(raw.provider_id, `${field}.provider_id`),
    model: requireString(raw.model, `${field}.model`),
  };
  if (raw.temperature !== undefined) {
    const temperature = requireNumber(raw.temperature, `${field}.temperature`, { min: 0 });
    if (temperature > 2) throw new ConfigValidationError(`${field}.temperature 必须在 0-2 之间`, "INVALID_INPUT", `${field}.temperature`);
    binding.temperature = temperature;
  }
  if (raw.max_tokens !== undefined) binding.max_tokens = requireNonNegativeInt(raw.max_tokens, `${field}.max_tokens`);
  return binding;
}

function normalizeAgentModels(
  raw: unknown,
  base: Record<string, AgentModelBinding>,
  providers: ModelProviderConfig[],
  defaultProviderId: string,
): Record<string, AgentModelBinding> {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const fallbackProvider = providers.find((provider) => provider.id === defaultProviderId) ?? providers[0];
  const fallbackBinding: AgentModelBinding = {
    provider_id: fallbackProvider?.id ?? defaultProviderId,
    model: fallbackProvider?.default_model ?? "deepseek-chat",
  };
  const result: Record<string, AgentModelBinding> = {};
  for (const role of AGENT_ROLES) {
    const baseBinding = base[role];
    const binding =
      baseBinding !== undefined && providerIds.has(baseBinding.provider_id) && baseBinding.model.trim() !== ""
        ? cloneJson(baseBinding)
        : cloneJson(fallbackBinding);
    result[role] = binding;
  }
  if (raw === undefined) return result;
  if (!isRecord(raw)) throw new ConfigValidationError("models.agent_models 必须是对象（role -> binding）", "INVALID_INPUT", "models.agent_models");
  for (const [role, value] of Object.entries(raw)) {
    const roleName = requireString(role, "models.agent_models 的 role");
    result[roleName] = normalizeAgentModelBinding(value, `models.agent_models.${roleName}`);
  }
  return result;
}

function normalizeModels(raw: unknown, base: ModelRoutingConfig): ModelRoutingConfig {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("models 必须是对象", "INVALID_INPUT", "models");
  const providers = normalizeModelProviders(source.providers, base.providers);
  const defaultProviderId =
    source.default_provider_id === undefined ? base.default_provider_id : requireString(source.default_provider_id, "models.default_provider_id");
  const models: ModelRoutingConfig = {
    sync_mode: source.sync_mode === undefined ? base.sync_mode : requireEnum(source.sync_mode, MODEL_SYNC_MODES, "models.sync_mode"),
    default_provider_id: defaultProviderId,
    providers,
    agent_models: normalizeAgentModels(source.agent_models, base.agent_models, providers, defaultProviderId),
  };
  return models;
}

function normalizeSystemPromptEntry(raw: unknown, fallbackRole: string): SystemPromptConfig {
  if (!isRecord(raw)) throw new ConfigValidationError("orchestrator.system_prompts[] 必须是对象", "INVALID_INPUT", "orchestrator.system_prompts");
  const role = raw.role === undefined ? fallbackRole : requireString(raw.role, "orchestrator.system_prompts[].role");
  const prompt = raw.system_prompt === undefined ? "" : requireString(raw.system_prompt, `orchestrator.system_prompts[${role}].system_prompt`);
  return {
    role,
    title: raw.title === undefined ? role : requireString(raw.title, "orchestrator.system_prompts[].title"),
    system_prompt: prompt,
    updated_at: raw.updated_at === undefined ? "" : requireString(raw.updated_at, "orchestrator.system_prompts[].updated_at"),
  };
}

function normalizeOrchestrator(raw: unknown, base: OrchestratorSettings, now: () => Date): OrchestratorSettings {
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) throw new ConfigValidationError("orchestrator 必须是对象", "INVALID_INPUT", "orchestrator");
  const conductorPrompt =
    source.conductor_prompt === undefined ? base.conductor_prompt : requireString(source.conductor_prompt, "orchestrator.conductor_prompt");
  const systemPrompts = new Map<string, SystemPromptConfig>();
  for (const entry of base.system_prompts) systemPrompts.set(entry.role, cloneJson(entry));
  if (source.system_prompts !== undefined) {
    if (!Array.isArray(source.system_prompts)) {
      throw new ConfigValidationError("orchestrator.system_prompts 必须是数组", "INVALID_INPUT", "orchestrator.system_prompts");
    }
    for (const item of source.system_prompts) {
      const entry = normalizeSystemPromptEntry(item, "");
      if (entry.role === "") throw new ConfigValidationError("system_prompts 条目缺少 role", "INVALID_INPUT", "orchestrator.system_prompts");
      if (entry.system_prompt === "") {
        const fallback = systemPrompts.get(entry.role);
        if (fallback !== undefined) entry.system_prompt = fallback.system_prompt;
        else throw new ConfigValidationError(`system_prompts[${entry.role}] 缺少 system_prompt`, "INVALID_INPUT", "orchestrator.system_prompts");
      }
      if (entry.updated_at === "") entry.updated_at = now().toISOString();
      systemPrompts.set(entry.role, entry);
    }
  }
  const iso = now().toISOString();
  const prompts: SystemPromptConfig[] = [];
  for (const role of SYSTEM_PROMPT_ROLES) {
    const entry = systemPrompts.get(role);
    if (entry !== undefined) {
      prompts.push(entry);
      continue;
    }
    const fallbackEntry = base.system_prompts.find((item) => item.role === role);
    prompts.push(fallbackEntry === undefined ? { role, title: role, system_prompt: `你是代掌 Steward 的 ${role} 智能体。`, updated_at: iso } : cloneJson(fallbackEntry));
  }
  for (const [role, entry] of systemPrompts) {
    if (!SYSTEM_PROMPT_ROLES.includes(role as (typeof SYSTEM_PROMPT_ROLES)[number])) prompts.push(entry);
  }
  const orchestrator: OrchestratorSettings = {
    conductor_prompt: conductorPrompt,
    system_prompts: prompts,
    auto_plan: source.auto_plan === undefined ? base.auto_plan : requireBoolean(source.auto_plan, "orchestrator.auto_plan"),
    max_steps_per_run:
      source.max_steps_per_run === undefined ? base.max_steps_per_run : requireNonNegativeInt(source.max_steps_per_run, "orchestrator.max_steps_per_run"),
    ask_before_commit:
      source.ask_before_commit === undefined ? base.ask_before_commit : requireBoolean(source.ask_before_commit, "orchestrator.ask_before_commit"),
  };
  return orchestrator;
}

/** 从任意 JSON（配置文件/import）构造完整配置；缺失字段用「其 mode 的默认值」兜底。 */
function buildConfigFromUnknown(raw: unknown, fallbackMode: RunMode, now: () => Date): StewardConfig {
  if (!isRecord(raw)) throw new ConfigValidationError("配置必须是 JSON 对象", "INVALID_INPUT", "(root)");
  let mode: RunMode = fallbackMode;
  if (isRecord(raw.profile) && raw.profile.mode !== undefined) {
    mode = requireEnum(raw.profile.mode, RUN_MODES, "profile.mode");
  }
  const base = buildDefaults(mode, { now });
  const config: StewardConfig = {
    version: raw.version === undefined ? CONFIG_VERSION : requireNonNegativeInt(raw.version, "version"),
    profile: normalizeProfile(raw.profile, base.profile),
    features: normalizeFeatures(raw.features, base.features),
    budgets: normalizeBudgets(raw.budgets, base.budgets),
    token_budget: normalizeTokenBudget(raw.token_budget, base.token_budget),
    payments: normalizePayments(raw.payments, base.payments),
    agents: normalizeAgents(raw.agents, base.agents),
    approval: normalizeApproval(raw.approval, base.approval),
    data: normalizeData(raw.data, base.data),
    // v1.2 新增字段：旧 config 缺 models/orchestrator 时自动补该模式默认值（迁移，不丢已有字段）
    models: normalizeModels(raw.models, base.models),
    orchestrator: normalizeOrchestrator(raw.orchestrator, base.orchestrator, now),
    // v1.3 新增字段：旧 config 缺 system_policy / payments.epay 时自动补默认（迁移，不丢已有字段）
    system_policy: normalizeSystemPolicy(raw.system_policy, base.system_policy),
    // v1.4 新增字段：旧 config 缺 runtime 时自动补该模式默认值（迁移，不丢已有字段）
    runtime: normalizeRuntimeSettings(raw.runtime, base.runtime),
    // v1.5 新增字段：旧 config 缺 harness / roles / agent harness 元数据时自动补默认（迁移）
    harness: normalizeHarnessSettings(raw.harness, base.harness),
    updated_at: raw.updated_at === undefined ? now().toISOString() : requireString(raw.updated_at, "updated_at"),
  };
  return config;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function issue(errors: ValidationIssue[], field: string, message: string): void {
  errors.push({ field, message });
}

function checkMaskedField(errors: ValidationIssue[], field: string, value: string | undefined, options: { required?: boolean } = {}): void {
  if (value === undefined) {
    if (options.required === true) issue(errors, field, `${field} 不能为空（企业模式必填）`);
    return;
  }
  if (value.trim() === "") {
    if (options.required === true) issue(errors, field, `${field} 不能为空（企业模式必填）`);
    return;
  }
  if (looksLikePlaintextCard(value) || looksLikePlaintextPhone(value)) {
    issue(errors, field, `${field} 疑似明文敏感信息（请只存掩码/引用，不存明文）`);
    return;
  }
  if (!isMaskedValue(value) && /(?:bank|card|license|tax)/u.test(field)) {
    issue(errors, field, `${field} 必须是掩码（含 *），不存明文`);
  }
}

/** 校验配置一致性（返回全部问题，不抛错；save/import 会据此抛 ConfigValidationError）。 */
export function validateConfig(config: StewardConfig): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(config)) return { ok: false, errors: [{ field: "(root)", message: "配置必须是对象" }] };
  if (typeof config.version !== "number" || config.version < 1) issue(errors, "version", "version 必须是 ≥1 的数字");

  const mode: RunMode = isRunMode(config.profile?.mode) ? config.profile.mode : "personal";
  if (!isRunMode(config.profile?.mode)) issue(errors, "profile.mode", "profile.mode 必须是 demo/personal/enterprise");
  if (config.profile?.operator_type !== undefined && !(OPERATOR_TYPES as readonly string[]).includes(config.profile.operator_type)) {
    issue(errors, "profile.operator_type", "profile.operator_type 必须是 individual/company");
  }
  if (mode !== "enterprise" && config.profile?.operator_type === "company") {
    issue(errors, "profile.operator_type", "非企业模式 operator_type 必须为 individual");
  }
  if (mode === "enterprise") {
    if (config.profile?.operator_type !== "company") issue(errors, "profile.operator_type", "企业模式 operator_type 必须为 company");
    const company = config.profile?.company;
    if (company === undefined) {
      issue(errors, "profile.company", "企业模式必须填写企业主体字段（名称/执照/税号/法人/经办人）");
    } else {
      for (const field of ["name", "legal_representative", "agent_name"] as const) {
        if (typeof company[field] !== "string" || company[field].trim() === "") issue(errors, `profile.company.${field}`, `企业模式 ${field} 不能为空`);
      }
      checkMaskedField(errors, "profile.company.license_no_masked", company.license_no_masked, { required: true });
      checkMaskedField(errors, "profile.company.tax_no_masked", company.tax_no_masked, { required: true });
    }
  }

  // 预算三层
  for (const kind of BUDGET_KINDS) {
    const key = BUDGET_LIMIT_KEYS[kind];
    const value = config.budgets?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) issue(errors, `budgets.${String(key)}`, `budgets.${String(key)} 必须是非负数字`);
  }
  if (
    typeof config.budgets?.per_txn_cny === "number" &&
    typeof config.budgets?.project_cny === "number" &&
    typeof config.budgets?.month_cny === "number" &&
    config.budgets.per_txn_cny >= 0 &&
    config.budgets.project_cny >= 0 &&
    config.budgets.month_cny >= 0 &&
    (config.budgets.per_txn_cny > config.budgets.project_cny || config.budgets.project_cny > config.budgets.month_cny)
  ) {
    issue(errors, "budgets", "预算三层必须满足 单笔 ≤ 项目 ≤ 月");
  }

  // Token 预算
  const token = config.token_budget;
  if (typeof token?.limit_tokens !== "number" || token.limit_tokens < 0) issue(errors, "token_budget.limit_tokens", "limit_tokens 必须是非负数字");
  if (typeof token?.per_action_limit !== "number" || token.per_action_limit < 0) issue(errors, "token_budget.per_action_limit", "per_action_limit 必须是非负数字");
  if (typeof token?.used_tokens !== "number" || token.used_tokens < 0) issue(errors, "token_budget.used_tokens", "used_tokens 必须是非负数字");
  if (typeof token?.limit_tokens === "number" && typeof token?.used_tokens === "number" && token.used_tokens > token.limit_tokens) {
    issue(errors, "token_budget.used_tokens", "used_tokens 不得超过 limit_tokens");
  }
  if (token !== undefined && !(ON_EXCEED as readonly string[]).includes(token.on_exceed)) issue(errors, "token_budget.on_exceed", "on_exceed 必须是 block/notify");

  // 支付 / 银行 / 发票
  const payments = config.payments;
  if (payments?.ai_may_sign !== false) issue(errors, "payments.ai_may_sign", "ai_may_sign 必须为 false：AI 不得代签");
  const providers = Array.isArray(payments?.providers) ? payments.providers : [];
  if (providers.length === 0) issue(errors, "payments.providers", "至少需要配置一个支付渠道");
  const providerIds = new Set<string>();
  for (const provider of providers) {
    if (providerIds.has(provider.id)) issue(errors, "payments.providers", `支付渠道 id 重复：${provider.id}`);
    providerIds.add(provider.id);
    if (!PAYMENT_KINDS.includes(provider.kind)) issue(errors, "payments.providers[].kind", `支付渠道类型非法：${String(provider.kind)}`);
    if (!PAYMENT_MODES.includes(provider.mode)) issue(errors, "payments.providers[].mode", `支付渠道模式非法：${String(provider.mode)}`);
    if (provider.kind === "personal_bank_card" || provider.kind === "corporate_account") {
      if (typeof provider.account_masked !== "string" || !isMaskedValue(provider.account_masked)) {
        issue(errors, "payments.providers[].account_masked", `支付渠道 ${provider.id} 的账号必须为掩码（只留后 4 位）`);
      }
    }
    if (looksLikePlaintextCard(String(provider.account_masked ?? ""))) {
      issue(errors, "payments.providers[].account_masked", `支付渠道 ${provider.id} 疑似明文账号，请改为掩码`);
    }
  }
  if (providers.length > 0 && !providers.some((provider) => provider.enabled && provider.mode !== "disabled")) {
    issue(errors, "payments.providers", "至少需要启用一个支付渠道（enabled=true 且 mode≠disabled）");
  }
  const payout = payments?.payout_account;
  if (payout === undefined) {
    issue(errors, "payments.payout_account", "必须配置收款账户（银行卡/微信/支付宝）");
  } else {
    if (typeof payout.holder !== "string" || payout.holder.trim() === "") issue(errors, "payments.payout_account.holder", "收款账户 holder 不能为空");
    if (typeof payout.bank_name !== "string" || payout.bank_name.trim() === "") issue(errors, "payments.payout_account.bank_name", "收款账户 bank_name 不能为空");
    checkMaskedField(errors, "payments.payout_account.card_no_masked", payout.card_no_masked, { required: true });
    if (mode === "personal" && payout.type !== "personal") issue(errors, "payments.payout_account.type", "个人模式收款账户必须是个人账户（type=personal）");
    if (mode === "enterprise" && payout.type !== "corporate") issue(errors, "payments.payout_account.type", "企业模式收款账户必须是对公账户（type=corporate）");
    if (payout.wechat_id_masked !== undefined && payout.wechat_id_masked !== "" && !isMaskedValue(payout.wechat_id_masked)) {
      issue(errors, "payments.payout_account.wechat_id_masked", "微信 id 必须为掩码");
    }
    if (payout.alipay_id_masked !== undefined && payout.alipay_id_masked !== "" && !isMaskedValue(payout.alipay_id_masked)) {
      issue(errors, "payments.payout_account.alipay_id_masked", "支付宝 id 必须为掩码");
    }
  }
  const invoice = payments?.invoice;
  if (invoice !== undefined) {
    if (!INVOICE_TYPES.includes(invoice.default_type)) issue(errors, "payments.invoice.default_type", `发票类型非法：${String(invoice.default_type)}`);
    if (invoice.default_type !== "none" && (typeof invoice.title !== "string" || invoice.title.trim() === "")) {
      issue(errors, "payments.invoice.title", "非 none 发票类型必须填写发票抬头");
    }
    checkMaskedField(errors, "payments.invoice.tax_no_masked", invoice.tax_no_masked);
    if (invoice.default_type === "vat_special" && (invoice.tax_no_masked === undefined || invoice.tax_no_masked.trim() === "")) {
      issue(errors, "payments.invoice.tax_no_masked", "增值税专票必须填写企业税号（掩码）");
    }
  }
  // v1.3：易支付（epay）校验：gateway 必须 https；live 必须补齐商家信息；key 只存引用
  const epay = payments?.epay;
  if (epay === undefined) {
    issue(errors, "payments.epay", "payments.epay 配置缺失（旧 config 应在加载时自动补默认 demo 配置）");
  } else {
    if (typeof epay.enabled !== "boolean") issue(errors, "payments.epay.enabled", "epay.enabled 必须是布尔值");
    if (typeof epay.gateway_url !== "string" || !HTTPS_URL_PATTERN.test(epay.gateway_url)) {
      issue(errors, "payments.epay.gateway_url", "易支付 gateway_url 必须是 https 地址");
    }
    if (!EPAY_MODES.includes(epay.mode)) issue(errors, "payments.epay.mode", `易支付 mode 非法：${String(epay.mode)}（demo/live）`);
    if (epay.sign_type !== "MD5") issue(errors, "payments.epay.sign_type", "易支付 sign_type 目前只支持 MD5");
    if (!Array.isArray(epay.pay_types) || epay.pay_types.length === 0) {
      issue(errors, "payments.epay.pay_types", "易支付至少需要一种支付方式（alipay/wxpay）");
    } else {
      for (const payType of epay.pay_types) {
        if (!EPAY_PAY_TYPES.includes(payType)) issue(errors, "payments.epay.pay_types", `易支付支付方式非法：${String(payType)}`);
      }
    }
    if (typeof epay.key_ref !== "string" || !isValidApiKeyRef(epay.key_ref)) {
      issue(errors, "payments.epay.key_ref", "易支付 key_ref 格式非法（只允许 env:EPAY_KEY / file:path#key / 空；禁止明文密钥）");
    }
    if (typeof epay.pid !== "string") issue(errors, "payments.epay.pid", "易支付 pid 必须是字符串");
    if (typeof epay.notify_url !== "string" || (epay.notify_url !== "" && !HTTP_URL_PATTERN.test(epay.notify_url))) {
      issue(errors, "payments.epay.notify_url", "易支付 notify_url 必须是 http(s) 地址或留空");
    }
    if (typeof epay.return_url !== "string" || (epay.return_url !== "" && !HTTP_URL_PATTERN.test(epay.return_url))) {
      issue(errors, "payments.epay.return_url", "易支付 return_url 必须是 http(s) 地址或留空");
    }
    if (epay.mode === "live") {
      if (typeof epay.pid !== "string" || epay.pid.trim() === "") {
        issue(errors, "payments.epay.pid", "易支付 live 模式必须填写商户 pid");
      }
      if (typeof epay.key_ref !== "string" || epay.key_ref.trim() === "") {
        issue(errors, "payments.epay.key_ref", "易支付 live 模式必须配置商户密钥引用（env:EPAY_KEY / file:secrets.json#epay）");
      }
      if (epay.notify_url.trim() === "" || !HTTP_URL_PATTERN.test(epay.notify_url)) {
        issue(errors, "payments.epay.notify_url", "易支付 live 模式必须配置 notify_url（http/https）");
      }
      if (epay.return_url.trim() === "" || !HTTP_URL_PATTERN.test(epay.return_url)) {
        issue(errors, "payments.epay.return_url", "易支付 live 模式必须配置 return_url（http/https）");
      }
    }
  }
  if (mode === "personal") {
    if (invoice !== undefined && invoice.default_type === "vat_special") {
      issue(errors, "payments.invoice.default_type", "个人模式不允许开具增值税专用发票（请用 none/personal_receipt/vat_general）");
    }
    if (providers.some((provider) => provider.kind === "corporate_account")) {
      issue(errors, "payments.providers", "个人模式不允许使用对公账户收款（请用微信/支付宝/个人银行卡）");
    }
    if (payments?.require_dual_review === true) issue(errors, "payments.require_dual_review", "个人模式无需双人复核（require_dual_review 应为 false）");
    if (payments?.sign_contract === true) issue(errors, "payments.sign_contract", "个人模式无需合同签署流程（sign_contract 应为 false）");
  }  if (mode === "enterprise") {
    if (!providers.some((provider) => provider.kind === "corporate_account" && provider.enabled)) {
      issue(errors, "payments.providers", "企业模式必须启用对公账户支付渠道");
    }
    if (invoice === undefined || invoice.default_type === "none") {
      issue(errors, "payments.invoice.default_type", "企业模式必须选择发票类型（增值税专票/普票）");
    }
    if (payments?.require_dual_review !== true) issue(errors, "payments.require_dual_review", "企业模式必须启用双人复核");
    if (payments?.sign_contract !== true) issue(errors, "payments.sign_contract", "企业模式必须启用合同签署/用印流程（AI 不代签）");
  }

  // 代理注册表
  const agents = Array.isArray(config.agents) ? config.agents : [];
  if (agents.length === 0) issue(errors, "agents", "至少需要 1 个代理角色");
  const roles = new Set<string>();
  for (const agent of agents) {
    if (typeof agent.role !== "string" || agent.role.trim() === "") issue(errors, "agents[].role", "代理角色不能为空");
    if (roles.has(agent.role)) issue(errors, "agents", `代理角色重复：${agent.role}`);
    roles.add(agent.role);
    if (!AUTONOMY_VALUES.includes(agent.autonomy)) issue(errors, "agents[].autonomy", `自主度非法：${String(agent.autonomy)}`);
    if (typeof agent.token_limit !== "number" || agent.token_limit < 0) issue(errors, "agents[].token_limit", "代理 token_limit 必须是非负数字");
  }
  for (const role of AGENT_ROLES) {
    if (!roles.has(role)) issue(errors, "agents", `缺少代理角色：${role}（可 disabled 但需保留配置）`);
  }
  if (agents.length > 0 && !agents.some((agent) => agent.enabled)) issue(errors, "agents", "至少需要启用一个代理角色");

  // 审批 / 数据
  if (config.approval?.auto_approve !== false) issue(errors, "approval.auto_approve", "auto_approve 必须为 false：审批超时挂起，不自动放行");
  if (typeof config.approval?.timeout_minutes !== "number" || config.approval.timeout_minutes <= 0) {
    issue(errors, "approval.timeout_minutes", "timeout_minutes 必须是正数");
  }
  if (typeof config.approval?.dual_review_threshold_cny !== "number" || config.approval.dual_review_threshold_cny < 0) {
    issue(errors, "approval.dual_review_threshold_cny", "dual_review_threshold_cny 必须是非负数字");
  }
  if (config.data?.telemetry !== false) issue(errors, "data.telemetry", "telemetry 必须为 false");
  if (typeof config.data?.retention_days !== "number" || config.data.retention_days < 1) {
    issue(errors, "data.retention_days", "retention_days 必须是 ≥1 的整数");
  }

  // v1.2：多模型路由 / API 密钥引用 / 各智能体模型绑定
  const models = config.models;
  if (!isRecord(models)) {
    issue(errors, "models", "models 配置缺失（旧配置文件应在加载时自动迁移补默认值）");
  } else {
    const providers = Array.isArray(models.providers) ? models.providers : [];
    if (providers.length === 0) issue(errors, "models.providers", "至少需要配置一个模型服务商");
    const providerIds = new Set<string>();
    const configuredRefs: string[] = [];
    for (const provider of providers) {
      if (typeof provider.id !== "string" || !PROVIDER_ID_PATTERN.test(provider.id)) {
        issue(errors, "models.providers[].id", `服务商 id 非法：${String(provider.id)}`);
      }
      if (providerIds.has(provider.id)) issue(errors, "models.providers", `服务商 id 重复：${provider.id}`);
      providerIds.add(provider.id);
      if (!MODEL_PROVIDER_KINDS.includes(provider.kind)) issue(errors, "models.providers[].kind", `服务商类型非法：${String(provider.kind)}`);
      if (typeof provider.base_url !== "string" || !HTTP_URL_PATTERN.test(provider.base_url)) {
        issue(errors, "models.providers[].base_url", `服务商 ${provider.id} base_url 必须是 http(s) 绝对地址`);
      }
      if (typeof provider.default_model !== "string" || provider.default_model.trim() === "") {
        issue(errors, "models.providers[].default_model", `服务商 ${provider.id} default_model 不能为空`);
      }
      if (!Array.isArray(provider.models) || provider.models.length === 0) {
        issue(errors, "models.providers[].models", `服务商 ${provider.id} 至少需要一个模型名`);
      }
      if (provider.api_key_ref === undefined || !isValidApiKeyRef(provider.api_key_ref)) {
        issue(
          errors,
          "models.providers[].api_key_ref",
          `服务商 ${provider.id} 密钥引用格式非法（只允许 env:NAME / file:path#key / 空；禁止明文密钥）：${String(provider.api_key_ref)}`,
        );
      } else if (provider.api_key_ref !== "") {
        configuredRefs.push(provider.api_key_ref);
      }
    }
    if (!MODEL_SYNC_MODES.includes(models.sync_mode)) issue(errors, "models.sync_mode", "sync_mode 必须是 single_key_all / per_provider");
    if (!providerIds.has(models.default_provider_id)) {
      issue(errors, "models.default_provider_id", `默认服务商不存在：${String(models.default_provider_id)}`);
    } else if (providers.find((provider) => provider.id === models.default_provider_id)?.enabled !== true) {
      issue(errors, "models.default_provider_id", `默认服务商必须启用：${String(models.default_provider_id)}`);
    }
    if (models.sync_mode === "single_key_all") {
      const allRefs = providers.map((provider) => provider.api_key_ref ?? "");
      if (allRefs.some((ref) => ref !== (allRefs[0] ?? ""))) {
        issue(errors, "models.providers", "single_key_all（一键同步）模式下所有服务商的密钥引用必须一致；如需独立密钥请切换 per_provider");
      }
    }
    const bindings = isRecord(models.agent_models) ? models.agent_models : {};
    for (const role of AGENT_ROLES) {
      const binding = bindings[role];
      if (!isRecord(binding)) {
        issue(errors, `models.agent_models.${role}`, `缺少代理 ${role} 的模型绑定`);
        continue;
      }
      if (typeof binding.provider_id !== "string" || !providerIds.has(binding.provider_id)) {
        issue(errors, `models.agent_models.${role}.provider_id`, `代理 ${role} 绑定的服务商不存在：${String(binding.provider_id)}`);
      }
      if (typeof binding.model !== "string" || binding.model.trim() === "") {
        issue(errors, `models.agent_models.${role}.model`, `代理 ${role} 的模型名不能为空`);
      }
      if (binding.temperature !== undefined && (typeof binding.temperature !== "number" || binding.temperature < 0 || binding.temperature > 2)) {
        issue(errors, `models.agent_models.${role}.temperature`, `代理 ${role} 的 temperature 必须在 0-2 之间`);
      }
      if (binding.max_tokens !== undefined && (typeof binding.max_tokens !== "number" || binding.max_tokens <= 0)) {
        issue(errors, `models.agent_models.${role}.max_tokens`, `代理 ${role} 的 max_tokens 必须是正数`);
      }
    }
  }

  // v1.2：总调度核心设置 / 专业系统提示词
  const orchestrator = config.orchestrator;
  if (!isRecord(orchestrator)) {
    issue(errors, "orchestrator", "orchestrator 配置缺失（旧配置文件应在加载时自动迁移补默认值）");
  } else {
    const conductorPrompt = typeof orchestrator.conductor_prompt === "string" ? orchestrator.conductor_prompt.trim() : "";
    if ([...conductorPrompt].length < 20) issue(errors, "orchestrator.conductor_prompt", "总调度系统提示词过短（至少 20 个字符）");
    const prompts = Array.isArray(orchestrator.system_prompts) ? orchestrator.system_prompts : [];
    const promptRoles = new Set<string>();
    for (const entry of prompts) {
      if (typeof entry.role !== "string" || entry.role.trim() === "") {
        issue(errors, "orchestrator.system_prompts[].role", "系统提示词角色不能为空");
        continue;
      }
      if (promptRoles.has(entry.role)) issue(errors, "orchestrator.system_prompts", `系统提示词角色重复：${entry.role}`);
      promptRoles.add(entry.role);
      const text = typeof entry.system_prompt === "string" ? entry.system_prompt.trim() : "";
      if ([...text].length < 20) issue(errors, `orchestrator.system_prompts.${entry.role}`, `角色 ${entry.role} 的系统提示词过短（至少 20 个字符）`);
    }
    for (const role of SYSTEM_PROMPT_ROLES) {
      if (!promptRoles.has(role)) issue(errors, "orchestrator.system_prompts", `缺少角色 ${role} 的系统提示词`);
    }
    if (typeof orchestrator.auto_plan !== "boolean") issue(errors, "orchestrator.auto_plan", "auto_plan 必须是布尔值");
    if (typeof orchestrator.max_steps_per_run !== "number" || !Number.isInteger(orchestrator.max_steps_per_run) || orchestrator.max_steps_per_run < 1 || orchestrator.max_steps_per_run > 1_000) {
      issue(errors, "orchestrator.max_steps_per_run", "max_steps_per_run 必须是 1-1000 的整数");
    }
    if (typeof orchestrator.ask_before_commit !== "boolean") issue(errors, "orchestrator.ask_before_commit", "ask_before_commit 必须是布尔值");
  }

  // v1.3：系统总控 supervisor（最高权限）与系统动作策略
  const supervisor = agents.find((agent) => agent.role === "supervisor");
  if (supervisor === undefined) {
    issue(errors, "agents", "缺少系统总控 supervisor 角色（最高权限智能体，负责程序/插件/模型与提示词管理）");
  } else {
    if (supervisor.autonomy !== "approval_required") {
      issue(errors, "agents.supervisor.autonomy", "系统总控 supervisor 必须为 approval_required（最高权限动作需人工审批）");
    }
    for (const requiredTool of ["system.*", "agents.*", "models.*", "prompts.*", "logs.read"]) {
      if (!Array.isArray(supervisor.tools) || !supervisor.tools.includes(requiredTool)) {
        issue(errors, "agents.supervisor.tools", `系统总控 supervisor 缺少权限工具：${requiredTool}`);
      }
    }
  }
  const policy = config.system_policy;
  if (!isRecord(policy)) {
    issue(errors, "system_policy", "system_policy 配置缺失（旧 config 应在加载时自动补默认值）");
  } else {
    const apps = Array.isArray(policy.managed_apps) ? policy.managed_apps : [];
    if (!Array.isArray(policy.managed_apps)) issue(errors, "system_policy.managed_apps", "managed_apps 必须是数组");
    const appIds = new Set<string>();
    for (const app of apps) {
      if (typeof app.id !== "string" || !PROVIDER_ID_PATTERN.test(app.id)) issue(errors, "system_policy.managed_apps[].id", `受管应用 id 非法：${String(app.id)}`);
      if (appIds.has(app.id)) issue(errors, "system_policy.managed_apps", `受管应用 id 重复：${app.id}`);
      appIds.add(app.id);
      if (typeof app.name !== "string" || app.name.trim() === "") issue(errors, "system_policy.managed_apps[].name", `受管应用 ${app.id} name 不能为空`);
      if (typeof app.command !== "string" || app.command.trim() === "") issue(errors, "system_policy.managed_apps[].command", `受管应用 ${app.id} command 不能为空`);
      for (const flag of ["allow_start", "allow_stop", "allow_remove"] as const) {
        if (typeof app[flag] !== "boolean") issue(errors, `system_policy.managed_apps[].${flag}`, `受管应用 ${app.id} ${flag} 必须是布尔值`);
      }
    }
    if (typeof policy.plugins_dir !== "string" || policy.plugins_dir.trim() === "" || !SAFE_RELATIVE_PATH_PATTERN.test(policy.plugins_dir) || policy.plugins_dir.includes("..")) {
      issue(errors, "system_policy.plugins_dir", "plugins_dir 必须是安全的相对路径（不能为空/绝对路径/含 ..）");
    }
    if (typeof policy.allow_destructive !== "boolean") issue(errors, "system_policy.allow_destructive", "allow_destructive 必须是布尔值");
    if (typeof policy.require_confirmation !== "boolean") issue(errors, "system_policy.require_confirmation", "require_confirmation 必须是布尔值");
    if (
      typeof policy.confirmation_ttl_seconds !== "number" ||
      !Number.isInteger(policy.confirmation_ttl_seconds) ||
      policy.confirmation_ttl_seconds < 1 ||
      policy.confirmation_ttl_seconds > 3_600
    ) {
      issue(errors, "system_policy.confirmation_ttl_seconds", "confirmation_ttl_seconds 必须是 1-3600 的整数");
    }
    if (policy.allow_destructive === true && policy.require_confirmation !== true) {
      issue(errors, "system_policy.require_confirmation", "危险动作必须二次确认（allow_destructive=true 时 require_confirmation 必须为 true）");
    }
  }

  // v1.4：运行时设置（自动执行/审批策略/步骤上限/返工/事件保留）
  const runtime = config.runtime;
  if (!isRecord(runtime)) {
    issue(errors, "runtime", "runtime 配置缺失（旧 config 应在加载时自动补默认值）");
  } else {
    if (typeof runtime.auto_run !== "boolean") issue(errors, "runtime.auto_run", "auto_run 必须是布尔值");
    if (!APPROVAL_MODES.includes(runtime.approval_mode)) {
      issue(errors, "runtime.approval_mode", `approval_mode 取值非法：${String(runtime.approval_mode)}（允许 auto_low_risk/auto_all/manual）`);
    }
    if (typeof runtime.full_auto !== "boolean") issue(errors, "runtime.full_auto", "full_auto 必须是布尔值");
    if (
      typeof runtime.max_auto_steps !== "number" ||
      !Number.isInteger(runtime.max_auto_steps) ||
      runtime.max_auto_steps < RUNTIME_MAX_AUTO_STEPS_RANGE.min ||
      runtime.max_auto_steps > RUNTIME_MAX_AUTO_STEPS_RANGE.max
    ) {
      issue(errors, "runtime.max_auto_steps", "max_auto_steps 必须是 10-200 的整数");
    }
    if (
      typeof runtime.rework_limit !== "number" ||
      !Number.isInteger(runtime.rework_limit) ||
      runtime.rework_limit < RUNTIME_REWORK_LIMIT_RANGE.min ||
      runtime.rework_limit > RUNTIME_REWORK_LIMIT_RANGE.max
    ) {
      issue(errors, "runtime.rework_limit", "rework_limit 必须是 0-3 的整数");
    }
    if (
      typeof runtime.event_retention !== "number" ||
      !Number.isInteger(runtime.event_retention) ||
      runtime.event_retention < RUNTIME_EVENT_RETENTION_RANGE.min ||
      runtime.event_retention > RUNTIME_EVENT_RETENTION_RANGE.max
    ) {
      issue(errors, "runtime.event_retention", "event_retention 必须是 100-5000 的整数");
    }
    if (runtime.full_auto === true && runtime.approval_mode === "manual") {
      issue(errors, "runtime.full_auto", "full_auto=true 时不能同时使用 approval_mode=manual（全自动与全人工审批冲突）");
    }
  }

  // v1.5：Harness 真实执行设置（总开关/profile/dsh_bin/超时/并发/产物保留/11 角色）
  const harness = config.harness;
  if (!isRecord(harness)) {
    issue(errors, "harness", "harness 配置缺失（旧 config 应在加载时自动补默认值）");
  } else {
    if (typeof harness.enabled !== "boolean") issue(errors, "harness.enabled", "harness.enabled 必须是布尔值");
    if (typeof harness.profile !== "string" || harness.profile.trim() === "") issue(errors, "harness.profile", "harness.profile 不能为空");
    if (typeof harness.dsh_bin !== "string") issue(errors, "harness.dsh_bin", "harness.dsh_bin 必须是字符串（空=自动探测）");
    if (
      typeof harness.timeout_ms !== "number" ||
      !Number.isInteger(harness.timeout_ms) ||
      harness.timeout_ms < HARNESS_TIMEOUT_RANGE.min ||
      harness.timeout_ms > HARNESS_TIMEOUT_RANGE.max
    ) {
      issue(errors, "harness.timeout_ms", "harness.timeout_ms 必须是 10-1800000 的整数");
    }
    if (
      typeof harness.max_concurrency !== "number" ||
      !Number.isInteger(harness.max_concurrency) ||
      harness.max_concurrency < HARNESS_MAX_CONCURRENCY_RANGE.min ||
      harness.max_concurrency > HARNESS_MAX_CONCURRENCY_RANGE.max
    ) {
      issue(errors, "harness.max_concurrency", "harness.max_concurrency 必须是 1-4 的整数");
    }
    if (
      typeof harness.artifact_retention_days !== "number" ||
      !Number.isInteger(harness.artifact_retention_days) ||
      harness.artifact_retention_days < HARNESS_ARTIFACT_RETENTION_RANGE.min ||
      harness.artifact_retention_days > HARNESS_ARTIFACT_RETENTION_RANGE.max
    ) {
      issue(errors, "harness.artifact_retention_days", "harness.artifact_retention_days 必须是 1-365 的整数");
    }
    if (typeof harness.report_required !== "boolean") issue(errors, "harness.report_required", "harness.report_required 必须是布尔值");
    const roleSettings = Array.isArray(harness.roles) ? harness.roles : [];
    const roleSeen = new Set<string>();
    for (const entry of roleSettings) {
      if (typeof entry.role !== "string" || !(AGENT_ROLES as readonly string[]).includes(entry.role)) {
        issue(errors, "harness.roles[].role", `Harness 角色非法：${String(entry.role)}（允许：${AGENT_ROLES.join("/")}）`);
        continue;
      }
      if (roleSeen.has(entry.role)) issue(errors, "harness.roles", `Harness 角色重复：${entry.role}`);
      roleSeen.add(entry.role);
      if (typeof entry.enabled !== "boolean") issue(errors, `harness.roles[${entry.role}].enabled`, "enabled 必须是布尔值");
      if (typeof entry.workspace !== "string" || entry.workspace.trim() === "" || !HARNESS_WORKSPACE_PATTERN.test(entry.workspace)) {
        issue(errors, `harness.roles[${entry.role}].workspace`, "workspace 必须是安全相对路径（相对 runDir，不能为绝对路径/含 ..）");
      }
      if (
        typeof entry.timeout_ms !== "number" ||
        !Number.isInteger(entry.timeout_ms) ||
        entry.timeout_ms < HARNESS_TIMEOUT_RANGE.min ||
        entry.timeout_ms > HARNESS_TIMEOUT_RANGE.max
      ) {
        issue(errors, `harness.roles[${entry.role}].timeout_ms`, "timeout_ms 必须是 10-1800000 的整数");
      }
      if (
        typeof entry.max_tokens_per_run !== "number" ||
        !Number.isInteger(entry.max_tokens_per_run) ||
        entry.max_tokens_per_run < HARNESS_MAX_TOKENS_RANGE.min ||
        entry.max_tokens_per_run > HARNESS_MAX_TOKENS_RANGE.max
      ) {
        issue(errors, `harness.roles[${entry.role}].max_tokens_per_run`, "max_tokens_per_run 必须是 1000-2000000 的整数");
      }
      if (entry.role === "supervisor" && entry.enabled === true) {
        issue(errors, "harness.roles.supervisor.enabled", "supervisor 不得走真实 Harness 执行（仅系统动作），enabled 必须为 false");
      }
    }
    for (const role of AGENT_ROLES) {
      if (!roleSeen.has(role)) issue(errors, "harness.roles", `harness.roles 缺少角色：${role}`);
    }
  }
  // v1.5：Agent 的 Harness 元数据（可选；提供时校验 profile/workspace/tools）
  for (const agent of agents) {
    if (agent.harness === undefined) continue;
    if (typeof agent.harness.profile !== "string" || agent.harness.profile.trim() === "") {
      issue(errors, `agents.${agent.role}.harness.profile`, "harness.profile 不能为空");
    }
    if (typeof agent.harness.workspace !== "string" || agent.harness.workspace.trim() === "" || !HARNESS_WORKSPACE_PATTERN.test(agent.harness.workspace)) {
      issue(errors, `agents.${agent.role}.harness.workspace`, "harness.workspace 必须是安全相对路径（不能为绝对路径/含 ..）");
    }
    if (!Array.isArray(agent.harness.tools) || agent.harness.tools.length === 0) {
      issue(errors, `agents.${agent.role}.harness.tools`, "harness.tools 至少需要一项工具");
    }
  }

  // 功能开关完整性
  for (const name of FEATURE_NAMES) {
    const toggle = config.features?.[name];
    if (!isRecord(toggle)) issue(errors, `features.${name}`, `功能开关 ${name} 缺失`);
    else if (typeof toggle.enabled !== "boolean" || typeof toggle.requires_approval !== "boolean") {
      issue(errors, `features.${name}`, `功能开关 ${name} 字段类型非法`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// ConfigEngine
// ---------------------------------------------------------------------------

/**
 * 配置中心引擎。
 *
 * ```ts
 * const engine = new ConfigEngine({ root: "<repo>" });   // 或 { persist: false }
 * engine.setMode("personal");                             // 三模式切换
 * engine.setFeature("payments", { enabled: false });      // 逐项禁用功能
 * engine.setBudgets({ zero_budget_mode: true });          // 0 元极限模式
 * engine.tokenBudget.consume(1200, { agentRole: "conductor", action: "browser.flow" });
 * engine.resetData(join(root, "runs"));                   // 数据清空（白名单，防穿越）
 * ```
 */
export class ConfigEngine {
  readonly root: string | null;
  readonly persist: boolean;
  readonly configPath: string | null;
  readonly auditPath: string | null;
  readonly tokenUsagePath: string | null;
  readonly tokenBudget: TokenBudget;
  readonly agents: AgentRegistry;

  private readonly now: () => Date;
  private state: StewardConfig;
  private auditEntries: AuditEntry[] = [];
  private auditSeq = 0;
  private tokenHistory: TokenUsageEntry[] = [];

  constructor(options: ConfigEngineOptions = {}) {
    const opts: ConfigEngineOptions = isRecord(options) ? options : {};
    this.now = typeof opts.now === "function" ? (opts.now as () => Date) : () => new Date();
    const rootCandidate = typeof opts.root === "string" && opts.root.trim() !== "" ? opts.root.trim() : null;
    const persistFlag = opts.persist;
    this.persist = persistFlag === false ? false : persistFlag === true ? true : rootCandidate !== null;
    if (this.persist && rootCandidate === null) {
      throw new ConfigValidationError("persist=true 时必须提供 root", "INVALID_INPUT", "root");
    }
    this.root = rootCandidate;
    this.configPath = this.persist && rootCandidate !== null ? join(rootCandidate, CONFIG_FILE_NAME) : null;
    this.auditPath = this.persist && rootCandidate !== null ? join(rootCandidate, AUDIT_FILE_NAME) : null;
    this.tokenUsagePath = this.persist && rootCandidate !== null ? join(rootCandidate, TOKEN_USAGE_FILE_NAME) : null;

    const initialMode: RunMode = opts.mode === undefined ? "personal" : requireEnum(opts.mode, RUN_MODES, "mode");
    let loaded: StewardConfig | null = null;
    if (this.configPath !== null) {
      const raw = readJsonFileSync<unknown>(this.configPath);
      if (raw !== null) {
        loaded = buildConfigFromUnknown(raw, initialMode, this.now);
        const validation = validateConfig(loaded);
        if (!validation.ok) {
          throw new ConfigValidationError(
            `配置文件校验失败：${validation.errors.map((item) => `${item.field}: ${item.message}`).join("; ")}`,
            "INVALID_INPUT",
            validation.errors[0]?.field ?? null,
          );
        }
      }
    }
    this.state = loaded ?? buildDefaults(initialMode, { now: this.now });
    if (this.persist && loaded === null) this.persistState();

    // 审计 + Token 用量历史（重启恢复）
    if (this.auditPath !== null) {
      this.auditEntries = readJsonLinesSync<AuditEntry>(this.auditPath);
      this.auditSeq = this.auditEntries.reduce((max, entry) => Math.max(max, typeof entry.seq === "number" ? entry.seq : 0), 0);
    }
    if (this.tokenUsagePath !== null) {
      this.tokenHistory = readJsonLinesSync<TokenUsageEntry>(this.tokenUsagePath).filter(
        (entry) => isRecord(entry) && typeof entry.agent_role === "string" && typeof entry.amount === "number",
      );
    }

    const host = {
      getTokenBudget: (): TokenBudgetConfig => this.state.token_budget,
      applyTokenBudget: (patch: Partial<TokenBudgetConfig>): void => {
        this.state.token_budget = { ...this.state.token_budget, ...patch };
        this.persistState();
      },
      recordTokenUsage: (entry: TokenUsageEntry): void => {
        this.tokenHistory.push(entry);
        if (this.tokenUsagePath !== null) appendJsonLineSync(this.tokenUsagePath, entry);
      },
      getTokenUsageHistory: (): TokenUsageEntry[] => this.tokenHistory,
      recordAudit: (action: string, object: string, result: AuditResult, reason: string): void => this.recordAudit(action, object, result, reason),
      nowIso: (): string => this.now().toISOString(),
      getAgents: (): AgentConfig[] => this.state.agents,
      getAgent: (role: string): AgentConfig | null => this.state.agents.find((agent) => agent.role === role) ?? null,
    };
    this.tokenBudget = new TokenBudget(host);
    this.agents = new AgentRegistry({
      getAgents: () => this.state.agents,
      applyAgents: (agents) => {
        this.state.agents = agents;
        this.persistState();
      },
      getTokenUsageHistory: () => this.tokenHistory,
      getTokenBudget: () => this.state.token_budget,
      recordAudit: (action, object, result, reason) => this.recordAudit(action, object, result, reason),
    });
    this.recordAudit("config.init", this.state.profile.mode, "ok", loaded === null ? "使用默认配置" : "从 config.json 载入");
  }

  // -------------------------------------------------------------------------
  // 只读访问
  // -------------------------------------------------------------------------

  get mode(): RunMode {
    return this.state.profile.mode;
  }

  /** 当前完整配置（只读副本）。 */
  get config(): StewardConfig {
    return cloneJson(this.state);
  }

  /** 三模式默认值（不修改当前配置）。 */
  defaultsForMode(mode: RunMode): StewardConfig {
    if (!isRunMode(mode)) throw new ConfigValidationError(`未知运行模式：${String(mode)}`, "INVALID_INPUT", "mode");
    return buildDefaults(mode, { now: this.now });
  }

  /** 全部代理角色（10 个）默认配置。 */
  defaultAgents(mode: RunMode = this.state.profile.mode): AgentConfig[] {
    if (!isRunMode(mode)) throw new ConfigValidationError(`未知运行模式：${String(mode)}`, "INVALID_INPUT", "mode");
    return this.agents.defaultAgents(mode);
  }

  // -------------------------------------------------------------------------
  // 持久化：load / save / export / import / reset
  // -------------------------------------------------------------------------

  /** 重新从 `<root>/config.json` 载入（纯内存模式返回当前配置）。 */
  load(): StewardConfig {
    if (this.configPath === null) return this.config;
    const raw = readJsonFileSync<unknown>(this.configPath);
    if (raw === null) {
      this.state = buildDefaults(this.state.profile.mode, { now: this.now });
      this.persistState();
      this.recordAudit("config.load", this.state.profile.mode, "ok", "config.json 不存在，已生成默认配置");
      return this.config;
    }
    const next = buildConfigFromUnknown(raw, this.state.profile.mode, this.now);
    this.assertValidOrThrow(next, "配置载入校验失败");
    this.state = next;
    this.recordAudit("config.load", this.state.profile.mode, "ok", "从 config.json 载入");
    return this.config;
  }

  /** 保存（先校验；原子写）；返回保存后的配置。 */
  save(): StewardConfig {
    this.assertValidOrThrow(this.state, "配置保存校验失败");
    this.persistState();
    this.recordAudit("config.save", this.state.profile.mode, "ok", "config.json 已保存");
    return this.config;
  }

  /** 导出为 JSON 字符串（可用于备份/迁移/CLI `config export`）。 */
  export(): string {
    return JSON.stringify(this.state, null, 2) + "\n";
  }

  /** 从 JSON 字符串/对象导入（校验失败抛 ConfigValidationError）。 */
  import(json: string | Record<string, unknown>): StewardConfig {
    let raw: unknown = json;
    if (typeof json === "string") {
      try {
        raw = JSON.parse(json);
      } catch (error) {
        throw new ConfigValidationError(`导入失败：JSON 解析错误（${(error as Error).message}）`, "INVALID_INPUT", "(root)");
      }
    }
    const next = buildConfigFromUnknown(raw, this.state.profile.mode, this.now);
    this.assertValidOrThrow(next, "导入配置校验失败");
    this.state = next;
    this.trimTokenUsageToBudget();
    this.persistState();
    this.recordAudit("config.import", this.state.profile.mode, "ok", `version=${this.state.version}`);
    return this.config;
  }

  /** 恢复默认：`reset()` 恢复当前模式，`reset(mode)` 先切到该模式再恢复默认。 */
  reset(mode?: RunMode): StewardConfig {
    const targetMode: RunMode = mode === undefined ? this.state.profile.mode : requireEnum(mode, RUN_MODES, "mode");
    this.state = buildDefaults(targetMode, { now: this.now });
    this.tokenHistory = [];
    this.clearTokenUsageFile();
    this.persistState();
    this.recordAudit("config.reset", targetMode, "ok", mode === undefined ? "恢复当前模式默认配置" : `恢复 ${targetMode} 默认配置`);
    return this.config;
  }

  /** 切换运行模式：应用目标模式的支付/发票/审批/主体/代理默认值，返回 diff。 */
  setMode(mode: RunMode, options: SetModeOptions = {}): ModeDiff {
    const targetMode = requireEnum(mode, RUN_MODES, "mode");
    const from = this.state.profile.mode;
    if (targetMode === from) {
      return { from, to: targetMode, changed: [], config: this.config };
    }
    const previous = cloneJson(this.state);
    const defaults = buildDefaults(targetMode, { now: this.now });
    const next = cloneJson(this.state);
    next.profile.mode = targetMode;
    next.profile.operator_type = defaults.profile.operator_type;
    if (targetMode === "enterprise") {
      next.profile.company = cloneJson(this.state.profile.company ?? defaults.profile.company ?? {
        name: "示例科技有限公司",
        license_no_masked: "9133******（待填写）",
        tax_no_masked: "9133******（待填写）",
        legal_representative: "待填写",
        agent_name: "待填写",
      });
    } else {
      delete next.profile.company;
    }
    if (options.preserve_features === true) {
      next.features = cloneJson(this.state.features);
    } else {
      next.features = cloneJson(defaults.features);
    }
    // 预算 / Token 预算默认保留用户自定义值（显式 preserve_*: false 才重置为目标模式默认）
    if (options.preserve_budgets === false) {
      next.budgets = cloneJson(defaults.budgets);
    }
    if (options.preserve_token_budget === false) {
      next.token_budget = cloneJson(defaults.token_budget);
    }
    next.payments = cloneJson(defaults.payments);
    next.approval = cloneJson(defaults.approval);
    next.agents = cloneJson(defaults.agents);
    // v1.2：默认保留用户自配的模型/API 密钥引用与系统提示词（切模式不应丢密钥）；
    // 显式 preserve_models:false / preserve_orchestrator:false 时重置为目标模式默认值。
    if (options.preserve_models === false) next.models = cloneJson(defaults.models);
    if (options.preserve_orchestrator === false) next.orchestrator = cloneJson(defaults.orchestrator);
    // v1.4：运行时设置默认也保留用户自定义值（显式 preserve_runtime:false 才重置）
    if (options.preserve_runtime === false) next.runtime = cloneJson(defaults.runtime);
    if (next.models.sync_mode === "single_key_all") {
      const canonical = next.models.providers.find((provider) => provider.id === next.models.default_provider_id)?.api_key_ref
        ?? next.models.providers[0]?.api_key_ref
        ?? "";
      for (const provider of next.models.providers) provider.api_key_ref = canonical;
    }
    this.assertValidOrThrow(next, `切换到 ${targetMode} 模式失败：新配置校验不通过`);
    this.state = next;
    this.persistState();
    const changed = diffPaths(previous, this.state).filter((path) => path !== "updated_at");
    this.recordAudit("mode.switch", `${from}→${targetMode}`, "ok", `changed=${changed.join(",")}`);
    return { from, to: targetMode, changed, config: this.config };
  }

  // -------------------------------------------------------------------------
  // 功能开关（14 项逐项可禁用）
  // -------------------------------------------------------------------------

  setFeature(name: FeatureName, update: { enabled: boolean; requiresApproval?: boolean; note?: string }): FeatureToggle {
    if (!isFeatureName(name)) throw new ConfigValidationError(`未知功能开关：${String(name)}`, "INVALID_INPUT", "feature");
    if (!isRecord(update)) throw new ConfigValidationError("setFeature 需要 {enabled, requiresApproval?, note?}", "INVALID_INPUT", "update");
    const enabled = requireBoolean(update.enabled, "enabled");
    const current = this.state.features[name];
    const next: FeatureToggle = { enabled, requires_approval: update.requiresApproval === undefined ? current.requires_approval : requireBoolean(update.requiresApproval, "requiresApproval") };
    if (update.note !== undefined) next.note = String(update.note);
    else if (current.note !== undefined) next.note = current.note;
    this.state.features[name] = next;
    if (!validateConfig(this.state).ok) {
      // 单个功能开关不会破坏一致性，但仍走统一校验（未来加规则时自动生效）
      this.state.features[name] = current;
      throw new ConfigValidationError(`功能开关 ${name} 更新后配置校验失败`, "INVALID_INPUT", `features.${name}`);
    }
    this.persistState();
    this.recordAudit("feature.update", name, "ok", `${enabled ? "启用" : "禁用"}; requires_approval=${next.requires_approval}`);
    return cloneJson(next);
  }

  /** 检查功能是否可用（禁用 → allowed:false + 可读原因）。 */
  checkFeature(name: FeatureName): FeatureCheckResult {
    if (!isFeatureName(name)) throw new ConfigValidationError(`未知功能开关：${String(name)}`, "INVALID_INPUT", "feature");
    const toggle = this.state.features[name];
    if (name === "enterprise" && this.state.profile.mode !== "enterprise") {
      const reason = `当前为 ${this.state.profile.mode === "demo" ? "体验" : "个人"}模式，企业能力不可用；如确需企业能力请切换企业模式（setMode("enterprise")）`;
      this.recordAudit("feature.check", name, "blocked", reason);
      return { allowed: false, feature: name, requires_approval: toggle.requires_approval, reason };
    }
    if (!toggle.enabled) {
      const reason = `该功能已被用户禁用：${name}${toggle.note === undefined ? "（可在配置中心逐项开启）" : `（${toggle.note}）`}`;
      this.recordAudit("feature.check", name, "blocked", reason);
      return { allowed: false, feature: name, requires_approval: toggle.requires_approval, reason };
    }
    return { allowed: true, feature: name, requires_approval: toggle.requires_approval };
  }

  /** 断言式功能检查：禁用时抛 FeatureDisabledError（CLI/其他引擎动作前调用）。 */
  assertFeature(name: FeatureName): FeatureCheckResult {
    const result = this.checkFeature(name);
    if (!result.allowed) throw new FeatureDisabledError(result.reason ?? `功能已被禁用：${name}`, name);
    return result;
  }

  // -------------------------------------------------------------------------
  // 预算三层 + 0 元极限模式
  // -------------------------------------------------------------------------

  /** 预算校验：三层任一超限 / 0 元极限模式下任何支出 → allowed:false + requiresHuman:true。 */
  checkBudget(kind: BudgetKind, amountCny: number): BudgetCheckResult {
    const kindValue = requireEnum(kind, BUDGET_KINDS, "kind");
    const amount = requireNumber(amountCny, "amount_cny", { min: 0 });
    const limit = this.state.budgets[BUDGET_LIMIT_KEYS[kindValue]];
    const base = {
      kind: kindValue,
      amount_cny: amount,
      limit_cny: limit,
      zero_budget_mode: this.state.budgets.zero_budget_mode,
      requiresHuman: true,
    };

    if (this.state.budgets.zero_budget_mode && amount > 0) {
      const reason = `0 元极限模式：任何支出都被拒绝（本次 ¥${amount}，${BUDGET_LABELS[kindValue]}额度 ¥${limit}）；仅允许免费本地动作`;
      this.recordAudit("budget.deny", `${kindValue}:${amount}`, "blocked", reason);
      return { allowed: false, ...base, remaining_cny: Math.max(0, limit), requiresHuman: true, reason };
    }
    if (amount === 0) {
      if (this.state.budgets.allow_free_local_actions) {
        return { allowed: true, ...base, remaining_cny: Math.max(0, limit), requiresHuman: false };
      }
      const reason = "0 元动作被拒绝：allow_free_local_actions=false（免费本地动作已被用户关闭）";
      this.recordAudit("budget.deny", `${kindValue}:0`, "blocked", reason);
      return { allowed: false, ...base, remaining_cny: Math.max(0, limit), requiresHuman: false, reason };
    }
    if (amount > limit) {
      const reason = `预算超限（${BUDGET_LABELS[kindValue]}）：本次 ¥${amount} > ${BUDGET_LABELS[kindValue]}额度 ¥${limit}`;
      this.recordAudit("budget.deny", `${kindValue}:${amount}`, "blocked", reason);
      return { allowed: false, ...base, remaining_cny: 0, requiresHuman: true, reason };
    }
    return { allowed: true, ...base, remaining_cny: limit - amount, requiresHuman: false };
  }

  /** 断言式预算检查：不通过抛 BudgetLimitError。 */
  assertBudget(kind: BudgetKind, amountCny: number): BudgetCheckResult {
    const result = this.checkBudget(kind, amountCny);
    if (!result.allowed) {
      throw new BudgetLimitError(result.reason ?? "预算校验未通过", { kind: result.kind, limit_cny: result.limit_cny, amount_cny: result.amount_cny });
    }
    return result;
  }

  setBudgets(patch: Partial<Budgets>): Budgets {
    if (!isRecord(patch)) throw new ConfigValidationError("setBudgets 需要对象", "INVALID_INPUT", "patch");
    const next = normalizeBudgets({ ...this.state.budgets, ...patch }, this.state.budgets);
    const previous = this.state.budgets;
    this.state.budgets = next;
    if (!validateConfig(this.state).ok) {
      this.state.budgets = previous;
      throw new ConfigValidationError("预算更新后配置校验失败（检查 单笔 ≤ 项目 ≤ 月）", "INVALID_INPUT", "budgets");
    }
    this.persistState();
    this.recordAudit("budget.update", "budgets", "ok", `月=${next.month_cny}; 项目=${next.project_cny}; 单笔=${next.per_txn_cny}; zero=${next.zero_budget_mode}`);
    return cloneJson(next);
  }

  setTokenBudget(patch: Partial<TokenBudgetConfig>): TokenBudgetConfig {
    if (!isRecord(patch)) throw new ConfigValidationError("setTokenBudget 需要对象", "INVALID_INPUT", "patch");
    const next = normalizeTokenBudget({ ...this.state.token_budget, ...patch }, this.state.token_budget);
    const previous = this.state.token_budget;
    this.state.token_budget = next;
    if (!validateConfig(this.state).ok) {
      this.state.token_budget = previous;
      throw new ConfigValidationError("Token 预算更新后配置校验失败", "INVALID_INPUT", "token_budget");
    }
    this.persistState();
    this.recordAudit("token.update", "token_budget", "ok", `limit=${next.limit_tokens}; per_action=${next.per_action_limit}; on_exceed=${next.on_exceed}`);
    return cloneJson(next);
  }

  /** 便捷：消耗 token（等价 `engine.tokenBudget.consume`）。 */
  consumeTokens(amount: number, meta: TokenConsumeMeta): TokenConsumeResult {
    return this.tokenBudget.consume(amount, meta);
  }

  // -------------------------------------------------------------------------
  // 支付 / 银行卡 / 发票（全部参数可配置；敏感字段自动掩码）
  // -------------------------------------------------------------------------

  /** 支付渠道列表（enabledOnly=true 只返回启用且非 disabled 的渠道）。 */
  paymentProviders(options: { enabledOnly?: boolean } = {}): PaymentProvider[] {
    const enabledOnly = options.enabledOnly === true;
    return this.state.payments.providers
      .filter((provider) => !enabledOnly || (provider.enabled && provider.mode !== "disabled"))
      .map((provider) => cloneJson(provider));
  }

  /** 更新支付渠道（account 传入原始值会立即掩码，不落明文）。 */
  setPaymentProvider(id: string, update: PaymentProviderUpdate): PaymentProvider {
    const providerId = requireString(id, "provider.id");
    const index = this.state.payments.providers.findIndex((provider) => provider.id === providerId);
    if (index < 0) throw new ConfigValidationError(`支付渠道不存在：${providerId}`, "INVALID_INPUT", "provider.id");
    const target = this.state.payments.providers[index];
    if (target === undefined) throw new ConfigValidationError(`支付渠道不存在：${providerId}`, "INVALID_INPUT", "provider.id");
    const previous = cloneJson(target);
    if (update.enabled !== undefined) target.enabled = requireBoolean(update.enabled, "enabled");
    if (update.mode !== undefined) target.mode = requireEnum(update.mode, PAYMENT_MODES, "mode");
    if (update.note !== undefined) target.note = String(update.note);
    if (update.account !== undefined) target.account_masked = this.maskAccount(String(update.account));
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.payments.providers[index] = previous;
      throw new ConfigValidationError(
        `支付渠道更新后配置校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "payments.providers",
      );
    }
    this.persistState();
    this.recordAudit("payment.provider.update", providerId, "ok", `enabled=${target.enabled}; mode=${target.mode}`);
    return cloneJson(target);
  }

  /** 更新收款账户（银行卡/微信/支付宝；自动掩码）。 */
  setPayoutAccount(update: PayoutAccountUpdate): PayoutAccount {
    if (!isRecord(update)) throw new ConfigValidationError("setPayoutAccount 需要对象", "INVALID_INPUT", "update");
    const previous = cloneJson(this.state.payments.payout_account);
    const target = this.state.payments.payout_account;
    if (update.holder !== undefined) target.holder = requireString(update.holder, "holder");
    if (update.bank_name !== undefined) target.bank_name = requireString(update.bank_name, "bank_name");
    if (update.type !== undefined) target.type = requireEnum(update.type, ["personal", "corporate"] as const, "type");
    if (update.card_no !== undefined) target.card_no_masked = maskBankCard(String(update.card_no));
    if (update.wechat_id !== undefined) target.wechat_id_masked = maskAccountId(String(update.wechat_id));
    if (update.alipay_id !== undefined) target.alipay_id_masked = maskAccountId(String(update.alipay_id));
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.payments.payout_account = previous;
      throw new ConfigValidationError(
        `收款账户更新后配置校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "payments.payout_account",
      );
    }
    this.persistState();
    this.recordAudit("payment.payout.update", target.holder, "ok", `type=${target.type}; card=${target.card_no_masked}`);
    return cloneJson(target);
  }

  /** 更新发票默认配置（个人模式不得开专票；企业模式必须选择发票类型）。 */
  setInvoiceConfig(patch: Partial<InvoiceConfig>): InvoiceConfig {
    if (!isRecord(patch)) throw new ConfigValidationError("setInvoiceConfig 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.payments.invoice);
    const merged = { ...this.state.payments.invoice, ...patch };
    let next: InvoiceConfig;
    try {
      next = normalizeInvoice(merged, this.state.payments.invoice);
    } catch (error) {
      throw error instanceof ConfigValidationError ? error : new ConfigValidationError(String(error), "INVALID_INPUT", "payments.invoice");
    }
    this.state.payments.invoice = next;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.payments.invoice = previous;
      throw new ConfigValidationError(
        `发票配置更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "payments.invoice",
      );
    }
    this.persistState();
    this.recordAudit("payment.invoice.update", next.default_type, "ok", `title=${next.title}; draft_only=${next.draft_only}`);
    return cloneJson(next);
  }

  /** 更新支付流程策略（双人复核 / 合同签署；AI 永远不得代签）。 */
  setPaymentsPolicy(patch: { require_dual_review?: boolean; sign_contract?: boolean }): PaymentsConfig {
    if (!isRecord(patch)) throw new ConfigValidationError("setPaymentsPolicy 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.payments);
    if (patch.require_dual_review !== undefined) {
      this.state.payments.require_dual_review = requireBoolean(patch.require_dual_review, "require_dual_review");
    }
    if (patch.sign_contract !== undefined) this.state.payments.sign_contract = requireBoolean(patch.sign_contract, "sign_contract");
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.payments = previous;
      throw new ConfigValidationError(
        `支付策略更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "payments",
      );
    }
    this.persistState();
    this.recordAudit(
      "payment.policy.update",
      "payments",
      "ok",
      `dual_review=${this.state.payments.require_dual_review}; sign_contract=${this.state.payments.sign_contract}`,
    );
    return cloneJson(this.state.payments);
  }

  // v1.3：易支付（epay）配置（默认 demo/disabled；live 需补齐商家信息；密钥只存引用）
  getEpayConfig(): EpayConfig {
    return cloneJson(this.state.payments.epay ?? defaultEpayConfig());
  }

  setEpayConfig(patch: EpayConfigUpdate): EpayConfig {
    if (!isRecord(patch)) throw new ConfigValidationError("setEpayConfig 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.payments.epay ?? defaultEpayConfig());
    const merged = { ...(this.state.payments.epay ?? defaultEpayConfig()), ...patch };
    let next: EpayConfig;
    try {
      next = normalizeEpay(merged, previous);
    } catch (error) {
      throw error instanceof ConfigValidationError ? error : new ConfigValidationError(String(error), "INVALID_INPUT", "payments.epay");
    }
    this.state.payments.epay = next;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.payments.epay = previous;
      throw new ConfigValidationError(
        `易支付配置更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "payments.epay",
      );
    }
    this.persistState();
    this.recordAudit(
      "payment.epay.update",
      next.mode,
      "ok",
      `enabled=${next.enabled}; gateway=${next.gateway_url}; key=${maskApiKeyRef(next.key_ref)}; pay_types=${next.pay_types.join("+")}`,
    );
    return cloneJson(next);
  }

  /** 易支付商户密钥引用掩码（展示用，不泄露明文）。 */
  maskEpayKeyRef(): string {
    return maskApiKeyRef(this.state.payments.epay?.key_ref ?? "");
  }

  /** 掩码工具（银行卡/微信/支付宝 id；供 CLI/控制台展示）。 */
  maskAccount(value: string): string {
    return maskAccountValue(value);
  }

  /** 各种掩码函数（日志/报告/UI 用）。 */
  maskBankCard(value: string): string {
    return maskBankCard(value);
  }

  maskTaxNo(value: string): string {
    return maskTaxNo(value);
  }

  maskLicenseNo(value: string): string {
    return maskLicenseNo(value);
  }

  // -------------------------------------------------------------------------
  // 代理注册表（10 个角色）
  // -------------------------------------------------------------------------

  listAgents(): AgentConfig[] {
    return this.agents.listAgents();
  }

  setAgentEnabled(role: string, enabled: boolean): AgentConfig {
    return this.agents.setAgentEnabled(role, enabled);
  }

  setAgentConfig(role: string, update: AgentUpdate): AgentConfig {
    return this.agents.setAgentConfig(role, update);
  }

  agentUsage(role: string): ReturnType<AgentRegistry["agentUsage"]> {
    return this.agents.agentUsage(role);
  }

  // -------------------------------------------------------------------------
  // v1.2：多模型 / API 密钥引用 / 一键同步 / 各智能体模型分配
  // -------------------------------------------------------------------------

  /** 当前模型服务商列表（只读副本；api_key_ref 仅为引用，不是密钥）。 */
  listModelProviders(): ModelProviderConfig[] {
    return this.state.models.providers.map((provider) => cloneJson(provider));
  }

  /** 新增或更新模型服务商（校验 id/base_url/kind/模型名/密钥引用；一键同步模式下引用自动对齐）。 */
  upsertModelProvider(provider: Partial<ModelProviderConfig> & { id: string }): ModelProviderConfig {
    if (!isRecord(provider)) throw new ConfigValidationError("upsertModelProvider 需要 provider 对象", "INVALID_INPUT", "provider");
    const id = requireString(provider.id, "provider.id");
    const index = this.state.models.providers.findIndex((item) => item.id === id);
    const existing = index >= 0 ? this.state.models.providers[index] : undefined;
    const normalized = normalizeModelProvider(provider, index >= 0 ? index : this.state.models.providers.length, existing);
    const previous = cloneJson(this.state.models);
    if (index >= 0) this.state.models.providers[index] = normalized;
    else this.state.models.providers.push(normalized);
    if (this.state.models.sync_mode === "single_key_all") {
      const canonical = normalized.api_key_ref !== "" ? normalized.api_key_ref : this.canonicalApiKeyRef();
      for (const item of this.state.models.providers) item.api_key_ref = canonical;
    }
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.models = previous;
      throw new ConfigValidationError(
        `服务商保存后配置校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "models.providers",
      );
    }
    this.persistState();
    this.recordAudit(
      "model.provider.upsert",
      id,
      "ok",
      `kind=${normalized.kind}; base_url=${normalized.base_url}; key=${maskApiKeyRef(normalized.api_key_ref)}`,
    );
    return cloneJson(normalized);
  }

  /** 删除模型服务商（不能删默认/最后一个；原绑定该服务商的 agent 自动改绑默认服务商）。 */
  removeModelProvider(id: string): ModelProviderRemovalResult {
    const providerId = requireString(id, "provider.id");
    const index = this.state.models.providers.findIndex((provider) => provider.id === providerId);
    if (index < 0) throw new ConfigValidationError(`服务商不存在：${providerId}`, "INVALID_INPUT", "provider.id");
    if (providerId === this.state.models.default_provider_id) {
      throw new ConfigValidationError(`不能删除默认服务商：${providerId}（请先 setDefaultProvider 切换默认服务商）`, "INVALID_INPUT", "models.default_provider_id");
    }
    if (this.state.models.providers.length <= 1) throw new ConfigValidationError("至少保留一个模型服务商", "INVALID_INPUT", "models.providers");
    this.state.models.providers.splice(index, 1);
    const fallbackProvider = this.state.models.providers.find((provider) => provider.id === this.state.models.default_provider_id)
      ?? this.state.models.providers[0];
    const reboundRoles: string[] = [];
    for (const [role, binding] of Object.entries(this.state.models.agent_models)) {
      if (binding.provider_id !== providerId) continue;
      binding.provider_id = fallbackProvider?.id ?? this.state.models.default_provider_id;
      binding.model = fallbackProvider?.default_model ?? binding.model;
      reboundRoles.push(role);
    }
    this.assertValidOrThrow(this.state, "删除服务商后配置校验失败");
    this.persistState();
    this.recordAudit("model.provider.remove", providerId, "ok", `rebound=${reboundRoles.join(",")}`);
    return { removed_provider_id: providerId, rebound_roles: reboundRoles };
  }

  /** 设置默认模型服务商（必须存在且启用）。 */
  setDefaultProvider(id: string): ModelProviderConfig {
    const providerId = requireString(id, "provider.id");
    const provider = this.state.models.providers.find((item) => item.id === providerId);
    if (provider === undefined) throw new ConfigValidationError(`服务商不存在：${providerId}`, "INVALID_INPUT", "provider.id");
    if (!provider.enabled) throw new ConfigValidationError(`服务商未启用：${providerId}（请先 upsertModelProvider 启用）`, "INVALID_INPUT", "provider.enabled");
    const previous = this.state.models.default_provider_id;
    this.state.models.default_provider_id = providerId;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.models.default_provider_id = previous;
      throw new ConfigValidationError("默认服务商更新后配置校验失败", "INVALID_INPUT", "models.default_provider_id");
    }
    this.persistState();
    this.recordAudit("model.provider.default", providerId, "ok", `from=${previous}`);
    return cloneJson(provider);
  }

  /** 切换一键同步/独立密钥模式；切到 single_key_all 时立即把所有引用统一。 */
  setModelSyncMode(mode: ModelSyncMode): ModelSyncModeResult {
    const modeValue = requireEnum(mode, MODEL_SYNC_MODES, "mode");
    const previousMode = this.state.models.sync_mode;
    const synced: string[] = [];
    this.state.models.sync_mode = modeValue;
    if (modeValue === "single_key_all") {
      const canonical = this.canonicalApiKeyRef();
      for (const provider of this.state.models.providers) {
        if (provider.api_key_ref !== canonical) {
          provider.api_key_ref = canonical;
          synced.push(provider.id);
        }
      }
    }
    this.assertValidOrThrow(this.state, "同步模式切换后配置校验失败");
    this.persistState();
    this.recordAudit("model.sync_mode", modeValue, "ok", `from=${previousMode}; synced=${synced.join(",")}`);
    return { sync_mode: modeValue, synced_provider_ids: synced };
  }

  /**
   * 一键同步：把同一 API 密钥引用应用到**所有服务商/功能**（用户核心诉求）。
   * 只接受引用（env:NAME / file:path#key / "" 清空），拒绝明文密钥。
   */
  syncApiKey(apiKeyRef: string): SyncApiKeyResult {
    const ref = normalizeApiKeyRefValue(apiKeyRef, "api_key_ref");
    const affected: string[] = [];
    for (const provider of this.state.models.providers) {
      if (provider.api_key_ref !== ref) {
        provider.api_key_ref = ref;
        affected.push(provider.id);
      }
    }
    const alreadyConsistent = affected.length === 0;
    this.assertValidOrThrow(this.state, "一键同步密钥引用后配置校验失败");
    this.persistState();
    this.recordAudit("model.api_key.sync", "all_providers", "ok", `ref=${maskApiKeyRef(ref)}; affected=${affected.length}`);
    return {
      api_key_ref: ref,
      api_key_ref_masked: maskApiKeyRef(ref),
      sync_mode: this.state.models.sync_mode,
      affected_provider_ids: affected,
      already_consistent: alreadyConsistent,
    };
  }

  /** 设置单个服务商的密钥引用（格式校验；single_key_all 模式下会同步到所有服务商）。 */
  setProviderApiKeyRef(id: string, apiKeyRef: string): ProviderKeyRefUpdate {
    const providerId = requireString(id, "provider.id");
    const ref = normalizeApiKeyRefValue(apiKeyRef, "api_key_ref");
    const provider = this.state.models.providers.find((item) => item.id === providerId);
    if (provider === undefined) throw new ConfigValidationError(`服务商不存在：${providerId}`, "INVALID_INPUT", "provider.id");
    const affected: string[] = [];
    if (this.state.models.sync_mode === "single_key_all") {
      for (const item of this.state.models.providers) {
        if (item.api_key_ref !== ref) {
          item.api_key_ref = ref;
          affected.push(item.id);
        }
      }
    } else if (provider.api_key_ref !== ref) {
      provider.api_key_ref = ref;
      affected.push(providerId);
    }
    this.assertValidOrThrow(this.state, "密钥引用更新后配置校验失败");
    this.persistState();
    this.recordAudit("model.api_key.ref", providerId, "ok", `ref=${maskApiKeyRef(ref)}`);
    return { provider_id: providerId, api_key_ref: ref, api_key_ref_masked: maskApiKeyRef(ref), affected_provider_ids: affected };
  }

  /** 为某智能体绑定模型（可各 agent 不同模型/温度/最大 token）。 */
  setAgentModel(role: string, binding: AgentModelBinding): AgentModelBinding {
    const roleName = requireString(role, "role");
    const normalized = normalizeAgentModelBinding(binding, `models.agent_models.${roleName}`);
    const provider = this.state.models.providers.find((item) => item.id === normalized.provider_id);
    if (provider === undefined) throw new ConfigValidationError(`服务商不存在：${normalized.provider_id}`, "INVALID_INPUT", "provider_id");
    this.state.models.agent_models[roleName] = normalized;
    this.assertValidOrThrow(this.state, "代理模型绑定后配置校验失败");
    this.persistState();
    this.recordAudit("model.agent_binding", roleName, "ok", `provider=${normalized.provider_id}; model=${normalized.model}`);
    return cloneJson(normalized);
  }

  /** 解析某智能体实际使用的模型与是否有可用密钥（**只返回 has_key，绝不返回明文**）。 */
  resolveAgentModel(role: string): ResolvedAgentModel {
    const roleName = requireString(role, "role");
    const binding = this.state.models.agent_models[roleName] ?? {
      provider_id: this.state.models.default_provider_id,
      model: this.defaultProvider().default_model,
    };
    const provider = this.state.models.providers.find((item) => item.id === binding.provider_id) ?? this.defaultProvider();
    const resolution = resolveApiKeyRef(provider.api_key_ref, this.root);
    return {
      role: roleName,
      provider_id: provider.id,
      provider: cloneJson(provider),
      binding: cloneJson(binding),
      model: binding.model.trim() === "" ? provider.default_model : binding.model,
      has_key: resolution.ok,
      key_source: resolution.ok ? resolution.source : "missing",
    };
  }

  /**
   * 运行时解析某服务商的明文 API 密钥（仅运行器内部使用；不写日志/审计/配置）。
   * env → process.env[NAME]；file → 读 `<root>/secrets.json` 的片段。
   */
  getApiKeyForProvider(id: string): ApiKeyResolution {
    const providerId = requireString(id, "provider.id");
    const provider = this.state.models.providers.find((item) => item.id === providerId);
    if (provider === undefined) return { ok: false, source: "missing", error: `服务商不存在：${providerId}` };
    return resolveApiKeyRef(provider.api_key_ref, this.root);
  }

  /** 展示用掩码密钥引用（env:DEE***KEY / file:secrets.json#de***ek / （未配置））。 */
  maskApiKeyRef(apiKeyRef: string): string {
    return maskApiKeyRef(apiKeyRef);
  }

  /** `<root>/secrets.json` 路径；纯内存模式返回 null。 */
  secretsFilePath(): string | null {
    return secretsFilePathFor(this.root);
  }

  /**
   * 便捷：把明文 API 密钥写入本地 `<root>/secrets.json`（尽力 0600），
   * 并设置 provider 的引用为 `file:secrets.json#<id>`；**明文绝不进入 config.json**。
   */
  setLocalApiKey(providerId: string, plaintext: string): LocalApiKeyResult {
    const id = requireString(providerId, "provider.id");
    const provider = this.state.models.providers.find((item) => item.id === id);
    if (provider === undefined) throw new ConfigValidationError(`服务商不存在：${id}`, "INVALID_INPUT", "provider.id");
    if (this.root === null) {
      throw new ConfigValidationError("纯内存模式不能写入本地密钥文件；请使用环境变量引用（env:NAME）", "INVALID_INPUT", "root");
    }
    const key = requireString(plaintext, "plaintext", "API 密钥不能为空");
    if (key.length < 8) throw new ConfigValidationError("API 密钥过短（至少 8 个字符）", "INVALID_INPUT", "plaintext");
    const file = setLocalSecret(this.root, id, key);
    const ref = `file:${SECRETS_FILE_NAME}#${id}`;
    for (const item of this.state.models.providers) {
      if (item.id === id) item.api_key_ref = ref;
      else if (this.state.models.sync_mode === "single_key_all") item.api_key_ref = ref;
    }
    this.assertValidOrThrow(this.state, "本地密钥写入后配置校验失败");
    this.persistState();
    this.recordAudit("model.api_key.local.set", id, "ok", `ref=${maskApiKeyRef(ref)}`);
    return { provider_id: id, api_key_ref: ref, secrets_file: file, created: true };
  }

  /** 清除本地密钥（删 secrets.json 条目并把引用清空；一键同步模式下其他服务商也清空）。 */
  clearLocalApiKey(providerId: string): boolean {
    const id = requireString(providerId, "provider.id");
    const provider = this.state.models.providers.find((item) => item.id === id);
    if (provider === undefined) throw new ConfigValidationError(`服务商不存在：${id}`, "INVALID_INPUT", "provider.id");
    const removed = this.root === null ? false : removeLocalSecret(this.root, id);
    const fileRef = `file:${SECRETS_FILE_NAME}#${id}`;
    for (const item of this.state.models.providers) {
      if (item.id === id) item.api_key_ref = "";
      else if (this.state.models.sync_mode === "single_key_all" && item.api_key_ref.startsWith(`file:${SECRETS_FILE_NAME}#`)) item.api_key_ref = "";
    }
    if (provider.api_key_ref === fileRef) provider.api_key_ref = "";
    this.assertValidOrThrow(this.state, "清除本地密钥后配置校验失败");
    this.persistState();
    this.recordAudit("model.api_key.local.clear", id, "ok", removed ? "已删除本地密钥" : "本地密钥不存在");
    return removed;
  }

  // -------------------------------------------------------------------------
  // v1.2：系统提示词（核心设置由总调度智能体负责管理）
  // -------------------------------------------------------------------------

  /** 各智能体当前专业系统提示词（只读副本）。 */
  listSystemPrompts(): SystemPromptConfig[] {
    return this.state.orchestrator.system_prompts.map((entry) => cloneJson(entry));
  }

  /** 总调度核心系统提示词。 */
  getConductorPrompt(): string {
    return this.state.orchestrator.conductor_prompt;
  }

  /**
   * 修改某智能体的系统提示词（核心设置由总调度管理）。
   * 校验：角色必须存在、文本非空且 ≥20 字符；可选要求包含安全条款关键词。
   */
  setSystemPrompt(role: string, systemPrompt: string, options: { requireSafetyKeywords?: boolean } = {}): SystemPromptConfig {
    const roleName = requireString(role, "role");
    const index = this.state.orchestrator.system_prompts.findIndex((entry) => entry.role === roleName);
    if (index < 0) {
      throw new ConfigValidationError(
        `未知系统提示词角色：${roleName}（可用角色：${this.state.orchestrator.system_prompts.map((entry) => entry.role).join("/")}）`,
        "INVALID_INPUT",
        "role",
      );
    }
    const text = requireString(systemPrompt, "system_prompt", "系统提示词不能为空");
    const check = validateSystemPromptText(text, { requireSafetyKeywords: options.requireSafetyKeywords === true });
    if (!check.ok) throw new ConfigValidationError(check.errors.join("；"), "INVALID_INPUT", "system_prompt");
    const entry = this.state.orchestrator.system_prompts[index];
    if (entry === undefined) throw new ConfigValidationError(`未知系统提示词角色：${roleName}`, "INVALID_INPUT", "role");
    entry.system_prompt = text;
    entry.updated_at = this.now().toISOString();
    this.assertValidOrThrow(this.state, "系统提示词修改后配置校验失败");
    this.persistState();
    this.recordAudit("prompt.update", roleName, "ok", `length=${[...text].length}`);
    return cloneJson(entry);
  }

  /** 恢复全部智能体默认专业系统提示词（也会重置 conductor 系统提示词）。 */
  resetSystemPrompts(): SystemPromptConfig[] {
    this.state.orchestrator.system_prompts = buildDefaultSystemPrompts(this.now());
    const conductorEntry = this.state.orchestrator.system_prompts.find((entry) => entry.role === "conductor");
    this.state.orchestrator.conductor_prompt = conductorEntry?.system_prompt ?? DEFAULT_CONDUCTOR_PROMPT;
    this.assertValidOrThrow(this.state, "重置系统提示词后配置校验失败");
    this.persistState();
    this.recordAudit("prompt.reset", "all_agents", "ok", `roles=${SYSTEM_PROMPT_ROLES.length}`);
    return this.listSystemPrompts();
  }

  /** 修改总调度核心系统提示词（直接写在系统提示词之前：总调度负责核心设置）。 */
  setConductorPrompt(prompt: string): string {
    const text = requireString(prompt, "conductor_prompt", "总调度系统提示词不能为空");
    const check = validateSystemPromptText(text);
    if (!check.ok) throw new ConfigValidationError(check.errors.join("；"), "INVALID_INPUT", "conductor_prompt");
    this.state.orchestrator.conductor_prompt = text;
    this.assertValidOrThrow(this.state, "总调度提示词修改后配置校验失败");
    this.persistState();
    this.recordAudit("orchestrator.conductor.update", "conductor", "ok", `length=${[...text].length}`);
    return text;
  }

  /** 总调度核心设置（提示词/自动规划/步数上限/提交前确认）。 */
  getOrchestratorSettings(): OrchestratorSettings {
    return cloneJson(this.state.orchestrator);
  }

  setOrchestratorSettings(patch: OrchestratorUpdate): OrchestratorSettings {
    if (!isRecord(patch)) throw new ConfigValidationError("setOrchestratorSettings 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.orchestrator);
    if (patch.auto_plan !== undefined) this.state.orchestrator.auto_plan = requireBoolean(patch.auto_plan, "auto_plan");
    if (patch.ask_before_commit !== undefined) {
      this.state.orchestrator.ask_before_commit = requireBoolean(patch.ask_before_commit, "ask_before_commit");
    }
    if (patch.max_steps_per_run !== undefined) {
      const steps = requireNonNegativeInt(patch.max_steps_per_run, "max_steps_per_run");
      if (steps < 1 || steps > 1_000) throw new ConfigValidationError("max_steps_per_run 必须是 1-1000 的整数", "INVALID_INPUT", "max_steps_per_run");
      this.state.orchestrator.max_steps_per_run = steps;
    }
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.orchestrator = previous;
      throw new ConfigValidationError(
        `总调度设置更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "orchestrator",
      );
    }
    this.persistState();
    this.recordAudit(
      "orchestrator.update",
      "orchestrator",
      "ok",
      `auto_plan=${this.state.orchestrator.auto_plan}; max_steps=${this.state.orchestrator.max_steps_per_run}; ask_before_commit=${this.state.orchestrator.ask_before_commit}`,
    );
    return this.getOrchestratorSettings();
  }

  /** 校验一段系统提示词（预览用，不修改配置）。 */
  validateSystemPrompt(systemPrompt: string, options: { requireSafetyKeywords?: boolean } = {}): { ok: boolean; errors: string[] } {
    return validateSystemPromptText(systemPrompt, { requireSafetyKeywords: options.requireSafetyKeywords === true });
  }

  /** 默认模型服务商/模型路由（按模式生成，不修改当前配置）。 */
  defaultModelRoutingFor(mode: RunMode): ModelRoutingConfig {
    if (!isRunMode(mode)) throw new ConfigValidationError(`未知运行模式：${String(mode)}`, "INVALID_INPUT", "mode");
    return buildDefaults(mode, { now: this.now }).models;
  }

  /** 内部：当前默认服务商。 */
  private defaultProvider(): ModelProviderConfig {
    const found = this.state.models.providers.find((provider) => provider.id === this.state.models.default_provider_id);
    if (found === undefined) throw new ConfigValidationError(`默认服务商不存在：${this.state.models.default_provider_id}`, "INVALID_INPUT", "models.default_provider_id");
    return found;
  }

  /** 内部：一键同步的规范密钥引用（默认服务商引用优先，其次第一个非空）。 */
  private canonicalApiKeyRef(): string {
    const defaultProviderRef = this.state.models.providers.find((provider) => provider.id === this.state.models.default_provider_id)?.api_key_ref;
    if (typeof defaultProviderRef === "string" && defaultProviderRef !== "") return defaultProviderRef;
    return this.state.models.providers.find((provider) => provider.api_key_ref !== "")?.api_key_ref ?? "";
  }

  // -------------------------------------------------------------------------
  // Profile / 审批 / 数据保留（全部参数可配置）
  // -------------------------------------------------------------------------

  /** 更新主体资料（语言/时区/授权人名/主体类型/企业字段）；切换模式请用 setMode。 */
  setProfile(patch: Partial<Profile>): Profile {
    if (!isRecord(patch)) throw new ConfigValidationError("setProfile 需要对象", "INVALID_INPUT", "patch");
    if (patch.mode !== undefined) throw new ConfigValidationError("切换运行模式请使用 setMode()", "INVALID_INPUT", "profile.mode");
    const merged = { ...this.state.profile, ...patch };
    const previous = this.state.profile;
    let next: Profile;
    try {
      next = normalizeProfile(merged, this.state.profile);
    } catch (error) {
      throw error instanceof ConfigValidationError ? error : new ConfigValidationError(String(error), "INVALID_INPUT", "profile");
    }
    this.state.profile = next;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.profile = previous;
      throw new ConfigValidationError(
        `主体资料更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "profile",
      );
    }
    this.persistState();
    this.recordAudit("profile.update", next.principal_name, "ok", `language=${next.language}; timezone=${next.timezone}`);
    return cloneJson(next);
  }

  setApprovalPolicy(patch: Partial<ApprovalPolicy>): ApprovalPolicy {
    if (!isRecord(patch)) throw new ConfigValidationError("setApprovalPolicy 需要对象", "INVALID_INPUT", "patch");
    if ((patch as Record<string, unknown>).auto_approve === true) {
      throw new ConfigValidationError("auto_approve 必须为 false：审批不得自动放行", "INVALID_INPUT", "approval.auto_approve");
    }
    const merged = { ...this.state.approval, ...patch };
    const next = normalizeApproval(merged, this.state.approval);
    const previous = this.state.approval;
    this.state.approval = next;
    if (!validateConfig(this.state).ok) {
      this.state.approval = previous;
      throw new ConfigValidationError("审批策略更新后配置校验失败", "INVALID_INPUT", "approval");
    }
    this.persistState();
    this.recordAudit("approval.update", "approval", "ok", `timeout=${next.timeout_minutes}; threshold=${next.dual_review_threshold_cny}`);
    return cloneJson(next);
  }

  setData(patch: Partial<DataConfig>): DataConfig {
    if (!isRecord(patch)) throw new ConfigValidationError("setData 需要对象", "INVALID_INPUT", "patch");
    if ((patch as Record<string, unknown>).telemetry === true) {
      throw new ConfigValidationError("telemetry 必须为 false：本产品无遥测", "INVALID_INPUT", "data.telemetry");
    }
    const merged = { ...this.state.data, ...patch };
    const next = normalizeData(merged, this.state.data);
    const previous = this.state.data;
    this.state.data = next;
    if (!validateConfig(this.state).ok) {
      this.state.data = previous;
      throw new ConfigValidationError("数据保留配置更新后校验失败", "INVALID_INPUT", "data");
    }
    this.persistState();
    this.recordAudit("data.update", "data", "ok", `retention_days=${next.retention_days}`);
    return cloneJson(next);
  }

  // -------------------------------------------------------------------------
  // v1.3：系统动作策略（受管程序/插件/危险动作二次确认，由系统总控 supervisor 使用）
  // -------------------------------------------------------------------------

  /** 系统动作策略（只读副本）。 */
  getSystemPolicy(): SystemPolicyConfig {
    return cloneJson(this.state.system_policy);
  }

  /**
   * 更新系统动作策略：受管应用白名单 / 插件目录 / 危险动作开关 / 二次确认 TTL。
   * 安全约束：allow_destructive=true 时 require_confirmation 必须为 true。
   */
  setSystemPolicy(patch: SystemPolicyUpdate): SystemPolicyConfig {
    if (!isRecord(patch)) throw new ConfigValidationError("setSystemPolicy 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.system_policy);
    const merged = { ...this.state.system_policy, ...patch };
    let next: SystemPolicyConfig;
    try {
      next = normalizeSystemPolicy(merged, this.state.system_policy);
    } catch (error) {
      throw error instanceof ConfigValidationError ? error : new ConfigValidationError(String(error), "INVALID_INPUT", "system_policy");
    }
    this.state.system_policy = next;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.system_policy = previous;
      throw new ConfigValidationError(
        `系统动作策略更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "system_policy",
      );
    }
    this.persistState();
    this.recordAudit(
      "system.policy.update",
      "system_policy",
      "ok",
      `apps=${next.managed_apps.length}; plugins_dir=${next.plugins_dir}; destructive=${next.allow_destructive}; confirmation=${next.require_confirmation}; ttl=${next.confirmation_ttl_seconds}`,
    );
    return cloneJson(next);
  }

  // -------------------------------------------------------------------------
  // v1.4：运行时设置（发消息即自动执行 / 审批策略 / 步骤上限 / 返工 / 事件保留）
  // -------------------------------------------------------------------------

  /** 运行时设置（只读副本）。 */
  getRuntimeSettings(): RuntimeSettings {
    return cloneJson(this.state.runtime);
  }

  /**
   * 更新运行时设置。
   * 校验：auto_run/full_auto 为布尔；approval_mode ∈ {auto_low_risk,auto_all,manual}；
   * max_auto_steps 10–200；rework_limit 0–3；event_retention 100–5000；
   * 安全约束：full_auto=true 时不能使用 approval_mode=manual（全自动 vs 全人工审批冲突）。
   */
  setRuntimeSettings(patch: RuntimeSettingsUpdate): RuntimeSettings {
    if (!isRecord(patch)) throw new ConfigValidationError("setRuntimeSettings 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.runtime);
    const merged = { ...this.state.runtime, ...patch };
    let next: RuntimeSettings;
    try {
      next = normalizeRuntimeSettings(merged, this.state.runtime);
    } catch (error) {
      throw error instanceof ConfigValidationError ? error : new ConfigValidationError(String(error), "INVALID_INPUT", "runtime");
    }
    this.state.runtime = next;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.runtime = previous;
      throw new ConfigValidationError(
        `运行时设置更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "runtime",
      );
    }
    this.persistState();
    this.recordAudit(
      "runtime.update",
      "runtime",
      "ok",
      `auto_run=${next.auto_run}; approval_mode=${next.approval_mode}; full_auto=${next.full_auto}; max_auto_steps=${next.max_auto_steps}; rework_limit=${next.rework_limit}; event_retention=${next.event_retention}`,
    );
    return cloneJson(next);
  }

  // -------------------------------------------------------------------------
  // v1.5：Harness 真实执行设置（各 agent 走真实 DeepSeek Harness；supervisor 仅系统动作）
  // -------------------------------------------------------------------------

  /** Harness 总设置（只读副本；密钥不在配置内，使用本机 DSH 凭据）。 */
  getHarnessSettings(): HarnessSettings {
    return cloneJson(this.state.harness);
  }

  /**
   * 更新 Harness 设置（含 roles 按角色合并；缺省角色自动补默认）。
   * 校验：profile 非空；timeout 10–1800000；max_concurrency 1–4；artifact_retention_days 1–365；
   * roles 必须覆盖 11 个角色不重复；supervisor.enabled 强制 false；失败回滚并写审计 `harness.update`。
   */
  setHarnessSettings(patch: HarnessSettingsUpdate): HarnessSettings {
    if (!isRecord(patch)) throw new ConfigValidationError("setHarnessSettings 需要对象", "INVALID_INPUT", "patch");
    const previous = cloneJson(this.state.harness);
    const merged = { ...this.state.harness, ...patch };
    let next: HarnessSettings;
    try {
      next = normalizeHarnessSettings(merged, this.state.harness);
    } catch (error) {
      throw error instanceof ConfigValidationError ? error : new ConfigValidationError(String(error), "INVALID_INPUT", "harness");
    }
    this.state.harness = next;
    const validation = validateConfig(this.state);
    if (!validation.ok) {
      this.state.harness = previous;
      throw new ConfigValidationError(
        `Harness 设置更新后校验失败：${validation.errors.map((item) => item.message).join("; ")}`,
        "INVALID_INPUT",
        "harness",
      );
    }
    this.persistState();
    this.recordAudit(
      "harness.update",
      "harness",
      "ok",
      `enabled=${next.enabled}; profile=${next.profile}; timeout_ms=${next.timeout_ms}; max_concurrency=${next.max_concurrency}; artifact_retention_days=${next.artifact_retention_days}; report_required=${next.report_required}; roles=${next.roles.filter((entry) => entry.enabled).length}/${next.roles.length}`,
    );
    return cloneJson(next);
  }

  /** 取某角色的 Harness 设置（未知角色抛错）。 */
  getHarnessRole(role: string): HarnessRoleSettings {
    const roleName = requireString(role, "role");
    const entry = this.state.harness.roles.find((item) => item.role === roleName);
    if (entry === undefined) {
      throw new ConfigValidationError(
        `未知 Harness 角色：${roleName}（允许：${AGENT_ROLES.join("/")}）`,
        "INVALID_INPUT",
        "role",
      );
    }
    return cloneJson(entry);
  }

  // -------------------------------------------------------------------------
  // 数据清空（白名单子目录 + 防路径穿越）
  // -------------------------------------------------------------------------

  /**
   * 清空运行时数据：只删 `<dataRoot>` 下的白名单子目录（runs/domain/evidence/ledger/events/...），
   * 保留 config.json 与其他非白名单内容；目标路径必须严格位于 dataRoot 内（防穿越/防符号链接逃逸）。
   */
  resetData(dataRoot: string): ResetDataResult {
    const rawRoot = requireString(dataRoot, "dataRoot", "resetData 需要 dataRoot 目录");
    const rootResolved = resolvePath(rawRoot);
    const rootParsed = parsePath(rootResolved);
    if (rootResolved === rootParsed.root) {
      throw new ConfigValidationError(`拒绝清空磁盘根目录：${rootResolved}`, "INVALID_INPUT", "dataRoot");
    }
    const result: ResetDataResult = {
      data_root: rootResolved,
      deleted: [],
      missing: [],
      files_deleted: 0,
      bytes_freed: 0,
      preserved: [],
    };
    if (!existsSync(rootResolved)) {
      result.missing = RESETTABLE_SUBDIRS.map((name) => join(rootResolved, name));
      result.preserved.push("dataRoot 不存在：未删除任何内容");
      this.recordAudit("data.reset", rootResolved, "ok", "dataRoot 不存在，未删除");
      return result;
    }
    const rootStat = statSync(rootResolved);
    if (!rootStat.isDirectory()) throw new ConfigValidationError(`dataRoot 不是目录：${rootResolved}`, "INVALID_INPUT", "dataRoot");

    for (const name of RESETTABLE_SUBDIRS) {
      if (!RESETTABLE_SUBDIRS.includes(name)) continue; // 白名单二次校验
      const target = resolvePath(rootResolved, name);
      if (target !== join(rootResolved, name) || !target.startsWith(rootResolved + sep)) {
        // 防路径穿越：目标必须严格位于 dataRoot 内
        continue;
      }
      if (!existsSync(target)) {
        result.missing.push(target);
        continue;
      }
      let targetStat;
      try {
        targetStat = lstatSync(target);
      } catch {
        result.missing.push(target);
        continue;
      }
      if (targetStat.isSymbolicLink()) {
        result.preserved.push(`${target}（符号链接，跳过以防逃逸）`);
        continue;
      }
      if (!targetStat.isDirectory()) {
        result.preserved.push(`${target}（不是目录，跳过）`);
        continue;
      }
      const stats = directoryStats(target);
      rmSync(target, { recursive: true, force: true });
      result.deleted.push(target);
      result.files_deleted += stats.files;
      result.bytes_freed += stats.bytes;
    }
    result.preserved.push("config.json（配置文件保留）");
    if (result.deleted.length === 0 && result.missing.length === 0) result.preserved.push("白名单目录均为空/不存在");
    this.recordAudit(
      "data.reset",
      rootResolved,
      "ok",
      `deleted=${result.deleted.length}; files=${result.files_deleted}; bytes=${result.bytes_freed}`,
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // 审计 / 校验
  // -------------------------------------------------------------------------

  /** 审计记录（最近 limit 条，默认全部；只追加）。 */
  auditTrail(limit?: number): AuditEntry[] {
    const entries = this.auditEntries.map((entry) => ({ ...entry }));
    if (limit === undefined) return entries;
    const count = Math.max(0, Math.floor(limit));
    return entries.slice(Math.max(0, entries.length - count));
  }

  /** Token 用量历史。 */
  tokenUsageHistory(): TokenUsageEntry[] {
    return this.tokenHistory.map((entry) => ({ ...entry }));
  }

  /** 校验当前配置（返回全部问题，不抛错）。 */
  validate(): ValidationResult {
    return validateConfig(this.state);
  }

  // -------------------------------------------------------------------------
  // 内部：持久化 / 审计 / 辅助
  // -------------------------------------------------------------------------

  private persistState(): void {
    this.state.updated_at = this.now().toISOString();
    if (this.configPath === null) return;
    ensureDirSync(dirname(this.configPath));
    atomicWriteJsonSync(this.configPath, this.state);
  }

  private recordAudit(action: string, object: string, result: AuditResult, reason: string): void {
    this.auditSeq += 1;
    const entry: AuditEntry = { seq: this.auditSeq, at: this.now().toISOString(), action, object, result, reason };
    this.auditEntries.push(entry);
    if (this.auditPath !== null) appendJsonLineSync(this.auditPath, entry);
  }

  private assertValidOrThrow(config: StewardConfig, prefix: string): void {
    const validation = validateConfig(config);
    if (validation.ok) return;
    const first = validation.errors[0];
    throw new ConfigValidationError(
      `${prefix}：${validation.errors.map((item) => `${item.field}: ${item.message}`).join("; ")}`,
      "INVALID_INPUT",
      first === undefined ? null : first.field,
    );
  }

  private trimTokenUsageToBudget(): void {
    this.state.token_budget.used_tokens = Math.min(this.state.token_budget.used_tokens, this.state.token_budget.limit_tokens);
  }

  private clearTokenUsageFile(): void {
    if (this.tokenUsagePath === null) return;
    try {
      writeFileSync(this.tokenUsagePath, "", "utf8");
    } catch (error) {
      throw new ConfigIOError(`清空 Token 用量日志失败：${(error as Error).message}`, this.tokenUsagePath);
    }
  }
}

// ---------------------------------------------------------------------------
// 内部辅助：目录统计
// ---------------------------------------------------------------------------

function directoryStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      try {
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) {
          files += 1;
          bytes += statSync(full).size;
        }
      } catch {
        // 忽略无法访问的条目
      }
    }
  }
  return { files, bytes };
}

/** 便捷：某模式下默认的代理角色列表（字符串数组；CLI 展示用）。 */
export function agentRolesForMode(mode: RunMode): AgentRoleName[] {
  if (!isRunMode(mode)) return [...AGENT_ROLES];
  return [...AGENT_ROLES];
}
