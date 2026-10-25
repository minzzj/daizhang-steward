/**
 * Scout（客户线索分支）领域契约。
 * 字段只增不减：新增能力请追加可选字段，禁止改名/删字段（CLI 与报告按此契约集成）。
 * 与 `prompts/scout.md`、`docs/zh-CN/contracts.md` 的 Lead 字段保持一致。
 */

/** 允许的触达渠道（决定可触达性启发式与每日频控分组）。 */
export type ScoutChannel = "email" | "platform_dm" | "form";

/** 客户预算区间（参与“预算/规模”20% 因子）。 */
export type BudgetRange = "low" | "medium" | "high";

/**
 * 线索 fixture 条目：由只读公开来源整理而来。
 * 必填 `source_url` + `signal` + `consent_basis`：缺任一即丢弃并记 rejected_reasons（不补造）。
 */
export interface ScoutFixtureLead {
  lead_id: string;
  org: string;
  role: string;
  /** 必填：证据来源（仅 http(s)）；缺失/空/非 http(s) → 丢弃。 */
  source_url: string;
  /** 具体需求信号原文（起草时必须引用其中片段，禁止编造）。 */
  signal: string;
  channel: ScoutChannel;
  /** 合规依据（如“公开商务邮箱，帖子明确寻求工具”）；空 → 丢弃。 */
  consent_basis: string;
  /** 需求强度 0-1；缺省按 signal 长度/关键词启发式。 */
  needs_strength?: number;
  budget_range?: BudgetRange;
  /** 公司人数，可选；无 budget_range 时参与预算/规模启发式。 */
  company_size?: number;
  /** 可触达性 0-1，可选；缺省按渠道启发式。 */
  reachability?: number;
  /** 合规风险 0-1，越高越差，可选；缺省按 consent_basis 启发式。 */
  compliance_risk?: number;
  /** 展示用公司名（可与 org 相同）。 */
  company_name?: string;
}

/** 理想客户画像（先写 ICP，再检索线索）。 */
export interface ICP {
  segment: string;
  pain_points: string[];
  budget: string;
  channels: string[];
  disqualifiers: string[];
}

/** 三个高价值场景之一（方案叙事，不含真实客户信息）。 */
export interface Scenario {
  id: string;
  name: string;
  who_hurts: string;
  pain: string;
  current_workaround: string;
  why_us: string;
}

/** 四因子评分明细（每项 0-1，权重见 ScoutEngine#scoreLead）。 */
export interface ScoreBreakdown {
  /** 需求强度，权重 40%。 */
  need: number;
  /** 预算/规模，权重 20%。 */
  budget: number;
  /** 可触达性，权重 20%。 */
  reachability: number;
  /** 合规（按 1 - compliance_risk 计分），权重 20%。 */
  compliance: number;
}

/** 评分后的线索：fit_score ∈ [0,1]，不合格/不合规线索 qualified=false。 */
export interface ScoredLead extends ScoutFixtureLead {
  fit_score: number;
  score_breakdown: ScoreBreakdown;
  qualified: boolean;
  reason: string;
}

/** 外联草稿状态：Scout 只会产出 drafted，绝不自行发送。 */
export type DraftStatus = "drafted";

/** 外联草稿（≤150 字符、引用具体 signal 片段、不冒充人类、不群发）。 */
export interface OutreachDraft {
  lead_id: string;
  channel: string;
  /** ≤30 字符。 */
  subject: string;
  /** ≤150 字符（中文按 1 字计）。 */
  body: string;
  /** body 的字符数（Unicode 码点计数，与 ≤150 校验一致）。 */
  chars: number;
  /** body 是否包含 signal 的具体片段（正常起草恒为 true）。 */
  cites_signal: boolean;
  status: DraftStatus;
  created_at: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** 审批队列条目：默认 pending，必须人类 approve 后才可能 markSent。 */
export interface ApprovalItem {
  lead_id: string;
  draft: OutreachDraft;
  status: ApprovalStatus;
  decided_by?: string;
  decided_at?: string;
  /** reject 原因（附加字段，只增不减）。 */
  reason?: string;
}

/** 丢弃/去重原因（报告留证用；lead_id 缺失时省略）。 */
export interface RejectedReason {
  lead_id?: string;
  reason: string;
}

/** 单渠道统计（报告用）。 */
export interface ChannelStats {
  drafts: number;
  sent: number;
}

/** ScoutReport：数字与内部状态一致，供周报/离线报告/证据留档使用。 */
export interface ScoutReport {
  generated_at: string;
  icp: ICP;
  scenarios: Scenario[];
  leads_total: number;
  leads_discarded: number;
  qualified_count: number;
  drafts_count: number;
  pending_approval: number;
  sent_count: number;
  replies: number;
  meetings: number;
  rejected_reasons: RejectedReason[];
  channels: Record<string, ChannelStats>;
  daily_limit_per_channel: number;
}

/** ScoutEngine 构造参数。 */
export interface ScoutEngineOptions {
  leads: ScoutFixtureLead[];
  /** 时钟注入（测试确定性）；默认 () => new Date()。 */
  now?: () => Date;
  /** 每日每渠道发送上限，默认 10。 */
  dailyPerChannelLimit?: number;
  /** 合格阈值 0-1，默认 0.5。 */
  qualifiedThreshold?: number;
}
