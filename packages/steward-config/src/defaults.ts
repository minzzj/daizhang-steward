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

import type {
  AgentConfig,
  Autonomy,
  Budgets,
  CompanyProfile,
  FeatureName,
  FeatureToggle,
  Features,
  InvoiceConfig,
  PaymentProvider,
  PaymentsConfig,
  PayoutAccount,
  Profile,
  RunMode,
  StewardConfig,
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

/** 全部代理角色（10 个）。 */
export const AGENT_ROLES = [
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
  return { providers, payout_account: payout, invoice, require_dual_review: false, sign_contract: false, ai_may_sign: false };
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
  return { providers, payout_account: payout, invoice, require_dual_review: false, sign_contract: false, ai_may_sign: false };
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
  return { providers, payout_account: payout, invoice, require_dual_review: true, sign_contract: true, ai_may_sign: false };
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

/** 某模式的默认代理注册表（10 个角色；个人模式也保留全部角色，enabled 可配）。 */
export function defaultAgents(mode: RunMode): AgentConfig[] {
  const autonomyMap = AUTONOMY_BY_MODE[mode];
  return AGENT_SEEDS.map((seed) => ({
    role: seed.role,
    name: seed.name,
    enabled: true,
    autonomy: autonomyMap[seed.role] ?? "readonly",
    tools: [...seed.tools],
    token_limit: AGENT_TOKEN_LIMIT[mode],
    model_ref: mode === "enterprise" ? "deepseek-chat@v1" : "deepseek-chat@v1",
  }));
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
    updated_at: now.toISOString(),
  };
}
