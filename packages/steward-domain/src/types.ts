/**
 * 阶段二 P1「经营域」数据模型（个人版 MVP）。
 *
 * 八概念全量数据模型 + 审批/接管/边界/摘要；字段只增不减（契约面，CLI/控制台按此集成）。
 * 所有金额单位为人民币元（CNY），时间戳为 ISO 8601 字符串。
 *
 * 八概念：委托（Mandate）/ 预算三层 / 项目（Project）/ 任务（Task）/ 代理（AgentRole）/
 *        证据（Evidence）/ 账本（LedgerEntry）/ 墓碑（tombstone）。
 * 每条关系带置信度：certain（确定）/ probable（可能）/ unknown（未知）/ tombstone（墓碑）。
 */

/** 置信度四档（与 core/types.ts 的 Confidence 一致）。 */
export type Confidence = "certain" | "probable" | "unknown" | "tombstone";

/** 经营域代理角色（总调度 + 专项代理）。 */
export type AgentRole = "conductor" | "developer" | "customer" | "finance" | "content" | "research";

// ---------------------------------------------------------------------------
// 1) 委托（Mandate）
// ---------------------------------------------------------------------------

export type MandateStatus = "active" | "expired" | "revoked";

/** 预算三层额度（A8/B2：月 / 项目 / 单笔）。 */
export interface MandateBudgetLimits {
  month_cny: number;
  project_cny: number;
  per_txn_cny: number;
}

/** 委托：授权人给代理的「范围 / 期限 / 额度 / 禁止项」。 */
export interface Mandate {
  id: string;
  /** 授权人（自然人；个人版即用户本人）。 */
  principal: string;
  /** 授权范围（自然语言条款，供承诺追溯引用）。 */
  scope: string[];
  valid_from: string;
  valid_to: string;
  budget_limits: MandateBudgetLimits;
  /** 禁止项（红线，命中即拒绝/人工）。 */
  prohibited: string[];
  status: MandateStatus;
  confidence: Confidence;
  created_at: string;
  revoked_at?: string;
  revoked_reason?: string;
}

export interface CreateMandateInput {
  principal: string;
  scope: string[];
  valid_from?: string;
  valid_to?: string;
  budget_limits: MandateBudgetLimits;
  prohibited?: string[];
  confidence?: Confidence;
}

// ---------------------------------------------------------------------------
// 2) 选题：业务线（BusinessLine）
// ---------------------------------------------------------------------------

/** 业务线的来源证据：必须可打开（http(s)），选题验收 B1 要求 30 秒内可核。 */
export interface BusinessLineSource {
  title: string;
  url: string;
}

export interface BusinessLine {
  id: string;
  name: string;
  /** 谁付钱（客户画像一句话）。 */
  who_pays: string;
  quote_cny: number;
  cost_cny: number;
  /** 毛利（元）= quote_cny - cost_cny（由引擎归一化保证一致）。 */
  gross_margin: number;
  /** 最坏情况成本（元）。 */
  worst_case_cny: number;
  sources: BusinessLineSource[];
  risks: string[];
  requires_offline?: boolean;
  requires_license?: boolean;
  /** 确定性（参与选题排序）。 */
  certainty?: Confidence;
  /** 交付周期（天，可选；参与预算窗口校验）。 */
  delivery_days?: number;
  /** 毛利率（0-1，由引擎归一化计算）。 */
  gross_margin_rate?: number;
}

/** 选题请求选项（验收 B1：例如 5 万预算 / 30 天）。 */
export interface ProposalOptions {
  budget_cny: number;
  days: number;
}

export type ProposalRejectCategory = "missing_source" | "over_budget" | "requires_human" | "invalid";

export interface ProposalRejected {
  id?: string;
  name?: string;
  reason: string;
  category: ProposalRejectCategory;
}

/** 选题提案文档（≥3 条合格业务线时输出）。 */
export interface ProposalDocument {
  summary: string;
  lines: BusinessLine[];
  total_quote_cny: number;
  total_cost_cny: number;
  expected_margin_cny: number;
}

/** 选题校验结果：三类结果（来源缺失/超预算/转人工）+ 排序 + 可选提案。 */
export interface BusinessLineProposal {
  generated_at: string;
  budget_cny: number;
  days: number;
  accepted: BusinessLine[];
  rejected: ProposalRejected[];
  needs_human: ProposalRejected[];
  /** 按「毛利/确定性」排序后的合格业务线。 */
  ranked: BusinessLine[];
  /** accepted ≥ 3 才有 proposal，否则 null。 */
  proposal: ProposalDocument | null;
}

// ---------------------------------------------------------------------------
// 3) 项目（Project）/ 任务（Task）/ 证据（Evidence）
// ---------------------------------------------------------------------------

export type ProjectStatus = "proposed" | "active" | "delivered" | "closed" | "tombstoned";
export type TaskStatus = "pending" | "in_progress" | "done" | "blocked";
export type TimelineKind =
  | "created"
  | "quoted"
  | "task"
  | "delivery"
  | "acceptance"
  | "income"
  | "invoice"
  | "promise"
  | "approval"
  | "takeover"
  | "resume"
  | "note"
  | "boundary";

/** 项目时间线（对话/报价/交付物/验收单/收款/开票进同一时间线）。 */
export interface TimelineEntry {
  at: string;
  kind: TimelineKind;
  summary: string;
  evidence_ids: string[];
  confidence: Confidence;
}

export interface Project {
  id: string;
  name: string;
  business_line_id: string;
  client: string;
  status: ProjectStatus;
  timeline: TimelineEntry[];
  created_at: string;
  updated_at: string;
  confidence: Confidence;
}

export type EvidenceKind = "screenshot" | "log" | "email" | "receipt" | "delivery" | "invoice" | "commit";

export interface EvidenceInput {
  kind: EvidenceKind;
  path: string;
  note?: string;
  confidence?: Confidence;
}

export interface Evidence {
  id: string;
  project_id: string;
  kind: EvidenceKind;
  /** 证据位置（仓库相对路径/绝对路径均可；只存引用，不存内容）。 */
  path: string;
  note: string;
  confidence: Confidence;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  agent_role: AgentRole;
  goal: string;
  status: TaskStatus;
  /** 关联证据 id 列表。 */
  evidence: string[];
  created_at: string;
  completed_at?: string;
}

export interface AddTaskInput {
  project_id: string;
  agent_role: AgentRole;
  goal: string;
}

// ---------------------------------------------------------------------------
// 4) 账本（LedgerEntry）
// ---------------------------------------------------------------------------

export type LedgerType = "income" | "expense" | "refund" | "receivable" | "invoice";

/** 预算检查的支出类别（只有支出类会消耗预算）。 */
export type BudgetKind = "expense" | "payment" | "refund";

export interface LedgerEntry {
  id: string;
  project_id: string;
  type: LedgerType;
  amount_cny: number;
  /** 收款方或付款方。 */
  payee_or_payer: string;
  /** 依据（合同/验收单/对话编号等）。 */
  basis: string;
  /** 审批人（自然人/仿真审批标识；禁止留空）。 */
  approved_by: string;
  /** 回执引用（收据/流水号/发票号）。 */
  receipt_ref: string;
  occurred_at: string;
  confidence: Confidence;
  created_at: string;
}

export interface RecordLedgerInput {
  project_id: string;
  type: LedgerType;
  amount_cny: number;
  payee_or_payer: string;
  basis: string;
  approved_by: string;
  receipt_ref: string;
  occurred_at?: string;
  confidence?: Confidence;
  /** 显式允许重复回执（默认 false：同回执同项目同类型杜绝重复记账）。 */
  allow_duplicate?: boolean;
}

/** 账本 6 要素（验收 B2：30 秒看到金额/收付方/依据/审批人/回执/项目）。 */
export interface LedgerFacts {
  entry_id: string;
  amount_cny: number;
  payee_or_payer: string;
  basis: string;
  approved_by: string;
  receipt_ref: string;
  project_id: string;
}

export interface LedgerFilter {
  project_id?: string;
  type?: LedgerType;
  /** YYYY-MM */
  month?: string;
}

// ---------------------------------------------------------------------------
// 5) 承诺追溯（B5）
// ---------------------------------------------------------------------------

export type PromiseStatus = "authorized" | "unauthorized";

export interface PromiseRecord {
  id: string;
  project_id: string;
  /** 对外承诺原文。 */
  text: string;
  /** 指向对话原文消息 id。 */
  source_message_id: string;
  /** 指向委托中的授权条款。 */
  mandate_clause: string;
  mandate_id: string | null;
  status: PromiseStatus;
  created_at: string;
}

/** tracePromise 的返回：找不到/未授权 → {authorized:false, reason:"未授权"}。 */
export interface PromiseTrace {
  authorized: boolean;
  reason?: string;
  promise_id?: string;
  project_id?: string;
  text?: string;
  source_message_id?: string;
  mandate_clause?: string;
  mandate_id?: string;
  /** 可读追溯链：对话原文 → 授权条款 → 项目。 */
  chain?: string[];
}

// ---------------------------------------------------------------------------
// 6) 审批（ApprovalCard，超时挂起不自动放行）
// ---------------------------------------------------------------------------

export type ApprovalKind = "payment" | "quote" | "contract" | "handoff" | "exception";
export type ApprovalCardStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalDecision = "approve" | "reject";
export type ApprovalOption = ApprovalDecision;

export interface ApprovalCard {
  id: string;
  kind: ApprovalKind;
  summary: string;
  amount_cny?: number;
  evidence_ids: string[];
  options: ApprovalOption[];
  expires_at: string;
  status: ApprovalCardStatus;
  created_at: string;
  decided_by?: string;
  decided_at?: string;
  related_project_id?: string;
}

export interface CreateApprovalCardInput {
  kind: ApprovalKind;
  summary: string;
  amount_cny?: number;
  evidence_ids?: string[];
  /** 缺省：now + ttl_hours（默认 24h） */
  expires_at?: string;
  ttl_hours?: number;
  related_project_id?: string;
}

// ---------------------------------------------------------------------------
// 7) 接管包（TakeoverPack）
// ---------------------------------------------------------------------------

export type TakeoverCoverage = "complete" | "partial" | "not_covered";

export interface TakeoverPack {
  generated_at: string;
  /** 未结订单/在办项目。 */
  open_orders: string[];
  /** 待办对话/未完成任务。 */
  pending_threads: string[];
  /** 待付账单。 */
  payables: string[];
  /** 凭据引用（只放引用名/环境变量名，绝不含明文）。 */
  credentials: string[];
  /** 风险项。 */
  risks: string[];
  coverage: TakeoverCoverage;
  reason?: string;
  by?: string;
}

// ---------------------------------------------------------------------------
// 8) 月报（MonthlyReport）与三层摘要（L0/L1/L2）
// ---------------------------------------------------------------------------

export interface MonthlyReport {
  /** YYYY-MM */
  month: string;
  income_cny: number;
  cost_cny: number;
  gross_margin_cny: number;
  /** 0-1（income 为 0 时取 0）。 */
  gross_margin_rate: number;
  budget_left_cny: number;
  /** 合规事件（边界拒绝/人工审批等）可读描述。 */
  compliance_events: string[];
  /** 下月提案（业务线名称）。 */
  next_proposals: string[];
  as_of: string;
  coverage: TakeoverCoverage;
}

export type ActionSeverity = "info" | "warn" | "critical";
export type ActionCardKind = "approval" | "takeover" | "task" | "risk" | "proposal" | "budget";

/** L0 动作卡：一眼看清「现在需要人做什么」。 */
export interface ActionCard {
  id: string;
  kind: ActionCardKind;
  summary: string;
  severity: ActionSeverity;
  ref_id?: string;
}

/** L1 项目摘要。 */
export interface ProjectSummary {
  project_id: string;
  name: string;
  status: ProjectStatus;
  client: string;
  open_tasks: number;
  done_tasks: number;
  evidence_count: number;
  confidence: Confidence;
  last_event_at: string;
}

/** 三层摘要：L0 动作卡 / L1 项目摘要 / L2 经营月报。 */
export interface SummaryBundle {
  generated_at: string;
  L0: ActionCard[];
  L1: ProjectSummary[];
  L2: MonthlyReport;
}

// ---------------------------------------------------------------------------
// 9) 边界规则（≥12 条个人模式；四类越界 100% deny）
// ---------------------------------------------------------------------------

/** 规则强制行为：deny 拒绝 / human 转人工 / draft_only 只出草稿。 */
export type BoundaryMust = "deny" | "human" | "draft_only";
export type BoundaryMode = "personal" | "enterprise" | "both";
/** 最终判定（allow 表示未命中任何拦截规则）。 */
export type BoundaryDecision = "allow" | "deny" | "human" | "draft_only";

export interface BoundaryRule {
  rule_id: string;
  /** 触发条件的可读描述。 */
  trigger: string;
  must: BoundaryMust;
  /** 用户可见文案（可读、可留痕）。 */
  user_message: string;
  mode: BoundaryMode;
  /** 对应测试用例 id（边界核对表用）。 */
  test_case_id: string;
}

export type BoundaryRequestKind =
  | "payment"
  | "refund"
  | "contract"
  | "account_permission"
  | "captcha"
  | "promise"
  | "quote"
  | "outreach"
  | "business_scope"
  | "expense"
  | "delivery"
  | "invoice"
  | "other";

export interface BoundaryCheckRequest {
  kind: BoundaryRequestKind;
  /** 请求原文（用于关键词类规则；会脱敏后留痕）。 */
  text: string;
  amount_cny?: number;
  requires_license?: boolean;
  requires_offline?: boolean;
  is_unknown_outreach?: boolean;
  has_authorization?: boolean;
}

export interface BoundaryCheckResult {
  decision: BoundaryDecision;
  rule_id: string;
  user_message: string;
}

/** 合规事件（月报 compliance_events 与事件流留痕共用；已脱敏）。 */
export interface ComplianceEvent {
  at: string;
  rule_id: string;
  decision: BoundaryDecision;
  kind: BoundaryRequestKind;
  /** 可读原因（不含敏感原文；原文只存摘要）。 */
  message: string;
  text_digest: string;
}

// ---------------------------------------------------------------------------
// 10) 预算 / 仿真业务线 / 引擎选项
// ---------------------------------------------------------------------------

export interface BudgetCheckResult {
  allowed: boolean;
  requiresHumanApproval: boolean;
  amount_cny: number;
  reason?: string;
  layer?: "per_txn" | "project" | "month";
  remaining?: {
    month_cny: number;
    project_cny: number;
    per_txn_cny: number;
  };
}

/** 仿真业务线端到端结果（B1/B2/B5 场景演示用）。 */
export interface SimulatedBusinessLineResult {
  project: Project;
  tasks: Task[];
  timeline: TimelineEntry[];
  ledger: LedgerEntry[];
  invoice_status: "not_required" | "pending" | "issued";
  invoice_no: string;
  report: MonthlyReport;
  quote_cny: number;
  customer_message: string;
  acceptance: Evidence;
}

/** 事件流一行（`<root>/domain/events.jsonl`，只追加不覆盖）。 */
export interface DomainEvent {
  seq: number;
  ts: string;
  action: string;
  object_type: string;
  object_id: string;
  result: "ok" | "denied" | "error";
  evidence_refs: string[];
  /** 脱敏后的补充说明。 */
  detail?: string;
}

export interface DomainEngineOptions {
  /** 持久化根目录；`<root>/domain/state.json` + `<root>/domain/events.jsonl`。 */
  root?: string;
  /** false = 纯内存（默认：给了 root 就持久化）。 */
  persist?: boolean;
  /** 时钟注入（测试确定性）；默认 () => new Date()。 */
  now?: () => Date;
  /** 凭据「引用」列表（环境变量名/文件路径；接管包只放引用，不存明文）。 */
  credentials?: string[];
}

/** 引擎当前预算快照（只读视图）。 */
export interface BudgetSnapshot {
  month_key: string;
  month_limit_cny: number;
  month_spent_cny: number;
  month_left_cny: number;
  project_limit_cny: number;
  per_txn_limit_cny: number;
}
