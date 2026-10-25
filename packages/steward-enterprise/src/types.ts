/**
 * 阶段二 P3「企业版」数据契约。
 *
 * 企业增量：认证主体（营业执照/经办人/公司授权书人签/用印）、对公账户、增值税普票/专票、
 * 开票校验（抬头/税号/合同一致）、申报草稿（人确认）、双人复核（收款账户变更）、
 * 组织级审批链、多代理串行、30 条边界双模式标注、B8 双模式一致性。
 *
 * 字段只增不减（CLI/控制台/验收脚本按此集成）；所有金额单位为人民币元（CNY），
 * 时间戳为 ISO 8601 字符串。纯逻辑、零第三方依赖、无网络、无真实资金/税务动作。
 */

// ---------------------------------------------------------------------------
// 1) 企业主体与认证
// ---------------------------------------------------------------------------

export type EntityKind = "individual" | "company";

/** 签署类材料状态（授权书/用印都是「人签」，AI 不代签）。 */
export type SignTaskStatus = "none" | "pending_human" | "signed";

/** 公司授权书（必须由自然人签署）。 */
export interface AuthorizationLetter {
  status: SignTaskStatus;
  /** 签署人（必须是自然人；AI/机器人不得作为签署人）。 */
  signed_by?: string;
  /** 授权书证据路径（仓库相对路径）。 */
  path?: string;
}

/** 用印记录（必须由自然人签署/盖章）。 */
export interface SealRecord {
  status: SignTaskStatus;
  signed_by?: string;
}

export interface BankAccount {
  account_name: string;
  /** 已脱敏账号（只存掩码，绝不存完整卡号/账号）。 */
  account_no_masked: string;
  bank_name: string;
  /** personal = 个人账户；corporate = 对公账户。 */
  type: "personal" | "corporate";
}

/** 企业认证主体（个人模式下也可用个人主体）。 */
export interface BusinessEntity {
  id: string;
  kind: EntityKind;
  name: string;
  /** 营业执照号/统一社会信用代码：企业必填。 */
  license_no?: string;
  legal_representative?: string;
  /** 授权经办人（可代表企业办理日常事务）。 */
  agent_name?: string;
  authorization_letter?: AuthorizationLetter;
  seal?: SealRecord;
  bank_account: BankAccount;
  /** 纳税人识别号：企业必填。 */
  tax_no?: string;
  /** 经营范围（登记原文摘要；用于经营范围校验）。 */
  scope: string;
}

// ---------------------------------------------------------------------------
// 2) 企业档案与发票默认值
// ---------------------------------------------------------------------------

export type InvoiceType = "none" | "vat_general" | "vat_special";

export interface InvoiceDefaults {
  type: InvoiceType;
  title: string;
  tax_no: string;
}

export interface ReviewPolicy {
  /** 触发双人复核的金额阈值（元）。 */
  dual_review_threshold_cny: number;
  /** 双人复核可用角色（同一次变更需要 2 个不同角色批准）。 */
  dual_review_roles: string[];
  /** 组织级审批链可用角色（负责人/财务/法人）。 */
  approval_chain: string[];
}

export interface EnterpriseProfile {
  entity: BusinessEntity;
  invoice_defaults: InvoiceDefaults;
  review_policy: ReviewPolicy;
  seats: number;
  /** 多代理/多账号是否强制串行（true = 同一时刻只允许一个代理占用会话）。 */
  multi_agent_serial: boolean;
}

// ---------------------------------------------------------------------------
// 3) 订单上下文与模式冲突
// ---------------------------------------------------------------------------

export type OrderMode = "personal" | "enterprise";
export type ClientType = "individual" | "company";
export type PaymentMethod = "personal_account" | "corporate_account";

export interface OrderContext {
  mode: OrderMode;
  client_type: ClientType;
  quote_cny: number;
  invoice_type_requested: InvoiceType;
  payment_method: PaymentMethod;
  /** 开票抬头（企业模式下必须与企业主体抬头一致）。 */
  client_invoice_title?: string | undefined;
  /** 开票税号（企业模式下必须与企业主体税号一致）。 */
  client_tax_no?: string | undefined;
  /** 签署人（企业模式必须是授权经办人/法定代表人；个人模式由客户本人签署，不拦）。 */
  signatory?: string | undefined;
  /** 是否需要用印（企业模式需用印时，未人签一律阻断转人工）。 */
  seal_required?: boolean | undefined;
  /** 经营范围提示原文（用于经营范围校验）。 */
  scope_hint?: string | undefined;
  /** 代理/账号标识（多代理串行演示用）。 */
  agent_id?: string | undefined;
  /**
   * 订单级授权书状态覆盖（fixtures 支持按单模拟 pending_human；"not_required" 归一为 none）。
   * 缺省用档案主体 authorization_letter.status。
   */
  authorization_letter_status?: SignTaskStatus | undefined;
  /** 订单级用印状态覆盖（同上）。缺省用档案主体 seal.status。 */
  seal_status?: SignTaskStatus | undefined;
}

export type ConflictSeverity = "block" | "warn";

/** 模式冲突（B8：主体/抬头/收款/发票类型不一致 → block）。 */
export interface ModeConflict {
  code: string;
  field: string;
  message: string;
  severity: ConflictSeverity;
}

// ---------------------------------------------------------------------------
// 4) 开票校验 / 收款 / 签署
// ---------------------------------------------------------------------------

export interface InvoiceChecks {
  title_matches: boolean;
  tax_no_matches: boolean;
  contract_matches: boolean;
}

/** 开票校验结果：只产出「待人工确认提交」的草稿，绝不自动提交/自动开票。 */
export interface InvoiceValidation {
  ok: boolean;
  invoice_type: InvoiceType;
  title: string;
  tax_no: string;
  checks: InvoiceChecks;
  draft_status: "draft_pending_human";
  message: string;
}

export interface PaymentCheck {
  ok: boolean;
  account_type: "personal" | "corporate";
  message: string;
}

export interface SignatureCheck {
  required: boolean;
  signatory_ok: boolean;
  /** 硬约束：AI 永远不得代签。 */
  ai_may_sign: false;
  message?: string;
}

// ---------------------------------------------------------------------------
// 5) 审计与订单结果
// ---------------------------------------------------------------------------

export type AuditResult = "ok" | "blocked" | "pending" | "error";

/** 审计行（时间/操作/对象/结果/原因；只追加）。 */
export interface AuditEntry {
  seq: number;
  at: string;
  action: string;
  object: string;
  result: AuditResult;
  reason: string;
}

export interface OrderRunResult {
  blocked: boolean;
  conflicts: ModeConflict[];
  invoice?: InvoiceValidation;
  payment: PaymentCheck;
  signature: SignatureCheck;
  /** 本次 runOrder 追加的审计行。 */
  audit: AuditEntry[];
}

// ---------------------------------------------------------------------------
// 6) 双人复核（收款账户变更）
// ---------------------------------------------------------------------------

export interface DualReviewOpinion {
  reviewer: string;
  decision: "approve" | "reject";
  at: string;
}

export interface AccountChangeRequest {
  id: string;
  from_account: string;
  to_account: string;
  requested_by: string;
  status: "pending_dual_review" | "approved" | "rejected";
  reviews: DualReviewOpinion[];
  applied: boolean;
  created_at: string;
}

/**
 * 发起收款账户变更的入参。
 * 两种字段写法都接受（契约写作 from/to；CLI/fixtures 常用 from_account/to_account）。
 */
export interface AccountChangeInput {
  requested_by: string;
  from?: string | undefined;
  to?: string | undefined;
  from_account?: string | undefined;
  to_account?: string | undefined;
}

// ---------------------------------------------------------------------------
// 7) 用印流程（AI 不代签）
// ---------------------------------------------------------------------------

export interface SealFlowInput {
  doc_id: string;
  /** 文档标题/说明（用于生成签署页定位提示，可选）。 */
  title?: string | undefined;
  signing_page_hint?: string | undefined;
}

export interface SealFlow {
  doc_id: string;
  status: "unsigned" | "pending_human" | "signed";
  /** 硬约束：AI 永远不得代签/代盖。 */
  ai_may_sign: false;
  signing_page_hint: string;
  next_action: string;
  signed_by?: string;
  signed_at?: string;
}

// ---------------------------------------------------------------------------
// 8) 30 条边界双模式标注表
// ---------------------------------------------------------------------------

/** 单条边界在某模式下的落地状态。 */
export type BoundaryImplementation = "implemented" | "human" | "not_applicable";
/** 必须行为（与 boundary.ts 的判定一致）。 */
export type BoundaryMust30 = "deny" | "human" | "draft_only";
export type BoundaryRowMode = "personal" | "enterprise" | "both";

/** 30 条边界之一：rule_id / 触发 / 必须行为 / 用户文案 / 模式 / 双模式标注 / 测试 / 证据。 */
export interface BoundaryRow30 {
  rule_id: string;
  trigger: string;
  must: BoundaryMust30;
  user_message: string;
  mode: BoundaryRowMode;
  personal: BoundaryImplementation;
  enterprise: BoundaryImplementation;
  test_case_id: string;
  evidence: string;
}

export type BoundaryDecision30 = "allow" | "deny" | "human" | "draft_only";

export type EnterpriseBoundaryKind =
  | "payment"
  | "refund"
  | "contract"
  | "invoice"
  | "tax"
  | "account_change"
  | "account_permission"
  | "captcha"
  | "promise"
  | "quote"
  | "outreach"
  | "business_scope"
  | "expense"
  | "employment_dispatch"
  | "qualification"
  | "data_privacy"
  | "other";

export interface EnterpriseBoundaryRequest {
  kind: EnterpriseBoundaryKind;
  /** 请求原文（用于关键词类规则；脱敏后留痕）。 */
  text: string;
  /** 当前模式（默认 enterprise）。 */
  mode?: OrderMode;
  amount_cny?: number;
  /** 当前预算（元）；amount_cny 超过即「超预算」。 */
  budget_cny?: number;
  requires_license?: boolean;
  requires_offline?: boolean;
  is_unknown_outreach?: boolean;
  has_authorization?: boolean;
  /** 业务明确超出登记经营范围。 */
  out_of_scope?: boolean;
}

export interface EnterpriseBoundaryResult {
  decision: BoundaryDecision30;
  rule_id: string;
  user_message: string;
  mode: OrderMode;
}

// ---------------------------------------------------------------------------
// 9) B8 双模式结果
// ---------------------------------------------------------------------------

/** 单一模式的订单证据（order 为 runOrder 结果；block 表示是否被阻断）。 */
export interface DualModeOrderEvidence {
  order: OrderRunResult;
  block: boolean;
  conflicts: ModeConflict[];
  invoice: InvoiceValidation | null;
}

/** 一个必须被阻断的 mismatch 场景证据（证明未产生发票/收款动作）。 */
export interface DualModeMismatchEvidence {
  id: string;
  label: string;
  blocked: boolean;
  conflicts: ModeConflict[];
  invoice_produced: boolean;
  payment_captured: boolean;
}

export interface DualModeChecks {
  subject_consistent: boolean;
  invoice_consistent: boolean;
  payment_consistent: boolean;
  all_mismatches_blocked: boolean;
}

export interface DualModeResult {
  personal: DualModeOrderEvidence;
  enterprise: DualModeOrderEvidence;
  /** 6 个 mismatch 场景各自的冲突列表（每个都应含 block）。 */
  mismatches_blocked: ModeConflict[][];
  checks: DualModeChecks;
  ok: boolean;
  /** 附加证据（6 个场景逐条说明；字段只增不减）。 */
  mismatch_scenarios: DualModeMismatchEvidence[];
}

// ---------------------------------------------------------------------------
// 10) 主体校验 / 审批提交 / 申报草稿 / 串行槽 / 引擎选项
// ---------------------------------------------------------------------------

export interface EntityValidation {
  ok: boolean;
  entity_id: string;
  kind: EntityKind;
  issues: string[];
}

export interface ApprovalSubmission {
  id: string;
  status: "pending";
  amount_cny: number;
  chain: string[];
  submitted_at: string;
}

/** 组织级审批链（按金额分档；amount_cny + chain 便于 CLI/证据直接序列化）。 */
export interface ApprovalChain {
  amount_cny: number;
  chain: string[];
  /** 与 chain 相同（语义别名，方便阅读）。 */
  roles: string[];
}

/** 税务申报草稿：人确认后才能提交，AI 不自动申报。 */
export interface TaxFilingDraft {
  draft_id: string;
  period: string;
  status: "draft_pending_human";
  ai_may_submit: false;
  next_action: string;
}

export interface SerialSlotResult {
  ok: boolean;
  holder: string | null;
  message: string;
}

export interface EnterpriseEngineOptions {
  /** 企业档案；缺省使用 defaultProfile()（虚构示例企业，非真实公司）。 */
  profile?: EnterpriseProfile | undefined;
  /** 时钟注入（测试确定性）；默认 () => new Date()。 */
  now?: (() => Date) | undefined;
  /** 个人主体（B8 个人模式用）；缺省使用内置虚构个人主体。 */
  personal_entity?: BusinessEntity | undefined;
}
