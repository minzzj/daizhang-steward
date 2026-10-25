/**
 * DomainEngine：阶段二 P1「经营域」核心引擎（个人版 MVP）。
 *
 * 设计约束：
 * - 纯逻辑、零第三方依赖：只用 Node 内置 `node:fs` / `node:crypto` / `node:path`；
 *   不联网、不启动进程、不接触真实资金/平台账号。
 * - 持久化：`<root>/domain/state.json`（tmp+rename 原子写）+ `<root>/domain/events.jsonl`
 *   （只追加审计：时间/操作/对象/结果/证据引用，原文脱敏）。`{persist:false}` 纯内存。
 * - 安全默认：接管态（halted）下所有写操作抛 `SystemHaltedError`；审批超时挂起不自动放行；
 *   四类越界请求 100% deny；账本必须有 6 要素；未授权承诺不可追溯为授权。
 * - 同步 API：状态为本地小 JSON，便于 CLI/控制台直接调用（无异步竞态）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

import { BoundaryDeniedError, DomainValidationError, SystemHaltedError } from "./errors.js";
import { boundaryRuleCount, digestBoundaryText, evaluateBoundary, listBoundaryRules } from "./boundary.js";
import type { BoundaryContext } from "./boundary.js";
import { DEFAULT_BUSINESS_LINES, DEFAULT_CUSTOMER_INQUIRY, SIMULATED_HUMAN_APPROVER, defaultMandateInput } from "./fixtures.js";
import type {
  ActionCard,
  AddTaskInput,
  AgentRole,
  ApprovalCard,
  ApprovalCardStatus,
  ApprovalDecision,
  ApprovalKind,
  BoundaryCheckRequest,
  BoundaryCheckResult,
  BoundaryRequestKind,
  BudgetCheckResult,
  BudgetKind,
  BudgetSnapshot,
  BusinessLine,
  BusinessLineProposal,
  BusinessLineSource,
  ComplianceEvent,
  Confidence,
  CreateApprovalCardInput,
  CreateMandateInput,
  DomainEngineOptions,
  DomainEvent,
  Evidence,
  EvidenceInput,
  EvidenceKind,
  LedgerEntry,
  LedgerFacts,
  LedgerFilter,
  LedgerType,
  Mandate,
  MandateBudgetLimits,
  MonthlyReport,
  Project,
  ProjectSummary,
  ProposalOptions,
  ProposalRejected,
  ProposalDocument,
  PromiseRecord,
  PromiseTrace,
  RecordLedgerInput,
  SimulatedBusinessLineResult,
  SummaryBundle,
  TakeoverPack,
  Task,
  TimelineEntry,
  TimelineKind,
} from "./types.js";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const DOMAIN_STATE_VERSION = 1 as const;
/** 默认审批卡有效期（24h；超时挂起不自动放行）。 */
export const DEFAULT_APPROVAL_TTL_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIDENCES: readonly Confidence[] = ["certain", "probable", "unknown", "tombstone"];
const AGENT_ROLES: readonly AgentRole[] = ["conductor", "developer", "customer", "finance", "content", "research"];
const EVIDENCE_KINDS: readonly EvidenceKind[] = ["screenshot", "log", "email", "receipt", "delivery", "invoice", "commit"];
const LEDGER_TYPES: readonly LedgerType[] = ["income", "expense", "refund", "receivable", "invoice"];
const BUDGET_KINDS: readonly BudgetKind[] = ["expense", "payment", "refund"];
const APPROVAL_KINDS: readonly ApprovalKind[] = ["payment", "quote", "contract", "handoff", "exception"];
const APPROVAL_DECISIONS: readonly ApprovalDecision[] = ["approve", "reject"];

const CERTAINTY_RANK: Record<Confidence, number> = { certain: 3, probable: 2, unknown: 1, tombstone: 0 };

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/** YYYY-MM（本地时区无关：用 ISO 串前 7 位）。 */
function formatMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, message?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(message ?? `${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string, options: { min?: number; max?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainValidationError(`${field} 必须是有限数字`, "INVALID_INPUT", field);
  }
  if (options.min !== undefined && value < options.min) {
    throw new DomainValidationError(`${field} 必须 ≥ ${options.min}`, "INVALID_INPUT", field);
  }
  if (options.max !== undefined && value > options.max) {
    throw new DomainValidationError(`${field} 必须 ≤ ${options.max}`, "INVALID_INPUT", field);
  }
  return value;
}

function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(`${field} 必须是 ISO 时间字符串`, "INVALID_INPUT", field);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new DomainValidationError(`${field} 不是合法时间`, "INVALID_INPUT", field);
  return new Date(parsed).toISOString();
}

function requireStringArray(value: unknown, field: string, options: { min?: number } = {}): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError(`${field} 必须是字符串数组`, "INVALID_INPUT", field);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new DomainValidationError(`${field} 含空/非字符串项`, "INVALID_INPUT", field);
    }
    out.push(item.trim());
  }
  const min = options.min ?? 0;
  if (out.length < min) throw new DomainValidationError(`${field} 至少需要 ${min} 项`, "INVALID_INPUT", field);
  return out;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new DomainValidationError(`${field} 取值非法：${String(value)}（允许 ${allowed.join("/")}）`, "INVALID_INPUT", field);
  }
  return value as T;
}

function normalizeBudgetLimits(raw: unknown): MandateBudgetLimits {
  if (!isRecord(raw)) throw new DomainValidationError("budget_limits 必须是对象", "INVALID_INPUT", "budget_limits");
  const month = round2(requireNumber(raw.month_cny, "budget_limits.month_cny", { min: 0.01 }));
  const project = round2(requireNumber(raw.project_cny, "budget_limits.project_cny", { min: 0.01 }));
  const perTxn = round2(requireNumber(raw.per_txn_cny, "budget_limits.per_txn_cny", { min: 0.01 }));
  if (perTxn > project) {
    throw new DomainValidationError("预算三层必须满足 单笔 ≤ 项目 ≤ 月", "INVALID_INPUT", "budget_limits");
  }
  if (project > month) {
    throw new DomainValidationError("预算三层必须满足 单笔 ≤ 项目 ≤ 月", "INVALID_INPUT", "budget_limits");
  }
  return { month_cny: month, project_cny: project, per_txn_cny: perTxn };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function sanitizeDetail(detail: string): string {
  return String(detail)
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "sk-[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]{8,}/gu, "ghp_[REDACTED]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/gu, "[REDACTED-HEX]")
    .slice(0, 500);
}

function excerpt(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function compareBusinessLines(a: BusinessLine, b: BusinessLine): number {
  const rateA = a.gross_margin_rate ?? 0;
  const rateB = b.gross_margin_rate ?? 0;
  if (Math.abs(rateB - rateA) > 1e-9) return rateB - rateA;
  const certaintyDiff = CERTAINTY_RANK[b.certainty ?? "probable"] - CERTAINTY_RANK[a.certainty ?? "probable"];
  if (certaintyDiff !== 0) return certaintyDiff;
  return (b.gross_margin ?? 0) - (a.gross_margin ?? 0);
}

type CandidateResult =
  | { ok: true; line: BusinessLine }
  | { ok: false; rejected: ProposalRejected };

/** 业务线归一化 + 选题三类校验（缺来源/超预算/转人工）。 */
function normalizeCandidate(raw: unknown, options: { budget_cny: number; days: number }): CandidateResult {
  if (!isRecord(raw)) {
    return { ok: false, rejected: { reason: "业务线必须是对象", category: "invalid" } };
  }
  const idRaw = typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id.trim() : "";
  const nameRaw = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : "";
  const base: { id?: string; name?: string } = {};
  if (idRaw !== "") base.id = idRaw;
  if (nameRaw !== "") base.name = nameRaw;

  const sources = raw.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return {
      ok: false,
      rejected: { ...base, reason: "缺少来源证据（sources[] 至少 1 条，title/url 必填）", category: "missing_source" },
    };
  }
  const normalizedSources: BusinessLineSource[] = [];
  for (const source of sources) {
    if (!isRecord(source)) {
      return { ok: false, rejected: { ...base, reason: "来源证据格式非法（需 {title,url}）", category: "missing_source" } };
    }
    const title = typeof source.title === "string" ? source.title.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    if (title === "" || url === "" || !isHttpUrl(url)) {
      return {
        ok: false,
        rejected: { ...base, reason: `来源证据不可打开：${title === "" ? "缺少标题" : url === "" ? "缺少 URL" : `URL 非 http(s)：${url}`}`, category: "missing_source" },
      };
    }
    normalizedSources.push({ title, url });
  }

  if (nameRaw === "") {
    return {
      ok: false,
      rejected: { ...base, reason: "业务线缺少 name", category: "invalid" },
    };
  }
  const whoPays = typeof raw.who_pays === "string" ? raw.who_pays.trim() : "";
  if (whoPays === "") {
    return { ok: false, rejected: { ...base, name: nameRaw, reason: "业务线缺少 who_pays（谁付钱）", category: "invalid" } };
  }
  let quote: number;
  let cost: number;
  try {
    quote = round2(requireNumber(raw.quote_cny, "quote_cny", { min: 0 }));
    cost = round2(requireNumber(raw.cost_cny, "cost_cny", { min: 0 }));
  } catch (error) {
    return { ok: false, rejected: { ...base, name: nameRaw, reason: (error as Error).message, category: "invalid" } };
  }
  const grossMargin = round2(quote - cost);
  const grossMarginRate = quote > 0 ? round4(grossMargin / quote) : 0;
  const worstCase = raw.worst_case_cny === undefined ? cost : round2(requireNumber(raw.worst_case_cny, "worst_case_cny", { min: 0 }));
  const risks = Array.isArray(raw.risks) ? raw.risks.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  const requiresOffline = raw.requires_offline === true;
  const requiresLicense = raw.requires_license === true;
  const certainty: Confidence =
    typeof raw.certainty === "string" && CONFIDENCES.includes(raw.certainty as Confidence)
      ? (raw.certainty as Confidence)
      : "probable";
  const deliveryDays =
    raw.delivery_days === undefined ? undefined : round2(requireNumber(raw.delivery_days, "delivery_days", { min: 0.01 }));

  const id = idRaw === "" ? newId("bl") : idRaw;

  if (requiresLicense) {
    return {
      ok: false,
      rejected: { id, name: nameRaw, reason: "业务需要经营资质，个人模式转人工确认（不得无证经营）", category: "requires_human" },
    };
  }
  if (requiresOffline) {
    return {
      ok: false,
      rejected: { id, name: nameRaw, reason: "业务需要线下到场/面签，转人工处理", category: "requires_human" },
    };
  }
  if (cost > options.budget_cny) {
    return {
      ok: false,
      rejected: { id, name: nameRaw, reason: `启动成本 ¥${cost} 超出选题预算 ¥${options.budget_cny}`, category: "over_budget" },
    };
  }
  if (deliveryDays !== undefined && deliveryDays > options.days) {
    return {
      ok: false,
      rejected: { id, name: nameRaw, reason: `交付周期 ${deliveryDays} 天超出可用窗口 ${options.days} 天`, category: "over_budget" },
    };
  }

  return {
    ok: true,
    line: {
      id,
      name: nameRaw,
      who_pays: whoPays,
      quote_cny: quote,
      cost_cny: cost,
      gross_margin: grossMargin,
      gross_margin_rate: grossMarginRate,
      worst_case_cny: worstCase,
      sources: normalizedSources,
      risks,
      requires_offline: requiresOffline,
      requires_license: requiresLicense,
      certainty,
      ...(deliveryDays === undefined ? {} : { delivery_days: deliveryDays }),
    },
  };
}

function buildProposalDocument(lines: BusinessLine[], budgetCny: number, days: number): ProposalDocument {
  const totalQuote = round2(lines.reduce((sum, line) => sum + line.quote_cny, 0));
  const totalCost = round2(lines.reduce((sum, line) => sum + line.cost_cny, 0));
  const top = lines[0];
  return {
    summary:
      `${days} 天窗口 / 预算 ¥${budgetCny}：已筛出 ${lines.length} 条可执行业务线，` +
      `合计报价 ¥${totalQuote}、交付成本 ¥${totalCost}、预计毛利 ¥${round2(totalQuote - totalCost)}。` +
      (top === undefined ? "" : `建议优先「${top.name}」（毛利率 ${Math.round((top.gross_margin_rate ?? 0) * 100)}%）。`),
    lines: lines.map((line) => clone(line)),
    total_quote_cny: totalQuote,
    total_cost_cny: totalCost,
    expected_margin_cny: round2(totalQuote - totalCost),
  };
}

// ---------------------------------------------------------------------------
// 持久化状态（内部结构，不属于对外契约；对外只看 types.ts）
// ---------------------------------------------------------------------------

interface BudgetState {
  month_key: string;
  spent_cny: number;
  by_project: Record<string, number>;
}

interface DomainState {
  version: typeof DOMAIN_STATE_VERSION;
  created_at: string;
  updated_at: string;
  event_seq: number;
  halted: boolean;
  halted_at: string | null;
  halted_reason: string | null;
  mandates: Mandate[];
  business_lines: BusinessLine[];
  projects: Project[];
  tasks: Task[];
  evidence: Evidence[];
  ledger: LedgerEntry[];
  promises: PromiseRecord[];
  approvals: ApprovalCard[];
  compliance_events: ComplianceEvent[];
  budget: BudgetState;
  last_proposal: BusinessLineProposal | null;
  last_takeover: TakeoverPack | null;
}

function createInitialState(now: Date): DomainState {
  const iso = now.toISOString();
  return {
    version: DOMAIN_STATE_VERSION,
    created_at: iso,
    updated_at: iso,
    event_seq: 0,
    halted: false,
    halted_at: null,
    halted_reason: null,
    mandates: [],
    business_lines: [],
    projects: [],
    tasks: [],
    evidence: [],
    ledger: [],
    promises: [],
    approvals: [],
    compliance_events: [],
    budget: { month_key: formatMonth(now), spent_cny: 0, by_project: {} },
    last_proposal: null,
    last_takeover: null,
  };
}

function normalizeLoadedState(raw: unknown, now: Date): DomainState {
  const initial = createInitialState(now);
  if (!isRecord(raw)) return initial;
  if (raw.version !== DOMAIN_STATE_VERSION) {
    throw new DomainValidationError(
      `不支持的经营域状态版本：${String(raw.version)}（期望 ${DOMAIN_STATE_VERSION}）`,
      "INVALID_INPUT",
      "state.version",
    );
  }
  const state: DomainState = { ...initial };
  if (typeof raw.created_at === "string") state.created_at = raw.created_at;
  if (typeof raw.updated_at === "string") state.updated_at = raw.updated_at;
  if (typeof raw.event_seq === "number" && Number.isFinite(raw.event_seq) && raw.event_seq >= 0) state.event_seq = raw.event_seq;
  state.halted = raw.halted === true;
  if (typeof raw.halted_at === "string") state.halted_at = raw.halted_at;
  if (typeof raw.halted_reason === "string") state.halted_reason = raw.halted_reason;
  const arrays: Array<keyof Pick<DomainState, "mandates" | "business_lines" | "projects" | "tasks" | "evidence" | "ledger" | "promises" | "approvals" | "compliance_events">> = [
    "mandates",
    "business_lines",
    "projects",
    "tasks",
    "evidence",
    "ledger",
    "promises",
    "approvals",
    "compliance_events",
  ];
  for (const key of arrays) {
    const value = raw[key];
    if (!Array.isArray(value)) continue;
    switch (key) {
      case "mandates":
        state.mandates = value as Mandate[];
        break;
      case "business_lines":
        state.business_lines = value as BusinessLine[];
        break;
      case "projects":
        state.projects = value as Project[];
        break;
      case "tasks":
        state.tasks = value as Task[];
        break;
      case "evidence":
        state.evidence = value as Evidence[];
        break;
      case "ledger":
        state.ledger = value as LedgerEntry[];
        break;
      case "promises":
        state.promises = value as PromiseRecord[];
        break;
      case "approvals":
        state.approvals = value as ApprovalCard[];
        break;
      case "compliance_events":
        state.compliance_events = value as ComplianceEvent[];
        break;
    }
  }
  if (isRecord(raw.budget)) {
    const budget = raw.budget;
    const monthKey = typeof budget.month_key === "string" && budget.month_key !== "" ? budget.month_key : formatMonth(now);
    const spent = typeof budget.spent_cny === "number" && Number.isFinite(budget.spent_cny) ? budget.spent_cny : 0;
    const byProject: Record<string, number> = {};
    if (isRecord(budget.by_project)) {
      for (const [projectId, amount] of Object.entries(budget.by_project)) {
        if (typeof amount === "number" && Number.isFinite(amount)) byProject[projectId] = amount;
      }
    }
    state.budget = { month_key: monthKey, spent_cny: spent, by_project: byProject };
  }
  state.last_proposal = isRecord(raw.last_proposal) ? (raw.last_proposal as unknown as BusinessLineProposal) : null;
  state.last_takeover = isRecord(raw.last_takeover) ? (raw.last_takeover as unknown as TakeoverPack) : null;
  return state;
}

// ---------------------------------------------------------------------------
// DomainEngine
// ---------------------------------------------------------------------------

/**
 * 经营域引擎。
 *
 * ```ts
 * const engine = new DomainEngine({ root: "<仓库根>" }); // 或 { persist: false }
 * engine.createMandate({ ... });            // 委托
 * const proposal = engine.proposeBusinessLines(lines, { budget_cny: 50000, days: 30 });
 * const project = engine.createProject(proposal.ranked[0]);
 * engine.checkBudget("expense", 3000, project.id);
 * const report = engine.buildMonthlyReport("2026-10");
 * ```
 */
export class DomainEngine {
  readonly root: string | null;
  readonly persist: boolean;
  readonly statePath: string | null;
  readonly eventsPath: string | null;

  private readonly now: () => Date;
  private readonly credentials: string[];
  private state: DomainState;

  constructor(options: DomainEngineOptions = {}) {
    const optionsValue = isRecord(options) ? options : {};
    this.now = typeof optionsValue.now === "function" ? (optionsValue.now as () => Date) : () => new Date();
    const root = typeof optionsValue.root === "string" && optionsValue.root.trim() !== "" ? optionsValue.root.trim() : null;
    const persistFlag = optionsValue.persist;
    this.persist = persistFlag === false ? false : persistFlag === true ? true : root !== null;
    if (this.persist && root === null) {
      throw new DomainValidationError("persist=true 时必须提供 root", "INVALID_INPUT", "root");
    }
    this.root = root;
    this.statePath = this.persist && root !== null ? join(root, "domain", "state.json") : null;
    this.eventsPath = this.persist && root !== null ? join(root, "domain", "events.jsonl") : null;
    this.credentials = Array.isArray(optionsValue.credentials)
      ? optionsValue.credentials.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
      : [];

    if (this.statePath !== null && existsSync(this.statePath)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(this.statePath, "utf8"));
      } catch (error) {
        throw new DomainValidationError(
          `经营域状态文件损坏：${this.statePath}（${(error as Error).message}）`,
          "INVALID_INPUT",
          "state",
        );
      }
      this.state = normalizeLoadedState(parsed, this.now());
    } else {
      this.state = createInitialState(this.now());
      if (this.persist) this.commit();
    }
  }

  // -------------------------------------------------------------------------
  // 只读状态
  // -------------------------------------------------------------------------

  get isHalted(): boolean {
    return this.state.halted;
  }

  get haltedReason(): string | null {
    return this.state.halted_reason;
  }

  /** 事件序号（已写入 events.jsonl 的行数；测试/CLI 可用来核对追加）。 */
  get eventCount(): number {
    return this.state.event_seq;
  }

  // -------------------------------------------------------------------------
  // 1) 委托
  // -------------------------------------------------------------------------

  createMandate(input: CreateMandateInput): Mandate {
    this.assertNotHalted("createMandate");
    if (!isRecord(input)) throw new DomainValidationError("createMandate 需要输入对象", "INVALID_INPUT", "input");
    const principal = requireString(input.principal, "principal");
    const scope = requireStringArray(input.scope, "scope", { min: 1 });
    const prohibited = input.prohibited === undefined ? [] : requireStringArray(input.prohibited, "prohibited");
    const budgetLimits = normalizeBudgetLimits(input.budget_limits);
    const now = this.now();
    const validFrom = input.valid_from === undefined ? now.toISOString() : requireIsoDate(input.valid_from, "valid_from");
    const validTo =
      input.valid_to === undefined ? new Date(now.getTime() + 365 * DAY_MS).toISOString() : requireIsoDate(input.valid_to, "valid_to");
    if (Date.parse(validTo) <= Date.parse(validFrom)) {
      throw new DomainValidationError("valid_to 必须晚于 valid_from", "INVALID_INPUT", "valid_to");
    }
    const confidence = input.confidence === undefined ? "certain" : requireEnum(input.confidence, CONFIDENCES, "confidence");

    for (const existing of this.state.mandates) {
      if (existing.status === "active") {
        existing.status = "revoked";
        existing.revoked_at = now.toISOString();
        existing.revoked_reason = "被新委托替代";
        this.recordEvent("mandate.revoke", "mandate", existing.id, "ok", { detail: "superseded_by_new_mandate" });
      }
    }

    const mandate: Mandate = {
      id: newId("mand"),
      principal,
      scope,
      valid_from: validFrom,
      valid_to: validTo,
      budget_limits: budgetLimits,
      prohibited,
      status: now.getTime() < Date.parse(validFrom) ? "expired" : "active",
      confidence,
      created_at: now.toISOString(),
    };
    this.state.mandates.push(mandate);
    this.recordEvent("mandate.create", "mandate", mandate.id, "ok", {
      detail: `principal=${principal}; scope=${scope.length} 条; 月=${budgetLimits.month_cny}; 项目=${budgetLimits.project_cny}; 单笔=${budgetLimits.per_txn_cny}`,
    });
    this.commit();
    return clone(mandate);
  }

  /** 当前生效委托（有效期内且 active）；顺带把过期的置为 expired。 */
  activeMandate(): Mandate | null {
    const now = this.now();
    let changed = false;
    for (const mandate of this.state.mandates) {
      if (mandate.status === "active" && now.getTime() > Date.parse(mandate.valid_to)) {
        mandate.status = "expired";
        this.recordEvent("mandate.expire", "mandate", mandate.id, "ok", { detail: `valid_to=${mandate.valid_to}` });
        changed = true;
      }
    }
    const active =
      [...this.state.mandates]
        .reverse()
        .find(
          (mandate) =>
            mandate.status === "active" &&
            Date.parse(mandate.valid_from) <= now.getTime() &&
            now.getTime() <= Date.parse(mandate.valid_to),
        ) ?? null;
    if (changed) this.commit();
    return active === null ? null : clone(active);
  }

  /** 吊销当前生效委托（需 human 显式调用；吊销后承诺追溯会判失效）。 */
  revokeMandate(reason: string): Mandate {
    this.assertNotHalted("revokeMandate");
    const reasonValue = requireString(reason, "reason");
    const mandate = this.activeMandateInternal();
    if (mandate === null) throw new DomainValidationError("没有生效中的委托可吊销", "NOT_FOUND", "mandate");
    mandate.status = "revoked";
    mandate.revoked_at = this.now().toISOString();
    mandate.revoked_reason = reasonValue;
    this.recordEvent("mandate.revoke", "mandate", mandate.id, "ok", { detail: `reason=${reasonValue}` });
    this.commit();
    return clone(mandate);
  }

  // -------------------------------------------------------------------------
  // 2) 选题
  // -------------------------------------------------------------------------

  proposeBusinessLines(lines: BusinessLine[], options: ProposalOptions): BusinessLineProposal {
    this.assertNotHalted("proposeBusinessLines");
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new DomainValidationError("proposeBusinessLines 需要至少 1 条候选业务线", "INVALID_INPUT", "lines");
    }
    if (!isRecord(options)) throw new DomainValidationError("proposeBusinessLines 需要 {budget_cny, days}", "INVALID_INPUT", "options");
    const budgetCny = round2(requireNumber(options.budget_cny, "budget_cny", { min: 0.01 }));
    const days = requireNumber(options.days, "days", { min: 1 });

    const accepted: BusinessLine[] = [];
    const rejected: ProposalRejected[] = [];
    const needsHuman: ProposalRejected[] = [];
    for (const raw of lines) {
      const normalized = normalizeCandidate(raw, { budget_cny: budgetCny, days });
      if (normalized.ok) {
        accepted.push(normalized.line);
        continue;
      }
      if (normalized.rejected.category === "requires_human") needsHuman.push(normalized.rejected);
      else rejected.push(normalized.rejected);
    }

    for (const line of accepted) {
      const index = this.state.business_lines.findIndex((existing) => existing.id === line.id);
      if (index >= 0) this.state.business_lines[index] = clone(line);
      else this.state.business_lines.push(clone(line));
    }

    const ranked = [...accepted].sort(compareBusinessLines);
    const proposal = accepted.length >= 3 ? buildProposalDocument(ranked, budgetCny, days) : null;
    const result: BusinessLineProposal = {
      generated_at: this.now().toISOString(),
      budget_cny: budgetCny,
      days,
      accepted: accepted.map((line) => clone(line)),
      rejected: clone(rejected),
      needs_human: clone(needsHuman),
      ranked: ranked.map((line) => clone(line)),
      proposal: proposal === null ? null : clone(proposal),
    };
    this.state.last_proposal = clone(result);
    const proposalId = `proposal-${this.state.event_seq + 1}`;
    this.recordEvent("proposal.generate", "business_line_proposal", proposalId, "ok", {
      detail: `accepted=${accepted.length}; rejected=${rejected.length}; needs_human=${needsHuman.length}; proposal=${proposal === null ? "none" : "ready"}`,
    });
    this.commit();
    return result;
  }

  /** 已登记的可选业务线（含仿真 fixture 与历史提案中合格的）。 */
  businessLines(): BusinessLine[] {
    return this.state.business_lines.map((line) => clone(line)).sort((a, b) => a.name.localeCompare(b.name));
  }

  // -------------------------------------------------------------------------
  // 3) 预算三层
  // -------------------------------------------------------------------------

  /**
   * 预算三层校验：单笔 → 项目 → 月；任一层超限 → allowed:false + requiresHumanApproval:true。
   * 通过则记录消耗（月/项目两层分别累计）。
   */
  checkBudget(kind: BudgetKind, amountCny: number, projectId?: string): BudgetCheckResult {
    this.assertNotHalted("checkBudget");
    const kindValue = requireEnum(kind, BUDGET_KINDS, "kind");
    const amount = round2(requireNumber(amountCny, "amount_cny", { min: 0.01 }));
    const mandate = this.activeMandate();
    if (mandate === null) {
      return {
        allowed: false,
        requiresHumanApproval: true,
        amount_cny: amount,
        reason: "没有生效中的委托（Mandate），无法支出；请先创建委托。",
      };
    }
    this.resetBudgetIfNewMonth();
    const limits = mandate.budget_limits;
    const projectIdValue = projectId === undefined ? undefined : requireString(projectId, "project_id");
    let projectSpent = 0;
    if (projectIdValue !== undefined) {
      this.requireProject(projectIdValue);
      projectSpent = round2(this.state.budget.by_project[projectIdValue] ?? 0);
    }
    const preRemaining = {
      month_cny: round2(Math.max(0, limits.month_cny - this.state.budget.spent_cny)),
      project_cny: round2(Math.max(0, limits.project_cny - projectSpent)),
      per_txn_cny: limits.per_txn_cny,
    };

    if (amount > limits.per_txn_cny + 1e-9) {
      return {
        allowed: false,
        requiresHumanApproval: true,
        amount_cny: amount,
        reason: `单笔额度超限：申请 ¥${amount} > 单笔上限 ¥${limits.per_txn_cny}（委托 ${mandate.id}）`,
        layer: "per_txn",
        remaining: preRemaining,
      };
    }
    if (projectIdValue !== undefined && projectSpent + amount > limits.project_cny + 1e-9) {
      return {
        allowed: false,
        requiresHumanApproval: true,
        amount_cny: amount,
        reason: `项目额度超限：项目已占用 ¥${projectSpent} + 本次 ¥${amount} > 项目上限 ¥${limits.project_cny}`,
        layer: "project",
        remaining: preRemaining,
      };
    }
    if (this.state.budget.spent_cny + amount > limits.month_cny + 1e-9) {
      return {
        allowed: false,
        requiresHumanApproval: true,
        amount_cny: amount,
        reason: `本月额度超限：已支出 ¥${this.state.budget.spent_cny} + 本次 ¥${amount} > 月上限 ¥${limits.month_cny}`,
        layer: "month",
        remaining: preRemaining,
      };
    }

    this.state.budget.spent_cny = round2(this.state.budget.spent_cny + amount);
    if (projectIdValue !== undefined) {
      this.state.budget.by_project[projectIdValue] = round2(projectSpent + amount);
    }
    this.recordEvent("budget.consume", "budget", projectIdValue ?? this.state.budget.month_key, "ok", {
      detail: `${kindValue} ¥${amount}${projectIdValue === undefined ? "" : ` project=${projectIdValue}`}`,
    });
    this.commit();
    const postRemaining = {
      month_cny: round2(Math.max(0, limits.month_cny - this.state.budget.spent_cny)),
      project_cny:
        projectIdValue === undefined
          ? round2(limits.project_cny)
          : round2(Math.max(0, limits.project_cny - (this.state.budget.by_project[projectIdValue] ?? 0))),
      per_txn_cny: limits.per_txn_cny,
    };
    return { allowed: true, requiresHumanApproval: false, amount_cny: amount, remaining: postRemaining };
  }

  /** 预算快照（无生效委托 → null；只读，不消耗）。 */
  budgetSnapshot(): BudgetSnapshot | null {
    const mandate = this.activeMandateInternal();
    if (mandate === null) return null;
    if (this.resetBudgetIfNewMonth()) this.commit();
    const limits = mandate.budget_limits;
    return {
      month_key: this.state.budget.month_key,
      month_limit_cny: limits.month_cny,
      month_spent_cny: this.state.budget.spent_cny,
      month_left_cny: round2(Math.max(0, limits.month_cny - this.state.budget.spent_cny)),
      project_limit_cny: limits.project_cny,
      per_txn_limit_cny: limits.per_txn_cny,
    };
  }

  // -------------------------------------------------------------------------
  // 4) 项目 / 任务 / 证据
  // -------------------------------------------------------------------------

  createProject(businessLine: BusinessLine | string, client?: string): Project {
    this.assertNotHalted("createProject");
    const line = this.resolveBusinessLine(businessLine);
    const clientName = client === undefined ? requireString(line.who_pays, "client") : requireString(client, "client");
    const now = this.now();
    const iso = now.toISOString();
    const confidence = line.certainty ?? "probable";
    const project: Project = {
      id: newId("prj"),
      name: line.name,
      business_line_id: line.id,
      client: clientName,
      status: "active",
      timeline: [
        { at: iso, kind: "created", summary: `项目创建：${line.name}（业务线 ${line.id}）`, evidence_ids: [], confidence },
      ],
      created_at: iso,
      updated_at: iso,
      confidence,
    };
    this.state.projects.push(project);
    this.recordEvent("project.create", "project", project.id, "ok", {
      detail: `business_line=${line.id}; client=${clientName}`,
    });
    this.commit();
    return clone(project);
  }

  addTask(input: AddTaskInput): Task {
    this.assertNotHalted("addTask");
    if (!isRecord(input)) throw new DomainValidationError("addTask 需要输入对象", "INVALID_INPUT", "input");
    const projectId = requireString(input.project_id, "project_id");
    const project = this.requireProject(projectId);
    const agentRole = requireEnum(input.agent_role, AGENT_ROLES, "agent_role");
    const goal = requireString(input.goal, "goal");
    const task: Task = {
      id: newId("task"),
      project_id: projectId,
      agent_role: agentRole,
      goal,
      status: "pending",
      evidence: [],
      created_at: this.now().toISOString(),
    };
    this.state.tasks.push(task);
    this.appendTimelineInternal(project, {
      kind: "task",
      summary: `新增任务 [${agentRole}]：${goal}`,
      evidence_ids: [],
      confidence: project.confidence,
    });
    this.recordEvent("task.create", "task", task.id, "ok", { detail: `project=${projectId}; role=${agentRole}` });
    this.commit();
    return clone(task);
  }

  /** 完成任务并登记交付证据（幂等：已完成任务重复调用直接返回，不重复登记）。 */
  completeTask(taskId: string, evidence?: Array<EvidenceInput | Evidence>): Task {
    this.assertNotHalted("completeTask");
    const id = requireString(taskId, "task_id");
    const task = this.requireTask(id);
    if (task.status === "done") return clone(task);
    const project = this.requireProject(task.project_id);
    const evidenceInputs: Array<EvidenceInput | Evidence> = evidence === undefined ? [] : Array.isArray(evidence) ? evidence : [evidence];
    const createdEvidence: Evidence[] = [];
    for (const raw of evidenceInputs) {
      if (!isRecord(raw)) throw new DomainValidationError("evidence 必须是 EvidenceInput 数组", "INVALID_INPUT", "evidence");
      const kind = requireEnum(raw.kind, EVIDENCE_KINDS, "evidence.kind");
      const path = requireString(raw.path, "evidence.path");
      const confidence =
        typeof raw.confidence === "string" ? requireEnum(raw.confidence, CONFIDENCES, "evidence.confidence") : "certain";
      const note = typeof raw.note === "string" ? raw.note.trim() : "";
      const record: Evidence = {
        id: newId("ev"),
        project_id: task.project_id,
        kind,
        path,
        note,
        confidence,
        created_at: this.now().toISOString(),
      };
      this.state.evidence.push(record);
      createdEvidence.push(record);
    }
    task.status = "done";
    task.completed_at = this.now().toISOString();
    task.evidence = createdEvidence.map((record) => record.id);
    this.appendTimelineInternal(project, {
      kind: "task",
      summary: `任务完成 [${task.agent_role}]：${task.goal}`,
      evidence_ids: task.evidence,
      confidence: createdEvidence.length > 0 ? "certain" : "unknown",
    });
    this.recordEvent("task.complete", "task", task.id, "ok", {
      detail: `project=${task.project_id}; evidence=${createdEvidence.length}`,
      evidence_refs: createdEvidence.map((record) => record.path),
    });
    this.commit();
    return clone(task);
  }

  projectTimeline(projectId: string): TimelineEntry[] {
    const project = this.requireProject(requireString(projectId, "project_id"));
    return clone(project.timeline);
  }

  addEvidence(projectId: string, input: EvidenceInput): Evidence {
    this.assertNotHalted("addEvidence");
    const project = this.requireProject(requireString(projectId, "project_id"));
    if (!isRecord(input)) throw new DomainValidationError("addEvidence 需要 EvidenceInput", "INVALID_INPUT", "input");
    const kind = requireEnum(input.kind, EVIDENCE_KINDS, "kind");
    const path = requireString(input.path, "path");
    const confidence = input.confidence === undefined ? "certain" : requireEnum(input.confidence, CONFIDENCES, "confidence");
    const note = typeof input.note === "string" ? input.note.trim() : "";
    const evidence: Evidence = {
      id: newId("ev"),
      project_id: project.id,
      kind,
      path,
      note,
      confidence,
      created_at: this.now().toISOString(),
    };
    this.state.evidence.push(evidence);
    if (confidence !== "tombstone") {
      this.appendTimelineInternal(project, {
        kind: kind === "delivery" ? "delivery" : kind === "invoice" ? "invoice" : "note",
        summary: `证据登记（${kind}）：${note === "" ? path : note}`,
        evidence_ids: [evidence.id],
        confidence,
      });
    }
    this.recordEvent("evidence.add", "evidence", evidence.id, "ok", { detail: `project=${project.id}; kind=${kind}`, evidence_refs: [path] });
    this.commit();
    return clone(evidence);
  }

  /** 证据列表（默认排除墓碑；include_tombstone=true 才含 tombstone 置信度）。 */
  evidence(filter: { project_id?: string; include_tombstone?: boolean } = {}): Evidence[] {
    const projectId = filter.project_id === undefined ? undefined : requireString(filter.project_id, "project_id");
    const includeTombstone = filter.include_tombstone === true;
    return this.state.evidence
      .filter((record) => projectId === undefined || record.project_id === projectId)
      .filter((record) => includeTombstone || record.confidence !== "tombstone")
      .map((record) => clone(record))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /** 墓碑：项目标记为不可逆（不删除历史账本/事件，只标记）。 */
  tombstoneProject(projectId: string, reason = "手动墓碑"): Project {
    this.assertNotHalted("tombstoneProject");
    const project = this.requireProject(requireString(projectId, "project_id"));
    project.status = "tombstoned";
    project.confidence = "tombstone";
    project.updated_at = this.now().toISOString();
    this.appendTimelineInternal(project, {
      kind: "note",
      summary: `墓碑：${reason}`,
      evidence_ids: [],
      confidence: "tombstone",
    });
    this.recordEvent("project.tombstone", "project", project.id, "ok", { detail: `reason=${reason}` });
    this.commit();
    return clone(project);
  }

  /** 墓碑：证据标记为 tombstone（保留 id/路径，默认视图不再展示）。 */
  tombstoneEvidence(evidenceId: string, reason = "手动墓碑"): Evidence {
    this.assertNotHalted("tombstoneEvidence");
    const id = requireString(evidenceId, "evidence_id");
    const record = this.state.evidence.find((item) => item.id === id);
    if (record === undefined) throw new DomainValidationError(`证据不存在：${id}`, "NOT_FOUND", "evidence_id");
    record.confidence = "tombstone";
    record.note = record.note === "" ? `墓碑：${reason}` : `${record.note}（墓碑：${reason}）`;
    this.recordEvent("evidence.tombstone", "evidence", record.id, "ok", { detail: `reason=${reason}` });
    this.commit();
    return clone(record);
  }

  getProject(projectId: string): Project {
    return clone(this.requireProject(requireString(projectId, "project_id")));
  }

  getTask(taskId: string): Task {
    return clone(this.requireTask(requireString(taskId, "task_id")));
  }

  // -------------------------------------------------------------------------
  // 5) 账本
  // -------------------------------------------------------------------------

  /** 记账：payment/income/expense 必须有 basis + approved_by + receipt_ref + 项目关联，缺一即抛错。 */
  recordLedger(input: RecordLedgerInput): LedgerEntry {
    this.assertNotHalted("recordLedger");
    if (!isRecord(input)) throw new DomainValidationError("recordLedger 需要输入对象", "INVALID_INPUT", "input");
    const projectId = requireString(input.project_id, "project_id");
    const project = this.requireProject(projectId);
    const type = requireEnum(input.type, LEDGER_TYPES, "type");
    const amount = round2(requireNumber(input.amount_cny, "amount_cny", { min: 0.01 }));
    const payee = requireString(input.payee_or_payer, "payee_or_payer");
    const basis = requireString(input.basis, "basis", "记账必须有依据（basis：合同/验收单/对话编号等）");
    const approvedBy = requireString(input.approved_by, "approved_by", "记账必须有审批人（approved_by）");
    const receiptRef = requireString(input.receipt_ref, "receipt_ref", "记账必须有回执（receipt_ref：收据/流水号/发票号）");
    const occurredAt = input.occurred_at === undefined ? this.now().toISOString() : requireIsoDate(input.occurred_at, "occurred_at");
    const confidence = input.confidence === undefined ? "certain" : requireEnum(input.confidence, CONFIDENCES, "confidence");

    if (input.allow_duplicate !== true) {
      const duplicate = this.state.ledger.find(
        (entry) => entry.project_id === projectId && entry.type === type && entry.receipt_ref === receiptRef,
      );
      if (duplicate !== undefined) {
        throw new DomainValidationError(
          `重复记账：回执 ${receiptRef} 已存在同项目同类型条目 ${duplicate.id}（账本不重复）`,
          "DUPLICATE",
          "receipt_ref",
        );
      }
    }

    const entry: LedgerEntry = {
      id: newId("led"),
      project_id: projectId,
      type,
      amount_cny: amount,
      payee_or_payer: payee,
      basis,
      approved_by: approvedBy,
      receipt_ref: receiptRef,
      occurred_at: occurredAt,
      confidence,
      created_at: this.now().toISOString(),
    };
    this.state.ledger.push(entry);
    const timelineKind: TimelineKind = type === "income" ? "income" : type === "invoice" ? "invoice" : "note";
    this.appendTimelineInternal(project, {
      kind: timelineKind,
      summary: `账本记录（${type}）：¥${amount} ${type === "income" ? "来自" : "付给"} ${payee}（回执 ${receiptRef}）`,
      evidence_ids: [],
      confidence,
    });
    this.recordEvent("ledger.record", "ledger", entry.id, "ok", {
      detail: `type=${type}; amount=${amount}; payee=${payee}; ref=${receiptRef}`,
      evidence_refs: [receiptRef],
    });
    this.commit();
    return clone(entry);
  }

  /** 账本 6 要素（验收 B2）。 */
  ledgerEntryFacts(entryId: string): LedgerFacts {
    const id = requireString(entryId, "entry_id");
    const entry = this.state.ledger.find((item) => item.id === id);
    if (entry === undefined) throw new DomainValidationError(`账本条目不存在：${id}`, "NOT_FOUND", "entry_id");
    return {
      entry_id: entry.id,
      amount_cny: entry.amount_cny,
      payee_or_payer: entry.payee_or_payer,
      basis: entry.basis,
      approved_by: entry.approved_by,
      receipt_ref: entry.receipt_ref,
      project_id: entry.project_id,
    };
  }

  ledger(filter: LedgerFilter = {}): LedgerEntry[] {
    const projectId = filter.project_id === undefined ? undefined : requireString(filter.project_id, "project_id");
    const type = filter.type === undefined ? undefined : requireEnum(filter.type, LEDGER_TYPES, "type");
    const month = filter.month === undefined ? undefined : requireMonth(filter.month);
    return this.state.ledger
      .filter((entry) => projectId === undefined || entry.project_id === projectId)
      .filter((entry) => type === undefined || entry.type === type)
      .filter((entry) => month === undefined || entry.occurred_at.slice(0, 7) === month)
      .map((entry) => clone(entry))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  /** 导出账本 CSV（6 要素 + 类型/时间/置信度；可直接给财务对账）。 */
  exportLedgerCsv(): string {
    const header = [
      "entry_id",
      "project_id",
      "type",
      "amount_cny",
      "payee_or_payer",
      "basis",
      "approved_by",
      "receipt_ref",
      "occurred_at",
      "confidence",
    ].join(",");
    const rows = this.ledger({}).map((entry) =>
      [
        entry.id,
        entry.project_id,
        entry.type,
        entry.amount_cny.toFixed(2),
        entry.payee_or_payer,
        entry.basis,
        entry.approved_by,
        entry.receipt_ref,
        entry.occurred_at,
        entry.confidence,
      ]
        .map(csvCell)
        .join(","),
    );
    return [header, ...rows].join("\n") + "\n";
  }

  // -------------------------------------------------------------------------
  // 6) 承诺追溯（B5）
  // -------------------------------------------------------------------------

  recordPromise(projectId: string, text: string, sourceMessageId: string, mandateClause: string): PromiseRecord {
    this.assertNotHalted("recordPromise");
    const project = this.requireProject(requireString(projectId, "project_id"));
    const promiseText = requireString(text, "text");
    const sourceId = requireString(sourceMessageId, "source_message_id", "承诺必须能指向对话原文（source_message_id）");
    const clause = requireString(mandateClause, "mandate_clause", "承诺必须能指向委托授权条款（mandate_clause）");
    const mandate = this.activeMandateInternal();
    const authorized =
      mandate !== null &&
      mandateClauseCovered(mandate, clause) &&
      !mandateProhibits(mandate, promiseText);
    const record: PromiseRecord = {
      id: newId("prm"),
      project_id: project.id,
      text: promiseText,
      source_message_id: sourceId,
      mandate_clause: clause,
      mandate_id: mandate === null ? null : mandate.id,
      status: authorized ? "authorized" : "unauthorized",
      created_at: this.now().toISOString(),
    };
    this.state.promises.push(record);
    this.appendTimelineInternal(project, {
      kind: "promise",
      summary: `承诺记录（${record.status}）：${excerpt(promiseText, 40)}（原文 ${sourceId}）`,
      evidence_ids: [],
      confidence: authorized ? "certain" : "unknown",
    });
    this.recordEvent("promise.record", "promise", record.id, authorized ? "ok" : "denied", {
      detail: `project=${project.id}; source=${sourceId}; clause_covered=${authorized}`,
    });
    this.commit();
    return clone(record);
  }

  /** 追溯承诺：找到 → 链路；找不到/未授权/委托失效 → {authorized:false, reason:"未授权"}（B5）。 */
  tracePromise(promiseId: string): PromiseTrace {
    if (typeof promiseId !== "string" || promiseId.trim() === "") return { authorized: false, reason: "未授权" };
    const record = this.state.promises.find((item) => item.id === promiseId.trim());
    if (record === undefined) return { authorized: false, reason: "未授权" };
    if (record.status !== "authorized") {
      return { authorized: false, reason: "未授权", promise_id: record.id, project_id: record.project_id };
    }
    const mandate = record.mandate_id === null ? undefined : this.state.mandates.find((item) => item.id === record.mandate_id);
    if (mandate === undefined || mandate.status !== "active" || Date.parse(mandate.valid_to) < this.now().getTime()) {
      return { authorized: false, reason: "未授权（委托已失效）", promise_id: record.id, project_id: record.project_id };
    }
    return {
      authorized: true,
      promise_id: record.id,
      project_id: record.project_id,
      text: record.text,
      source_message_id: record.source_message_id,
      mandate_clause: record.mandate_clause,
      mandate_id: mandate.id,
      chain: [
        `对话原文：${record.source_message_id}`,
        `委托条款：${record.mandate_clause}（委托 ${mandate.id}，授权人 ${mandate.principal}）`,
        `项目：${record.project_id}`,
      ],
    };
  }

  // -------------------------------------------------------------------------
  // 7) 审批（超时挂起不自动放行）
  // -------------------------------------------------------------------------

  createApprovalCard(input: CreateApprovalCardInput): ApprovalCard {
    this.assertNotHalted("createApprovalCard");
    if (!isRecord(input)) throw new DomainValidationError("createApprovalCard 需要输入对象", "INVALID_INPUT", "input");
    const kind = requireEnum(input.kind, APPROVAL_KINDS, "kind");
    const summary = requireString(input.summary, "summary");
    const now = this.now();
    const ttlHours = input.ttl_hours === undefined ? DEFAULT_APPROVAL_TTL_HOURS : requireNumber(input.ttl_hours, "ttl_hours", { min: 0.01 });
    const expiresAt =
      input.expires_at === undefined
        ? new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString()
        : requireIsoDate(input.expires_at, "expires_at");
    if (Date.parse(expiresAt) <= now.getTime()) {
      throw new DomainValidationError("expires_at 必须晚于当前时间", "INVALID_INPUT", "expires_at");
    }
    const amount = input.amount_cny === undefined ? undefined : round2(requireNumber(input.amount_cny, "amount_cny", { min: 0.01 }));
    const evidenceIds = input.evidence_ids === undefined ? [] : requireStringArray(input.evidence_ids, "evidence_ids");
    for (const evidenceId of evidenceIds) {
      if (!this.state.evidence.some((record) => record.id === evidenceId)) {
        throw new DomainValidationError(`审批卡引用的证据不存在：${evidenceId}`, "NOT_FOUND", "evidence_ids");
      }
    }
    const relatedProjectId = input.related_project_id === undefined ? undefined : requireString(input.related_project_id, "related_project_id");
    if (relatedProjectId !== undefined) this.requireProject(relatedProjectId);

    const card: ApprovalCard = {
      id: newId("apr"),
      kind,
      summary,
      evidence_ids: evidenceIds,
      options: ["approve", "reject"],
      expires_at: expiresAt,
      status: "pending",
      created_at: now.toISOString(),
    };
    if (amount !== undefined) card.amount_cny = amount;
    if (relatedProjectId !== undefined) card.related_project_id = relatedProjectId;
    this.state.approvals.push(card);
    if (relatedProjectId !== undefined) {
      const project = this.requireProject(relatedProjectId);
      this.appendTimelineInternal(project, {
        kind: "approval",
        summary: `待审批[${kind}]：${summary}（超时不自动放行）`,
        evidence_ids: evidenceIds,
        confidence: "probable",
      });
    }
    this.recordEvent("approval.create", "approval", card.id, "ok", { detail: `kind=${kind}; expires_at=${expiresAt}` });
    this.commit();
    return clone(card);
  }

  /** 审批决策：approve/reject；已超时 → 置 expired 并返回（不自动放行）。 */
  decideApproval(approvalId: string, decision: ApprovalDecision, by: string): ApprovalCard {
    this.assertNotHalted("decideApproval");
    const id = requireString(approvalId, "approval_id");
    const card = this.requireApproval(id);
    if (card.status !== "pending") {
      if (card.status === "expired") return clone(card);
      throw new DomainValidationError(`审批卡已决策：${card.status}（${id}）`, "INVALID_INPUT", "approval_id");
    }
    const decisionValue = requireEnum(decision, APPROVAL_DECISIONS, "decision");
    const decidedBy = requireString(by, "by", "审批必须记录决策人（by）");
    const now = this.now();
    if (now.getTime() > Date.parse(card.expires_at)) {
      card.status = "expired";
      card.decided_at = now.toISOString();
      this.recordEvent("approval.expired", "approval", card.id, "denied", { detail: `expires_at=${card.expires_at}` });
      this.commit();
      return clone(card);
    }
    card.status = decisionValue === "approve" ? "approved" : "rejected";
    card.decided_by = decidedBy;
    card.decided_at = now.toISOString();
    if (card.related_project_id !== undefined) {
      const project = this.state.projects.find((item) => item.id === card.related_project_id);
      if (project !== undefined) {
        this.appendTimelineInternal(project, {
          kind: "approval",
          summary: `审批${card.status === "approved" ? "通过" : "驳回"} [${card.kind}]：${card.summary}（by ${decidedBy}）`,
          evidence_ids: card.evidence_ids,
          confidence: "certain",
        });
      }
    }
    this.recordEvent(`approval.${card.status}`, "approval", card.id, "ok", { detail: `by=${decidedBy}; kind=${card.kind}` });
    this.commit();
    return clone(card);
  }

  /** 待审批队列：顺手把超时卡置为 expired（挂起，不自动放行）。 */
  approvalQueue(): ApprovalCard[] {
    const now = this.now();
    let changed = false;
    for (const card of this.state.approvals) {
      if (card.status === "pending" && now.getTime() > Date.parse(card.expires_at)) {
        card.status = "expired";
        card.decided_at = now.toISOString();
        this.recordEvent("approval.expired", "approval", card.id, "denied", { detail: `expires_at=${card.expires_at}` });
        changed = true;
      }
    }
    if (changed) this.commit();
    return this.state.approvals
      .filter((card) => card.status === "pending")
      .map((card) => clone(card))
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  }

  getApproval(approvalId: string): ApprovalCard {
    return clone(this.requireApproval(requireString(approvalId, "approval_id")));
  }

  // -------------------------------------------------------------------------
  // 8) 接管键 + 接管包
  // -------------------------------------------------------------------------

  /**
   * 接管：立即置 halted=true（之后所有写操作抛 SystemHaltedError，10 秒内生效——同步实现），
   * 并生成接管包（未结订单/待办对话/待付账单/凭据引用/风险/coverage）。
   */
  takeover(reason: string, by: string): TakeoverPack {
    const reasonValue = requireString(reason, "reason");
    const byValue = requireString(by, "by");
    const now = this.now();
    if (!this.state.halted) {
      this.state.halted = true;
      this.state.halted_at = now.toISOString();
      this.state.halted_reason = reasonValue;
      for (const project of this.state.projects) {
        if (project.status === "active" || project.status === "delivered" || project.status === "proposed") {
          this.appendTimelineInternal(project, {
            kind: "takeover",
            summary: `接管键触发：${reasonValue}（by ${byValue}），停止新动作`,
            evidence_ids: [],
            confidence: "certain",
          });
        }
      }
      this.recordEvent("takeover.start", "system", "halted", "ok", { detail: `reason=${reasonValue}; by=${byValue}` });
    }
    const pack = this.buildTakeoverPack(reasonValue, byValue);
    this.state.last_takeover = clone(pack);
    this.recordEvent("takeover.pack", "takeover_pack", pack.generated_at, "ok", {
      detail: `coverage=${pack.coverage}; open_orders=${pack.open_orders.length}; threads=${pack.pending_threads.length}`,
    });
    this.commit();
    return clone(pack);
  }

  /** 恢复：解除 halted（只允许在人工处理接管包后调用）。 */
  resume(by = "owner"): void {
    const byValue = requireString(by, "by");
    if (!this.state.halted) return;
    this.state.halted = false;
    this.state.halted_at = null;
    this.state.halted_reason = null;
    for (const project of this.state.projects) {
      if (project.status === "active" || project.status === "delivered" || project.status === "proposed") {
        this.appendTimelineInternal(project, {
          kind: "resume",
          summary: `解除接管（by ${byValue}），恢复执行`,
          evidence_ids: [],
          confidence: "certain",
        });
      }
    }
    this.recordEvent("takeover.resume", "system", "halted", "ok", { detail: `by=${byValue}` });
    this.commit();
  }

  get lastTakeoverPack(): TakeoverPack | null {
    return this.state.last_takeover === null ? null : clone(this.state.last_takeover);
  }

  // -------------------------------------------------------------------------
  // 9) 摘要（L0/L1/L2）与月报
  // -------------------------------------------------------------------------

  summaries(): SummaryBundle {
    return this.summariesInternal();
  }

  buildMonthlyReport(month: string): MonthlyReport {
    return this.buildMonthlyReportInternal(month);
  }

  // -------------------------------------------------------------------------
  // 10) 边界规则
  // -------------------------------------------------------------------------

  /** 边界规则目录（默认个人模式：personal + both，≥12 条）。 */
  boundaryRules(mode: "personal" | "enterprise" | "both" = "personal"): ReturnType<typeof listBoundaryRules> {
    return listBoundaryRules(mode);
  }

  /** 规则总数（含企业模式；边界核对表用）。 */
  boundaryRuleTotal(): number {
    return boundaryRuleCount();
  }

  /**
   * 边界判定：返回 {decision, rule_id, user_message}。
   * 四类越界 100% deny；判 deny/human/draft_only 均写入合规事件与 events.jsonl（脱敏留痕）。
   */
  checkBoundary(request: BoundaryCheckRequest): BoundaryCheckResult {
    if (!isRecord(request)) throw new DomainValidationError("checkBoundary 需要请求对象", "INVALID_INPUT", "request");
    const kindValue = requireString(request.kind, "kind") as BoundaryRequestKind;
    if (typeof request.text !== "string") throw new DomainValidationError("text 必须是字符串", "INVALID_INPUT", "text");
    const mandate = this.activeMandateInternal();
    const context: BoundaryContext = { mandate };
    const snapshot = this.budgetSnapshot();
    if (snapshot !== null) context.budget = snapshot;
    const normalizedRequest: BoundaryCheckRequest = { kind: kindValue, text: request.text };
    if (request.amount_cny !== undefined) normalizedRequest.amount_cny = request.amount_cny;
    if (request.requires_license !== undefined) normalizedRequest.requires_license = request.requires_license;
    if (request.requires_offline !== undefined) normalizedRequest.requires_offline = request.requires_offline;
    if (request.is_unknown_outreach !== undefined) normalizedRequest.is_unknown_outreach = request.is_unknown_outreach;
    if (request.has_authorization !== undefined) normalizedRequest.has_authorization = request.has_authorization;
    const result = evaluateBoundary(normalizedRequest, context);
    if (result.decision !== "allow") {
      const complianceEvent: ComplianceEvent = {
        at: this.now().toISOString(),
        rule_id: result.rule_id,
        decision: result.decision,
        kind: normalizedRequest.kind,
        message: result.user_message,
        text_digest: digestBoundaryText(request.text),
      };
      this.state.compliance_events.push(complianceEvent);
      this.recordEvent("boundary.check", "boundary", result.rule_id, "denied", {
        detail: `${result.decision}; kind=${normalizedRequest.kind}; text=${complianceEvent.text_digest}`,
      });
      this.commit();
    } else {
      this.recordEvent("boundary.check", "boundary", "ALLOW", "ok", { detail: `kind=${normalizedRequest.kind}` });
      this.commit();
    }
    return { decision: result.decision, rule_id: result.rule_id, user_message: result.user_message };
  }

  /** 断言式边界检查：deny 时抛 BoundaryDeniedError（CLI/工具在动作前调用）。 */
  assertRequestAllowed(request: BoundaryCheckRequest): BoundaryCheckResult {
    const result = this.checkBoundary(request);
    if (result.decision === "deny") throw new BoundaryDeniedError(result.user_message, result.rule_id);
    return result;
  }

  // -------------------------------------------------------------------------
  // 11) 仿真业务线端到端（B1/B2/B5 场景）
  // -------------------------------------------------------------------------

  /**
   * 跑一条完整仿真业务线：客户询价 → 报价（审批）→ 建项目/任务 → 交付证据 →
   * 验收单 → 收款（income）→ 开票（invoice）→ 月报。全程事件留痕。
   *
   * 注意：审批使用仿真审批人标识（SIMULATED_HUMAN_APPROVER），不代表真实人工审批；
   * 不连接真实客户/平台/资金。
   */
  runSimulatedBusinessLine(): SimulatedBusinessLineResult {
    this.assertNotHalted("runSimulatedBusinessLine");
    if (this.activeMandateInternal() === null) this.createMandateInternal(defaultMandateInput(this.now()));

    const proposal = this.proposeBusinessLines(clone(DEFAULT_BUSINESS_LINES), { budget_cny: 50_000, days: 30 });
    if (proposal.proposal === null) {
      throw new DomainValidationError("内置仿真业务线不足 3 条合格项，无法生成提案", "INVALID_INPUT", "simulation");
    }
    const line = proposal.ranked[0];
    if (line === undefined) throw new DomainValidationError("仿真提案为空", "INVALID_INPUT", "simulation");

    // 1) 建项目 + 客户询价进入时间线
    const project = this.createProject(line);
    const projectRecord = this.requireProject(project.id);
    this.appendTimelineInternal(projectRecord, {
      kind: "note",
      summary: `客户询价：${excerpt(DEFAULT_CUSTOMER_INQUIRY, 60)}`,
      evidence_ids: [],
      confidence: "certain",
    });
    this.recordEvent("sim.customer_inquiry", "project", project.id, "ok", { detail: excerpt(DEFAULT_CUSTOMER_INQUIRY, 60) });

    // 2) 报价（关联 BusinessLine）+ 仿真人工审批
    const quoteCard = this.createApprovalCard({
      kind: "quote",
      summary: `对外报价 ¥${line.quote_cny}：${line.name}`,
      amount_cny: line.quote_cny,
      related_project_id: project.id,
      ttl_hours: 72,
    });
    const quoteDecision = this.decideApproval(quoteCard.id, "approve", SIMULATED_HUMAN_APPROVER);
    this.appendTimelineInternal(projectRecord, {
      kind: "quoted",
      summary: `报价确认 ¥${line.quote_cny}（审批 ${quoteDecision.id}，by ${SIMULATED_HUMAN_APPROVER}）`,
      evidence_ids: [],
      confidence: "certain",
    });
    this.recordEvent("sim.quote", "project", project.id, "ok", { detail: `quote=${line.quote_cny}; approval=${quoteDecision.id}` });

    // 3) 任务：开发交付 + 客户验收
    const devTask = this.addTask({ project_id: project.id, agent_role: "developer", goal: `交付「${line.name}」的可运行 demo 与使用说明` });
    const customerTask = this.addTask({ project_id: project.id, agent_role: "customer", goal: "客户确认需求并出具验收单" });
    const devDone = this.completeTask(devTask.id, [
      { kind: "delivery", path: `runs/sim/${project.id}/delivery.zip`, note: "可运行 demo + 使用说明", confidence: "certain" },
      { kind: "commit", path: `runs/sim/${project.id}/commit.txt`, note: "提交记录摘要", confidence: "certain" },
    ]);
    this.appendTimelineInternal(projectRecord, {
      kind: "delivery",
      summary: `交付完成：${devDone.goal}`,
      evidence_ids: devDone.evidence,
      confidence: "certain",
    });

    // 4) 客户验收证据 + 验收任务完成
    const acceptanceTask = this.completeTask(customerTask.id, [
      { kind: "email", path: `runs/sim/${project.id}/acceptance.eml`, note: "客户验收通过邮件", confidence: "certain" },
    ]);
    const acceptanceEvidenceId = acceptanceTask.evidence[0];
    const acceptanceEvidence =
      acceptanceEvidenceId === undefined ? undefined : this.state.evidence.find((record) => record.id === acceptanceEvidenceId);
    if (acceptanceEvidence === undefined) {
      throw new DomainValidationError("仿真流程未生成验收证据", "INVALID_INPUT", "simulation");
    }
    this.appendTimelineInternal(projectRecord, {
      kind: "acceptance",
      summary: `客户验收通过（证据 ${acceptanceEvidence.path}）`,
      evidence_ids: [acceptanceEvidence.id],
      confidence: "certain",
    });
    this.recordEvent("sim.acceptance", "project", project.id, "ok", { evidence_refs: [acceptanceEvidence.path] });

    // 5) 收款（income）与开票（invoice）
    const income = this.recordLedger({
      project_id: project.id,
      type: "income",
      amount_cny: line.quote_cny,
      payee_or_payer: project.client,
      basis: `验收单 ${acceptanceEvidence.path} + 报价审批 ${quoteDecision.id}`,
      approved_by: SIMULATED_HUMAN_APPROVER,
      receipt_ref: `receipt-${project.id}`,
      confidence: "certain",
    });
    const invoice = this.recordLedger({
      project_id: project.id,
      type: "invoice",
      amount_cny: line.quote_cny,
      payee_or_payer: project.client,
      basis: `验收单 ${acceptanceEvidence.path} + 委托条款`,
      approved_by: SIMULATED_HUMAN_APPROVER,
      receipt_ref: `invoice-${project.id}`,
      confidence: "certain",
    });

    // 6) 项目进入 delivered；生成月报
    projectRecord.status = "delivered";
    projectRecord.updated_at = this.now().toISOString();
    this.recordEvent("project.delivered", "project", projectRecord.id, "ok", { detail: `income=${income.id}; invoice=${invoice.id}` });
    const report = this.buildMonthlyReportInternal(formatMonth(this.now()));
    this.commit();

    const finalProject = this.requireProject(project.id);
    return {
      project: clone(finalProject),
      tasks: [clone(this.requireTask(devTask.id)), clone(this.requireTask(customerTask.id))],
      timeline: clone(finalProject.timeline),
      ledger: [clone(this.requireLedger(income.id)), clone(this.requireLedger(invoice.id))],
      invoice_status: "issued",
      invoice_no: invoice.receipt_ref,
      report,
      quote_cny: line.quote_cny,
      customer_message: DEFAULT_CUSTOMER_INQUIRY,
      acceptance: clone(acceptanceEvidence),
    };
  }

  // =========================================================================
  // 内部实现
  // =========================================================================

  private assertNotHalted(action: string): void {
    if (this.state.halted) {
      throw new SystemHaltedError(
        `系统已接管暂停（halted=true），拒绝执行：${action}。请先处理接管包并 resume()。`,
        this.state.halted_at,
        this.state.halted_reason,
      );
    }
  }

  private commit(): void {
    this.state.updated_at = this.now().toISOString();
    if (!this.persist || this.statePath === null) return;
    const dir = dirname(this.statePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.statePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + "\n", "utf8");
    renameSync(tmp, this.statePath);
  }

  private recordEvent(
    action: string,
    objectType: string,
    objectId: string,
    result: DomainEvent["result"],
    options: { evidence_refs?: string[]; detail?: string } = {},
  ): void {
    const seq = this.state.event_seq + 1;
    this.state.event_seq = seq;
    const event: DomainEvent = {
      seq,
      ts: this.now().toISOString(),
      action,
      object_type: objectType,
      object_id: objectId,
      result,
      evidence_refs: options.evidence_refs === undefined ? [] : [...options.evidence_refs],
    };
    if (options.detail !== undefined) event.detail = sanitizeDetail(options.detail);
    if (this.eventsPath === null) return;
    mkdirSync(dirname(this.eventsPath), { recursive: true });
    appendFileSync(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
  }

  private appendTimelineInternal(
    project: Project,
    entry: { kind: TimelineKind; summary: string; evidence_ids: string[]; confidence: Confidence },
  ): void {
    project.timeline.push({
      at: this.now().toISOString(),
      kind: entry.kind,
      summary: sanitizeDetail(entry.summary),
      evidence_ids: [...entry.evidence_ids],
      confidence: entry.confidence,
    });
    project.updated_at = this.now().toISOString();
  }

  private activeMandateInternal(): Mandate | null {
    const now = this.now();
    for (const mandate of this.state.mandates) {
      if (mandate.status === "active" && now.getTime() > Date.parse(mandate.valid_to)) {
        mandate.status = "expired";
        this.recordEvent("mandate.expire", "mandate", mandate.id, "ok", { detail: `valid_to=${mandate.valid_to}` });
      }
    }
    return (
      [...this.state.mandates]
        .reverse()
        .find(
          (mandate) =>
            mandate.status === "active" &&
            Date.parse(mandate.valid_from) <= now.getTime() &&
            now.getTime() <= Date.parse(mandate.valid_to),
        ) ?? null
    );
  }

  private createMandateInternal(input: CreateMandateInput): Mandate {
    return this.createMandate(input);
  }

  private resetBudgetIfNewMonth(): boolean {
    const monthKey = formatMonth(this.now());
    if (this.state.budget.month_key === monthKey) return false;
    this.state.budget = { month_key: monthKey, spent_cny: 0, by_project: {} };
    this.recordEvent("budget.rollover", "budget", monthKey, "ok", { detail: `month=${monthKey}` });
    return true;
  }

  private requireProject(projectId: string): Project {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (project === undefined) throw new DomainValidationError(`项目不存在：${projectId}`, "NOT_FOUND", "project_id");
    return project;
  }

  private requireTask(taskId: string): Task {
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (task === undefined) throw new DomainValidationError(`任务不存在：${taskId}`, "NOT_FOUND", "task_id");
    return task;
  }

  private requireApproval(approvalId: string): ApprovalCard {
    const card = this.state.approvals.find((item) => item.id === approvalId);
    if (card === undefined) throw new DomainValidationError(`审批卡不存在：${approvalId}`, "NOT_FOUND", "approval_id");
    return card;
  }

  private requireLedger(entryId: string): LedgerEntry {
    const entry = this.state.ledger.find((item) => item.id === entryId);
    if (entry === undefined) throw new DomainValidationError(`账本条目不存在：${entryId}`, "NOT_FOUND", "entry_id");
    return entry;
  }

  private resolveBusinessLine(input: BusinessLine | string): BusinessLine {
    if (typeof input === "string") {
      const id = requireString(input, "business_line_id");
      const existing = this.state.business_lines.find((line) => line.id === id);
      if (existing === undefined) throw new DomainValidationError(`业务线不存在：${id}`, "NOT_FOUND", "business_line_id");
      return existing;
    }
    if (!isRecord(input)) throw new DomainValidationError("createProject 需要业务线 id 或对象", "INVALID_INPUT", "business_line");
    const idRaw = typeof input.id === "string" ? input.id.trim() : "";
    if (idRaw !== "") {
      const existing = this.state.business_lines.find((line) => line.id === idRaw);
      if (existing !== undefined) return existing;
    }
    const normalized = normalizeCandidate(input, { budget_cny: Number.POSITIVE_INFINITY, days: Number.POSITIVE_INFINITY });
    if (!normalized.ok) {
      throw new DomainValidationError(`业务线不合法：${normalized.rejected.reason}`, "INVALID_INPUT", "business_line");
    }
    this.state.business_lines.push(clone(normalized.line));
    return normalized.line;
  }

  private buildTakeoverPack(reason: string, by: string): TakeoverPack {
    const openOrders: string[] = this.state.projects
      .filter((project) => project.status === "active" || project.status === "proposed" || project.status === "delivered")
      .map(
        (project) =>
          `${project.id} | ${project.name} | 客户 ${project.client} | 状态 ${project.status} | 置信度 ${project.confidence}`,
      );
    const pendingThreads: string[] = [
      ...this.state.tasks
        .filter((task) => task.status !== "done")
        .map((task) => `${task.id} | [${task.agent_role}] ${task.goal} | 状态 ${task.status}`),
      ...this.state.promises
        .filter((promise) => promise.status === "authorized")
        .map((promise) => `${promise.id} | 承诺：${excerpt(promise.text, 30)} | 原文 ${promise.source_message_id}`),
    ];
    const payables: string[] = [
      ...this.state.approvals
        .filter(
          (card) =>
            card.status === "pending" &&
            (card.kind === "payment" || card.kind === "contract" || card.kind === "quote"),
        )
        .map((card) => `${card.id} | 待审批[${card.kind}] ${card.summary}${card.amount_cny === undefined ? "" : ` | ¥${card.amount_cny}`}`),
      ...this.state.ledger
        .filter((entry) => entry.type === "expense" || entry.type === "refund" || entry.type === "receivable")
        .map((entry) => `${entry.id} | ${entry.type} ¥${entry.amount_cny} | 对方 ${entry.payee_or_payer} | 回执 ${entry.receipt_ref}`),
    ];
    const risks: string[] = [];
    if (this.state.halted) risks.push(`接管态：所有新动作已停止（原因：${this.state.halted_reason ?? "未记录"}）`);
    if (this.activeMandateInternal() === null) risks.push("没有生效委托：需重新授权后才能恢复对外动作");
    const blocked = this.state.tasks.filter((task) => task.status === "blocked").length;
    if (blocked > 0) risks.push(`存在 ${blocked} 个阻塞任务，需人工排障`);
    const pendingApprovals = this.state.approvals.filter((card) => card.status === "pending").length;
    if (pendingApprovals > 0) risks.push(`存在 ${pendingApprovals} 张待审批卡（超时挂起，不自动放行）`);
    const snapshot = this.budgetSnapshot();
    if (snapshot !== null && snapshot.month_limit_cny > 0 && snapshot.month_left_cny / snapshot.month_limit_cny < 0.2) {
      risks.push(`本月预算余量仅 ¥${snapshot.month_left_cny}（上限 ¥${snapshot.month_limit_cny}）`);
    }
    const tombstoned = this.state.projects.filter((project) => project.status === "tombstoned").length;
    if (tombstoned > 0) risks.push(`存在 ${tombstoned} 个墓碑项目（历史保留，不可逆）`);

    const hasWork = this.state.projects.length > 0 || this.state.tasks.length > 0;
    const coverage = !hasWork && this.state.ledger.length === 0 ? "not_covered" : this.credentials.length > 0 && this.state.projects.length > 0 ? "complete" : hasWork ? "partial" : "not_covered";

    const pack: TakeoverPack = {
      generated_at: this.now().toISOString(),
      open_orders: openOrders,
      pending_threads: pendingThreads,
      payables,
      credentials: [...this.credentials],
      risks,
      coverage,
      reason,
      by,
    };
    return pack;
  }

  private buildMonthlyReportInternal(month: string): MonthlyReport {
    const monthValue = requireMonth(month);
    const entries = this.state.ledger.filter((entry) => entry.occurred_at.slice(0, 7) === monthValue);
    const income = round2(entries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount_cny, 0));
    const cost = round2(entries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount_cny, 0));
    const refund = round2(entries.filter((entry) => entry.type === "refund").reduce((sum, entry) => sum + entry.amount_cny, 0));
    const grossMargin = round2(income - cost - refund);
    const grossMarginRate = income > 0 ? round4(grossMargin / income) : 0;
    const mandate = this.activeMandateInternal();
    const spent = this.spentInMonth(monthValue);
    const budgetLeft = mandate === null ? 0 : round2(Math.max(0, mandate.budget_limits.month_cny - spent));
    const complianceEvents = this.state.compliance_events
      .filter((event) => event.at.slice(0, 7) === monthValue)
      .map((event) => `${event.at.slice(0, 10)} ${event.rule_id} ${event.decision}：${event.message}`);
    const nextProposals =
      this.state.last_proposal === null
        ? []
        : this.state.last_proposal.ranked.slice(0, 3).map((line) => line.name);
    const hasData = entries.length > 0 || this.state.projects.length > 0;
    const coverage: MonthlyReport["coverage"] = mandate === null ? (hasData ? "partial" : "not_covered") : hasData ? "complete" : "partial";
    return {
      month: monthValue,
      income_cny: income,
      cost_cny: cost,
      gross_margin_cny: grossMargin,
      gross_margin_rate: grossMarginRate,
      budget_left_cny: budgetLeft,
      compliance_events: complianceEvents,
      next_proposals: nextProposals,
      as_of: this.now().toISOString(),
      coverage,
    };
  }

  private spentInMonth(month: string): number {
    if (this.state.budget.month_key === month) return round2(this.state.budget.spent_cny);
    return round2(
      this.state.ledger
        .filter((entry) => entry.occurred_at.slice(0, 7) === month && entry.type === "expense")
        .reduce((sum, entry) => sum + entry.amount_cny, 0),
    );
  }

  private summariesInternal(): SummaryBundle {
    const now = this.now();
    const L0: ActionCard[] = [];
    if (this.state.halted) {
      L0.push({
        id: "action-halted",
        kind: "takeover",
        summary: `系统接管中：${this.state.halted_reason ?? "已停止新动作"}；处理完接管包后请 resume。`,
        severity: "critical",
        ref_id: "halted",
      });
    }
    const queue = this.approvalQueue();
    for (const card of queue) {
      const hoursLeft = (Date.parse(card.expires_at) - now.getTime()) / (60 * 60 * 1000);
      L0.push({
        id: `action-${card.id}`,
        kind: "approval",
        summary: `待审批[${card.kind}]：${card.summary}（剩余 ${Math.max(0, Math.round(hoursLeft))}h，超时不自动放行）`,
        severity: hoursLeft <= 4 ? "warn" : "info",
        ref_id: card.id,
      });
    }
    for (const task of this.state.tasks) {
      if (task.status === "blocked") {
        L0.push({
          id: `action-${task.id}`,
          kind: "task",
          summary: `阻塞任务：${task.goal}（需人工排障）`,
          severity: "warn",
          ref_id: task.id,
        });
      } else if (task.status === "pending") {
        L0.push({
          id: `action-${task.id}`,
          kind: "task",
          summary: `待办任务：${task.goal}`,
          severity: "info",
          ref_id: task.id,
        });
      }
    }
    const snapshot = this.budgetSnapshot();
    if (snapshot !== null && snapshot.month_limit_cny > 0 && snapshot.month_left_cny / snapshot.month_limit_cny < 0.2) {
      L0.push({
        id: "action-budget",
        kind: "budget",
        summary: `本月预算余量仅 ¥${snapshot.month_left_cny}（上限 ¥${snapshot.month_limit_cny}），请确认是否继续。`,
        severity: "warn",
        ref_id: snapshot.month_key,
      });
    }
    if (this.state.last_proposal === null || this.state.last_proposal.proposal === null) {
      L0.push({
        id: "action-proposal",
        kind: "proposal",
        summary: "尚无可用选题提案：请先跑 proposeBusinessLines（≥3 条带来源的业务线）。",
        severity: "info",
        ref_id: "proposal",
      });
    }
    if (L0.length === 0) {
      L0.push({ id: "action-idle", kind: "risk", summary: "当前无待办：可查看 L2 月报或发起新选题。", severity: "info", ref_id: "idle" });
    }

    const L1: ProjectSummary[] = this.state.projects
      .filter((project) => project.status !== "tombstoned")
      .map((project) => {
        const tasks = this.state.tasks.filter((task) => task.project_id === project.id);
        const evidence = this.state.evidence.filter(
          (record) => record.project_id === project.id && record.confidence !== "tombstone",
        );
        const last = project.timeline[project.timeline.length - 1];
        return {
          project_id: project.id,
          name: project.name,
          status: project.status,
          client: project.client,
          open_tasks: tasks.filter((task) => task.status !== "done").length,
          done_tasks: tasks.filter((task) => task.status === "done").length,
          evidence_count: evidence.length,
          confidence: project.confidence,
          last_event_at: last === undefined ? project.updated_at : last.at,
        };
      });

    return {
      generated_at: now.toISOString(),
      L0,
      L1,
      L2: this.buildMonthlyReportInternal(formatMonth(now)),
    };
  }
}

// ---------------------------------------------------------------------------
// 模块级辅助
// ---------------------------------------------------------------------------

function requireMonth(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) {
    throw new DomainValidationError(`month 必须是 YYYY-MM 格式：${String(value)}`, "INVALID_INPUT", "month");
  }
  return value;
}

function mandateClauseCovered(mandate: Mandate, clause: string): boolean {
  const clauseText = clause.trim();
  if (clauseText === "") return false;
  return mandate.scope.some((scopeItem) => scopeItem.includes(clauseText) || clauseText.includes(scopeItem));
}

function mandateProhibits(mandate: Mandate, text: string): boolean {
  return mandate.prohibited.some((item) => text.includes(item) || item.includes(text));
}
