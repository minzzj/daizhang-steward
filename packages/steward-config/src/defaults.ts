/**
 * 三种运行模式的默认配置（demo / personal / enterprise）。
 *
 * 差异摘要：
 * - demo：内置演示数据、支付=人工确认、预算 5 万、token 1M；
 * - personal：微信支付/支付宝/个人银行卡（人工审批）、无签字/无法务条款/无双人复核、发票 none、
 *   预算 5000/2000/500、token 2M；
 * - enterprise：对公账户 + 增值税专票 + 授权书/用印 + 双人复核 + 企业主体必填、
 *   预算 50000/20000/5000、token 10,000,000。
 *
 * 注意：所有默认值都可被用户逐项覆盖（`setFeature` / `setBudgets` / `setTokenBudget` / ...）。
 */

import { buildDefaultOrchestratorSettings } from "./prompts.js";
import type {
  AgentConfig,
  AgentModelBinding,
  Autonomy,
  Budgets,
  CompanyProfile,
  EpayConfig,
  FeatureName,
  FeatureToggle,
  Features,
  InvoiceConfig,
  ManagedAppConfig,
  ModelProviderConfig,
  ModelRoutingConfig,
  ModelSyncMode,
  OrchestratorSettings,
  PaymentProvider,
  PaymentsConfig,
  PayoutAccount,
  Profile,
  RunMode,
  RuntimeSettings,
  StewardConfig,
  SystemPolicyConfig,
  TokenBudgetConfig,
} from "./types.js";

/** 配置结构版本（只增不减；升级时做迁移）。 */
export const CONFIG_VERSION = 1 as const;

/** 全部功能开关名（14 项，均可逐项禁用）。 */
export const FEATURE_NAMES: readonly FeatureName[] = [
  "browser",
  "desktop",
  "coding_loop",
  "scout",
  "content",
  "research",
  "payments",
  "invoicing",
  "notifications",
  "auto_send",
  "console",
  "fault_drills",
  "enterprise",
  "demo_data",
];

/** 全部代理角色（11 个：supervisor 系统总控 + conductor + 9 个专项）。 */
export const AGENT_ROLES = [
  "supervisor",
  "conductor",
  "operator",
  "harness",
  "customer",
  "finance",
  "reviewer",
  "backend",
  "scout",
  "content",
  "research",
] as const;

export type AgentRoleName = (typeof AGENT_ROLES)[number];

const RUN_MODES: readonly RunMode[] = ["demo", "personal", "enterprise"];

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value);
}

export function isFeatureName(value: unknown): value is FeatureName {
  return typeof value === "string" && (FEATURE_NAMES as readonly string[]).includes(value);
}

export function isAgentRole(value: unknown): value is AgentRoleName {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

/** 构造 FeatureToggle（note 仅在提供时写入，兼容 exactOptionalPropertyTypes）。 */
export function featureToggle(enabled: boolean, requiresApproval = false, note?: string): FeatureToggle {
  const toggle: FeatureToggle = { enabled, requires_approval: requiresApproval };
  if (note !== undefined) toggle.note = note;
  return toggle;
}

function buildFeatures(mode: RunMode): Features {
  const enabled = (requiresApproval = false): FeatureToggle => featureToggle(true, requiresApproval);
  const disabled = (note = "用户可在配置中心逐项开启"): FeatureToggle => featureToggle(false, false, note);
  if (mode === "demo") {
    return {
      browser: enabled(),
      desktop: enabled(),
      coding_loop: enabled(),
      scout: enabled(),
      content: enabled(),
      research: enabled(),
      payments: enabled(true),
      invoicing: disabled("体验模式默认关闭开票"),
      notifications: enabled(),
      auto_send: disabled("默认关闭：对外发送一律人工确认"),
      console: enabled(),
      fault_drills: enabled(),
      enterprise: disabled("体验模式不含企业能力"),
      demo_data: enabled(),
    };
  }
  if (mode === "enterprise") {
    return {
      browser: enabled(),
      desktop: enabled(),
      coding_loop: enabled(),
      scout: enabled(),
      content: enabled(),
      research: enabled(),
      payments: enabled(true),
      invoicing: enabled(true),
      notifications: enabled(),
      auto_send: disabled("默认关闭：对外发送一律人工确认/双人复核"),
      console: enabled(),
      fault_drills: enabled(),
      enterprise: enabled(true),
      demo_data: disabled("企业模式不使用内置演示数据"),
    };
  }
  // personal
  return {
    browser: enabled(),
    desktop: enabled(),
    coding_loop: enabled(),
    scout: enabled(),
    content: enabled(),
    research: enabled(),
    payments: enabled(true),
    invoicing: enabled(true),
    notifications: enabled(),
    auto_send: disabled("默认关闭：对外发送只出草稿，人工确认后发送"),
    console: enabled(),
    fault_drills: enabled(),
    enterprise: disabled("个人模式不含企业能力（对公/专票/双人复核）"),
    demo_data: disabled("个人模式不使用内置演示数据"),
  };
}

/** 默认易支付（epay）配置：demo 模式、未填商家信息时 disabled；密钥只存引用。 */
export function defaultEpayConfig(): EpayConfig {
  return {
    enabled: false,
    gateway_url: "https://pay.example.com/submit.php",
    pid: "",
    key_ref: "",
    pay_types: ["alipay", "wxpay"],
    notify_url: "http://127.0.0.1:4180/api/payments/epay/notify",
    return_url: "http://127.0.0.1:4180/api/payments/epay/return",
    mode: "demo",
    sign_type: "MD5",
  };
}

function demoPayments(): PaymentsConfig {
  const providers: PaymentProvider[] = [
    {
      id: "manual",
      kind: "manual",
      name: "人工确认（体验模式演示）",
      enabled: true,
      mode: "manual_approval",
      account_masked: "（演示无真实资金）",
      note: "体验模式不接真实支付；所有资金动作只做演示记录",
    },
  ];
  const payout: PayoutAccount = {
    holder: "体验用户（演示）",
    bank_name: "演示银行",
    card_no_masked: "**** **** **** 0000",
    type: "personal",
  };
  const invoice: InvoiceConfig = { default_type: "none", title: "", draft_only: true };
  return {
    providers,
    payout_account: payout,
    invoice,
    require_dual_review: false,
    sign_contract: false,
    ai_may_sign: false,
    epay: defaultEpayConfig(),
  };
}

function personalPayments(): PaymentsConfig {
  const providers: PaymentProvider[] = [
    {
      id: "wechat",
      kind: "wechat_pay",
      name: "微信支付",
      enabled: true,
      mode: "manual_approval",
      account_masked: "wx_***89",
      note: "个人收款；每笔需人工确认",
    },
    {
      id: "alipay",
      kind: "alipay",
      name: "支付宝",
      enabled: true,
      mode: "manual_approval",
      account_masked: "ali***90",
      note: "个人收款；每笔需人工确认",
    },
    {
      id: "personal-card",
      kind: "personal_bank_card",
      name: "个人银行卡",
      enabled: true,
      mode: "manual_approval",
      account_masked: "**** **** **** 6789",
      note: "个人储蓄卡收款；卡号只存掩码，绝不存明文",
    },
  ];
  const payout: PayoutAccount = {
    holder: "本人",
    bank_name: "示例银行",
    card_no_masked: "**** **** **** 6789",
    type: "personal",
    wechat_id_masked: "wx_***89",
    alipay_id_masked: "ali***90",
  };
  const invoice: InvoiceConfig = { default_type: "none", title: "", draft_only: true };
  return {
    providers,
    payout_account: payout,
    invoice,
    require_dual_review: false,
    sign_contract: false,
    ai_may_sign: false,
    epay: defaultEpayConfig(),
  };
}

function enterprisePayments(): PaymentsConfig {
  const providers: PaymentProvider[] = [
    {
      id: "corp-bank",
      kind: "corporate_account",
      name: "对公银行账户",
      enabled: true,
      mode: "manual_approval",
      account_masked: "**** **** **** 5678",
      note: "对公收款；变更需双人复核",
    },
    {
      id: "manual",
      kind: "manual",
      name: "财务人工确认",
      enabled: true,
      mode: "manual_approval",
      account_masked: "—",
      note: "财务人工处理对公转账/回单",
    },
  ];
  const payout: PayoutAccount = {
    holder: "示例科技有限公司",
    bank_name: "示例银行（对公）",
    card_no_masked: "**** **** **** 5678",
    type: "corporate",
  };
  const invoice: InvoiceConfig = {
    default_type: "vat_special",
    title: "示例科技有限公司",
    tax_no_masked: "9133******20",
    draft_only: true,
  };
  return {
    providers,
    payout_account: payout,
    invoice,
    require_dual_review: true,
    sign_contract: true,
    ai_may_sign: false,
    epay: { ...defaultEpayConfig(), mode: "demo" },
  };
}

function buildBudgets(mode: RunMode): Budgets {
  if (mode === "personal") {
    return { month_cny: 5_000, project_cny: 2_000, per_txn_cny: 500, zero_budget_mode: false, allow_free_local_actions: true };
  }
  if (mode === "enterprise") {
    return { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000, zero_budget_mode: false, allow_free_local_actions: true };
  }
  return { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000, zero_budget_mode: false, allow_free_local_actions: true };
}

function buildTokenBudget(mode: RunMode): TokenBudgetConfig {
  if (mode === "demo") return { limit_tokens: 1_000_000, per_action_limit: 100_000, used_tokens: 0, on_exceed: "notify" };
  if (mode === "personal") return { limit_tokens: 2_000_000, per_action_limit: 100_000, used_tokens: 0, on_exceed: "block" };
  // enterprise：本次测试值 10,000,000 tokens
  return { limit_tokens: 10_000_000, per_action_limit: 500_000, used_tokens: 0, on_exceed: "block" };
}

function buildCompany(): CompanyProfile {
  return {
    name: "示例科技有限公司",
    license_no_masked: "9133******（待填写，仅存掩码）",
    tax_no_masked: "9133******20",
    legal_representative: "示例法人（待改为真实姓名）",
    agent_name: "示例经办人（待改为真实姓名）",
  };
}

function buildProfile(mode: RunMode): Profile {
  const base: Profile = {
    mode,
    operator_type: mode === "enterprise" ? "company" : "individual",
    language: "zh-CN",
    currency: "CNY",
    timezone: "Asia/Shanghai",
    principal_name: mode === "demo" ? "体验用户（演示）" : mode === "enterprise" ? "企业授权人（示例）" : "本人",
  };
  if (mode === "enterprise") base.company = buildCompany();
  return base;
}

interface AgentSeed {
  role: AgentRoleName;
  name: string;
  tools: string[];
}

const AGENT_SEEDS: readonly AgentSeed[] = [
  {
    role: "supervisor",
    name: "系统总控",
    tools: ["system.*", "agents.*", "models.*", "prompts.*", "project.delegate", "logs.read"],
  },
  { role: "conductor", name: "总调度", tools: ["agent.dispatch", "budget.check", "task.plan", "approval.request"] },
  { role: "operator", name: "办公执行", tools: ["browser.flow", "desktop.flow", "artifact.write"] },
  { role: "harness", name: "编码代理", tools: ["harness.request", "patch.apply", "test.run"] },
  { role: "customer", name: "客户沟通", tools: ["message.draft", "thread.reply", "evidence.attach"] },
  { role: "finance", name: "财务", tools: ["ledger.record", "invoice.draft", "budget.check"] },
  { role: "reviewer", name: "核查", tools: ["evidence.verify", "policy.check", "report.render"] },
  { role: "backend", name: "后台运维", tools: ["data.backup", "data.reset", "log.rotate"] },
  { role: "scout", name: "线索", tools: ["scout.score", "outreach.draft", "lead.import"] },
  { role: "content", name: "内容", tools: ["content.plan", "copy.draft", "artifact.write"] },
  { role: "research", name: "调研", tools: ["web.search", "source.summarize", "evidence.attach"] },
];

const AUTONOMY_BY_MODE: Record<RunMode, Record<string, Autonomy>> = {
  demo: {
    supervisor: "approval_required",
    conductor: "autonomous_limited",
    operator: "draft",
    harness: "draft",
    customer: "draft",
    finance: "draft",
    reviewer: "readonly",
    backend: "readonly",
    scout: "draft",
    content: "draft",
    research: "readonly",
  },
  personal: {
    supervisor: "approval_required",
    conductor: "autonomous_limited",
    operator: "approval_required",
    harness: "approval_required",
    customer: "draft",
    finance: "approval_required",
    reviewer: "readonly",
    backend: "readonly",
    scout: "draft",
    content: "draft",
    research: "readonly",
  },
  enterprise: {
    supervisor: "approval_required",
    conductor: "approval_required",
    operator: "approval_required",
    harness: "approval_required",
    customer: "approval_required",
    finance: "approval_required",
    reviewer: "readonly",
    backend: "readonly",
    scout: "draft",
    content: "approval_required",
    research: "readonly",
  },
};

const AGENT_TOKEN_LIMIT: Record<RunMode, number> = { demo: 100_000, personal: 200_000, enterprise: 1_000_000 };
/** 系统总控 supervisor 的 Token 上限固定 1,000,000（最高权限角色，所有模式一致）。 */
export const SUPERVISOR_TOKEN_LIMIT = 1_000_000;

/** 某模式的默认代理注册表（11 个角色：supervisor + conductor + 9 专项）。 */
export function defaultAgents(mode: RunMode): AgentConfig[] {
  const autonomyMap = AUTONOMY_BY_MODE[mode];
  return AGENT_SEEDS.map((seed) => ({
    role: seed.role,
    name: seed.name,
    enabled: true,
    autonomy: autonomyMap[seed.role] ?? "readonly",
    tools: [...seed.tools],
    token_limit: seed.role === "supervisor" ? SUPERVISOR_TOKEN_LIMIT : AGENT_TOKEN_LIMIT[mode],
    model_ref: mode === "enterprise" ? "deepseek-chat@v1" : "deepseek-chat@v1",
  }));
}

// ---------------------------------------------------------------------------
// 多模型 / API 密钥引用 / 各智能体模型分配（v1.2 默认值）
// ---------------------------------------------------------------------------

/** 默认模型服务商：DeepSeek 默认启用（env 引用），其余预置但默认关闭，用户可自配密钥与模型名。 */
export function defaultModelProviders(): ModelProviderConfig[] {
  return [
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "deepseek",
      base_url: "https://api.deepseek.com",
      api_key_ref: "env:DEEPSEEK_API_KEY",
      enabled: true,
      default_model: "deepseek-chat",
      models: ["deepseek-chat", "deepseek-reasoner"],
      note: "默认服务商；密钥只存引用（环境变量），绝不写入 config.json",
    },
    {
      id: "openai",
      name: "OpenAI 兼容",
      kind: "openai_compatible",
      base_url: "https://api.openai.com/v1",
      api_key_ref: "",
      enabled: false,
      default_model: "gpt-4o-mini",
      models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
      note: "任何 OpenAI 兼容端点（可改 base_url）；默认关闭",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic",
      base_url: "https://api.anthropic.com",
      api_key_ref: "",
      enabled: false,
      default_model: "claude-3-5-sonnet",
      models: ["claude-3-5-sonnet", "claude-3-5-haiku"],
      note: "默认关闭；需要时可一键同步同一密钥",
    },
    {
      id: "local",
      name: "本地模型（Ollama 兼容）",
      kind: "local",
      base_url: "http://127.0.0.1:11434/v1",
      api_key_ref: "",
      enabled: false,
      default_model: "qwen2.5:7b",
      models: ["qwen2.5:7b", "llama3.1:8b"],
      note: "本地推理不产生云端费用；默认关闭",
    },
  ];
}

/** 默认各智能体模型绑定（可不同模型：conductor/reviewer/research 用 reasoner）。 */
export function defaultAgentModels(defaultProviderId = "deepseek"): Record<string, AgentModelBinding> {
  const binding = (model: string, extra: Partial<AgentModelBinding> = {}): AgentModelBinding => ({
    provider_id: defaultProviderId,
    model,
    ...extra,
  });
  return {
    supervisor: binding("deepseek-reasoner", { temperature: 0.2, max_tokens: 8_192 }),
    conductor: binding("deepseek-reasoner", { temperature: 0.3, max_tokens: 8_192 }),
    operator: binding("deepseek-chat"),
    harness: binding("deepseek-chat"),
    customer: binding("deepseek-chat"),
    finance: binding("deepseek-chat"),
    reviewer: binding("deepseek-reasoner", { temperature: 0.2, max_tokens: 8_192 }),
    backend: binding("deepseek-chat"),
    scout: binding("deepseek-chat"),
    content: binding("deepseek-chat"),
    research: binding("deepseek-reasoner"),
  };
}

/** 默认模型路由：demo/personal 默认一键同步（single_key_all），enterprise 默认 per_provider。 */
export function defaultModelRouting(mode: RunMode): ModelRoutingConfig {
  const syncMode: ModelSyncMode = mode === "enterprise" ? "per_provider" : "single_key_all";
  const providers = defaultModelProviders();
  if (syncMode === "single_key_all") {
    // 一键同步模式：默认所有服务商共用同一密钥引用（用户可一键改成自己的 env/file 引用）
    const canonical = providers.find((provider) => provider.id === "deepseek")?.api_key_ref ?? "env:DEEPSEEK_API_KEY";
    for (const provider of providers) provider.api_key_ref = canonical;
  }
  return {
    sync_mode: syncMode,
    default_provider_id: "deepseek",
    providers,
    agent_models: defaultAgentModels("deepseek"),
  };
}

/** 默认系统动作策略（v1.3）：受管应用白名单 + 插件目录 + 危险动作二次确认。 */
export function defaultSystemPolicy(): SystemPolicyConfig {
  const managedApps: ManagedAppConfig[] = [
    {
      id: "demo-node",
      name: "Node 演示服务（examples/demo-web）",
      command: "node examples/demo-web/server.mjs",
      allow_start: true,
      allow_stop: true,
      allow_remove: false,
    },
    {
      id: "notepad",
      name: "记事本（Notepad）",
      command: "notepad.exe",
      allow_start: true,
      allow_stop: true,
      allow_remove: false,
    },
  ];
  return {
    managed_apps: managedApps,
    plugins_dir: "plugins",
    allow_destructive: true,
    require_confirmation: true,
    confirmation_ttl_seconds: 120,
  };
}

/** 默认运行时设置（v1.4）：发消息自动执行；审批默认 auto_low_risk；步骤上限按模式。 */
export function defaultRuntimeSettings(mode: RunMode): RuntimeSettings {
  return {
    auto_run: true,
    approval_mode: "auto_low_risk",
    full_auto: false,
    max_auto_steps: mode === "demo" ? 10 : mode === "enterprise" ? 50 : 20,
    rework_limit: 1,
    event_retention: 1_000,
  };
}

/** 三种模式的完整默认配置（每种都通过 validate 的基础校验）。 */
export function defaultsForMode(mode: RunMode, options: { now?: () => Date } = {}): StewardConfig {
  if (!isRunMode(mode)) throw new Error(`未知运行模式：${String(mode)}（允许 demo/personal/enterprise）`);
  const now = options.now === undefined ? new Date() : options.now();
  return {
    version: CONFIG_VERSION,
    profile: buildProfile(mode),
    features: buildFeatures(mode),
    budgets: buildBudgets(mode),
    token_budget: buildTokenBudget(mode),
    payments: mode === "demo" ? demoPayments() : mode === "personal" ? personalPayments() : enterprisePayments(),
    agents: defaultAgents(mode),
    approval: {
      timeout_minutes: mode === "enterprise" ? 60 : mode === "personal" ? 120 : 1_440,
      auto_approve: false,
      dual_review_threshold_cny: mode === "demo" ? 50_000 : 5_000,
      takeover_shortcut: "Ctrl+Alt+S",
    },
    data: {
      retention_days: mode === "demo" ? 7 : mode === "personal" ? 30 : 90,
      telemetry: false,
    },
    models: defaultModelRouting(mode),
    orchestrator: buildDefaultOrchestratorSettings(mode, now),
    system_policy: defaultSystemPolicy(),
    runtime: defaultRuntimeSettings(mode),
    updated_at: now.toISOString(),
  };
}
