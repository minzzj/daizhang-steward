/**
 * packages/steward-console/src/admin.ts
 *
 * 控制台「专业版」管理侧数据契约：配置中心 / 智能体中心 / 后台流程 / 数据管理。
 *
 * 设计要点：
 * 1. 与 `ConsoleDataProvider`（经营数据）分离、**向后兼容**：不传 adminProvider 时旧页面/旧 API 照常工作；
 * 2. 类型与 `packages/steward-config`（task-27 契约）保持一致的三模式字段（demo/personal/enterprise），
 *    便于 Lead 后续用 `ConfigEngine` 实现同名方法直接替换 `createDemoAdminProvider()`；
 * 3. 内置 `createDemoAdminProvider()` 全部为**虚构演示数据**；保存/切换模式/清空数据在内存真实生效，
 *    供 UI 开发与真实浏览器 E2E 使用；
 * 4. 所有方法允许同步或异步（`MaybePromise`）；敏感账户只存掩码，控制器不做凭据代填。
 */

import type { MaybePromise } from "./provider.js";

// ---------------------------------------------------------------------------
// 三模式 & 配置契约（与 task-27 的 steward-config 契约对齐）
// ---------------------------------------------------------------------------

export type RunMode = "demo" | "personal" | "enterprise";

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  demo: "体验模式",
  personal: "个人模式",
  enterprise: "企业模式",
};

export const RUN_MODE_SUMMARIES: Record<RunMode, string> = {
  demo: "内置演示数据，真实浏览器/桌面的全部演示流程可跑；支付仅记账，不对接任何资金渠道。",
  personal: "个人收款：微信支付 / 支付宝 / 个人银行卡；无签字法务流程，用印一律交人。",
  enterprise: "企业对公结算：对公账户 / 增值税专票 / 授权书 / 双人复核；30 条边界与审批链生效。",
};

export interface CompanyProfile {
  name: string;
  license_no_masked: string;
  tax_no_masked: string;
  legal_representative: string;
  agent_name: string;
}

export interface Profile {
  mode: RunMode;
  operator_type: "individual" | "company";
  language: "zh-CN" | "en";
  currency: "CNY";
  timezone: string;
  principal_name: string;
  company?: CompanyProfile;
}

export type FeatureName =
  | "browser"
  | "desktop"
  | "coding_loop"
  | "scout"
  | "content"
  | "research"
  | "payments"
  | "invoicing"
  | "notifications"
  | "auto_send"
  | "console"
  | "fault_drills"
  | "enterprise"
  | "demo_data";

export interface FeatureToggle {
  enabled: boolean;
  requires_approval: boolean;
  note?: string;
}

export type Features = Record<FeatureName, FeatureToggle>;

export const FEATURE_LABELS: Record<FeatureName, string> = {
  browser: "真实浏览器",
  desktop: "真实桌面",
  coding_loop: "编码回路（Harness）",
  scout: "Scout 找客户",
  content: "内容创作",
  research: "调研检索",
  payments: "支付/收款",
  invoicing: "发票/开票",
  notifications: "通知推送",
  auto_send: "自动外发",
  console: "本地控制台",
  fault_drills: "故障演练",
  enterprise: "企业能力",
  demo_data: "演示数据",
};

export const FEATURE_ORDER: readonly FeatureName[] = [
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

export interface Budgets {
  month_cny: number;
  project_cny: number;
  per_txn_cny: number;
  zero_budget_mode: boolean;
  allow_free_local_actions: boolean;
}

export interface TokenBudgetConfig {
  limit_tokens: number;
  per_action_limit: number;
  used_tokens: number;
  on_exceed: "block" | "notify";
}

export type PaymentProviderKind =
  | "wechat_pay"
  | "alipay"
  | "personal_bank_card"
  | "corporate_account"
  | "manual";

export const PAYMENT_KIND_LABELS: Record<PaymentProviderKind, string> = {
  wechat_pay: "微信支付",
  alipay: "支付宝",
  personal_bank_card: "个人银行卡",
  corporate_account: "企业对公账户",
  manual: "人工记账",
};

export type PaymentProviderMode = "auto" | "manual_approval" | "disabled";

export interface PaymentProvider {
  id: string;
  kind: PaymentProviderKind;
  name: string;
  enabled: boolean;
  mode: PaymentProviderMode;
  account_masked: string;
  note?: string;
}

export interface PayoutAccount {
  holder: string;
  bank_name: string;
  card_no_masked: string;
  type: "personal" | "corporate";
  wechat_id_masked?: string;
  alipay_id_masked?: string;
}

export type InvoiceType = "none" | "personal_receipt" | "vat_general" | "vat_special";

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  none: "不开票",
  personal_receipt: "个人收据",
  vat_general: "增值税普通发票",
  vat_special: "增值税专用发票",
};

export interface InvoiceConfig {
  default_type: InvoiceType;
  title: string;
  tax_no_masked?: string;
  draft_only: boolean;
}

export interface PaymentsConfig {
  providers: PaymentProvider[];
  payout_account: PayoutAccount;
  invoice: InvoiceConfig;
  require_dual_review: boolean;
  sign_contract: boolean;
  /** AI 永不代签（固定 false，只读展示）。 */
  ai_may_sign: false;
}

export type AgentAutonomy = "readonly" | "draft" | "approval_required" | "autonomous_limited";

export const AGENT_AUTONOMY_LABELS: Record<AgentAutonomy, string> = {
  readonly: "只读",
  draft: "只起草",
  approval_required: "需审批",
  autonomous_limited: "有限自主",
};

export interface AgentConfig {
  role: string;
  name: string;
  enabled: boolean;
  autonomy: AgentAutonomy;
  tools: string[];
  token_limit: number;
  model_ref: string;
}

export interface ApprovalPolicy {
  timeout_minutes: number;
  auto_approve: false;
  dual_review_threshold_cny: number;
  takeover_shortcut: string;
}

export interface DataPolicyConfig {
  retention_days: number;
  telemetry: false;
}

/** 与 task-27 `StewardConfig` 对齐（仅字段子集/同名字段，便于后续直接替换）。 */
export interface StewardConfig {
  version: number;
  profile: Profile;
  features: Features;
  budgets: Budgets;
  token_budget: TokenBudgetConfig;
  payments: PaymentsConfig;
  agents: AgentConfig[];
  approval: ApprovalPolicy;
  data: DataPolicyConfig;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// 智能体中心 / 后台流程 / 数据管理（控制台运行态视图）
// ---------------------------------------------------------------------------

export interface ConsoleAgentInfo extends AgentConfig {
  /** 展示名（比 role 可读） */
  title: string;
  /** idle / running / waiting_approval / disabled / not_applicable */
  status: string;
  current_task: string;
  today_actions: number;
  tokens_used: number;
  logs: string[];
  /** 企业模式专属（个人/体验模式下显示“该模式不适用”） */
  enterprise_only: boolean;
}

export type AgentRole =
  | "conductor"
  | "operator"
  | "harness"
  | "customer"
  | "finance"
  | "reviewer"
  | "backend"
  | "scout"
  | "content"
  | "research"
  | "enterprise_admin";

export interface FlowEvent {
  seq: number;
  /** plan / action / observe / verify / evidence / error / takeover */
  phase: string;
  ts: string;
  actor: string;
  summary: string;
  evidence_ref?: string;
}

export interface FlowRun {
  run_id: string;
  goal: string;
  started_at: string;
  status: "done" | "running" | "failed" | "halted";
  events: FlowEvent[];
}

export interface QueueItem {
  id: string;
  goal: string;
  agent_role: string;
  status: "queued" | "running" | "blocked";
  eta: string;
}

export interface DataStats {
  runs: number;
  evidence_files: number;
  ledger_projects: number;
  config_updated_at: string;
  data_root: string;
  disk_usage_mb: number;
  cleared: boolean;
}

export interface AdminStatus {
  mode: RunMode;
  mode_label: string;
  budget_left_cny: number;
  token_remaining: number;
  token_limit_tokens: number;
  token_used_tokens: number;
  halted: boolean;
  last_event_at: string | null;
  config_updated_at: string;
}

export interface ConfigSaveResult {
  ok: boolean;
  config: StewardConfig;
  errors: string[];
}

export interface ModeApplyResult {
  ok: boolean;
  config: StewardConfig;
  mode: RunMode;
  diff: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Provider 契约
// ---------------------------------------------------------------------------

export interface ConsoleAdminProvider {
  getConfig(): MaybePromise<StewardConfig>;
  /** 局部保存；返回校验错误（不抛异常，便于 UI 展示）。 */
  saveConfig(partial: Partial<StewardConfig>): MaybePromise<ConfigSaveResult>;
  /** 切换运行模式并应用该模式默认（支付/发票/审批/主体/agent 开关）。 */
  applyMode(mode: RunMode): MaybePromise<ModeApplyResult>;
  resetConfig(mode?: RunMode): MaybePromise<StewardConfig>;
  exportConfig(): MaybePromise<string>;

  getAgents(): MaybePromise<ConsoleAgentInfo[]>;
  getAgentDetail(role: string): MaybePromise<ConsoleAgentInfo | null>;
  updateAgent(role: string, patch: Partial<AgentConfig>): MaybePromise<ConfigSaveResult>;

  getFlow(filter?: { phase?: string; run_id?: string; limit?: number }): MaybePromise<FlowRun[]>;
  getQueue(): MaybePromise<QueueItem[]>;
  getDataStats(): MaybePromise<DataStats>;
  resetData(): MaybePromise<{ ok: boolean; cleared: DataStats; removed: string[] }>;
  resetDemoData(): MaybePromise<{ ok: boolean; stats: DataStats }>;

  getTokenBudget(): MaybePromise<TokenBudgetConfig>;
  getPaymentConfig(): MaybePromise<PaymentsConfig>;
  getAdminStatus(): MaybePromise<AdminStatus>;

  auditTrail(): MaybePromise<Array<{ at: string; actor: string; action: string; target: string; result: string; reason: string }>>;
}

// ---------------------------------------------------------------------------
// 演示数据：三种运行模式的默认值
// ---------------------------------------------------------------------------

const TOKEN_DEMO = 10_000_000;
const TOKEN_PERSONAL = 2_000_000;
const TOKEN_ENTERPRISE = 10_000_000;

function featureDefaults(mode: RunMode): Features {
  const enabled = mode === "demo";
  const t = (on: boolean, approval = false, note?: string): FeatureToggle =>
    note === undefined ? { enabled: on, requires_approval: approval } : { enabled: on, requires_approval: approval, note };
  return {
    browser: t(true),
    desktop: t(true),
    coding_loop: t(true, mode !== "demo"),
    scout: t(mode !== "enterprise", mode !== "demo"),
    content: t(true, true, "对外内容必须人工审批后发布"),
    research: t(true),
    payments: t(mode !== "demo", true, mode === "demo" ? "体验模式仅人工记账，不对接资金渠道" : "支付动作必须人工审批"),
    invoicing: t(mode !== "demo", mode !== "personal"),
    notifications: t(true, false),
    auto_send: t(false, true, "自动外发默认关闭，开启需审批"),
    console: t(true),
    fault_drills: t(mode === "demo"),
    enterprise: t(mode === "enterprise", true),
    demo_data: t(enabled, false, enabled ? "体验模式内置演示数据" : "关闭后不加载演示数据"),
  };
}

function paymentsForMode(mode: RunMode): PaymentsConfig {
  if (mode === "personal") {
    return {
      providers: [
        { id: "pay-wx", kind: "wechat_pay", name: "微信支付（个人收款码）", enabled: true, mode: "manual_approval", account_masked: "wxid_****demo88" },
        { id: "pay-ali", kind: "alipay", name: "支付宝（个人收款）", enabled: true, mode: "manual_approval", account_masked: "dem***@example.com" },
        { id: "pay-card", kind: "personal_bank_card", name: "个人银行卡（收款）", enabled: true, mode: "manual_approval", account_masked: "招商银行 **** **** 8888" },
      ],
      payout_account: {
        holder: "王示例",
        bank_name: "招商银行 示例支行",
        card_no_masked: "**** **** **** 8888",
        type: "personal",
        wechat_id_masked: "wxid_****demo88",
        alipay_id_masked: "dem***@example.com",
      },
      invoice: { default_type: "personal_receipt", title: "个人服务费（示例）", draft_only: true },
      require_dual_review: false,
      sign_contract: false,
      ai_may_sign: false,
    };
  }
  if (mode === "enterprise") {
    return {
      providers: [
        { id: "pay-corp", kind: "corporate_account", name: "企业对公账户", enabled: true, mode: "manual_approval", account_masked: "工商银行 **** **** 6666" },
        { id: "pay-manual", kind: "manual", name: "人工复核打款", enabled: true, mode: "manual_approval", account_masked: "—" },
        { id: "pay-wx", kind: "wechat_pay", name: "微信支付（个人，本模式不适用）", enabled: false, mode: "disabled", account_masked: "—", note: "企业模式请使用对公账户" },
        { id: "pay-ali", kind: "alipay", name: "支付宝（个人，本模式不适用）", enabled: false, mode: "disabled", account_masked: "—", note: "企业模式请使用对公账户" },
        { id: "pay-card", kind: "personal_bank_card", name: "个人银行卡（本模式不适用）", enabled: false, mode: "disabled", account_masked: "—", note: "企业模式请使用对公账户" },
      ],
      payout_account: {
        holder: "杭州示例科技有限公司",
        bank_name: "工商银行 示例分行",
        card_no_masked: "**** **** **** 6666",
        type: "corporate",
      },
      invoice: {
        default_type: "vat_special",
        title: "杭州示例科技有限公司",
        tax_no_masked: "9133**********X8",
        draft_only: true,
      },
      require_dual_review: true,
      sign_contract: true,
      ai_may_sign: false,
    };
  }
  return {
    providers: [
      { id: "pay-manual", kind: "manual", name: "人工记账（体验模式）", enabled: true, mode: "disabled", account_masked: "—", note: "体验模式不对接任何资金渠道" },
      { id: "pay-wx", kind: "wechat_pay", name: "微信支付（个人收款码）", enabled: false, mode: "disabled", account_masked: "wxid_****demo", note: "切到个人模式后可启用" },
      { id: "pay-ali", kind: "alipay", name: "支付宝（个人收款）", enabled: false, mode: "disabled", account_masked: "demo***@example.com", note: "切到个人模式后可启用" },
      { id: "pay-card", kind: "personal_bank_card", name: "个人银行卡（收款）", enabled: false, mode: "disabled", account_masked: "演示银行 **** **** 0000", note: "切到个人模式后可启用" },
    ],
    payout_account: {
      holder: "演示用户",
      bank_name: "演示银行",
      card_no_masked: "**** **** **** 0000",
      type: "personal",
      wechat_id_masked: "wxid_****demo",
      alipay_id_masked: "demo***@example.com",
    },
    invoice: { default_type: "none", title: "", draft_only: true },
    require_dual_review: false,
    sign_contract: false,
    ai_may_sign: false,
  };
}

const AGENT_SEEDS: ReadonlyArray<{
  role: AgentRole;
  title: string;
  autonomy: AgentAutonomy;
  tools: string[];
  enterpriseOnly?: boolean;
}> = [
  { role: "conductor", title: "总调度", autonomy: "approval_required", tools: ["plan", "dispatch", "report"] },
  { role: "operator", title: "执行（浏览器/桌面）", autonomy: "approval_required", tools: ["browser.*", "desktop.*", "file.*"] },
  { role: "harness", title: "写代码 Harness", autonomy: "approval_required", tools: ["code.loop", "patch.apply", "test.run"] },
  { role: "customer", title: "客户对接", autonomy: "draft", tools: ["crm.read", "message.draft"] },
  { role: "finance", title: "财务记账", autonomy: "approval_required", tools: ["ledger.read", "ledger.write", "invoice.draft"] },
  { role: "reviewer", title: "核查复核", autonomy: "readonly", tools: ["evidence.read", "report.review"] },
  { role: "backend", title: "后台值守", autonomy: "approval_required", tools: ["queue.read", "flow.watch", "takeover.candidate"] },
  { role: "scout", title: "找客户", autonomy: "draft", tools: ["scout.run", "lead.score", "draft.write"] },
  { role: "content", title: "内容创作", autonomy: "draft", tools: ["content.draft", "assets.read"] },
  { role: "research", title: "调研检索", autonomy: "readonly", tools: ["research.search", "source.cite"] },
  { role: "enterprise_admin", title: "企业合规/用印", autonomy: "approval_required", tools: ["contract.check", "seal.request"], enterpriseOnly: true },
];

function agentsForMode(mode: RunMode): AgentConfig[] {
  return AGENT_SEEDS.map((seed) => ({
    role: seed.role,
    name: seed.title,
    enabled: mode === "enterprise" ? true : seed.role !== "enterprise_admin",
    autonomy: seed.autonomy,
    tools: [...seed.tools],
    token_limit: mode === "personal" ? 200_000 : 1_000_000,
    model_ref: "deepseek-chat",
  }));
}

function tokenBudgetForMode(mode: RunMode): TokenBudgetConfig {
  const limit = mode === "demo" ? TOKEN_DEMO : mode === "personal" ? TOKEN_PERSONAL : TOKEN_ENTERPRISE;
  return {
    limit_tokens: limit,
    per_action_limit: mode === "personal" ? 20_000 : 50_000,
    used_tokens: mode === "demo" ? 3_246_800 : mode === "personal" ? 128_400 : 6_812_300,
    on_exceed: "block",
  };
}

function budgetsForMode(mode: RunMode): Budgets {
  if (mode === "personal") {
    return { month_cny: 5_000, project_cny: 2_000, per_txn_cny: 500, zero_budget_mode: false, allow_free_local_actions: true };
  }
  if (mode === "enterprise") {
    return { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000, zero_budget_mode: false, allow_free_local_actions: true };
  }
  return { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000, zero_budget_mode: false, allow_free_local_actions: true };
}

function profileForMode(mode: RunMode): Profile {
  if (mode === "enterprise") {
    return {
      mode,
      operator_type: "company",
      language: "zh-CN",
      currency: "CNY",
      timezone: "Asia/Shanghai",
      principal_name: "杭州示例科技有限公司（虚构）",
      company: {
        name: "杭州示例科技有限公司（虚构）",
        license_no_masked: "9133**********X8",
        tax_no_masked: "9133**********X8",
        legal_representative: "示例法人",
        agent_name: "代掌智能体（企业授权）",
      },
    };
  }
  if (mode === "personal") {
    return {
      mode,
      operator_type: "individual",
      language: "zh-CN",
      currency: "CNY",
      timezone: "Asia/Shanghai",
      principal_name: "王示例（虚构）",
    };
  }
  return {
    mode,
    operator_type: "individual",
    language: "zh-CN",
    currency: "CNY",
    timezone: "Asia/Shanghai",
    principal_name: "演示用户（虚构）",
  };
}

function approvalForMode(mode: RunMode): ApprovalPolicy {
  return {
    timeout_minutes: mode === "personal" ? 30 : 15,
    auto_approve: false,
    dual_review_threshold_cny: mode === "enterprise" ? 5_000 : 0,
    takeover_shortcut: "Ctrl+Shift+T（本地）",
  };
}

function defaultConfig(mode: RunMode): StewardConfig {
  return {
    version: 1,
    profile: profileForMode(mode),
    features: featureDefaults(mode),
    budgets: budgetsForMode(mode),
    token_budget: tokenBudgetForMode(mode),
    payments: paymentsForMode(mode),
    agents: agentsForMode(mode),
    approval: approvalForMode(mode),
    data: { retention_days: 90, telemetry: false },
    updated_at: new Date().toISOString(),
  };
}

export function defaultsForMode(mode: RunMode): StewardConfig {
  return defaultConfig(mode);
}

// ---------------------------------------------------------------------------
// 演示 admin provider（内存态；保存/切模式/清空数据真实生效）
// ---------------------------------------------------------------------------

export interface DemoAdminProviderOptions {
  mode?: RunMode;
  now?: () => Date;
}

export function createDemoAdminProvider(options: DemoAdminProviderOptions = {}): ConsoleAdminProvider {
  const now = options.now ?? (() => new Date());
  const iso = (offsetMs = 0): string => new Date(now().getTime() + offsetMs).toISOString();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  let mode: RunMode = options.mode ?? "demo";
  let config: StewardConfig = defaultConfig(mode);
  let cleared = false;
  const audit: Array<{ at: string; actor: string; action: string; target: string; result: string; reason: string }> = [];

  const runtimeAgents = new Map<
    string,
    { status: string; current_task: string; today_actions: number; tokens_used: number; logs: string[] }
  >([
    ["conductor", { status: "running", current_task: "为 3 个项目排优先级并生成今日计划", today_actions: 18, tokens_used: 486_200, logs: ["08:32 生成今日计划（3 项目 / 7 任务）", "09:10 分派任务给 operator / scout", "10:05 复核 2 张审批卡"] }],
    ["operator", { status: "running", current_task: "真实浏览器：官网改版移动端回归中", today_actions: 42, tokens_used: 812_400, logs: ["09:21 打开代掌演示站（有头 Chrome）", "09:24 填表并提交项目成功", "09:30 截图 7 张 + DOM 快照留证"] }],
    ["harness", { status: "running", current_task: "CodeTask：修复登录超时 red test", today_actions: 6, tokens_used: 1_204_800, logs: ["10:02 读取失败测试与补丁任务", "10:18 生成统一补丁并应用隔离 worktree", "10:41 真实浏览器验收转绿（第 1 轮）"] }],
    ["customer", { status: "idle", current_task: "等待客户回复验收意见", today_actions: 5, tokens_used: 96_300, logs: ["09:00 发送交付摘要（人工审批后）", "11:20 客户确认首页验收通过", "—"] }],
    ["finance", { status: "waiting_approval", current_task: "生成 10 月账本摘要与开票草稿", today_actions: 9, tokens_used: 143_600, logs: ["10:10 记账 3 笔（支出 2 / 收入 2）", "10:40 生成普票草稿（仅草稿，不代签）", "11:02 等待人工审批付款 ap-001"] }],
    ["reviewer", { status: "running", current_task: "复核 Harness 补丁与浏览器证据", today_actions: 12, tokens_used: 208_900, logs: ["10:45 复核 7 张真实截图", "10:52 校验账本 6 要素", "11:01 出具复核意见：证据齐全"] }],
    ["backend", { status: "running", current_task: "值守后台：队列 2 项 / 异常 0", today_actions: 27, tokens_used: 331_500, logs: ["每小时巡检运行队列", "10:30 发现 1 次验证码拦截 → 已停止交人", "11:00 心跳正常"] }],
    ["scout", { status: "idle", current_task: "合规 fixture 已跑完，3 条草稿待审批", today_actions: 4, tokens_used: 71_200, logs: ["14 线索 → 丢 4 → 合格 8", "生成 3 条草稿（0 发送）", "草稿全部待审批"] }],
    ["content", { status: "idle", current_task: "等待内容选题审批", today_actions: 2, tokens_used: 38_400, logs: ["草稿 1 篇（未外发）", "—", "—"] }],
    ["research", { status: "idle", current_task: "政策与合规资料检索（只读）", today_actions: 3, tokens_used: 57_800, logs: ["检索 6 条公开政策来源", "标注引用与日期", "—"] }],
    ["enterprise_admin", { status: "disabled", current_task: "—", today_actions: 0, tokens_used: 0, logs: ["企业模式专属：合同/用印/双人复核"] }],
  ]);

  const flowRuns: FlowRun[] = [
    {
      run_id: "run-20261026-1015-a2b7",
      goal: "真实浏览器验收：demo-web 登录 → 提交项目（A2）",
      started_at: iso(-2 * HOUR),
      status: "done",
      events: [
        { seq: 1, phase: "plan", ts: iso(-2 * HOUR), actor: "conductor", summary: "拆解为 7 个真实浏览器动作，预算单步 ≤ ¥500" },
        { seq: 2, phase: "action", ts: iso(-2 * HOUR + 60_000), actor: "operator", summary: "有头 Chrome 打开 http://127.0.0.1:4173/ 并填表登录" },
        { seq: 3, phase: "observe", ts: iso(-2 * HOUR + 90_000), actor: "operator", summary: "观察 #project-view 可见，登录耗时 300ms" },
        { seq: 4, phase: "verify", ts: iso(-2 * HOUR + 150_000), actor: "reviewer", summary: "断言 #project-result 含「已提交」，校验通过", evidence_ref: "ev-001" },
        { seq: 5, phase: "evidence", ts: iso(-2 * HOUR + 180_000), actor: "operator", summary: "留证：7 张截图 + DOM + console.log", evidence_ref: "ev-002" },
      ],
    },
    {
      run_id: "run-20261026-1030-c9d1",
      goal: "编码回路：登录超时 red test 修复并复验（A4/A5）",
      started_at: iso(-1 * HOUR),
      status: "done",
      events: [
        { seq: 1, phase: "plan", ts: iso(-1 * HOUR), actor: "conductor", summary: "识别失败测试，生成 CodeTask（限 2 轮）" },
        { seq: 2, phase: "action", ts: iso(-1 * HOUR + 120_000), actor: "harness", summary: "生成统一补丁并应用到隔离 worktree" },
        { seq: 3, phase: "observe", ts: iso(-1 * HOUR + 300_000), actor: "operator", summary: "真实浏览器复跑：第 1 轮由红转绿" },
        { seq: 4, phase: "verify", ts: iso(-1 * HOUR + 420_000), actor: "reviewer", summary: "复核补丁只改错误处理，未动测试", evidence_ref: "ev-003" },
        { seq: 5, phase: "evidence", ts: iso(-1 * HOUR + 480_000), actor: "harness", summary: "留证：patch.diff / test.log / 4 张截图" },
      ],
    },
    {
      run_id: "run-20261026-1100-e4f2",
      goal: "后台值守：队列巡检 + 风控拦截处置",
      started_at: iso(-30 * 60_000),
      status: "halted",
      events: [
        { seq: 1, phase: "plan", ts: iso(-30 * 60_000), actor: "backend", summary: "巡检运行队列（2 项）与接管状态" },
        { seq: 2, phase: "action", ts: iso(-28 * 60_000), actor: "operator", summary: "尝试登录第三方平台时出现验证码" },
        { seq: 3, phase: "error", ts: iso(-28 * 60_000 + 5_000), actor: "operator", summary: "风控关键词命中：验证码 → 停止并交人（不绕过）" },
        { seq: 4, phase: "takeover", ts: iso(-27 * 60_000), actor: "human", summary: "人工接管：halted=true，生成 6 类接管包", evidence_ref: "ev-005" },
        { seq: 5, phase: "evidence", ts: iso(-27 * 60_000 + 30_000), actor: "backend", summary: "留证：停止事件 + 截图 + 接管包" },
      ],
    },
    {
      run_id: "run-20261025-1600-b7c3",
      goal: "Scout 客户分支：14 线索 → 3 草稿（0 发送，A7）",
      started_at: iso(-1 * DAY),
      status: "done",
      events: [
        { seq: 1, phase: "plan", ts: iso(-1 * DAY), actor: "conductor", summary: "按 ICP 拆分线索评分与外联起草任务" },
        { seq: 2, phase: "action", ts: iso(-1 * DAY + 300_000), actor: "scout", summary: "评分 14 条 → 丢弃 4 → 合格 8" },
        { seq: 3, phase: "verify", ts: iso(-1 * DAY + 600_000), actor: "reviewer", summary: "校验草稿 ≤150 字且引用具体信号" },
        { seq: 4, phase: "evidence", ts: iso(-1 * DAY + 700_000), actor: "scout", summary: "3 条草稿全部待审批，0 发送", evidence_ref: "ev-004" },
      ],
    },
  ];

  const queue: QueueItem[] = [
    { id: "q-001", goal: "官网改版移动端验收（真实浏览器）", agent_role: "operator", status: "running", eta: "12 分钟" },
    { id: "q-002", goal: "10 月账本摘要与开票草稿", agent_role: "finance", status: "queued", eta: "约 20 分钟" },
    { id: "q-003", goal: "客户回访草稿发送（待审批）", agent_role: "customer", status: "blocked", eta: "等待人工审批" },
  ];

  const dataStats = (): DataStats => ({
    runs: cleared ? 0 : 46,
    evidence_files: cleared ? 0 : 187,
    ledger_projects: cleared ? 0 : 3,
    config_updated_at: config.updated_at,
    data_root: "runs/（本地演示数据，虚构）",
    disk_usage_mb: cleared ? 0 : 84.6,
    cleared,
  });

  const cloneConfig = (): StewardConfig => JSON.parse(JSON.stringify(config)) as StewardConfig;
  const uid = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

  const record = (action: string, target: string, result: string, reason = ""): void => {
    audit.push({ at: iso(0), actor: "web-console", action, target, result, reason });
    if (audit.length > 200) audit.splice(0, audit.length - 200);
  };

  const validateConfig = (candidate: StewardConfig): string[] => {
    const errors: string[] = [];
    if (candidate.features.demo_data.enabled && candidate.profile.mode === "enterprise") {
      errors.push("企业模式请关闭「演示数据」（当前为启用；请显式关闭以免混入演示数据）");
    }
    const money = [candidate.budgets.month_cny, candidate.budgets.project_cny, candidate.budgets.per_txn_cny];
    if (money.some((value) => !Number.isFinite(value) || value < 0)) errors.push("预算必须为 ≥0 的数字");
    if (candidate.token_budget.limit_tokens <= 0) errors.push("Token 上限必须 > 0");
    if (candidate.token_budget.per_action_limit > candidate.token_budget.limit_tokens) errors.push("单步 Token 上限不能超过总上限");
    if (candidate.token_budget.used_tokens > candidate.token_budget.limit_tokens) errors.push("已用 Token 已超过上限，请先调整上限或清空用量");
    const personal = candidate.profile.mode === "personal";
    if (personal) {
      const corporate = candidate.payments.providers.find((item) => item.kind === "corporate_account");
      if (corporate !== undefined && corporate.enabled) errors.push("个人模式不允许启用对公账户渠道");
      if (candidate.payments.invoice.default_type === "vat_special") errors.push("个人模式不允许开增值税专用发票");
      if (candidate.payments.sign_contract) errors.push("个人模式无签字法务流程，不能启用签约");
    }
    if (candidate.profile.mode === "enterprise") {
      if (candidate.profile.company === undefined || candidate.profile.company.name.trim() === "") {
        errors.push("企业模式必须填写企业主体（名称/统一社会信用代码掩码/法人）");
      }
    }
    if (candidate.payments.require_dual_review && candidate.approval.dual_review_threshold_cny <= 0) {
      errors.push("启用双人复核时，双人复核阈值必须 > 0");
    }
    for (const provider of candidate.payments.providers) {
      if (provider.enabled && provider.mode === "auto") {
        errors.push(`支付渠道 ${provider.name} 不允许 auto 直付（只允许人工审批），请改为 manual_approval 或 disabled`);
      }
    }
    return errors;
  };

  const applyModeDefaults = (nextMode: RunMode): string[] => {
    const defaults = defaultConfig(nextMode);
    const diff: string[] = [];
    if (mode !== nextMode) diff.push(`运行模式：${RUN_MODE_LABELS[mode]} → ${RUN_MODE_LABELS[nextMode]}`);
    mode = nextMode;
    config = {
      ...config,
      profile: defaults.profile,
      features: { ...config.features, enterprise: defaults.features.enterprise, demo_data: defaults.features.demo_data },
      payments: defaults.payments,
      approval: defaults.approval,
      token_budget: { ...defaults.token_budget },
      budgets: defaults.budgets,
      agents: defaults.agents,
      updated_at: iso(0),
    };
    diff.push("支付渠道 / 收款账户 / 发票默认值已按模式重置");
    diff.push("审批与接管设置已按模式重置");
    return diff;
  };

  const maskAccount = (value: string): string => {
    const text = String(value ?? "").trim();
    if (text === "") return "—";
    if (text.length <= 4) return "****";
    return `${text.slice(0, 2)}${"*".repeat(Math.max(2, text.length - 6))}${text.slice(-4)}`;
  };

  const buildAgentInfos = (): ConsoleAgentInfo[] => {
    const currentMode = config.profile.mode;
    return config.agents.map((agent) => {
      const seed = AGENT_SEEDS.find((item) => item.role === agent.role);
      const runtime = runtimeAgents.get(agent.role);
      const enterpriseOnly = seed?.enterpriseOnly === true;
      const applicable = !enterpriseOnly || currentMode === "enterprise";
      const status = !applicable ? "not_applicable" : !agent.enabled ? "disabled" : runtime?.status ?? "idle";
      return {
        ...agent,
        title: seed?.title ?? agent.name,
        status,
        current_task: applicable ? runtime?.current_task ?? "—" : "该模式不适用",
        today_actions: applicable ? runtime?.today_actions ?? 0 : 0,
        tokens_used: runtime?.tokens_used ?? 0,
        logs: applicable ? [...(runtime?.logs ?? [])] : ["企业模式专属智能体：个人/体验模式下不适用"],
        enterprise_only: enterpriseOnly,
      };
    });
  };

  const flowList = (): FlowRun[] => (cleared ? [] : flowRuns.map((run) => ({ ...run, events: run.events.map((event) => ({ ...event })) })));

  const latestEventTs = (): string | null => {
    const runs = flowList();
    let latest: string | null = null;
    for (const run of runs) {
      for (const event of run.events) {
        if (latest === null || Date.parse(event.ts) > Date.parse(latest)) latest = event.ts;
      }
    }
    return latest;
  };

  return {
    getConfig: () => cloneConfig(),
    saveConfig: (partial) => {
      const before = cloneConfig();
      const candidate: StewardConfig = {
        ...config,
        ...partial,
        profile: { ...config.profile, ...(partial.profile ?? {}) },
        features: { ...config.features, ...(partial.features ?? {}) } as Features,
        budgets: { ...config.budgets, ...(partial.budgets ?? {}) },
        token_budget: { ...config.token_budget, ...(partial.token_budget ?? {}) },
        payments: { ...config.payments, ...(partial.payments ?? {}) },
        approval: { ...config.approval, ...(partial.approval ?? {}) },
        data: { ...config.data, ...(partial.data ?? {}) },
        agents: (partial.agents ?? config.agents).map((agent) => ({ ...agent })),
        updated_at: iso(0),
      };
      if (partial.profile?.mode !== undefined && partial.profile.mode !== before.profile.mode) {
        candidate.profile = { ...profileForMode(partial.profile.mode), ...(candidate.profile ?? {}) };
      }
      const errors = validateConfig(candidate);
      if (errors.length > 0) {
        record("config.save", "config", "rejected", errors.join("; "));
        return { ok: false, config: before, errors };
      }
      config = candidate;
      mode = candidate.profile.mode;
      record("config.save", "config", "ok", `features=${FEATURE_ORDER.filter((name) => !config.features[name].enabled).join(",") || "all-on"}`);
      return { ok: true, config: cloneConfig(), errors: [] };
    },
    applyMode: (nextMode) => {
      if (nextMode !== "demo" && nextMode !== "personal" && nextMode !== "enterprise") {
        return { ok: false, config: cloneConfig(), mode, diff: [], errors: [`未知运行模式：${String(nextMode)}`] };
      }
      const diff = applyModeDefaults(nextMode);
      record("config.mode", nextMode, "ok", diff.join("; "));
      return { ok: true, config: cloneConfig(), mode, diff, errors: [] };
    },
    resetConfig: (nextMode) => {
      mode = nextMode ?? config.profile.mode;
      config = defaultConfig(mode);
      record("config.reset", mode, "ok", "恢复该模式默认配置");
      return cloneConfig();
    },
    exportConfig: () => JSON.stringify(config, null, 2),

    getAgents: () => buildAgentInfos(),
    getAgentDetail: (role) => buildAgentInfos().find((agent) => agent.role === role) ?? null,
    updateAgent: (role, patch) => {
      const index = config.agents.findIndex((agent) => agent.role === role);
      if (index < 0) return { ok: false, config: cloneConfig(), errors: [`智能体不存在：${role}`] };
      const current = config.agents[index];
      if (current === undefined) return { ok: false, config: cloneConfig(), errors: [`智能体不存在：${role}`] };
      const tokenLimit = patch.token_limit ?? current.token_limit;
      if (!Number.isFinite(tokenLimit) || tokenLimit < 0) return { ok: false, config: cloneConfig(), errors: ["Token 限额必须为 ≥0 的数字"] };
      config.agents[index] = { ...current, ...patch, role: current.role, token_limit: tokenLimit };
      config.updated_at = iso(0);
      record("agent.update", role, "ok", JSON.stringify({ enabled: config.agents[index]?.enabled, autonomy: config.agents[index]?.autonomy }));
      return { ok: true, config: cloneConfig(), errors: [] };
    },

    getFlow: (filter) => {
      let runs = flowList();
      if (filter?.run_id !== undefined) runs = runs.filter((run) => run.run_id === filter.run_id);
      if (filter?.phase !== undefined) {
        runs = runs
          .map((run) => ({ ...run, events: run.events.filter((event) => event.phase === filter.phase) }))
          .filter((run) => run.events.length > 0);
      }
      if (filter?.limit !== undefined && filter.limit > 0) {
        let remaining = filter.limit;
        runs = runs
          .map((run) => {
            const events = run.events.slice(0, remaining);
            remaining -= events.length;
            return { ...run, events };
          })
          .filter((run) => run.events.length > 0);
      }
      return runs;
    },
    getQueue: () => (cleared ? [] : queue.map((item) => ({ ...item }))),
    getDataStats: () => dataStats(),
    resetData: () => {
      cleared = true;
      const removed = ["runs/", "evidence/", "ledger/", "flow/", "queue/"];
      record("data.reset", "runtime-data", "ok", removed.join(","));
      return { ok: true, cleared: dataStats(), removed };
    },
    resetDemoData: () => {
      cleared = false;
      record("data.reset_demo", "runtime-data", "ok", "恢复演示数据");
      return { ok: true, stats: dataStats() };
    },
    getTokenBudget: () => ({ ...config.token_budget }),
    getPaymentConfig: () => JSON.parse(JSON.stringify(config.payments)) as PaymentsConfig,
    getAdminStatus: () => {
      const token = config.token_budget;
      const lastEvent = latestEventTs();
      const demoSpend = config.profile.mode === "demo" ? 18_600 : 0;
      return {
        mode: config.profile.mode,
        mode_label: RUN_MODE_LABELS[config.profile.mode],
        budget_left_cny: Math.max(0, config.budgets.month_cny - demoSpend),
        token_remaining: Math.max(0, token.limit_tokens - token.used_tokens),
        token_limit_tokens: token.limit_tokens,
        token_used_tokens: token.used_tokens,
        halted: false,
        last_event_at: lastEvent,
        config_updated_at: config.updated_at,
      };
    },
    auditTrail: () => audit.map((item) => ({ ...item })),
  };
}

/** 生成测试用掩码（不暴露明文；仅后 4 位）。 */
export function maskAccount(value: string): string {
  const text = String(value ?? "").trim();
  if (text === "") return "—";
  if (text.length <= 4) return "****";
  return `${text.slice(0, 2)}${"*".repeat(Math.max(2, text.length - 6))}${text.slice(-4)}`;
}

/** 便捷：按模式返回默认配置（给 UI/E2E 对照）。 */
export function demoModeConfig(mode: RunMode): StewardConfig {
  return defaultConfig(mode);
}
