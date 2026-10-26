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
  defaultsForMode as buildDefaults,
  isAgentRole,
  isFeatureName,
  isRunMode,
  type AgentRoleName,
} from "./defaults.js";
import { BudgetLimitError, ConfigIOError, ConfigValidationError, FeatureDisabledError } from "./errors.js";
import { appendJsonLineSync, atomicWriteJsonSync, ensureDirSync, readJsonFileSync, readJsonLinesSync } from "./io.js";
import { isMaskedValue, looksLikePlaintextCard, looksLikePlaintextPhone, maskAccount as maskAccountValue, maskAccountId, maskBankCard, maskLicenseNo, maskTaxNo } from "./mask.js";
import { TokenBudget } from "./token-budget.js";
import type {
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
  DataConfig,
  FeatureCheckResult,
  FeatureName,
  FeatureToggle,
  Features,
  InvoiceConfig,
  InvoiceDefaultType,
  ModeDiff,
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
  if (mode === "personal") {
    if (invoice !== undefined && invoice.default_type === "vat_special") {
      issue(errors, "payments.invoice.default_type", "个人模式不允许开具增值税专用发票（请用 none/personal_receipt/vat_general）");
    }
    if (providers.some((provider) => provider.kind === "corporate_account")) {
      issue(errors, "payments.providers", "个人模式不允许使用对公账户收款（请用微信/支付宝/个人银行卡）");
    }
    if (payments?.require_dual_review === true) issue(errors, "payments.require_dual_review", "个人模式无需双人复核（require_dual_review 应为 false）");
    if (payments?.sign_contract === true) issue(errors, "payments.sign_contract", "个人模式无需合同签署流程（sign_contract 应为 false）");
  }
  if (mode === "enterprise") {
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
