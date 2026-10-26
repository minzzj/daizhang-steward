/**
 * v1.1 配置中心契约（三种运行模式：体验 demo / 个人 personal / 企业 enterprise）。
 *
 * 设计目标（回应用户核心诉求）：
 * 1. **全部参数可配置**：profile / features / budgets / token / payments / agents / approval / data 均可写；
 * 2. **三种运行模式**：demo（内置演示数据）、personal（微信/支付宝/个人银行卡，无签字/法务条款/双人复核）、
 *    enterprise（对公/专票/授权书/用印/双人复核/企业主体必填）；
 * 3. **所有功能可逐项禁用**：14 个 FeatureToggle（含 enabled/requires_approval/note）；
 * 4. **银行卡与支付配置明确**：`payments.providers[]` + `payments.payout_account` + `payments.invoice`；
 * 5. **Token 预算可配置**：`token_budget.limit_tokens`（测试值 10,000,000）/ `per_action_limit`；
 * 6. **预算支持 0 元极限模式**：`budgets.zero_budget_mode` + `allow_free_local_actions`；
 * 7. **数据可清空**：`ConfigEngine.resetData(dataRoot)`（白名单子目录，防路径穿越）。
 *
 * 所有金额单位：人民币元（CNY）；时间戳 ISO 8601；纯逻辑、零第三方依赖、无网络。
 * 敏感字段只存掩码/引用（银行卡只留后 4 位、微信/支付宝 id 打码），**绝不存明文**。
 */

// ---------------------------------------------------------------------------
// 1) 运行模式与主体
// ---------------------------------------------------------------------------

export type RunMode = "demo" | "personal" | "enterprise";
export type OperatorType = "individual" | "company";
export type Language = "zh-CN" | "en";
export type Currency = "CNY";

/** 企业主体（仅企业模式必填；字段均为掩码/摘要，不存明文证照号）。 */
export interface CompanyProfile {
  name: string;
  license_no_masked: string;
  tax_no_masked: string;
  legal_representative: string;
  agent_name: string;
}

export interface Profile {
  mode: RunMode;
  operator_type: OperatorType;
  language: Language;
  currency: Currency;
  timezone: string;
  /** 授权人/本人（演示可用虚构名）。 */
  principal_name: string;
  company?: CompanyProfile;
}

// ---------------------------------------------------------------------------
// 2) 功能开关（所有功能可逐项禁用）
// ---------------------------------------------------------------------------

export interface FeatureToggle {
  enabled: boolean;
  requires_approval: boolean;
  note?: string;
}

export interface Features {
  browser: FeatureToggle;
  desktop: FeatureToggle;
  coding_loop: FeatureToggle;
  scout: FeatureToggle;
  content: FeatureToggle;
  research: FeatureToggle;
  payments: FeatureToggle;
  invoicing: FeatureToggle;
  notifications: FeatureToggle;
  auto_send: FeatureToggle;
  console: FeatureToggle;
  fault_drills: FeatureToggle;
  enterprise: FeatureToggle;
  demo_data: FeatureToggle;
}

export type FeatureName = keyof Features;

/** setFeature 的入参（partial：只改传入字段）。 */
export interface FeatureUpdate {
  enabled: boolean;
  requiresApproval?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// 3) 预算三层 + 0 元极限模式
// ---------------------------------------------------------------------------

export interface Budgets {
  month_cny: number;
  project_cny: number;
  per_txn_cny: number;
  /** 0 元极限模式：true 时任何 amount>0 一律拒绝（演示/断网/冻结期用）。 */
  zero_budget_mode: boolean;
  /** 允许免费本地动作（0 元消耗，如读文件/本地整理/离线草稿）。 */
  allow_free_local_actions: boolean;
}

export type BudgetKind = "month" | "project" | "per_txn";

export interface BudgetCheckResult {
  allowed: boolean;
  kind: BudgetKind;
  amount_cny: number;
  /** 对应层额度；0 元极限模式下为 0。 */
  limit_cny: number;
  remaining_cny: number;
  zero_budget_mode: boolean;
  requiresHuman: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 4) Token 预算
// ---------------------------------------------------------------------------

export interface TokenBudgetConfig {
  limit_tokens: number;
  per_action_limit: number;
  used_tokens: number;
  on_exceed: "block" | "notify";
}

export interface TokenConsumeMeta {
  /** 消耗 token 的代理角色（用于 usageByAgent 统计）。 */
  agentRole: string;
  /** 动作标识（如 browser.flow / harness.request）。 */
  action: string;
}

export interface TokenConsumeResult {
  ok: boolean;
  reason?: string;
  consumed: number;
  used_tokens: number;
  limit_tokens: number;
  remaining_tokens: number;
  on_exceed: "block" | "notify";
  /** 是否因超限被拦截（on_exceed="block" 时为 true）。 */
  blocked: boolean;
  /** 单步上限是否被触发。 */
  per_action_exceeded: boolean;
}

export interface TokenUsageEntry {
  at: string;
  agent_role: string;
  action: string;
  amount: number;
  ok: boolean;
  reason?: string;
  used_after: number;
}

export interface TokenUsageByAgent {
  role: string;
  calls: number;
  tokens: number;
  token_limit: number;
  remaining_tokens: number;
}

// ---------------------------------------------------------------------------
// 5) 支付 / 银行卡 / 发票（银行卡配置位置明确）
// ---------------------------------------------------------------------------

export type PaymentProviderKind = "wechat_pay" | "alipay" | "personal_bank_card" | "corporate_account" | "manual";
export type PaymentProviderMode = "auto" | "manual_approval" | "disabled";

/** 支付渠道配置（`payments.providers[]`；account 只存掩码）。 */
export interface PaymentProvider {
  id: string;
  kind: PaymentProviderKind;
  name: string;
  enabled: boolean;
  mode: PaymentProviderMode;
  account_masked: string;
  note?: string;
}

/** 收款账户（`payments.payout_account`；银行卡/微信/支付宝位置明确，全部掩码）。 */
export interface PayoutAccount {
  holder: string;
  bank_name: string;
  /** 银行卡掩码（只留后 4 位，如 `**** **** **** 6789`）。 */
  card_no_masked: string;
  type: "personal" | "corporate";
  wechat_id_masked?: string;
  alipay_id_masked?: string;
}

export type InvoiceDefaultType = "none" | "personal_receipt" | "vat_general" | "vat_special";

export interface InvoiceConfig {
  default_type: InvoiceDefaultType;
  title: string;
  tax_no_masked?: string;
  /** true = 只生成开票草稿，人工确认提交（AI 不自动开票）。 */
  draft_only: boolean;
}

export interface PaymentsConfig {
  providers: PaymentProvider[];
  payout_account: PayoutAccount;
  invoice: InvoiceConfig;
  require_dual_review: boolean;
  sign_contract: boolean;
  /** 硬约束：AI 永远不得代签。 */
  ai_may_sign: false;
}

export interface PaymentProviderUpdate {
  enabled?: boolean;
  mode?: PaymentProviderMode;
  /** 原始账号（会立即掩码，不落明文）。 */
  account?: string;
  note?: string;
}

export interface PayoutAccountUpdate {
  holder?: string;
  bank_name?: string;
  /** 原始卡号/微信 id/支付宝 id（会立即掩码，不落明文）。 */
  card_no?: string;
  type?: "personal" | "corporate";
  wechat_id?: string;
  alipay_id?: string;
}

// ---------------------------------------------------------------------------
// 6) 代理（智能体）注册表
// ---------------------------------------------------------------------------

export type Autonomy = "readonly" | "draft" | "approval_required" | "autonomous_limited";

export interface AgentConfig {
  role: string;
  name: string;
  enabled: boolean;
  autonomy: Autonomy;
  tools: string[];
  token_limit: number;
  model_ref: string;
}

export interface AgentUpdate {
  name?: string;
  enabled?: boolean;
  autonomy?: Autonomy;
  tools?: string[];
  token_limit?: number;
  model_ref?: string;
}

// ---------------------------------------------------------------------------
// 7) 审批策略 / 数据保留 / 总配置
// ---------------------------------------------------------------------------

export interface ApprovalPolicy {
  /** 审批卡超时分钟数（超时挂起，不自动放行）。 */
  timeout_minutes: number;
  auto_approve: false;
  /** 触发双人复核的金额阈值（元；个人模式 require_dual_review=false 时不生效）。 */
  dual_review_threshold_cny: number;
  takeover_shortcut: string;
}

export interface DataConfig {
  retention_days: number;
  /** 遥测硬关闭（本产品无遥测）。 */
  telemetry: false;
}

export interface StewardConfig {
  version: number;
  profile: Profile;
  features: Features;
  budgets: Budgets;
  token_budget: TokenBudgetConfig;
  payments: PaymentsConfig;
  agents: AgentConfig[];
  approval: ApprovalPolicy;
  data: DataConfig;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// 8) 校验 / 模式切换 / 数据清空 / 审计 结果类型
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}

export interface FeatureCheckResult {
  allowed: boolean;
  feature: FeatureName;
  requires_approval: boolean;
  reason?: string;
}

export interface ModeDiff {
  from: RunMode;
  to: RunMode;
  /** 发生变化的字段路径（如 profile.mode / payments.invoice.default_type）。 */
  changed: string[];
  config: StewardConfig;
}

export interface SetModeOptions {
  /** 保留用户自定义预算（默认 true）。 */
  preserve_budgets?: boolean;
  /** 保留用户自定义 token 预算（默认 true）。 */
  preserve_token_budget?: boolean;
  /** 保留功能开关自定义状态（默认 false：功能开关按目标模式默认值重置）。 */
  preserve_features?: boolean;
}

export interface ResetDataResult {
  data_root: string;
  /** 已删除的白名单子目录（绝对路径）。 */
  deleted: string[];
  /** 不存在而跳过的白名单子目录。 */
  missing: string[];
  files_deleted: number;
  bytes_freed: number;
  /** 保留项说明（如 config.json / 非白名单目录）。 */
  preserved: string[];
}

export type AuditResult = "ok" | "blocked" | "failed";

/** 审计行（时间/操作/对象/结果/原因；只追加，持久化到 `<root>/config-audit.jsonl`）。 */
export interface AuditEntry {
  seq: number;
  at: string;
  action: string;
  object: string;
  result: AuditResult;
  reason: string;
}

export interface ConfigEngineOptions {
  /** 持久化根目录：`<root>/config.json`（原子写）+ `<root>/config-audit.jsonl`。 */
  root?: string;
  mode?: RunMode;
  /** false = 纯内存（默认：给了 root 就持久化）。 */
  persist?: boolean;
  now?: () => Date;
}

/** `defaultsForMode` / `ConfigEngine.defaultsForMode` 的返回（即完整配置）。 */
export type ModeDefaults = StewardConfig;
