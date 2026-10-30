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

// ---------------------------------------------------------------------------
// 6.2) 易支付（epay，v1.3 新增；默认 demo 模式，未填商家信息时 disabled）
// ---------------------------------------------------------------------------

export type EpayMode = "demo" | "live";
export type EpayPayType = "alipay" | "wxpay";

/**
 * 易支付（epay）聚合支付配置。`key_ref` 只存密钥**引用**（`env:EPAY_KEY` /
 * `file:secrets.json#epay`），绝不存明文；`mode="live"` 时必须补齐商家信息（pid/key_ref/回调地址）。
 */
export interface EpayConfig {
  enabled: boolean;
  /** 网关地址，必须 https。 */
  gateway_url: string;
  /** 商户 ID（demo 模式可留空；live 必填）。 */
  pid: string;
  /** 商户密钥引用：env:EPAY_KEY / file:secrets.json#epay / ""（未配置）。 */
  key_ref: string;
  pay_types: EpayPayType[];
  notify_url: string;
  return_url: string;
  mode: EpayMode;
  sign_type: "MD5";
}

export interface EpayConfigUpdate {
  enabled?: boolean;
  gateway_url?: string;
  pid?: string;
  key_ref?: string;
  pay_types?: EpayPayType[];
  notify_url?: string;
  return_url?: string;
  mode?: EpayMode;
}

export interface PaymentsConfig {
  providers: PaymentProvider[];
  payout_account: PayoutAccount;
  invoice: InvoiceConfig;
  require_dual_review: boolean;
  sign_contract: boolean;
  /** 硬约束：AI 永远不得代签。 */
  ai_may_sign: false;
  /** 易支付配置（v1.3；旧 config 自动补默认）。 */
  epay?: EpayConfig;
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
// 6.5) 多模型 / API 密钥引用 / 各智能体模型分配（v1.2 新增）
// ---------------------------------------------------------------------------

export type ModelProviderKind = "deepseek" | "openai_compatible" | "anthropic" | "local";

/**
 * 模型服务商配置。`api_key_ref` 只存**引用**（环境变量名/本地 secrets 文件片段），
 * 绝不存明文密钥；空字符串表示尚未配置。
 * 例：`env:DEEPSEEK_API_KEY`、`file:secrets.json#deepseek`。
 */
export interface ModelProviderConfig {
  id: string;
  name: string;
  kind: ModelProviderKind;
  /** 如 https://api.deepseek.com（必须是 http(s) 绝对地址）。 */
  base_url: string;
  /** 密钥引用：`env:NAME` | `file:<path>#<key>` | ""（未配置）。 */
  api_key_ref: string;
  enabled: boolean;
  default_model: string;
  /** 该服务商可用的模型名（用户可增删）。 */
  models: string[];
  note?: string;
}

/** 一键同步模式：single_key_all=所有功能共用同一个密钥引用；per_provider=各服务商独立。 */
export type ModelSyncMode = "single_key_all" | "per_provider";

export interface AgentModelBinding {
  provider_id: string;
  model: string;
  /** 采样温度（可选，0-2）。 */
  temperature?: number;
  max_tokens?: number;
}

export interface ModelRoutingConfig {
  sync_mode: ModelSyncMode;
  default_provider_id: string;
  providers: ModelProviderConfig[];
  /** role -> 绑定（10 个角色默认绑定默认服务商）。 */
  agent_models: Record<string, AgentModelBinding>;
}

/** 单个智能体的专业系统提示词。 */
export interface SystemPromptConfig {
  role: string;
  title: string;
  system_prompt: string;
  updated_at: string;
}

/**
 * 总调度（最上层智能体）负责管理的核心设置：conductor 专业系统提示词、
 * 各 agent 系统提示词、自动规划/步数上限/提交前确认。
 */
export interface OrchestratorSettings {
  conductor_prompt: string;
  system_prompts: SystemPromptConfig[];
  auto_plan: boolean;
  max_steps_per_run: number;
  ask_before_commit: boolean;
}

/** resolveAgentModel 的返回：只给 has_key，绝不返回明文密钥。 */
export interface ResolvedAgentModel {
  role: string;
  provider_id: string;
  provider: ModelProviderConfig;
  binding: AgentModelBinding;
  model: string;
  has_key: boolean;
  key_source: "env" | "file" | "missing";
}

/** getApiKeyForProvider 的运行时解析结果（仅运行器内部使用，不写日志/不落盘）。 */
export interface ApiKeyResolution {
  ok: boolean;
  /** 明文密钥：**仅供运行时调用，禁止写入日志/配置/审计**。 */
  value?: string;
  source: "env" | "file" | "missing";
  env_name?: string;
  file?: string;
  error?: string;
}

export interface SyncApiKeyResult {
  /** 同步后的密钥引用（引用本身不是密钥，可展示）。 */
  api_key_ref: string;
  /** 展示用掩码引用。 */
  api_key_ref_masked: string;
  sync_mode: ModelSyncMode;
  affected_provider_ids: string[];
  already_consistent: boolean;
}

export interface LocalApiKeyResult {
  provider_id: string;
  api_key_ref: string;
  secrets_file: string;
  created: boolean;
}

export interface ProviderKeyRefUpdate {
  provider_id: string;
  api_key_ref: string;
  api_key_ref_masked: string;
  affected_provider_ids: string[];
}

export interface OrchestratorUpdate {
  auto_plan?: boolean;
  max_steps_per_run?: number;
  ask_before_commit?: boolean;
}

// ---------------------------------------------------------------------------
// 6.8) 系统动作策略（v1.3 新增：受管程序/插件/危险动作二次确认）
// ---------------------------------------------------------------------------

/** 受管程序（系统总控 supervisor 只能启停/管理白名单内的程序）。 */
export interface ManagedAppConfig {
  id: string;
  name: string;
  /** 启动命令（如 node examples/demo-web/server.mjs / notepad.exe）。 */
  command: string;
  allow_start: boolean;
  allow_stop: boolean;
  allow_remove: boolean;
}

/**
 * 系统动作策略：受管应用白名单、插件目录、危险动作开关与二次确认。
 * 默认 allow_destructive=true 但 require_confirmation=true（危险动作必须二次确认）。
 */
export interface SystemPolicyConfig {
  managed_apps: ManagedAppConfig[];
  plugins_dir: string;
  allow_destructive: boolean;
  require_confirmation: boolean;
  confirmation_ttl_seconds: number;
}

export interface SystemPolicyUpdate {
  managed_apps?: ManagedAppConfig[];
  plugins_dir?: string;
  allow_destructive?: boolean;
  require_confirmation?: boolean;
  confirmation_ttl_seconds?: number;
}

// ---------------------------------------------------------------------------
// 6.9) 运行时设置（v1.4 新增：自动执行 / 审批策略 / 步骤上限 / 返工 / 事件保留）
// ---------------------------------------------------------------------------

/**
 * 审批模式：
 * - `auto_low_risk`（默认）：仅 high/critical/requires_confirmation 的动作暂停等审批；
 * - `auto_all`：全部自动执行（仍受 full_auto/危险动作策略的硬约束）；
 * - `manual`：所有动作都要人工确认。
 */
export type ApprovalMode = "auto_low_risk" | "auto_all" | "manual";

/** 运行时设置：发消息即自动执行相关参数（控制台 /settings 展示与修改）。 */
export interface RuntimeSettings {
  /** 发消息后自动执行（默认 true）。 */
  auto_run: boolean;
  /** 审批策略（默认 auto_low_risk）。 */
  approval_mode: ApprovalMode;
  /** 默认 false；true 时除 destructive 外全自动，但不能与 approval_mode="manual" 同时使用。 */
  full_auto: boolean;
  /** 单 run 自动步骤上限（10–200；按模式默认 demo 10 / personal 20 / enterprise 50）。 */
  max_auto_steps: number;
  /** 自动返工次数上限（0–3，默认 1）。 */
  rework_limit: number;
  /** 每个 run 保留的事件数（100–5000，默认 1000）。 */
  event_retention: number;
}

export interface RuntimeSettingsUpdate {
  auto_run?: boolean;
  approval_mode?: ApprovalMode;
  full_auto?: boolean;
  max_auto_steps?: number;
  rework_limit?: number;
  event_retention?: number;
}

export interface ModelProviderRemovalResult {
  removed_provider_id: string;
  /** 原本绑定该服务商、已自动改绑到默认服务商的代理角色。 */
  rebound_roles: string[];
}

export interface ModelSyncModeResult {
  sync_mode: ModelSyncMode;
  /** 因切换为一键同步而被统一的 provider id。 */
  synced_provider_ids: string[];
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
  /** v1.2 新增：多模型路由 / API 密钥引用 / 各智能体模型分配（旧 config 自动补默认）。 */
  models: ModelRoutingConfig;
  /** v1.2 新增：总调度负责的核心设置与专业系统提示词（旧 config 自动补默认）。 */
  orchestrator: OrchestratorSettings;
  /** v1.3 新增：系统动作策略（受管程序/插件/危险动作二次确认；旧 config 自动补默认）。 */
  system_policy: SystemPolicyConfig;
  /** v1.4 新增：自动执行/审批策略等运行时设置（旧 config 自动补默认）。 */
  runtime: RuntimeSettings;
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
  /** v1.2：保留用户自配的模型/API 密钥引用（默认 true；关闭会重置为目标模式默认模型）。 */
  preserve_models?: boolean;
  /** v1.2：保留用户自定义的系统提示词（默认 true）。 */
  preserve_orchestrator?: boolean;
  /** v1.4：保留用户自定义的运行时设置（默认 true；关闭会重置为目标模式默认值）。 */
  preserve_runtime?: boolean;
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
