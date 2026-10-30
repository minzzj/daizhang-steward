/**
 * OrchestratorEngine：v1.2/v1.3 编排内核。
 *
 * 两层总调度：
 * - **supervisor（system 会话）**：接收用户亲自下达的系统级命令，通过注入的 `SystemActions`
 *   管理受管程序/插件、切换模型与提示词（`ConfigBridge`）、读取全部日志记录、把项目委派给 conductor；
 *   每一步生成 `ActionPlan`（risk / requires_confirmation），高危动作必须人工确认；
 * - **conductor（project 会话）**：项目拆解/派发/汇总，执行 operator/harness/reviewer/finance/
 *   backend/scout/customer/content/research 的真实本地动作，不得操作系统、不能再派生 supervisor。
 *
 * 通用能力：模型（OpenAI 兼容 / DeepSeek，真实 fetch；无 key/失败回退 LocalPlannerAdapter 并明确标注）、
 * 每轮 AgentTurn（摘要 + 全文 + tokens + 证据）、打断/恢复、审批/确认、Token 双限额、会话 JSON 持久化、
 * 全动作审计（`<root>/orchestrator/audit.jsonl`，只追加）。
 *
 * 纯本地：受管系统动作只经注入接口执行（未注入则阻断，绝不假装执行）；项目动作写本地证据文件。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { OrchestratorNotFoundError, OrchestratorValidationError } from "./errors.js";
import {
  AGENT_SUMMARY_MARKER,
  ALLOWED_AGENT_ROLES,
  buildLocalPlan,
  buildLocalSystemPlan,
  estimateTokens,
  isRecord,
  LocalPlannerAdapter,
  OpenAICompatibleAdapter,
  parseConductorPlan,
  parseSystemPlan,
  PLAN_MARKER,
  requiresConfirmationFor,
  riskForSystemAction,
  SUPERVISOR_PLAN_MARKER,
  truncate,
} from "./model.js";
import { SessionStore } from "./store.js";
import { listEvidenceFiles, runLocalAction, writeSystemActionEvidence } from "./tools.js";
import type {
  ActionPlan,
  ActionRisk,
  AgentTurn,
  AgentTurnStatus,
  ApprovalRecord,
  AuditEntry,
  AuditResult,
  ChatKind,
  ChatMessage,
  ChatRole,
  ConductorPlan,
  ConfigBridge,
  CreateSessionInput,
  EvidenceItem,
  LedgerSink,
  ModelAdapter,
  ModelChatMessage,
  ModelChatResult,
  ModelOutcome,
  ModelResolution,
  ModelResolver,
  OrchestratorDeps,
  OrchestratorMode,
  OrchestratorSession,
  PlanStep,
  RecordsSnapshot,
  RunDetail,
  SessionKind,
  SystemActionName,
  SystemActionResult,
  SystemActions,
  TokenConsumeResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_STORE_VERSION = 1;
/** 默认预算（元）。 */
export const DEFAULT_BUDGET_CNY = 5_000;
/** 默认会话 Token 上限。 */
export const DEFAULT_TOKEN_LIMIT = 1_000_000;
/** 单次 startProject/runStep 最多推进步骤数（防失控循环）。 */
export const DEFAULT_MAX_STEPS_PER_RUN = 8;
/** autoApprove=false 时需要人工审批的项目 agent 角色（finance 涉及收款）。 */
export const APPROVAL_REQUIRED_ROLES: readonly string[] = ["finance"];
/** supervisor 角色名。 */
export const SUPERVISOR_ROLE = "supervisor";

const VALID_MODES: readonly OrchestratorMode[] = ["demo", "personal", "enterprise"];
const VALID_KINDS: readonly SessionKind[] = ["system", "project"];
const VALID_DECISIONS: readonly ("approve" | "reject")[] = ["approve", "reject"];

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function cloneSession(session: OrchestratorSession): OrchestratorSession {
  return JSON.parse(JSON.stringify(session)) as OrchestratorSession;
}

function requireString(value: unknown, field: string, message?: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrchestratorValidationError(message ?? `${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string, options: { min?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OrchestratorValidationError(`${field} 必须是有限数字`, "INVALID_INPUT", field);
  }
  if (options.min !== undefined && value < options.min) {
    throw new OrchestratorValidationError(`${field} 不能小于 ${options.min}`, "INVALID_INPUT", field);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new OrchestratorValidationError(`${field} 必须是 ${allowed.join(" / ")} 之一`, "INVALID_INPUT", field);
  }
  return value as T;
}

function makeOutcome(
  base: { ok: boolean; content: string; tokens: number; mode: "remote" | "local_fallback" },
  extra: { reason?: string; blocked?: boolean; aborted?: boolean } = {},
): ModelOutcome {
  const outcome: ModelOutcome = { ...base };
  if (extra.reason !== undefined) outcome.reason = extra.reason;
  if (extra.blocked !== undefined) outcome.blocked = extra.blocked;
  if (extra.aborted !== undefined) outcome.aborted = extra.aborted;
  return outcome;
}

function localResolution(): ModelResolution {
  return {
    provider: {
      id: "local",
      name: "本地规则模式",
      kind: "local",
      base_url: "",
      default_model: "local-rules",
      models: ["local-rules"],
    },
    model: "local-rules",
    has_key: false,
    key_source: "missing",
  };
}

// ---------------------------------------------------------------------------
// OrchestratorEngine
// ---------------------------------------------------------------------------

export class OrchestratorEngine {
  private readonly resolver: ModelResolver;
  private readonly adapter: ModelAdapter;
  private readonly localAdapter = new LocalPlannerAdapter();
  private readonly now: () => Date;
  /** 数据根目录：会话在 `<root>/orchestrator/`，证据在 `<root>/<sessionId>/`。 */
  readonly root: string;
  private readonly store: SessionStore;
  private readonly maxStepsPerRun: number;
  private readonly autoApprove: boolean;
  private readonly ledger: LedgerSink | undefined;
  private readonly systemActions: SystemActions | undefined;
  private readonly configBridge: ConfigBridge | undefined;
  private readonly sessions = new Map<string, OrchestratorSession>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly auditEntries: AuditEntry[] = [];
  private readonly auditPath: string;
  private auditSeq = 0;
  private sessionSeq = 0;

  constructor(deps: OrchestratorDeps) {
    if (!isRecord(deps)) {
      throw new OrchestratorValidationError("OrchestratorEngine 构造参数非法：需要 { resolver } 对象");
    }
    const resolver = deps.resolver as unknown;
    if (!isRecord(resolver)) {
      throw new OrchestratorValidationError("缺少 resolver（模型/提示词/Token 解析器）", "INVALID_INPUT", "resolver");
    }
    for (const name of [
      "resolveAgentModel",
      "getApiKey",
      "getConductorPrompt",
      "getSystemPrompt",
      "consumeTokens",
      "remainingTokens",
    ]) {
      if (typeof resolver[name] !== "function") {
        throw new OrchestratorValidationError(`resolver 缺少方法 ${name}`, "INVALID_INPUT", "resolver");
      }
    }
    this.resolver = deps.resolver as unknown as ModelResolver;

    this.now = typeof deps.now === "function" ? deps.now : () => new Date();
    const root = typeof deps.root === "string" && deps.root.trim().length > 0 ? deps.root.trim() : join(process.cwd(), "runs");
    this.root = root;
    this.store = new SessionStore(root);
    this.auditPath = join(this.store.sessionsDir, "audit.jsonl");
    this.maxStepsPerRun =
      typeof deps.maxStepsPerRun === "number" && Number.isInteger(deps.maxStepsPerRun) && deps.maxStepsPerRun > 0
        ? deps.maxStepsPerRun
        : DEFAULT_MAX_STEPS_PER_RUN;
    this.autoApprove = deps.autoApprove === true;
    this.ledger = deps.ledger;
    this.systemActions = deps.systemActions;
    this.configBridge = deps.configBridge;

    this.adapter =
      deps.adapter ??
      new OpenAICompatibleAdapter({
        getApiKey: (providerId: string): string | null => {
          try {
            return this.resolver.getApiKey(providerId);
          } catch {
            return null;
          }
        },
      });

    for (const session of this.store.loadAll()) this.sessions.set(session.id, session);
    this.sessionSeq = this.sessions.size;
    this.loadAudit();
  }

  // -------------------------------------------------------------------------
  // 0) 只读视图
  // -------------------------------------------------------------------------

  listSessions(): OrchestratorSession[] {
    return [...this.sessions.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((session) => cloneSession(session));
  }

  getSession(sessionId: string): OrchestratorSession {
    return cloneSession(this.requireSession(sessionId));
  }

  evidenceDir(sessionId: string): string {
    const session = this.requireSession(sessionId);
    return session.evidence_dir ?? join(this.root, session.id);
  }

  /** 全量审计日志（所有会话；时间/操作/对象/结果/原因）。 */
  auditLog(): AuditEntry[] {
    return this.auditEntries.map((entry) => ({ ...entry }));
  }

  get auditCount(): number {
    return this.auditEntries.length;
  }

  /** supervisor 读取全部日志/记录（会话 + 审计快照）。 */
  readLogs(sessionId?: string): RecordsSnapshot {
    if (typeof sessionId === "string" && sessionId.trim().length > 0) this.requireSession(sessionId);
    return this.buildRecordsSnapshot(this.nowIso());
  }

  // -------------------------------------------------------------------------
  // 1) 创建会话（system = supervisor / project = conductor）
  // -------------------------------------------------------------------------

  createSession(input: CreateSessionInput): OrchestratorSession {
    return cloneSession(this.createSessionInternal(input));
  }

  // -------------------------------------------------------------------------
  // 2) 与总调度对话（模型/本地回退）→ 生成计划（项目计划 / 系统动作计划）
  // -------------------------------------------------------------------------

  async sendMessage(sessionId: string, text: string): Promise<OrchestratorSession> {
    const session = this.requireSession(sessionId);
    const message = requireString(text, "text", "消息内容 text 不能为空");
    this.addMessage(session, { role: "user", kind: "text", text: message });
    session.status = "planning";
    const systemMode = session.kind === "system";
    const planRole = systemMode ? SUPERVISOR_ROLE : "conductor";
    const planMarker = systemMode ? SUPERVISOR_PLAN_MARKER : PLAN_MARKER;

    const controller = new AbortController();
    this.abortControllers.set(session.id, controller);
    try {
      const instructions = systemMode
        ? `请输出 JSON 系统动作计划：{"title":"系统操作计划","steps":[{"action":"listApps|startApp|stopApp|restartApp|removeApp|listPlugins|enablePlugin|disablePlugin|removePlugin|changeAgentModel|setPrompt|delegateProject|readLogs","target":"目标 id","summary":"这一步做什么","args":{},"risk":"low|medium|high"}]}。只能使用上述 action；删除类动作 risk=high、必须确认；只输出 JSON 本体。`
        : `请输出 JSON 计划：{"title":"计划标题","steps":[{"agent_role":"operator","action":"operator.build_deliverable","summary":"这一步要做什么"}]}。agent_role 只能是：${ALLOWED_AGENT_ROLES.join(", ")}；只输出 JSON 本体。`;
      const planMessages: ModelChatMessage[] = [
        {
          role: "system",
          content: this.safePrompt(
            () => this.resolver.getSystemPrompt(planRole),
            systemMode ? DEFAULT_SUPERVISOR_PROMPT : DEFAULT_CONDUCTOR_PROMPT,
          ),
        },
        ...this.conductorHistory(session),
        { role: "user", content: `${message}\n\n${planMarker}\n${instructions}` },
      ];
      const outcome = await this.callModel(
        session,
        planRole,
        systemMode ? "supervisor.plan" : "conductor.plan",
        planMessages,
        controller.signal,
      );

      if (this.wasInterrupted(session, controller)) {
        this.addTurn(session, {
          agent_role: planRole,
          input_summary: `用户消息：${truncate(message, 80)}`,
          output_summary: "本轮被用户中断（计划未生成）",
          detail: "总调度调用被中断：AbortController 已触发，计划未生成；可 resume 后重新发送消息。",
          tokens: outcome.tokens,
          status: "blocked",
          evidence_refs: [],
          model_mode: outcome.mode,
          interrupted: true,
        });
        this.persist(session);
        return cloneSession(session);
      }

      if (outcome.blocked === true) {
        return this.blockSession(session, `计划生成被阻断：${outcome.reason ?? "Token 超限"}`, planRole, outcome);
      }
      if (outcome.ok !== true) {
        return this.blockSession(session, `总调度模型不可用且回退失败：${outcome.reason ?? "未知原因"}`, planRole, outcome);
      }

      const parsed = systemMode
        ? parseSystemPlan(outcome.content, this.maxStepsPerRun)
        : parseConductorPlan(outcome.content, this.maxStepsPerRun);
      const usedFallback = parsed === null || outcome.mode === "local_fallback";
      const planMode: "remote" | "local_fallback" = parsed === null ? "local_fallback" : outcome.mode;
      const plan: ConductorPlan =
        parsed ??
        (systemMode ? buildLocalSystemPlan(message, this.maxStepsPerRun) : buildLocalPlan(message, this.maxStepsPerRun));
      const fallbackNote = parsed === null ? "模型返回的计划无法解析，已回退本地规则计划" : outcome.reason;

      if (typeof plan.title === "string" && plan.title.trim().length > 0) {
        session.title = truncate(plan.title.trim(), 60);
      }
      session.plan = plan.steps.slice(0, this.maxStepsPerRun).map((inputStep, index) => {
        const step: PlanStep = {
          step: index + 1,
          agent_role: systemMode ? SUPERVISOR_ROLE : inputStep.agent_role,
          action: inputStep.action,
          summary: inputStep.summary,
          status: "pending",
        };
        if (systemMode) {
          const action = inputStep.action as SystemActionName;
          const risk: ActionRisk = inputStep.risk ?? riskForSystemAction(action);
          const actionPlan: ActionPlan = {
            action,
            target: inputStep.target ?? action,
            args: inputStep.args ?? {},
            risk,
            requires_confirmation: requiresConfirmationFor(action, this.autoApprove),
            summary: inputStep.summary,
          };
          step.action_plan = actionPlan;
          if (actionPlan.requires_confirmation) step.requires_approval = true;
        } else if (this.requiresApprovalByDefault(step)) {
          step.requires_approval = true;
        }
        return step;
      });
      session.status = "active";
      const roles = systemMode ? [SUPERVISOR_ROLE] : [...new Set(session.plan.map((step) => step.agent_role))];

      this.addTurn(session, {
        agent_role: planRole,
        input_summary: `用户消息：${truncate(message, 80)}`,
        output_summary: systemMode
          ? `已生成 ${session.plan.length} 个系统动作${usedFallback ? "（本地规则回退）" : ""}：${session.plan.map((step) => step.action).join(" → ")}`
          : `已生成 ${session.plan.length} 步计划（${roles.join(" → ")}）${usedFallback ? "（本地规则回退）" : ""}`,
        detail: this.buildConductorDetail(outcome, session, fallbackNote),
        tokens: outcome.tokens,
        status: "done",
        evidence_refs: [],
        model_mode: planMode,
      });
      this.addMessage(session, {
        role: systemMode ? "supervisor" : "conductor",
        kind: "plan",
        text: this.renderPlanText(session, usedFallback, fallbackNote),
        summary: systemMode
          ? `系统动作 ${session.plan.length} 个：${session.plan.map((step) => step.action).join(" → ")}`
          : `计划 ${session.plan.length} 步：${roles.join(" → ")}`,
        model_mode: planMode,
      });
      this.recordAudit(
        session.id,
        systemMode ? "supervisor.plan" : "conductor.plan",
        "plan",
        "ok",
        `${session.plan.length} steps; mode=${planMode}`,
      );
      this.persist(session);
      return cloneSession(session);
    } finally {
      this.abortControllers.delete(session.id);
    }
  }

  // -------------------------------------------------------------------------
  // 3) 创建项目/工作区 / 执行计划 / 单步执行
  // -------------------------------------------------------------------------

  /** 创建工作区并开始执行（最多 maxStepsPerRun 步；遇到审批/确认/打断则暂停）。 */
  async startProject(sessionId: string): Promise<OrchestratorSession> {
    const session = this.requireSession(sessionId);
    if (session.status === "interrupted" || session.status === "done" || session.status === "blocked") {
      return cloneSession(session);
    }
    if (session.plan.length === 0) {
      throw new OrchestratorValidationError(
        "尚无可执行计划：请先 sendMessage 让总调度生成计划",
        "MISSING_PLAN",
        "plan",
      );
    }
    this.initializeWorkspace(session);
    session.status = "running";
    this.recordAudit(session.id, "run.start", session.project_id ?? session.id, "ok", `${session.plan.length} steps`);
    let executed = 0;
    while (executed < this.maxStepsPerRun && session.status === "running") {
      const progressed = await this.executeNextStep(session);
      if (!progressed) break;
      executed += 1;
    }
    this.persist(session);
    return cloneSession(session);
  }

  /** 单步执行下一个 pending 步骤（便于 UI 逐步展示/逐步打断）。 */
  async runStep(sessionId: string): Promise<OrchestratorSession> {
    const session = this.requireSession(sessionId);
    if (["interrupted", "paused", "blocked", "done"].includes(session.status)) return cloneSession(session);
    if (session.plan.length === 0) {
      throw new OrchestratorValidationError(
        "尚无可执行计划：请先 sendMessage 让总调度生成计划",
        "MISSING_PLAN",
        "plan",
      );
    }
    this.initializeWorkspace(session);
    session.status = "running";
    await this.executeNextStep(session);
    this.persist(session);
    return cloneSession(session);
  }

  // -------------------------------------------------------------------------
  // 4) 打断 / 恢复 / 审批（确认）
  // -------------------------------------------------------------------------

  interrupt(sessionId: string, reason?: string): OrchestratorSession {
    const session = this.requireSession(sessionId);
    const note = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : "用户中断";
    if (session.status === "done" || session.status === "blocked" || session.status === "interrupted") {
      return cloneSession(session);
    }
    session.status = "interrupted";
    const controller = this.abortControllers.get(session.id);
    if (controller !== undefined) controller.abort();
    this.addMessage(session, {
      role: "system",
      kind: "interrupt",
      text: `已中断：${note}。当前步骤会在下一步前停止，点「恢复」后继续剩余计划。`,
    });
    this.recordAudit(session.id, "run.interrupt", session.id, "pending", note);
    this.persist(session);
    return cloneSession(session);
  }

  resume(sessionId: string): OrchestratorSession {
    const session = this.requireSession(sessionId);
    if (session.status !== "interrupted" && session.status !== "paused") return cloneSession(session);
    session.status = session.evidence_dir === undefined ? "active" : "running";
    this.addMessage(session, {
      role: session.kind === "system" ? "supervisor" : "conductor",
      kind: "result",
      text: `已恢复执行（可继续 runStep / startProject，剩余 ${session.plan.filter((step) => step.status === "pending").length} 步）。`,
    });
    this.recordAudit(session.id, "run.resume", session.id, "ok", session.status);
    this.persist(session);
    return cloneSession(session);
  }

  /** 人工审批/确认：approve → 该步骤可继续执行；reject → 该步 blocked、会话 blocked。 */
  decideApproval(
    sessionId: string,
    step: number,
    decision: "approve" | "reject",
    by = "human:console",
  ): OrchestratorSession {
    const session = this.requireSession(sessionId);
    if (typeof step !== "number" || !Number.isInteger(step) || step < 1) {
      throw new OrchestratorValidationError("step 必须是 ≥1 的整数步骤号", "INVALID_INPUT", "step");
    }
    const target = session.plan.find((item) => item.step === step);
    if (target === undefined) {
      throw new OrchestratorValidationError(`步骤 ${step} 不存在（当前计划共 ${session.plan.length} 步）`, "INVALID_INPUT", "step");
    }
    const decisionValue = requireEnum(decision, VALID_DECISIONS, "decision");
    const byValue = typeof by === "string" && by.trim().length > 0 ? by.trim() : "human:console";
    session.approvals ??= {};
    const record: ApprovalRecord = {
      status: decisionValue === "approve" ? "approved" : "rejected",
      by: byValue,
      at: this.nowIso(),
    };
    session.approvals[String(step)] = record;
    this.addMessage(session, {
      role: session.kind === "system" ? "supervisor" : "conductor",
      kind: "approval",
      text: `人工${session.kind === "system" ? "确认" : "审批"}：步骤 ${step}（${target.agent_role} / ${target.action}）${decisionValue === "approve" ? "已批准" : "已驳回"}（by ${byValue}）。`,
      summary: decisionValue === "approve" ? "审批通过" : "审批驳回",
    });
    if (decisionValue === "reject") {
      target.status = "blocked";
      session.status = "blocked";
      this.recordAudit(session.id, "approval.decide", `step:${step}`, "blocked", `rejected by ${byValue}`);
    } else {
      if (target.status === "blocked") target.status = "pending";
      if (session.status === "paused" || session.status === "blocked") {
        session.status = session.evidence_dir === undefined ? "active" : "running";
      }
      this.recordAudit(session.id, "approval.decide", `step:${step}`, "ok", `approved by ${byValue}`);
    }
    this.persist(session);
    return cloneSession(session);
  }

  // -------------------------------------------------------------------------
  // 5) supervisor：委派项目 / 读取日志
  // -------------------------------------------------------------------------

  /**
   * supervisor 把项目委派给 conductor：创建 project 子会话（parent_id = 当前 system 会话），
   * 返回子会话（可通过 session.id 继续 sendMessage/startProject）。
   * **conductor/project 会话不得调用**（不能再派生 supervisor，也不能越级建系统会话）。
   */
  delegateProject(supervisorSessionId: string, goal: string, title?: string): OrchestratorSession {
    const session = this.requireSession(supervisorSessionId);
    if (session.kind !== "system") {
      throw new OrchestratorValidationError(
        "仅 supervisor（system）会话可委派项目；conductor 项目会话不得越权派生",
        "INVALID_INPUT",
        "sessionId",
      );
    }
    const childGoal = requireString(goal, "goal", "委派项目 goal 不能为空");
    const child = this.createSessionInternal(
      {
        goal: childGoal,
        kind: "project",
        mode: session.mode,
        budget_cny: session.budget_cny,
        token_limit: session.token_limit,
        ...(title === undefined ? {} : { title }),
      },
      session.id,
    );
    session.child_sessions ??= [];
    session.child_sessions.push(child.id);
    this.addMessage(session, {
      role: "supervisor",
      kind: "result",
      text: `已委派项目给 conductor：${child.id}（目标：${truncate(childGoal, 40)}）。后续由 conductor 拆解计划并派发执行。`,
      summary: "已委派项目",
    });
    this.recordAudit(session.id, "project.delegate", child.id, "ok", truncate(childGoal, 80));
    this.persist(session);
    return cloneSession(child);
  }

  // -------------------------------------------------------------------------
  // 6) 查询：运行详情 / 智能体轮次 / 总调度对话 / 证据
  // -------------------------------------------------------------------------

  getRunDetail(sessionId: string): RunDetail {
    const session = this.requireSession(sessionId);
    const evidenceDir = session.evidence_dir ?? join(this.root, session.id);
    return {
      session: cloneSession(session),
      turns: this.flattenTurns(session),
      evidence: listEvidenceFiles(this.root, evidenceDir),
    };
  }

  getAgentTranscripts(sessionId: string, role?: string): AgentTurn[] {
    const session = this.requireSession(sessionId);
    const roles = typeof role === "string" && role.trim().length > 0 ? [role.trim()] : Object.keys(session.children).sort();
    const turns: AgentTurn[] = [];
    for (const key of roles) {
      const list = session.children[key];
      if (!Array.isArray(list)) continue;
      for (const turn of list) turns.push({ ...turn, evidence_refs: [...turn.evidence_refs] });
    }
    turns.sort((left, right) => left.seq - right.seq);
    return turns;
  }

  /** 总调度对话记录（用户 + 总调度/supervisor 消息，含计划/审批/结果）。 */
  getConductorConversation(sessionId: string): ChatMessage[] {
    const session = this.requireSession(sessionId);
    return session.messages
      .filter((message) => message.role === "user" || message.role === "conductor" || message.role === "supervisor")
      .map((message) => ({ ...message }));
  }

  listEvidence(sessionId: string): EvidenceItem[] {
    const session = this.requireSession(sessionId);
    const evidenceDir = session.evidence_dir ?? join(this.root, session.id);
    return listEvidenceFiles(this.root, evidenceDir);
  }

  // -------------------------------------------------------------------------
  // 内部：创建会话
  // -------------------------------------------------------------------------

  private createSessionInternal(input: CreateSessionInput, parentId?: string): OrchestratorSession {
    if (!isRecord(input)) {
      throw new OrchestratorValidationError("createSession 需要 { goal } 对象", "INVALID_INPUT", "input");
    }
    const goal = requireString(input.goal, "goal", "目标 goal 不能为空");
    const mode = input.mode === undefined ? "demo" : requireEnum(input.mode, VALID_MODES, "mode");
    const kind = input.kind === undefined ? "project" : requireEnum(input.kind, VALID_KINDS, "kind");
    const budget =
      input.budget_cny === undefined ? DEFAULT_BUDGET_CNY : requireNumber(input.budget_cny, "budget_cny", { min: 0 });
    const tokenLimit =
      input.token_limit === undefined
        ? DEFAULT_TOKEN_LIMIT
        : requireNumber(input.token_limit, "token_limit", { min: 1 });
    const nowIso = this.nowIso();
    const session: OrchestratorSession = {
      id: this.nextSessionId(),
      title: truncate(goal, 40),
      goal,
      mode,
      kind,
      status: "active",
      created_at: nowIso,
      updated_at: nowIso,
      budget_cny: budget,
      token_limit: Math.floor(tokenLimit),
      messages: [],
      plan: [],
      children: {},
      approvals: {},
      tokens_used: 0,
      store_version: ORCHESTRATOR_STORE_VERSION,
    };
    if (kind === "system") session.child_sessions = [];
    if (typeof parentId === "string" && parentId.trim().length > 0) session.parent_id = parentId.trim();
    if (typeof input.title === "string" && input.title.trim().length > 0) {
      session.title = truncate(input.title.trim(), 60);
    }
    this.addMessage(session, {
      role: "system",
      kind: "text",
      text:
        kind === "system"
          ? `系统总控（supervisor）会话已创建：「${session.title}」。可以下达系统级命令（管理程序/插件、切换模型与提示词、读取日志、委派项目）。危险动作执行前必须人工确认。`
          : parentId === undefined
            ? `会话已创建：「${session.title}」。可以直接对总调度说“帮我做什么”，由总调度拆解计划并派发执行。`
            : `已由 supervisor 委派创建项目会话：「${session.title}」。由 conductor 拆解计划并派发执行。`,
    });
    this.sessions.set(session.id, session);
    this.recordAudit(session.id, "session.create", session.id, "ok", `kind=${kind}; parent=${session.parent_id ?? "none"}`);
    this.persist(session);
    return session;
  }

  // -------------------------------------------------------------------------
  // 内部：执行引擎
  // -------------------------------------------------------------------------

  private async executeNextStep(session: OrchestratorSession): Promise<boolean> {
    if (["interrupted", "paused", "blocked", "done"].includes(session.status)) return false;
    const step = session.plan.find((item) => item.status === "pending");
    if (step === undefined) {
      this.markDoneIfComplete(session);
      return false;
    }

    // 审批/确认门禁：project 的 finance 步骤或 system 的需确认动作，未批准一律挂起
    if (step.requires_approval === true) {
      const record = session.approvals?.[String(step.step)];
      if (record?.status === "rejected") {
        step.status = "blocked";
        session.status = "blocked";
        this.addMessage(session, {
          role: "system",
          kind: "error",
          text: `步骤 ${step.step}（${step.agent_role} / ${step.action}）已被人工驳回，不再执行。`,
        });
        this.recordAudit(session.id, "step.rejected", `step:${step.step}`, "blocked", step.action);
        return false;
      }
      if (record?.status !== "approved") {
        session.status = "paused";
        const alreadyNotified = session.messages.some(
          (message) => message.kind === "approval" && message.text.includes(`步骤 ${step.step}（`),
        );
        if (!alreadyNotified) {
          const confirmation = session.kind === "system" && step.action_plan !== undefined;
          this.addMessage(session, {
            role: session.kind === "system" ? "supervisor" : "conductor",
            kind: "approval",
            text: confirmation
              ? `系统动作需要确认：步骤 ${step.step} [${step.action_plan?.risk ?? "medium"}] ${step.action} → ${step.action_plan?.target ?? ""}（${step.summary}）。确认（/approve）后执行；驳回（/reject）则不执行。`
              : `步骤 ${step.step}（${step.agent_role} / ${step.action}）需要人工审批：${step.summary}。批准后继续执行；驳回则跳过该步并阻塞会话。`,
            summary: confirmation ? "等待人工确认" : "等待人工审批",
          });
        }
        this.persist(session);
        return false;
      }
    }

    const plan = step.action_plan;
    if (session.kind === "system" || plan !== undefined) {
      return this.executeSystemStep(session, step);
    }
    return this.executeProjectStep(session, step);
  }

  /** 执行一个项目步骤（conductor 派发的专项智能体：真实本地动作）。 */
  private async executeProjectStep(session: OrchestratorSession, step: PlanStep): Promise<boolean> {
    step.status = "running";
    session.status = "running";
    const controller = new AbortController();
    this.abortControllers.set(session.id, controller);
    const evidenceDir = session.evidence_dir ?? join(this.root, session.id);
    try {
      const systemPrompt = this.safePrompt(
        () => this.resolver.getSystemPrompt(step.agent_role),
        `你是代掌的 ${step.agent_role} 智能体。执行计划步骤必须真实、留证、不越界；对外动作需人工确认。`,
      );
      const agentMessages: ModelChatMessage[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${AGENT_SUMMARY_MARKER}\n角色：${step.agent_role}\n动作：${step.action}\n步骤：${step.summary}\n目标：${session.goal}\n请用一句话概括本轮执行结果（本地动作随后由系统真实执行并留证）。`,
        },
      ];
      const outcome = await this.callModel(session, step.agent_role, step.action, agentMessages, controller.signal);

      if (this.wasInterrupted(session, controller)) {
        step.status = "pending";
        this.addTurn(session, {
          agent_role: step.agent_role,
          input_summary: `步骤 ${step.step}：${step.summary}`,
          output_summary: "本轮被用户中断（步骤回退为 pending）",
          detail: "中断发生在模型调用阶段：AbortController 已触发；未执行本地动作，可 resume 后重跑本步骤。",
          tokens: outcome.tokens,
          status: "blocked",
          evidence_refs: [],
          model_mode: outcome.mode,
          interrupted: true,
        });
        return false;
      }
      if (outcome.blocked === true) {
        step.status = "blocked";
        session.status = "blocked";
        const reason = outcome.reason ?? "Token 超限";
        this.addTurn(session, {
          agent_role: step.agent_role,
          input_summary: `步骤 ${step.step}：${step.summary}`,
          output_summary: `被阻断：${reason}`,
          detail: `Token/预算阻断：${reason}`,
          tokens: 0,
          status: "blocked",
          evidence_refs: [],
          model_mode: outcome.mode,
        });
        this.addMessage(session, { role: "system", kind: "error", text: `步骤 ${step.step} 被阻断：${reason}` });
        this.recordAudit(session.id, "step.blocked", `step:${step.step}`, "blocked", reason);
        return false;
      }

      const actionResult = await runLocalAction({
        root: this.root,
        evidenceDir,
        session,
        step,
        nowIso: this.nowIso(),
        ledger: this.ledger,
      });

      if (this.wasInterrupted(session, controller)) {
        step.status = "pending";
        this.addTurn(session, {
          agent_role: step.agent_role,
          input_summary: `步骤 ${step.step}：${step.summary}`,
          output_summary: "本地动作执行中被中断（步骤回退为 pending）",
          detail: `中断发生在本地动作之后：已写证据 ${actionResult.evidence_refs.join("、")}；可 resume 后重跑本步骤。`,
          tokens: outcome.tokens,
          status: "blocked",
          evidence_refs: actionResult.evidence_refs,
          model_mode: outcome.mode,
          interrupted: true,
        });
        return false;
      }

      // v1.4：本地动作无实现/失败时，用模型输出兜底保存为证据，避免整条 Run 被未实现动作阻断。
      let effectiveResult = actionResult;
      if (!actionResult.ok && typeof outcome.content === "string" && outcome.content.trim().length > 0) {
        try {
          const fileName = "agent-output-step-" + step.step + ".md";
          const filePath = join(evidenceDir, fileName);
          mkdirSync(evidenceDir, { recursive: true });
          writeFileSync(filePath, "# 模型输出兜底 · 步骤 " + step.step + " · " + step.agent_role + "\n\n> 本地动作未实现/失败：" + actionResult.output_summary + "\n\n" + outcome.content + "\n", "utf8");
          const rel = relative(this.root, filePath);
          effectiveResult = {
            ok: true,
            output_summary: "本地动作未实现/失败（" + actionResult.output_summary + "）；已保存模型输出作为交付证据（" + rel + "）",
            detail: "本地动作结果：" + actionResult.detail + "\n兜底：模型输出已保存为证据 " + rel,
            evidence_refs: [...actionResult.evidence_refs, rel],
          };
        } catch {
          effectiveResult = actionResult;
        }
      }

      // v1.4：本地动作返回 note 兜底（未实现）但模型给出了交付物内容时，把模型输出保存为证据；
      // 若模型输出包含 HTML 代码块/完整 HTML，则提取为 deliverable.html（让“说到的交付物”真实存在）。
      if (effectiveResult.ok && typeof outcome.content === "string" && outcome.content.trim().length > 200) {
        const noteOnly = effectiveResult.evidence_refs.every((ref) => /step-\d+-note\.md$/.test(ref));
        const produces = ["operator", "harness", "content", "research", "scout", "customer"].includes(step.agent_role);
        if (noteOnly && produces) {
          try {
            const mdPath = join(evidenceDir, "agent-output-step-" + step.step + ".md");
            writeFileSync(mdPath, "# " + step.agent_role + " · 模型输出（步骤 " + step.step + "）\n\n" + outcome.content + "\n", "utf8");
            const refs = [...effectiveResult.evidence_refs, relative(this.root, mdPath)];
            const fence = /```html\s*([\s\S]*?)```/i.exec(outcome.content);
            const raw = fence ?? /(<html[\s\S]*<\/html>)/i.exec(outcome.content);
            const html = raw !== null && raw[1] !== undefined ? raw[1].trim() : "";
            if (html.length > 100) {
              const htmlPath = join(evidenceDir, "deliverable.html");
              writeFileSync(htmlPath, html, "utf8");
              refs.push(relative(this.root, htmlPath));
            }
            effectiveResult = {
              ...effectiveResult,
              detail: effectiveResult.detail + "\n模型输出已保存：" + relative(this.root, mdPath),
              evidence_refs: refs,
            };
          } catch {
            /* 保存失败不影响主流程 */
          }
        }
      }

      const remote = outcome.mode === "remote";
      const outputSummary = remote
        ? truncate(outcome.content, 140)
        : `${effectiveResult.output_summary}（本地规则模式·未调用远程模型）`;
      const detailLines = [
        `动作：${step.action}`,
        `智能体：${step.agent_role}`,
        `模型来源：${remote ? "远程模型（remote）" : "本地规则回退（local_fallback，未调用远程模型）"}`,
      ];
      if (outcome.reason !== undefined) detailLines.push(`回退原因：${outcome.reason}`);
      detailLines.push(
        `模型摘要：${outcome.content}`,
        `本地动作结果：${effectiveResult.detail}`,
        `证据：${effectiveResult.evidence_refs.length > 0 ? effectiveResult.evidence_refs.join("、") : "（无）"}`,
      );
      const turnStatus: AgentTurnStatus = effectiveResult.ok ? "done" : "failed";
      this.addTurn(session, {
        agent_role: step.agent_role,
        input_summary: `步骤 ${step.step}：${step.summary}`,
        output_summary: outputSummary,
        detail: detailLines.join("\n"),
        tokens: outcome.tokens,
        status: turnStatus,
        evidence_refs: effectiveResult.evidence_refs,
        model_mode: outcome.mode,
      });
      step.status = effectiveResult.ok ? "done" : "blocked";
      this.addMessage(session, {
        role: "agent",
        agent_role: step.agent_role,
        kind: effectiveResult.ok ? "result" : "error",
        text: outputSummary,
        summary: truncate(outputSummary, 80),
        model_mode: outcome.mode,
      });
      if (!effectiveResult.ok) {
        session.status = "blocked";
        this.addMessage(session, {
          role: "system",
          kind: "error",
          text: `步骤 ${step.step} 本地动作失败：${effectiveResult.output_summary}`,
        });
      }
      this.recordAudit(
        session.id,
        `agent.${step.action}`,
        `step:${step.step}`,
        effectiveResult.ok ? "ok" : "blocked",
        effectiveResult.output_summary,
      );
      this.markDoneIfComplete(session);
      return effectiveResult.ok;
    } finally {
      this.abortControllers.delete(session.id);
    }
  }

  /** 执行一个 supervisor 系统动作步骤（经注入的 SystemActions/ConfigBridge；未确认不执行）。 */
  private async executeSystemStep(session: OrchestratorSession, step: PlanStep): Promise<boolean> {
    const plan = step.action_plan;
    if (plan === undefined) {
      step.status = "blocked";
      session.status = "blocked";
      this.addMessage(session, { role: "system", kind: "error", text: `步骤 ${step.step} 缺少系统动作计划` });
      return false;
    }
    step.status = "running";
    session.status = "running";
    const evidenceDir = session.evidence_dir ?? join(this.root, session.id);
    const approval = session.approvals?.[String(step.step)];
    const confirmedBy = approval?.status === "approved" ? approval.by ?? "human:console" : null;
    if (plan.requires_confirmation && confirmedBy === null) {
      // 双保险：确认门禁在 executeNextStep 已有；这里再兜底一次，绝不未确认执行。
      step.status = "pending";
      session.status = "paused";
      this.addMessage(session, {
        role: "supervisor",
        kind: "approval",
        text: `系统动作「${plan.action}」需要人工确认后才能执行（supervisor 不能绕过确认）。`,
        summary: "等待人工确认",
      });
      this.persist(session);
      return false;
    }

    let result: SystemActionResult;
    try {
      result = await this.dispatchSystemAction(session, plan);
    } catch (error) {
      result = { ok: false, summary: `系统动作执行异常：${error instanceof Error ? error.message : String(error)}` };
    }
    const evidenceRef = writeSystemActionEvidence({
      root: this.root,
      evidenceDir,
      sessionId: session.id,
      step: step.step,
      action: plan.action,
      target: plan.target,
      args: plan.args,
      risk: plan.risk,
      requires_confirmation: plan.requires_confirmation,
      confirmed_by: confirmedBy,
      result,
      nowIso: this.nowIso(),
    });
    this.addTurn(session, {
      agent_role: SUPERVISOR_ROLE,
      input_summary: `系统动作 ${plan.action}：${plan.target}（risk=${plan.risk}${plan.requires_confirmation ? "，需确认" : ""}）`,
      output_summary: result.summary,
      detail: [
        `系统动作：${plan.action}`,
        `目标：${plan.target}`,
        `参数：${JSON.stringify(plan.args)}`,
        `风险：${plan.risk}；需要确认：${plan.requires_confirmation}`,
        `确认人：${confirmedBy ?? "（免确认）"}`,
        `执行结果：${result.ok ? "成功" : "失败"} — ${result.summary}`,
        result.detail === undefined ? "" : `详情：${result.detail}`,
        `证据：${evidenceRef}`,
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
      tokens: 0,
      status: result.ok ? "done" : "failed",
      evidence_refs: [evidenceRef],
    });
    step.status = result.ok ? "done" : "blocked";
    if (result.ok) {
      this.addMessage(session, {
        role: "agent",
        agent_role: SUPERVISOR_ROLE,
        kind: "result",
        text: result.summary,
        summary: truncate(result.summary, 80),
      });
    } else {
      session.status = "blocked";
      this.addMessage(session, { role: "system", kind: "error", text: result.summary });
    }
    this.recordAudit(session.id, `system.${plan.action}`, plan.target, result.ok ? "ok" : "blocked", result.summary);
    this.markDoneIfComplete(session);
    this.persist(session);
    return result.ok;
  }

  /** 系统动作分派（依赖注入；未注入则明确 blocked，绝不假装执行）。 */
  private async dispatchSystemAction(session: OrchestratorSession, plan: ActionPlan): Promise<SystemActionResult> {
    const actions = this.systemActions;
    const missing = (): SystemActionResult => ({
      ok: false,
      summary: "未注入 SystemActions：supervisor 无法执行受管系统动作（已阻断，不假装成功）",
    });

    switch (plan.action) {
      case "listApps":
        return actions === undefined ? missing() : actions.listApps();
      case "startApp":
        return actions === undefined ? missing() : actions.startApp(plan.target);
      case "stopApp":
        return actions === undefined ? missing() : actions.stopApp(plan.target);
      case "restartApp":
        return actions === undefined ? missing() : actions.restartApp(plan.target);
      case "removeApp":
        return actions === undefined ? missing() : actions.removeApp(plan.target);
      case "listPlugins":
        return actions === undefined ? missing() : actions.listPlugins();
      case "enablePlugin":
        return actions === undefined ? missing() : actions.enablePlugin(plan.target);
      case "disablePlugin":
        return actions === undefined ? missing() : actions.disablePlugin(plan.target);
      case "removePlugin":
        return actions === undefined ? missing() : actions.removePlugin(plan.target);
      case "changeAgentModel": {
        const role = typeof plan.args.role === "string" && plan.args.role.length > 0 ? plan.args.role : plan.target;
        const providerId =
          typeof plan.args.provider_id === "string" && plan.args.provider_id.length > 0 ? plan.args.provider_id : "deepseek";
        const model = typeof plan.args.model === "string" && plan.args.model.length > 0 ? plan.args.model : "deepseek-chat";
        if (this.configBridge !== undefined) {
          const bridgeResult = await this.configBridge.setAgentModel(role, { provider_id: providerId, model });
          return { ok: bridgeResult.ok, summary: bridgeResult.summary, detail: bridgeResult.detail, data: bridgeResult.data };
        }
        if (actions !== undefined) return actions.changeAgentModel(role, { provider_id: providerId, model });
        return {
          ok: true,
          summary: `未注入 ConfigBridge：已记录模型变更意图（${role} → ${providerId}/${model}），未真实切换`,
          data: { role, provider_id: providerId, model },
        };
      }
      case "setPrompt": {
        const role = typeof plan.args.role === "string" && plan.args.role.length > 0 ? plan.args.role : plan.target || "conductor";
        const prompt =
          typeof plan.args.prompt === "string" && plan.args.prompt.trim().length > 0
            ? plan.args.prompt
            : `# ${role} 系统提示词（由 supervisor 更新）\n必须真实执行、留证、遵守审批边界、失败升级人工。`;
        if (this.configBridge !== undefined) {
          const bridgeResult =
            role === "conductor"
              ? await this.configBridge.setConductorPrompt(prompt)
              : await this.configBridge.setSystemPrompt(role, prompt);
          return { ok: bridgeResult.ok, summary: bridgeResult.summary, detail: bridgeResult.detail, data: bridgeResult.data };
        }
        if (actions !== undefined) return actions.setPrompt(role, prompt);
        return {
          ok: true,
          summary: `未注入 ConfigBridge：已记录提示词变更意图（${role}，${[...prompt].length} 字），未真实生效`,
          data: { role, prompt_length: [...prompt].length },
        };
      }
      case "delegateProject": {
        const goal =
          typeof plan.args.project_goal === "string" && plan.args.project_goal.trim().length > 0
            ? plan.args.project_goal.trim()
            : plan.target || session.goal;
        const child = this.createSessionInternal(
          {
            goal,
            kind: "project",
            mode: session.mode,
            budget_cny: session.budget_cny,
            token_limit: session.token_limit,
            title: `子项目：${truncate(goal, 30)}`,
          },
          session.id,
        );
        session.child_sessions ??= [];
        session.child_sessions.push(child.id);
        let hookSummary = "";
        if (actions !== undefined) {
          try {
            const hook = await actions.delegateProject(goal, child.id);
            if (!hook.ok) hookSummary = `（外部登记失败：${hook.summary}）`;
          } catch (error) {
            hookSummary = `（外部登记异常：${error instanceof Error ? error.message : String(error)}）`;
          }
        }
        this.persist(session);
        return {
          ok: true,
          summary: `已委派项目给 conductor：${child.id}（${truncate(goal, 30)}）${hookSummary}`,
          detail: `父会话：${session.id}；子会话：${child.id}（kind=project）；目标：${goal}`,
          data: { session_id: child.id },
        };
      }
      case "readLogs": {
        const records = this.buildRecordsSnapshot(this.nowIso());
        return {
          ok: true,
          summary: `已读取全部日志/记录：会话 ${records.sessions.length} 个，审计 ${records.audit.length} 条`,
          data: records,
        };
      }
      default:
        return { ok: false, summary: `未知系统动作：${String((plan as ActionPlan).action)}` };
    }
  }

  /** 调用模型：Token 预扣（会话级 + 配置中心）→ 远程；无 key/失败 → 本地规则回退。 */
  private async callModel(
    session: OrchestratorSession,
    role: string,
    action: string,
    messages: ModelChatMessage[],
    signal?: AbortSignal,
  ): Promise<ModelOutcome> {
    const estimate = estimateTokens(messages);
    const used = session.tokens_used ?? 0;
    if (used + estimate > session.token_limit) {
      return makeOutcome(
        { ok: false, content: "", tokens: 0, mode: "local_fallback" },
        { blocked: true, reason: `会话 Token 上限超限：已用 ${used} + 本次估算 ${estimate} > 上限 ${session.token_limit}` },
      );
    }
    let consume: TokenConsumeResult;
    try {
      consume = this.resolver.consumeTokens(estimate, { agentRole: role, action });
    } catch (error) {
      return makeOutcome(
        { ok: false, content: "", tokens: 0, mode: "local_fallback" },
        { blocked: true, reason: `Token 预算校验失败：${error instanceof Error ? error.message : String(error)}` },
      );
    }
    if (consume.ok !== true) {
      return makeOutcome(
        { ok: false, content: "", tokens: 0, mode: "local_fallback" },
        { blocked: true, reason: consume.reason ?? "Token 超限（配置中心拒绝）" },
      );
    }
    session.tokens_used = used + estimate;

    let resolution: ModelResolution;
    try {
      resolution = this.resolver.resolveAgentModel(role);
    } catch {
      resolution = localResolution();
    }

    if (resolution.has_key !== true) {
      const local = await this.localAdapter.chat({ resolution, messages, ...(signal === undefined ? {} : { signal }) });
      return makeOutcome(
        { ok: true, content: local.content, tokens: local.tokens_used > 0 ? local.tokens_used : estimate, mode: "local_fallback" },
        { reason: "未配置 API 密钥：使用本地规则模式（未发起网络请求）" },
      );
    }

    let remote: ModelChatResult;
    try {
      remote = await this.adapter.chat({ resolution, messages, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      remote = {
        ok: false,
        content: "",
        tokens_used: 0,
        mode: "local_fallback",
        error: `模型调用异常：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (signal?.aborted === true) {
      return makeOutcome(
        { ok: false, content: "", tokens: 0, mode: "local_fallback" },
        { reason: "模型调用被中断", aborted: true },
      );
    }
    if (remote.ok !== true || remote.content.trim().length === 0) {
      const local = await this.localAdapter.chat({ resolution, messages, ...(signal === undefined ? {} : { signal }) });
      return makeOutcome(
        { ok: true, content: local.content, tokens: local.tokens_used > 0 ? local.tokens_used : estimate, mode: "local_fallback" },
        { reason: `远程模型调用失败，已回退本地规则模式：${remote.error ?? "响应为空"}` },
      );
    }
    return {
      ok: true,
      content: remote.content,
      tokens: remote.tokens_used > 0 ? remote.tokens_used : estimate,
      mode: remote.mode === "remote" ? "remote" : "local_fallback",
    };
  }

  // -------------------------------------------------------------------------
  // 内部：状态/消息/轮次/审计/持久化
  // -------------------------------------------------------------------------

  private requireSession(sessionId: string): OrchestratorSession {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new OrchestratorValidationError("sessionId 不能为空", "INVALID_INPUT", "sessionId");
    }
    const id = sessionId.trim();
    const session = this.sessions.get(id);
    if (session === undefined) throw new OrchestratorNotFoundError(`未找到编排会话：${id}`, id);
    return session;
  }

  private nextSessionId(): string {
    const stamp = this.nowDate().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      this.sessionSeq += 1;
      const candidate = `sess-${stamp}-${String(this.sessionSeq).padStart(4, "0")}`;
      if (!this.sessions.has(candidate)) return candidate;
    }
    throw new OrchestratorValidationError("会话 id 生成失败（重复过多）", "INVALID_INPUT", "sessionId");
  }

  private initializeWorkspace(session: OrchestratorSession): void {
    if (session.evidence_dir !== undefined) return;
    if (session.kind === "project") session.project_id = `proj-${session.id}`;
    session.evidence_dir = join(this.root, session.id);
    mkdirSync(session.evidence_dir, { recursive: true });
    this.addMessage(session, {
      role: session.kind === "system" ? "supervisor" : "conductor",
      kind: "result",
      text:
        session.kind === "system"
          ? `系统工作区已创建：${session.evidence_dir}；开始执行 supervisor 受管动作（危险动作会先请求人工确认）。`
          : `项目已创建：${session.project_id}；开始按计划派发专项智能体执行（每步日志/证据可在运行详情查看）。`,
      summary: session.kind === "system" ? "系统工作区已创建" : "项目已创建",
    });
    this.recordAudit(session.id, "workspace.create", session.id, "ok", session.evidence_dir);
  }

  private markDoneIfComplete(session: OrchestratorSession): void {
    if (session.plan.length === 0) return;
    if (!session.plan.every((step) => step.status === "done")) return;
    if (session.status === "done") return;
    session.status = "done";
    this.addMessage(session, {
      role: session.kind === "system" ? "supervisor" : "conductor",
      kind: "result",
      text:
        session.kind === "system"
          ? `全部系统动作已完成（${session.plan.length} 个）：可在运行详情查看动作证据与审计记录。`
          : `全部计划步骤已完成（${session.plan.length} 步）：交付物、质检、证据核查、事件与收款请求均已生成，可在运行详情查看证据。`,
      summary: "执行完成",
    });
    this.recordAudit(session.id, "run.done", session.id, "ok", `${session.plan.length} steps`);
  }

  private requiresApprovalByDefault(step: PlanStep): boolean {
    if (this.autoApprove) return false;
    return APPROVAL_REQUIRED_ROLES.includes(step.agent_role);
  }

  private wasInterrupted(session: OrchestratorSession, controller: AbortController): boolean {
    return session.status === "interrupted" || controller.signal.aborted;
  }

  private blockSession(
    session: OrchestratorSession,
    reason: string,
    role: string,
    outcome: ModelOutcome,
  ): OrchestratorSession {
    session.status = "blocked";
    this.addTurn(session, {
      agent_role: role,
      input_summary: "计划生成",
      output_summary: `被阻断：${reason}`,
      detail: reason,
      tokens: 0,
      status: "blocked",
      evidence_refs: [],
      model_mode: outcome.mode,
    });
    this.addMessage(session, { role: "system", kind: "error", text: reason });
    this.recordAudit(session.id, "plan.blocked", session.id, "blocked", reason);
    this.persist(session);
    return cloneSession(session);
  }

  private addMessage(
    session: OrchestratorSession,
    input: { role: ChatRole; kind: ChatKind; text: string; summary?: string; agent_role?: string; model_mode?: "remote" | "local_fallback" },
  ): ChatMessage {
    const entry: ChatMessage = {
      id: `msg-${String(session.messages.length + 1).padStart(3, "0")}`,
      role: input.role,
      text: input.text,
      at: this.nowIso(),
      kind: input.kind,
    };
    if (input.summary !== undefined) entry.summary = input.summary;
    if (input.agent_role !== undefined) entry.agent_role = input.agent_role;
    if (input.model_mode !== undefined) entry.model_mode = input.model_mode;
    session.messages.push(entry);
    session.updated_at = this.nowIso();
    return entry;
  }

  private addTurn(
    session: OrchestratorSession,
    input: {
      agent_role: string;
      input_summary: string;
      output_summary: string;
      detail: string;
      tokens: number;
      status: AgentTurnStatus;
      evidence_refs: string[];
      model_mode?: "remote" | "local_fallback";
      interrupted?: boolean;
    },
  ): AgentTurn {
    const seq =
      Object.values(session.children).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0) + 1;
    const turn: AgentTurn = {
      seq,
      at: this.nowIso(),
      agent_role: input.agent_role,
      input_summary: input.input_summary,
      output_summary: input.output_summary,
      detail: input.detail,
      tokens: Math.max(0, Math.floor(input.tokens)),
      status: input.status,
      evidence_refs: [...input.evidence_refs],
    };
    if (input.model_mode !== undefined) turn.model_mode = input.model_mode;
    if (input.interrupted === true) turn.interrupted = true;
    const list = session.children[input.agent_role];
    if (Array.isArray(list)) list.push(turn);
    else session.children[input.agent_role] = [turn];
    session.updated_at = this.nowIso();
    return turn;
  }

  private flattenTurns(session: OrchestratorSession): AgentTurn[] {
    const turns: AgentTurn[] = [];
    for (const list of Object.values(session.children)) {
      if (!Array.isArray(list)) continue;
      for (const turn of list) turns.push({ ...turn, evidence_refs: [...turn.evidence_refs] });
    }
    turns.sort((left, right) => left.seq - right.seq);
    return turns;
  }

  private buildRecordsSnapshot(nowIso: string): RecordsSnapshot {
    const sessions = [...this.sessions.values()]
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((session) => ({
        id: session.id,
        kind: session.kind,
        status: session.status,
        goal: session.goal,
        parent_id: session.parent_id ?? null,
        messages: session.messages.length,
        turns: this.flattenTurns(session).length,
        plan_steps: session.plan.length,
      }));
    return { generated_at: nowIso, sessions, audit: this.auditLog() };
  }

  private persist(session: OrchestratorSession): void {
    session.updated_at = this.nowIso();
    this.store.save(session);
  }

  private loadAudit(): void {
    if (!existsSync(this.auditPath)) return;
    try {
      const lines = readFileSync(this.auditPath, "utf8").split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as AuditEntry;
          if (typeof parsed === "object" && parsed !== null && typeof parsed.seq === "number") {
            this.auditEntries.push(parsed);
          }
        } catch {
          /* 跳过损坏行 */
        }
      }
      this.auditSeq = this.auditEntries.reduce((max, entry) => Math.max(max, entry.seq), 0);
    } catch {
      /* 审计文件不可读时从空开始 */
    }
  }

  /** 追加审计（内存 + `<root>/orchestrator/audit.jsonl` 只追加）。 */
  private recordAudit(sessionId: string, action: string, object: string, result: AuditResult, reason: string): AuditEntry {
    this.auditSeq += 1;
    const entry: AuditEntry = {
      seq: this.auditSeq,
      at: this.nowIso(),
      session_id: sessionId,
      action,
      object,
      result,
      reason: truncate(reason.replace(/\s+/gu, " "), 400),
    };
    this.auditEntries.push(entry);
    try {
      mkdirSync(this.store.sessionsDir, { recursive: true });
      appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* 审计落盘失败不影响主流程（内存仍保留） */
    }
    return entry;
  }

  private nowDate(): Date {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new OrchestratorValidationError("now() 必须返回合法 Date", "INVALID_INPUT", "now");
    }
    return value;
  }

  private nowIso(): string {
    return this.nowDate().toISOString();
  }

  private safePrompt(read: () => string, fallback: string): string {
    try {
      const value = read();
      return typeof value === "string" && value.trim().length > 0 ? value : fallback;
    } catch {
      return fallback;
    }
  }

  private conductorHistory(session: OrchestratorSession): ModelChatMessage[] {
    const history: ModelChatMessage[] = [];
    for (const message of session.messages) {
      if (message.role === "user") history.push({ role: "user", content: message.text });
      else if ((message.role === "conductor" || message.role === "supervisor") && message.kind !== "approval") {
        history.push({ role: "assistant", content: message.text });
      }
    }
    return history.slice(-8);
  }

  private buildConductorDetail(outcome: ModelOutcome, session: OrchestratorSession, fallbackNote?: string): string {
    const lines = [
      `模型来源：${outcome.mode === "remote" ? "远程模型（remote）" : "本地规则回退（local_fallback，未调用远程模型）"}`,
    ];
    if (fallbackNote !== undefined) lines.push(`回退说明：${fallbackNote}`);
    lines.push(`模型原始输出：${outcome.content}`, "解析后的计划：");
    for (const step of session.plan) {
      if (step.action_plan !== undefined) {
        lines.push(
          `- 步骤 ${step.step}：[${step.action_plan.risk}] ${step.action_plan.action} → ${step.action_plan.target}${step.action_plan.requires_confirmation ? "（需人工确认）" : ""} — ${step.summary}`,
        );
      } else {
        lines.push(`- 步骤 ${step.step}：${step.agent_role} / ${step.action} — ${step.summary}`);
      }
    }
    return lines.join("\n");
  }

  private renderPlanText(session: OrchestratorSession, usedFallback: boolean, fallbackNote?: string): string {
    const title = session.kind === "system" ? "supervisor 系统动作计划" : "总调度计划";
    const lines = [`${title}（共 ${session.plan.length} 步）：`];
    for (const step of session.plan) {
      if (step.action_plan !== undefined) {
        lines.push(
          `${step.step}. [${step.action_plan.risk}] ${step.action_plan.action} → ${step.action_plan.target} — ${step.summary}${step.action_plan.requires_confirmation ? "（需人工确认）" : ""}`,
        );
      } else {
        lines.push(`${step.step}. ${step.agent_role} / ${step.action} — ${step.summary}`);
      }
    }
    if (usedFallback) {
      lines.push("", `> 本次计划由本地规则模式生成（未调用远程模型）${fallbackNote === undefined ? "" : `：${fallbackNote}`}。`);
    }
    return lines.join("\n");
  }
}

/** 默认总调度系统提示词（resolver 未提供时兜底）。 */
export const DEFAULT_CONDUCTOR_PROMPT = `你是代掌 Steward 的总调度 AI（conductor）。
职责：把用户目标拆成可验收的最小计划，派发给专项智能体（operator 执行 / harness 写代码质检 /
reviewer 核查 / finance 财务 / backend 后台 / scout 找客户 / customer 客户 / content 内容 / research 调研）。
约束：只输出 JSON 计划；不得编造完成结果；对外动作必须人工确认；没有证据的“成功”视为未完成。`;

/** 默认 supervisor 系统总控提示词（resolver 未提供时兜底）。 */
export const DEFAULT_SUPERVISOR_PROMPT = `你是代掌 Steward 的系统总控 AI（supervisor）。
职责：接收用户亲自下达的**系统级命令**，管理受管程序/插件、切换各智能体模型与提示词、
读取全部日志记录、把项目委派给 conductor。
约束：只输出 JSON 系统动作计划；删除类动作风险高、必须人工确认；AI 不代签、不绕过确认；
不得再派生 supervisor；conductor 只做项目执行、不得操作系统；所有动作留证并写审计。`;
