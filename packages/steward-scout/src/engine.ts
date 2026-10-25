/**
 * ScoutEngine：客户线索分支核心领域引擎（纯逻辑、零依赖、无网络）。
 *
 * 铁律（与 prompts/scout.md 一致）：
 * - 无 source_url / 非 http(s) / 无 consent_basis → 丢弃并记 rejected_reasons，不补造；
 * - 评分四因子加权：需求 40% + 预算/规模 20% + 可触达 20% + 合规(1-risk) 20%；
 * - 外联只起草（≤150 字符、引用具体 signal 片段、不冒充人类、不群发）；
 * - 绝不自动发送：默认 pending，必须人类 approve；每日每渠道 ≤10；退订立即拦截；
 * - 所有“发送”类方法只记录内存状态，不产生任何网络/IO 调用。
 */

import { ScoutComplianceError, ScoutValidationError } from "./errors.js";
import {
  charLength,
  clamp01,
  excerptText,
  heuristicBudget,
  heuristicComplianceRisk,
  heuristicNeed,
  heuristicReachability,
} from "./heuristics.js";
import type {
  ApprovalItem,
  ChannelStats,
  ICP,
  OutreachDraft,
  RejectedReason,
  Scenario,
  ScoredLead,
  ScoutEngineOptions,
  ScoutFixtureLead,
  ScoutReport,
} from "./types.js";

/** 每日每渠道发送上限（A7 合规底线）。 */
export const DEFAULT_DAILY_LIMIT = 10;
/** 合格阈值默认值。 */
export const DEFAULT_QUALIFIED_THRESHOLD = 0.5;
/** drafts() 自动起草上限（A7 要求 3 条草稿）。 */
export const MAX_AUTO_DRAFTS = 3;
/** 外联正文上限（字符/码点，中文按 1 计）。 */
export const DRAFT_BODY_MAX_CHARS = 150;
/** 外联标题上限。 */
export const DRAFT_SUBJECT_MAX_CHARS = 30;

/** signal 引用片段最多取前 40 字（A7：取前 20-40 字）。 */
const SIGNAL_EXCERPT_MAX = 40;
/** 标题里的 signal 摘要最多 16 字（保证 subject ≤ 30）。 */
const SUBJECT_EXCERPT_MAX = 16;
/** 草稿正文模板固定开销（≈81 字符）；保证 40 字片段时仍 ≤150。 */
const DRAFT_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /我是\s*(?:AI|ai|人工智能|机器人|智能助手|虚拟助理)/u,
  /群发/u,
  /批量/u,
];

interface SentRecord {
  lead_id: string;
  channel: string;
  at: string;
  /** UTC 日期 YYYY-MM-DD，用于“每日每渠道”频控。 */
  date: string;
}

interface Decision {
  status: "approved" | "rejected";
  decided_by: string;
  decided_at: string;
  reason?: string;
}

interface UnsubscribeRecord {
  at: string;
  note?: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 归一化去重键片段：小写、去空白/标点/符号。 */
function normalizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 仅接受 http(s) 且带主机名的绝对 URL。 */
function isHttpUrl(value: string): boolean {
  const raw = value.trim();
  if (raw.length === 0) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function makeRejected(leadId: string, reason: string): RejectedReason {
  return leadId.length > 0 ? { lead_id: leadId, reason } : { reason };
}

/** 外联正文：单条、非群发、不冒充人类；仅引用 signal 片段 + 服务说明 + 退订提示。 */
function composeDraftBody(snippet: string): string {
  return `看到你提到「${snippet}」。我们做代掌 Steward，能把这类重复流程交给 AI 分步执行，先出草稿由人确认；想约 10 分钟聊聊是否合适。不需要请回复退订，我们不再打扰。`;
}

/** 外联标题（≤30 字符）。 */
function composeDraftSubject(snippet: string): string {
  return `关于「${excerptText(snippet, SUBJECT_EXCERPT_MAX)}」的自动化想法`;
}

function isSafeDraftText(text: string): boolean {
  return !DRAFT_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

/** Scout（客户线索分支）核心引擎。一个实例对应一次 scout 运行（fixture → 报告）。 */
export class ScoutEngine {
  private readonly leads: ScoutFixtureLead[];
  private readonly nowFn: () => Date;
  private readonly dailyPerChannelLimit: number;
  private readonly qualifiedThreshold: number;
  private readonly leadsById = new Map<string, ScoutFixtureLead>();
  private readonly draftsById = new Map<string, OutreachDraft>();
  private readonly decisions = new Map<string, Decision>();
  private readonly sentRecords: SentRecord[] = [];
  private readonly unsubscribed = new Map<string, UnsubscribeRecord>();
  private readonly replied = new Set<string>();
  private readonly met = new Set<string>();
  private scoredCache: ScoredLead[] | null = null;
  private rejectedList: RejectedReason[] = [];

  constructor(options: ScoutEngineOptions) {
    if (options === null || typeof options !== "object" || !Array.isArray(options.leads)) {
      throw new ScoutValidationError("ScoutEngine 构造参数非法：需要 { leads: ScoutFixtureLead[] }");
    }
    this.leads = options.leads;
    this.nowFn = options.now ?? (() => new Date());

    const limit = options.dailyPerChannelLimit;
    if (limit === undefined) {
      this.dailyPerChannelLimit = DEFAULT_DAILY_LIMIT;
    } else if (!Number.isInteger(limit) || limit < 1) {
      throw new ScoutValidationError("dailyPerChannelLimit 必须是 ≥1 的整数（默认 10）");
    } else {
      this.dailyPerChannelLimit = limit;
    }

    const threshold = options.qualifiedThreshold;
    if (threshold === undefined) {
      this.qualifiedThreshold = DEFAULT_QUALIFIED_THRESHOLD;
    } else if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new ScoutValidationError("qualifiedThreshold 必须是 0-1 之间的数字（默认 0.5）");
    } else {
      this.qualifiedThreshold = threshold;
    }

    for (const lead of options.leads) {
      const leadId = asString(lead?.lead_id).trim();
      if (leadId.length > 0 && !this.leadsById.has(leadId)) this.leadsById.set(leadId, lead);
    }
  }

  // -------------------------------------------------------------------------
  // 1) ICP 与三个高价值场景（先写方向，再检索线索）
  // -------------------------------------------------------------------------

  /** 理想客户画像：10–200 人、一人多岗、重复流程多、缺技术人手的中小企业。 */
  buildIcp(): ICP {
    return {
      segment:
        "10–200 人的中小企业（电商、SaaS、本地服务优先）里负责运营/客服/行政的「一人多岗」负责人",
      pain_points: [
        "每周/每天手工整理多渠道报表，耗时且易错",
        "客服与后台重复录入、复制粘贴，挤占思考时间",
        "跨系统对账靠人工核对，月底集中加班",
        "想上自动化但缺技术人手、缺可复核的交付方式",
      ],
      budget: "月付 3,000–20,000 元人民币（按流程数量与托管时长计价）",
      channels: ["email", "platform_dm", "form"],
      disqualifiers: [
        "要求绕过验证码/风控、抓取登录后页面或购买名单",
        "要求自动群发/无视退订、要求 AI 冒充真人",
        "采集无合法依据的个人信息",
        "无 source_url 或 consent_basis 的线索（一律不入库）",
        "预算与交付范围完全无法对齐且无明确流程",
      ],
    };
  }

  /** 恰好 3 个高价值场景（现场展示“痛点 → 现有替代 → 为什么是我们”）。 */
  listScenarios(): Scenario[] {
    return [
      {
        id: "scenario-weekly-report",
        name: "每周经营报表自动整理",
        who_hurts: "电商/连锁门店运营负责人",
        pain: "每周从多个后台导出销售、库存、客服数据，再手工合并成一张报表",
        current_workaround: "人工导出 Excel 后复制粘贴，2–5 小时/周，口径靠记忆",
        why_us: "用浏览器/桌面操作替代重复导出与合并，先生成草稿报表由人复核，全程留证据",
      },
      {
        id: "scenario-cs-reply",
        name: "客服与后台重复录入",
        who_hurts: "客服主管、行政/运营兼岗人员",
        pain: "同一信息在聊天工具、工单系统、表格之间重复录入与回复",
        current_workaround: "复制粘贴 + 固定话术；漏记、错记常见，新人上手慢",
        why_us: "按固定流程把重复录入与首轮回复做成待审草稿，人只做确认与例外",
      },
      {
        id: "scenario-reconcile",
        name: "对账与发票核对",
        who_hurts: "财务/行政兼岗的中小企业",
        pain: "订单、支付、发票三套数据靠肉眼核对，月底集中加班",
        current_workaround: "人工比对表格，差异逐条查，结果难以复核",
        why_us: "自动比对并输出差异清单，每步留证据、可回放，人只处理差异",
      },
    ];
  }

  // -------------------------------------------------------------------------
  // 2) 校验与评分
  // -------------------------------------------------------------------------

  /** 入库硬条件：lead_id / source_url(http(s)) / signal / consent_basis 齐全。 */
  private leadIssues(lead: ScoutFixtureLead): string[] {
    const source = (lead ?? {}) as Partial<ScoutFixtureLead>;
    const issues: string[] = [];
    if (asString(source.lead_id).trim().length === 0) issues.push("缺少 lead_id");
    const url = asString(source.source_url).trim();
    if (url.length === 0) {
      issues.push("缺少 source_url（无来源即丢弃，不补造）");
    } else if (!isHttpUrl(url)) {
      issues.push(`source_url 不是 http(s) 链接：${excerptText(url, 60)}`);
    }
    if (asString(source.signal).trim().length === 0) issues.push("缺少具体需求信号 signal");
    if (asString(source.consent_basis).trim().length === 0) {
      issues.push("缺少 consent_basis（无合规依据）");
    }
    return issues;
  }

  /**
   * 四因子评分：fit_score = 0.4*need + 0.2*budget + 0.2*reachability + 0.2*(1-risk)。
   * 显式字段优先；缺省走 heuristics（并夹取到 [0,1]）。不合规线索 qualified=false。
   */
  scoreLead(lead: ScoutFixtureLead): ScoredLead {
    const source = (lead ?? {}) as Partial<ScoutFixtureLead>;
    const issues = this.leadIssues(lead);

    const needInput = asFiniteNumber(source.needs_strength);
    const need = clamp01(needInput ?? heuristicNeed(asString(source.signal)));

    const budget = clamp01(heuristicBudget(source));

    const reachInput = asFiniteNumber(source.reachability);
    const reachability = clamp01(reachInput ?? heuristicReachability(source));

    const riskInput = asFiniteNumber(source.compliance_risk);
    const risk = clamp01(riskInput ?? heuristicComplianceRisk(source));
    const compliance = clamp01(1 - risk);

    const fit = clamp01(0.4 * need + 0.2 * budget + 0.2 * reachability + 0.2 * compliance);
    const qualified = issues.length === 0 && fit >= this.qualifiedThreshold;

    const reason =
      issues.length > 0
        ? `不符合入库条件：${issues.join("；")}（fit_score ${formatScore(fit)}，未进入合格集）`
        : `需求 ${formatScore(need)}×40% + 预算/规模 ${formatScore(budget)}×20% + 可触达 ${formatScore(reachability)}×20% + 合规 ${formatScore(compliance)}×20% → fit_score ${formatScore(fit)}，${qualified ? "≥" : "<"} 合格阈值 ${formatScore(this.qualifiedThreshold)}`;

    return {
      ...lead,
      fit_score: fit,
      score_breakdown: { need, budget, reachability, compliance },
      qualified,
      reason,
    };
  }

  /**
   * 评分 + 硬条件过滤 + 去重（org+signal 归一化后相同只留高分）。
   * 丢弃原因全部进 rejected_reasons（报告可核对，不静默丢数据）。
   */
  scoredLeads(): ScoredLead[] {
    if (this.scoredCache !== null) return this.scoredCache;

    const unique = new Map<string, ScoredLead>();
    const rejected: RejectedReason[] = [];

    for (const lead of this.leads) {
      const issues = this.leadIssues(lead);
      const leadId = asString(lead?.lead_id).trim();
      if (issues.length > 0) {
        rejected.push(makeRejected(leadId, issues.join("；")));
        continue;
      }

      const scored = this.scoreLead(lead);
      const key = `${normalizeKeyPart(asString(lead.org))}|${normalizeKeyPart(asString(lead.signal))}`;
      const existing = unique.get(key);
      if (existing === undefined) {
        unique.set(key, scored);
        continue;
      }

      const keepIncoming = scored.fit_score > existing.fit_score;
      const kept = keepIncoming ? scored : existing;
      const dropped = keepIncoming ? existing : scored;
      unique.set(key, kept);
      rejected.push(
        makeRejected(
          asString(dropped.lead_id),
          `重复线索（org+signal 归一化后相同）：保留更高分的 ${asString(kept.lead_id)}（fit ${formatScore(kept.fit_score)}），丢弃 ${asString(dropped.lead_id)}（fit ${formatScore(dropped.fit_score)}）`,
        ),
      );
    }

    const result = Array.from(unique.values());
    this.rejectedList = rejected;
    this.scoredCache = result;
    return result;
  }

  /** 合格线索（按 fit_score 降序，稳定排序；未批准的线索不会自动发送）。 */
  qualifiedLeads(): ScoredLead[] {
    return this.scoredLeads()
      .filter((lead) => lead.qualified)
      .sort((left, right) => right.fit_score - left.fit_score);
  }

  // -------------------------------------------------------------------------
  // 3) 外联草稿（只起草，不发送）
  // -------------------------------------------------------------------------

  /**
   * 为单条线索起草外联（同 lead_id 幂等：已有草稿直接返回，不重复入队）。
   * 正文 ≤150 字符、必须引用 signal 片段、不含“我是 AI/机器人”“群发/批量”语义。
   */
  draftOutreach(lead: ScoredLead | ScoutFixtureLead): OutreachDraft {
    const source = (lead ?? {}) as Partial<ScoutFixtureLead>;
    const leadId = asString(source.lead_id).trim();
    if (leadId.length === 0) throw new ScoutValidationError("draftOutreach 需要非空 lead_id");

    const existing = this.draftsById.get(leadId);
    if (existing !== undefined) return { ...existing };

    const signal = asString(source.signal).trim();
    if (signal.length === 0) {
      throw new ScoutValidationError(
        `线索 ${leadId} 缺少 signal：没有具体需求片段就不起草（禁止编造）`,
      );
    }

    const { body, snippet } = this.buildSafeDraftBody(signal, leadId);
    const channel = asString(source.channel).trim();
    const draft: OutreachDraft = {
      lead_id: leadId,
      channel: channel.length > 0 ? channel : "unknown",
      subject: composeDraftSubject(snippet),
      body,
      chars: charLength(body),
      cites_signal: snippet.length > 0 && body.includes(snippet),
      status: "drafted",
      created_at: this.nowIso(),
    };
    this.draftsById.set(leadId, draft);
    return { ...draft };
  }

  /**
   * 引用 signal 前 20–40 字（正常取 40）；若 signal 本身含“冒充/群发/批量”语义，
   * 自动缩短到安全前缀，避免把违规话术复制进外联正文。
   */
  private buildSafeDraftBody(signal: string, leadId: string): { body: string; snippet: string } {
    const signalChars = charLength(signal);
    const maxLength = Math.min(signalChars, SIGNAL_EXCERPT_MAX);
    for (let length = maxLength; length >= 1; length -= 1) {
      const snippet = excerptText(signal, length);
      const body = composeDraftBody(snippet);
      if (charLength(body) <= DRAFT_BODY_MAX_CHARS && isSafeDraftText(body)) {
        return { body, snippet };
      }
    }
    throw new ScoutComplianceError(
      `线索 ${leadId} 的 signal 无法在 ${DRAFT_BODY_MAX_CHARS} 字符内安全引用（可能含冒充/群发语义）`,
      "DRAFT_LIMIT",
    );
  }

  /** 自动起草：仅合格线索、最多 3 条（A7 验收要求“3 条草稿未发送”）。 */
  drafts(): OutreachDraft[] {
    const top = this.qualifiedLeads().slice(0, MAX_AUTO_DRAFTS);
    return top.map((lead) => this.draftOutreach(lead));
  }

  // -------------------------------------------------------------------------
  // 4) 人工审批队列（默认全部 pending；未批准严禁发送）
  // -------------------------------------------------------------------------

  /** 审批队列：包含所有已创建草稿，默认 pending；approve/reject 后反映人工决定。 */
  approvalQueue(): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    for (const draft of this.draftsById.values()) items.push(this.composeApprovalItem(draft));
    return items;
  }

  private composeApprovalItem(draft: OutreachDraft): ApprovalItem {
    const decision = this.decisions.get(draft.lead_id);
    const item: ApprovalItem = {
      lead_id: draft.lead_id,
      draft: { ...draft },
      status: decision?.status ?? "pending",
    };
    if (decision !== undefined) {
      item.decided_by = decision.decided_by;
      item.decided_at = decision.decided_at;
      if (decision.reason !== undefined) item.reason = decision.reason;
    }
    return item;
  }

  /** 人工审批通过（必须由人调用；模块绝不自动 approve）。 */
  approve(lead_id: string, decided_by: string): ApprovalItem {
    const leadId = this.requireLeadId(lead_id, "approve");
    const decidedBy = this.requireDecidedBy(decided_by, "approve");
    const draft = this.draftsById.get(leadId);
    if (draft === undefined) {
      throw new ScoutValidationError(
        `未找到 lead ${leadId} 的外联草稿：先 draftOutreach 起草，再人工审批（不允许跳过起草）`,
      );
    }
    this.decisions.set(leadId, {
      status: "approved",
      decided_by: decidedBy,
      decided_at: this.nowIso(),
    });
    return this.composeApprovalItem(draft);
  }

  /** 人工驳回（reason 可选，仅记录不发送）。 */
  reject(lead_id: string, decided_by: string, reason?: string): ApprovalItem {
    const leadId = this.requireLeadId(lead_id, "reject");
    const decidedBy = this.requireDecidedBy(decided_by, "reject");
    const draft = this.draftsById.get(leadId);
    if (draft === undefined) {
      throw new ScoutValidationError(`未找到 lead ${leadId} 的外联草稿：不能驳回不存在的草稿`);
    }
    const decision: Decision = {
      status: "rejected",
      decided_by: decidedBy,
      decided_at: this.nowIso(),
    };
    const note = typeof reason === "string" ? reason.trim() : "";
    if (note.length > 0) decision.reason = note;
    this.decisions.set(leadId, decision);
    return this.composeApprovalItem(draft);
  }

  // -------------------------------------------------------------------------
  // 5) 发送状态机（只记状态，不真正外发）
  // -------------------------------------------------------------------------

  /** 是否可发送：必须已 approved、未退订、未发送过；否则 false。 */
  canSend(lead_id: string): boolean {
    const leadId = asString(lead_id).trim();
    if (leadId.length === 0) return false;
    if (this.unsubscribed.has(leadId)) return false;
    if (this.sentRecords.some((record) => record.lead_id === leadId)) return false;
    return this.decisions.get(leadId)?.status === "approved";
  }

  /**
   * 记录“已发送”状态（**不产生任何网络调用**）。
   * 硬约束：已 approved、未退订、未发送过、且当日该渠道未达上限（默认 10），否则抛错。
   */
  markSent(lead_id: string): void {
    const leadId = this.requireLeadId(lead_id, "markSent");

    if (this.unsubscribed.has(leadId)) {
      throw new ScoutComplianceError(
        `线索 ${leadId} 已退订，禁止继续触达（退订即停止，不做任何例外）`,
        "UNSUBSCRIBED",
      );
    }

    const decision = this.decisions.get(leadId);
    if (decision === undefined || decision.status !== "approved") {
      throw new ScoutComplianceError(
        `线索 ${leadId} 未获人工审批（当前 ${decision?.status ?? "未入队"}），严禁自动发送`,
        "NOT_APPROVED",
      );
    }

    if (this.sentRecords.some((record) => record.lead_id === leadId)) {
      throw new ScoutComplianceError(
        `线索 ${leadId} 已记录发送，禁止重复触达（不做骚扰式跟进）`,
        "ALREADY_SENT",
      );
    }

    const now = this.currentDate();
    const iso = now.toISOString();
    const dateKey = iso.slice(0, 10);
    const channel = this.channelOf(leadId);
    const sentToday = this.sentRecords.filter(
      (record) => record.channel === channel && record.date === dateKey,
    ).length;
    if (sentToday >= this.dailyPerChannelLimit) {
      throw new ScoutComplianceError(
        `渠道 ${channel} 今日已记录 ${sentToday} 条，达到每日上限 ${this.dailyPerChannelLimit}，拒绝继续发送`,
        "DAILY_LIMIT_EXCEEDED",
      );
    }

    this.sentRecords.push({ lead_id: leadId, channel, at: iso, date: dateKey });
  }

  /** 记录退订：之后 canSend 恒为 false，markSent 抛 ScoutComplianceError。 */
  unsubscribe(lead_id: string, note?: string): void {
    const leadId = this.requireLeadId(lead_id, "unsubscribe");
    const record: UnsubscribeRecord = { at: this.nowIso() };
    const text = typeof note === "string" ? note.trim() : "";
    if (text.length > 0) record.note = text;
    this.unsubscribed.set(leadId, record);
  }

  /** 记录一次回复（按线索去重计数，同一线索多次回复只算 1 条线索）。 */
  addReply(lead_id: string): void {
    this.replied.add(this.requireLeadId(lead_id, "addReply"));
  }

  /** 记录一次会议/约聊（按线索去重计数）。 */
  addMeeting(lead_id: string): void {
    this.met.add(this.requireLeadId(lead_id, "addMeeting"));
  }

  // -------------------------------------------------------------------------
  // 6) 周报 / 离线报告
  // -------------------------------------------------------------------------

  /** 生成 ScoutReport（会物化 A7 的 3 条草稿，保证报告与草稿/审批队列一致）。 */
  buildReport(): ScoutReport {
    this.drafts();
    const scored = this.scoredLeads();
    const allDrafts = Array.from(this.draftsById.values());
    const queue = this.approvalQueue();

    const channels: Record<string, ChannelStats> = {};
    const bump = (channel: string, field: "drafts" | "sent"): void => {
      const key = channel.length > 0 ? channel : "unknown";
      const stats = channels[key] ?? { drafts: 0, sent: 0 };
      stats[field] += 1;
      channels[key] = stats;
    };
    for (const draft of allDrafts) bump(draft.channel, "drafts");
    for (const record of this.sentRecords) bump(record.channel, "sent");

    return {
      generated_at: this.nowIso(),
      icp: this.buildIcp(),
      scenarios: this.listScenarios(),
      leads_total: this.leads.length,
      leads_discarded: this.rejectedList.length,
      qualified_count: scored.filter((lead) => lead.qualified).length,
      drafts_count: allDrafts.length,
      pending_approval: queue.filter((item) => item.status === "pending").length,
      sent_count: this.sentRecords.length,
      replies: this.replied.size,
      meetings: this.met.size,
      rejected_reasons: this.rejectedList.map((entry) =>
        entry.lead_id !== undefined
          ? { lead_id: entry.lead_id, reason: entry.reason }
          : { reason: entry.reason },
      ),
      channels,
      daily_limit_per_channel: this.dailyPerChannelLimit,
    };
  }

  // -------------------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------------------

  private requireLeadId(value: unknown, action: string): string {
    const leadId = asString(value).trim();
    if (leadId.length === 0) throw new ScoutValidationError(`${action} 需要非空 lead_id`);
    return leadId;
  }

  private requireDecidedBy(value: unknown, action: string): string {
    const decidedBy = asString(value).trim();
    if (decidedBy.length === 0) {
      throw new ScoutValidationError(`${action} 需要人工审批人 decided_by（不允许自动审批/自动发送）`);
    }
    return decidedBy;
  }

  private currentDate(): Date {
    const date = this.nowFn();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new ScoutValidationError("注入的 now() 必须返回合法 Date");
    }
    return date;
  }

  private nowIso(): string {
    return this.currentDate().toISOString();
  }

  /** 发送渠道：优先草稿渠道，其次原始线索渠道。 */
  private channelOf(leadId: string): string {
    const draft = this.draftsById.get(leadId);
    if (draft !== undefined && draft.channel.length > 0) return draft.channel;
    const lead = this.leadsById.get(leadId);
    const channel = asString(lead?.channel).trim();
    return channel.length > 0 ? channel : "unknown";
  }
}
