/**
 * RunManager：v1.4 实时自动执行内核（零第三方依赖；纯逻辑 + JSON 持久化）。
 *
 * 解决用户痛点「发消息后不实时、还要手动点执行」：
 * - `createRun()` 立即返回，默认自动 `sendMessage → startProject → 循环 runStep` 直到完成/暂停；
 * - 每条事件进实时事件流（`subscribeRun/subscribeAll`，支持 `sinceSeq` 回放，用于 SSE/终端流式）；
 * - 审批策略（auto_low_risk / auto_all / manual）+ 并发队列（默认 3）+ 中断/恢复/暂停；
 * - 失败自动返工（rework_limit）+ 事件/记录持久化 + 重连可恢复。
 *
 * 与 orchestrator 解耦：只通过注入的 `OrchestratorRuntimePort` 调用；orchestrator 抛错 → run failed（不产生 unhandled rejection）。
 */

import { join } from "node:path";

import { RuntimeNotFoundError, RuntimeTimeoutError, RuntimeValidationError } from "./errors.js";
import { evaluateApprovalPolicy } from "./policy.js";
import { RunStore } from "./store.js";
import type {
  ApprovalMode,
  CreateRunInput,
  PersistedRunState,
  RunRecord,
  RunStatus,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeOptions,
  RuntimePlanStepView,
  RuntimeSessionView,
  RuntimeSettingsView,
} from "./types.js";

// ---------------------------------------------------------------------------
// 常量与默认值
// ---------------------------------------------------------------------------

/** 默认设置。 */
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettingsView = {
  auto_run: true,
  approval_mode: "auto_low_risk",
  full_auto: false,
  max_auto_steps: 200,
  rework_limit: 1,
  event_retention: 1_000,
};

export const DEFAULT_MAX_CONCURRENT_RUNS = 3;
export const DEFAULT_POLL_INTERVAL_MS = 50;
/** 自动返工时发给总调度的修正提示（固定文案，便于测试/审计）。 */
export const REWORK_PROMPT = "上一步失败，请修正后继续";

const APPROVAL_MODE_SET: ReadonlySet<string> = new Set<ApprovalMode>(["auto_low_risk", "auto_all", "manual"]);
const TERMINAL_STATUSES: readonly RunStatus[] = ["done", "blocked", "failed"];
const ADVANCE_SESSION_STATUSES: readonly string[] = ["running", "active", "planning"];

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(typeof text === "string" ? text : "");
  if (chars.length <= maxChars) return chars.join("");
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

function requireString(value: unknown, field: string, message?: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeValidationError(message ?? `${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function requireInt(value: unknown, field: string, options: { min: number; max: number }): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RuntimeValidationError(`${field} 必须是整数`, "CONFIG", field);
  }
  if (value < options.min || value > options.max) {
    throw new RuntimeValidationError(`${field} 必须在 ${options.min}–${options.max} 之间`, "CONFIG", field);
  }
  return value;
}

/** 归一化运行设置（含校验；部分 patch）。 */
export function normalizeRuntimeSettings(
  patch: Partial<RuntimeSettingsView> | undefined,
  base: RuntimeSettingsView = DEFAULT_RUNTIME_SETTINGS,
): RuntimeSettingsView {
  const input = isRecord(patch) ? patch : {};
  const settings: RuntimeSettingsView = { ...base };
  if (input.auto_run !== undefined) {
    if (typeof input.auto_run !== "boolean") throw new RuntimeValidationError("auto_run 必须是布尔值", "CONFIG", "auto_run");
    settings.auto_run = input.auto_run;
  }
  if (input.approval_mode !== undefined) {
    if (typeof input.approval_mode !== "string" || !APPROVAL_MODE_SET.has(input.approval_mode)) {
      throw new RuntimeValidationError("approval_mode 必须是 auto_low_risk / auto_all / manual", "CONFIG", "approval_mode");
    }
    settings.approval_mode = input.approval_mode as ApprovalMode;
  }
  if (input.full_auto !== undefined) {
    if (typeof input.full_auto !== "boolean") throw new RuntimeValidationError("full_auto 必须是布尔值", "CONFIG", "full_auto");
    settings.full_auto = input.full_auto;
  }
  if (input.max_auto_steps !== undefined) {
    settings.max_auto_steps = requireInt(input.max_auto_steps, "max_auto_steps", { min: 1, max: 100_000 });
  }
  if (input.rework_limit !== undefined) {
    settings.rework_limit = requireInt(input.rework_limit, "rework_limit", { min: 0, max: 10 });
  }
  if (input.event_retention !== undefined) {
    settings.event_retention = requireInt(input.event_retention, "event_retention", { min: 10, max: 100_000 });
  }
  return settings;
}

interface RunInternalState {
  reworks: number;
  project_started: boolean;
  plan_ready: boolean;
  rejected_by_human: boolean;
}

type RuntimeListener = (event: RuntimeEvent) => void;

// ---------------------------------------------------------------------------
// RunManager
// ---------------------------------------------------------------------------

export class RunManager {
  private readonly port: RuntimeOptions["orchestrator"];
  private readonly store: RunStore;
  private readonly now: () => Date;
  private readonly maxConcurrentRuns: number;
  private readonly pollIntervalMs: number;
  private settings: RuntimeSettingsView;

  private readonly runs = new Map<string, RunRecord>();
  private readonly internals = new Map<string, RunInternalState>();
  private readonly events = new Map<string, RuntimeEvent[]>();
  private readonly listeners = new Map<string, Set<RuntimeListener>>();
  private readonly allListeners = new Set<RuntimeListener>();
  private readonly activeRuns = new Set<string>();
  private readonly pumpQueue: string[] = [];
  private readonly watchers = new Map<string, NodeJS.Timeout>();
  private readonly trackedSteps = new Map<string, Map<number, string>>();
  private readonly seenTurns = new Map<string, Map<string, number>>();
  private readonly seeded = new Set<string>();
  private runSeq = 0;

  constructor(options: RuntimeOptions) {
    if (!isRecord(options) || !isRecord(options.orchestrator)) {
      throw new RuntimeValidationError("RunManager 构造参数非法：需要 { orchestrator } 对象", "CONFIG", "orchestrator");
    }
    for (const name of [
      "createSession",
      "sendMessage",
      "startProject",
      "runStep",
      "getSession",
      "decideApproval",
      "interrupt",
      "resume",
    ]) {
      if (typeof options.orchestrator[name] !== "function") {
        throw new RuntimeValidationError(`orchestrator 缺少方法 ${name}`, "CONFIG", "orchestrator");
      }
    }
    this.port = options.orchestrator;
    this.now = typeof options.now === "function" ? options.now : () => new Date();
    this.settings = normalizeRuntimeSettings(options.settings);
    const root =
      typeof options.root === "string" && options.root.trim().length > 0
        ? options.root.trim()
        : join(process.cwd(), ".steward", "runtime");
    this.store = new RunStore(root);
    this.maxConcurrentRuns =
      typeof options.maxConcurrentRuns === "number" && Number.isInteger(options.maxConcurrentRuns) && options.maxConcurrentRuns > 0
        ? options.maxConcurrentRuns
        : DEFAULT_MAX_CONCURRENT_RUNS;
    this.pollIntervalMs =
      typeof options.pollIntervalMs === "number" && Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0
        ? Math.max(1, Math.floor(options.pollIntervalMs))
        : DEFAULT_POLL_INTERVAL_MS;
    this.restore();
  }

  // -------------------------------------------------------------------------
  // 设置
  // -------------------------------------------------------------------------

  /** 当前设置（只读副本）。 */
  get settingsView(): RuntimeSettingsView {
    return { ...this.settings };
  }

  /** 更新设置（校验；影响后续调度/审批判定）。 */
  updateSettings(patch: Partial<RuntimeSettingsView>): RuntimeSettingsView {
    this.settings = normalizeRuntimeSettings(patch, this.settings);
    return { ...this.settings };
  }

  // -------------------------------------------------------------------------
  // Run 生命周期
  // -------------------------------------------------------------------------

  /**
   * 创建 Run：**立即返回**（不等执行完）；默认自动开始执行（settings.auto_run / autoStart）。
   * orchestrator.createSession 同步创建会话；之后自动 sendMessage→startProject→runStep。
   */
  async createRun(input: CreateRunInput): Promise<RunRecord> {
    if (!isRecord(input)) throw new RuntimeValidationError("createRun 需要 { goal } 对象", "INVALID_INPUT", "input");
    const goal = requireString(input.goal, "goal", "目标 goal 不能为空");
    const kind: "project" | "system" = input.kind === "system" ? "system" : "project";
    const sessionInput = {
      goal,
      kind,
      ...(input.budget_cny === undefined ? {} : { budget_cny: input.budget_cny }),
      ...(input.token_limit === undefined ? {} : { token_limit: input.token_limit }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
    };
    const session = this.port.createSession(sessionInput);
    const sessionId = requireString(isRecord(session) ? session.id : undefined, "session.id", "orchestrator.createSession 必须返回 { id }");
    const nowIso = this.nowIso();
    const run: RunRecord = {
      run_id: this.nextRunId(),
      session_id: sessionId,
      goal,
      kind,
      status: "queued",
      created_at: nowIso,
      updated_at: nowIso,
      steps_total: 0,
      steps_done: 0,
      token_used: 0,
      event_seq: 0,
    };
    this.runs.set(run.run_id, run);
    this.internals.set(run.run_id, {
      reworks: 0,
      project_started: false,
      plan_ready: false,
      rejected_by_human: false,
    });
    this.events.set(run.run_id, []);
    const autoStart = input.autoStart === undefined ? this.settings.auto_run : input.autoStart === true;
    this.emit(run, "run.queued", { goal, kind, auto_start: autoStart, session_id: sessionId });
    if (autoStart) this.requestPump(run.run_id);
    return clone(run);
  }

  /** 全部 Run（按创建时间倒序；副本）。 */
  listRuns(): RunRecord[] {
    return [...this.runs.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((run) => clone(run));
  }

  /** 单个 Run（不存在 → null；副本）。 */
  getRun(runId: string): RunRecord | null {
    const run = this.runs.get(this.requireRunId(runId));
    return run === undefined ? null : clone(run);
  }

  /** 手动开始一个 queued Run（auto_run=false 时用）。 */
  async startRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    if (run.status === "queued") {
      this.requestPump(run.run_id);
      return;
    }
    if (run.status === "paused") {
      await this.resumeRun(runId);
    }
  }

  /** 暂停：queued 直接暂停；running 在当前步骤结束后停止推进。 */
  async pauseRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    if (TERMINAL_STATUSES.includes(run.status) || run.status === "paused" || run.status === "interrupted" || run.status === "awaiting_approval") {
      return;
    }
    if (run.status === "queued") {
      const index = this.pumpQueue.indexOf(run.run_id);
      if (index >= 0) this.pumpQueue.splice(index, 1);
    }
    this.setStatus(run, "paused");
    this.emit(run, "run.paused", { reason: "user_pause" });
    this.persistRuns();
  }

  /** 恢复：paused/awaiting_approval/interrupted → 继续自动执行。 */
  async resumeRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    if (TERMINAL_STATUSES.includes(run.status)) return;
    if (run.status === "interrupted") {
      try {
        this.port.resume(run.session_id);
      } catch (error) {
        this.failRun(run, `恢复 orchestrator 会话失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.setStatus(run, "running");
      this.emit(run, "run.resumed", { reason: "interrupt_resume" });
      this.requestPump(run.run_id);
      return;
    }
    if (run.status === "paused" || run.status === "awaiting_approval") {
      this.setStatus(run, "running");
      this.emit(run, "run.resumed", { reason: "user_resume" });
      this.requestPump(run.run_id);
      return;
    }
    if (run.status === "queued") {
      this.requestPump(run.run_id);
    }
  }

  /** 打断：在步骤边界停止（orchestrator interrupt），可 resume 继续。 */
  async interruptRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    if (TERMINAL_STATUSES.includes(run.status) || run.status === "interrupted") return;
    const index = this.pumpQueue.indexOf(run.run_id);
    if (index >= 0) this.pumpQueue.splice(index, 1);
    try {
      this.port.interrupt(run.session_id, "用户打断");
    } catch {
      /* orchestrator 已结束等情况：仍标记 interrupted */
    }
    this.setStatus(run, "interrupted");
    this.emit(run, "run.interrupted", { reason: "user_interrupt" });
    this.persistRuns();
  }

  /** 人工审批/确认：approve → 继续执行；reject → 该步 blocked、Run blocked（不自动返工）。 */
  async approve(runId: string, step: number, decision: "approve" | "reject", by = "human:console"): Promise<void> {
    const run = this.requireRun(runId);
    if (typeof step !== "number" || !Number.isInteger(step) || step < 1) {
      throw new RuntimeValidationError("step 必须是 ≥1 的整数步骤号", "INVALID_INPUT", "step");
    }
    if (decision !== "approve" && decision !== "reject") {
      throw new RuntimeValidationError("decision 必须是 approve / reject", "INVALID_INPUT", "decision");
    }
    if (run.status !== "awaiting_approval" && run.status !== "paused" && run.status !== "running") {
      throw new RuntimeValidationError(`当前 Run 状态为 ${run.status}，不在等待审批`, "INVALID_INPUT", "status");
    }
    try {
      this.port.decideApproval(run.session_id, step, decision);
    } catch (error) {
      throw new RuntimeValidationError(
        `提交审批结果失败：${error instanceof Error ? error.message : String(error)}`,
        "INVALID_INPUT",
        "approval",
      );
    }
    const reviewer = typeof by === "string" && by.trim().length > 0 ? by.trim() : "human:console";
    if (decision === "reject") {
      const internal = this.internalFor(run.run_id);
      internal.rejected_by_human = true;
      run.pending_approval = undefined;
      this.setStatus(run, "blocked");
      this.emit(run, "run.blocked", { reason: "rejected_by_human", step, by: reviewer });
      this.persistRuns();
      return;
    }
    run.pending_approval = undefined;
    this.setStatus(run, "running");
    this.emit(run, "run.resumed", { reason: "human_approved", step, by: reviewer });
    this.requestPump(run.run_id);
  }

  // -------------------------------------------------------------------------
  // 事件订阅 / 查询
  // -------------------------------------------------------------------------

  /** 订阅单个 Run：先回放 `seq > sinceSeq` 的保留事件，再实时接收；返回取消订阅函数。 */
  subscribeRun(runId: string, listener: RuntimeListener, sinceSeq = 0): () => void {
    const run = this.requireRun(runId);
    if (typeof listener !== "function") throw new RuntimeValidationError("listener 必须是函数", "INVALID_INPUT", "listener");
    const set = this.listeners.get(run.run_id) ?? new Set<RuntimeListener>();
    this.listeners.set(run.run_id, set);
    set.add(listener);
    const replay = (this.events.get(run.run_id) ?? []).filter((event) => event.seq > sinceSeq);
    for (const event of replay) {
      try {
        listener(clone(event));
      } catch {
        /* 订阅方异常不影响内核 */
      }
    }
    return () => {
      set.delete(listener);
    };
  }

  /** 订阅全部 Run 的实时事件（不重放；刷新后按 run 用 subscribeRun 回放）。 */
  subscribeAll(listener: RuntimeListener): () => void {
    if (typeof listener !== "function") throw new RuntimeValidationError("listener 必须是函数", "INVALID_INPUT", "listener");
    this.allListeners.add(listener);
    return () => {
      this.allListeners.delete(listener);
    };
  }

  /** 事件日志（保留窗口内；`seq > sinceSeq`）。 */
  eventLog(runId: string, sinceSeq = 0): RuntimeEvent[] {
    const run = this.requireRun(runId);
    return (this.events.get(run.run_id) ?? [])
      .filter((event) => event.seq > sinceSeq)
      .map((event) => clone(event));
  }

  /** 等待 Run 进入指定状态之一（测试/CLI 用；超时抛 RuntimeTimeoutError）。 */
  async waitFor(runId: string, statuses: RunStatus[], timeoutMs = 15_000): Promise<RunRecord> {
    this.requireRun(runId);
    if (!Array.isArray(statuses) || statuses.length === 0) {
      throw new RuntimeValidationError("statuses 必须是非空数组", "INVALID_INPUT", "statuses");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RuntimeValidationError("timeoutMs 必须 > 0", "INVALID_INPUT", "timeoutMs");
    }
    const target = this.runs.get(runId) as RunRecord;
    if (statuses.includes(target.status)) return clone(target);
    const intervalMs = Math.max(2, Math.min(10, this.pollIntervalMs));
    const startedAt = Date.now();
    return new Promise<RunRecord>((resolve, reject) => {
      const timer = setInterval(() => {
        const run = this.runs.get(runId);
        if (run === undefined) {
          clearInterval(timer);
          reject(new RuntimeNotFoundError(`Run 已不存在：${runId}`, runId));
          return;
        }
        if (statuses.includes(run.status)) {
          clearInterval(timer);
          resolve(clone(run));
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(
            new RuntimeTimeoutError(
              `等待 Run ${runId} 进入 [${statuses.join(", ")}] 超时（${timeoutMs}ms，当前 ${run.status}）`,
              runId,
              Date.now() - startedAt,
            ),
          );
        }
      }, intervalMs);
    });
  }

  // -------------------------------------------------------------------------
  // 内部：调度与执行
  // -------------------------------------------------------------------------

  private requireRunId(runId: unknown): string {
    if (typeof runId !== "string" || runId.trim().length === 0) {
      throw new RuntimeValidationError("runId 不能为空", "INVALID_INPUT", "runId");
    }
    return runId.trim();
  }

  private requireRun(runId: unknown): RunRecord {
    const id = this.requireRunId(runId);
    const run = this.runs.get(id);
    if (run === undefined) throw new RuntimeNotFoundError(`未找到 Run：${id}`, id);
    return run;
  }

  private internalFor(runId: string): RunInternalState {
    const existing = this.internals.get(runId);
    if (existing !== undefined) return existing;
    const created: RunInternalState = { reworks: 0, project_started: false, plan_ready: false, rejected_by_human: false };
    this.internals.set(runId, created);
    return created;
  }

  private nextRunId(): string {
    const stamp = this.nowDate().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      this.runSeq += 1;
      const candidate = `run-${stamp}-${String(this.runSeq).padStart(4, "0")}`;
      if (!this.runs.has(candidate)) return candidate;
    }
    throw new RuntimeValidationError("Run id 生成失败（重复过多）", "INVALID_INPUT", "runId");
  }

  /** 申请执行槽：不阻塞调用者，由 scheduler 按 maxConcurrentRuns 调度。 */
  private requestPump(runId: string): void {
    if (this.activeRuns.has(runId) || this.pumpQueue.includes(runId)) return;
    this.pumpQueue.push(runId);
    this.schedule();
  }

  private schedule(): void {
    while (this.activeRuns.size < this.maxConcurrentRuns && this.pumpQueue.length > 0) {
      const runId = this.pumpQueue.shift();
      if (runId === undefined) return;
      const run = this.runs.get(runId);
      if (run === undefined) continue;
      if (run.status !== "queued" && run.status !== "running") continue;
      this.activeRuns.add(runId);
      void this.pump(runId)
        .catch(() => {
          /* pump 内部已兜底；这里避免 unhandled rejection */
        })
        .finally(() => {
          this.activeRuns.delete(runId);
          this.schedule();
        });
    }
  }

  /** 自动执行主循环：sendMessage → startProject → 循环 runStep，直到 done/暂停/打断/失败。 */
  private async pump(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) return;
    if (run.status === "queued") {
      this.setStatus(run, "running");
      this.emit(run, "run.started", { goal: run.goal, kind: run.kind, session_id: run.session_id });
    }
    if (run.status !== "running") return;
    const internal = this.internalFor(run.run_id);
    let autoSteps = 0;
    try {
      let session = this.port.getSession(run.session_id);
      if (!this.seeded.has(run.run_id)) {
        this.seedTracking(run, session);
        this.seeded.add(run.run_id);
      }
      this.syncProgress(run, session);
      if (session.plan.length === 0) {
        this.emit(run, "plan.generating", { goal: run.goal, kind: run.kind });
        await this.port.sendMessage(run.session_id, run.goal);
        session = this.port.getSession(run.session_id);
        internal.plan_ready = false;
        internal.project_started = false;
        this.trackedSteps.delete(run.run_id);
        this.syncProgress(run, session);
      }

      while (autoSteps < this.settings.max_auto_steps) {
        if (run.status !== "running") break;
        session = this.port.getSession(run.session_id);
        this.syncProgress(run, session);
        if (run.status !== "running") break;
        const sessionStatus = String(session.status);

        if (sessionStatus === "done") {
          this.finishDone(run);
          break;
        }
        if (sessionStatus === "interrupted") {
          this.setStatus(run, "interrupted");
          this.emit(run, "run.interrupted", { reason: "orchestrator interrupted" });
          break;
        }
        if (sessionStatus === "blocked") {
          if (await this.tryRework(run, session, internal)) {
            autoSteps += 1;
            continue;
          }
          run.error = run.error ?? this.extractLastError(session);
          this.setStatus(run, "blocked");
          this.emit(run, "run.blocked", { reason: run.error });
          break;
        }
        if (sessionStatus === "paused") {
          const pending = this.findPendingApproval(session);
          if (pending === null) {
            this.setStatus(run, "paused");
            this.emit(run, "run.paused", { reason: "orchestrator_paused" });
            break;
          }
          const decision = evaluateApprovalPolicy(pending, this.settings);
          if (decision.decision === "wait_human") {
            const pendingApproval: RunRecord["pending_approval"] = { step: pending.step, summary: pending.summary };
            if (decision.risk.length > 0) pendingApproval.risk = decision.risk;
            run.pending_approval = pendingApproval;
            this.setStatus(run, "awaiting_approval");
            this.emit(run, "approval.required", {
              step: pending.step,
              agent_role: pending.agent_role,
              action: pending.action,
              summary: pending.summary,
              risk: decision.risk,
              dangerous: decision.dangerous,
              requires_confirmation:
                pending.action_plan?.requires_confirmation === true || pending.requires_approval === true,
              approval_mode: this.settings.approval_mode,
              reason: decision.reason,
              message: `需要人工确认：步骤 ${pending.step}「${pending.summary}」（风险=${decision.risk}）`,
            });
            this.emit(run, "run.paused", { reason: "awaiting_approval", step: pending.step });
            break;
          }
          try {
            this.port.decideApproval(run.session_id, pending.step, "approve");
          } catch (error) {
            throw new Error(`自动批准步骤 ${pending.step} 失败：${error instanceof Error ? error.message : String(error)}`);
          }
          run.pending_approval = undefined;
          this.emit(run, "run.resumed", {
            reason: "auto_approved",
            step: pending.step,
            risk: decision.risk,
            policy: decision.reason,
          });
          autoSteps += 1;
          continue;
        }
        if (!ADVANCE_SESSION_STATUSES.includes(sessionStatus)) {
          this.failRun(run, `orchestrator 返回未知状态：${sessionStatus}`);
          break;
        }

        this.startWatcher(run);
        try {
          if (!internal.project_started) {
            internal.project_started = true;
            await this.port.startProject(run.session_id);
          } else {
            await this.port.runStep(run.session_id);
          }
        } finally {
          this.stopWatcher(run);
        }
        autoSteps += 1;
        session = this.port.getSession(run.session_id);
        this.syncProgress(run, session);
      }

      if (autoSteps >= this.settings.max_auto_steps && run.status === "running") {
        this.failRun(run, `自动执行步数超过上限 max_auto_steps=${this.settings.max_auto_steps}`);
      }
    } catch (error) {
      this.failRun(run, error instanceof Error ? error.message : String(error));
    } finally {
      this.stopWatcher(run);
      try {
        const latest = this.port.getSession(run.session_id);
        this.syncProgress(run, latest);
      } catch {
        /* 会话不可读：保持已有状态 */
      }
      this.persistRuns();
    }
  }

  /** 失败：状态 failed + 事件（不抛异常，由调用方保证无 unhandled rejection）。 */
  private failRun(run: RunRecord, message: string): void {
    if (TERMINAL_STATUSES.includes(run.status)) return;
    run.error = truncate(String(message ?? "未知错误"), 800);
    this.setStatus(run, "failed");
    this.emit(run, "run.failed", { error: run.error });
    this.persistRuns();
  }

  private finishDone(run: RunRecord): void {
    if (run.status === "done") return;
    this.setStatus(run, "done");
    run.pending_approval = undefined;
    this.emit(run, "run.completed", {
      steps_total: run.steps_total,
      steps_done: run.steps_done,
      token_used: run.token_used,
      reworks: this.internalFor(run.run_id).reworks,
    });
    this.persistRuns();
  }

  /** 返工：阻塞且非人工驳回时，重新规划并重试（最多 rework_limit 次）。 */
  private async tryRework(
    run: RunRecord,
    session: RuntimeSessionView,
    internal: RunInternalState,
  ): Promise<boolean> {
    if (internal.rejected_by_human) return false;
    if (internal.reworks >= this.settings.rework_limit) return false;
    internal.reworks += 1;
    internal.project_started = false;
    internal.plan_ready = false;
    run.error = this.extractLastError(session);
    this.setStatus(run, "running");
    this.emit(run, "run.resumed", {
      reason: "rework",
      attempt: internal.reworks,
      max: this.settings.rework_limit,
      message: `上一步失败，自动重新规划并返工（第 ${internal.reworks}/${this.settings.rework_limit} 次）`,
    });
    this.trackedSteps.delete(run.run_id);
    try {
      await this.port.sendMessage(run.session_id, REWORK_PROMPT);
    } catch (error) {
      this.failRun(run, `返工重新规划失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const refreshed = this.port.getSession(run.session_id);
    this.syncProgress(run, refreshed);
    return true;
  }

  // -------------------------------------------------------------------------
  // 内部：状态/事件/同步
  // -------------------------------------------------------------------------

  private findPendingApproval(session: RuntimeSessionView): RuntimePlanStepView | null {
    const plan = Array.isArray(session.plan) ? session.plan : [];
    for (const step of plan) {
      if (String(step.status) !== "pending") continue;
      const requires =
        step.requires_approval === true || step.action_plan?.requires_confirmation === true;
      if (!requires) continue;
      const approved = session.approvals?.[String(step.step)]?.status === "approved";
      if (!approved) return step;
    }
    return null;
  }

  private extractLastError(session: RuntimeSessionView): string {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.kind === "error" && typeof message.text === "string" && message.text.trim().length > 0) {
        return truncate(message.text.trim(), 500);
      }
    }
    return "步骤执行失败/被阻塞（详见会话记录）";
  }

  private setStatus(run: RunRecord, status: RunStatus): void {
    run.status = status;
    run.updated_at = this.nowIso();
  }

  private emit(run: RunRecord, type: RuntimeEventType, data: Record<string, unknown>): RuntimeEvent {
    run.event_seq += 1;
    const event: RuntimeEvent = {
      seq: run.event_seq,
      at: this.nowIso(),
      run_id: run.run_id,
      session_id: run.session_id,
      type,
      data: this.safeData(data),
    };
    const list = this.events.get(run.run_id) ?? [];
    list.push(event);
    const limit = this.settings.event_retention;
    if (list.length > limit) list.splice(0, list.length - limit);
    this.events.set(run.run_id, list);
    run.updated_at = event.at;
    try {
      this.store.saveEvents(run.run_id, list);
    } catch {
      /* 持久化失败不阻断执行（内存事件仍在） */
    }
    this.persistRuns();
    for (const listener of this.listeners.get(run.run_id) ?? []) {
      try {
        listener(clone(event));
      } catch {
        /* 订阅方异常不影响内核 */
      }
    }
    for (const listener of this.allListeners) {
      try {
        listener(clone(event));
      } catch {
        /* 忽略 */
      }
    }
    return event;
  }

  private safeData(data: Record<string, unknown>): Record<string, unknown> {
    try {
      const serialized = JSON.stringify(data);
      const parsed = JSON.parse(serialized) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistRuns(): void {
    const states: PersistedRunState[] = [...this.runs.values()].map((run) => {
      const internal = this.internalFor(run.run_id);
      return {
        run: clone(run),
        reworks: internal.reworks,
        project_started: internal.project_started,
        plan_ready: internal.plan_ready,
        rejected_by_human: internal.rejected_by_human,
      };
    });
    try {
      this.store.saveRuns(states, this.nowIso());
    } catch {
      /* 持久化失败不阻断执行 */
    }
  }

  /** 把 orchestrator 会话进度差异转成事件（步骤/轮次/token/计数）。 */
  private syncProgress(run: RunRecord, session: RuntimeSessionView, internalState?: RunInternalState): void {
    const internal = internalState ?? this.internalFor(run.run_id);
    const plan = Array.isArray(session.plan) ? session.plan : [];

    if (!internal.plan_ready && plan.length > 0) {
      internal.plan_ready = true;
      this.emit(run, "plan.ready", {
        goal: run.goal,
        steps_total: plan.length,
        steps: plan.map((step) => ({
          step: step.step,
          agent_role: step.agent_role,
          action: step.action,
          summary: step.summary,
          risk: step.action_plan?.risk ?? null,
          requires_confirmation: step.action_plan?.requires_confirmation === true || step.requires_approval === true,
        })),
      });
    }

    const tracked = this.trackedSteps.get(run.run_id) ?? new Map<number, string>();
    for (const step of plan) {
      const status = String(step.status);
      const previous = tracked.get(step.step);
      if (previous === status) continue;
      if (status === "running") {
        this.emitStepStarted(run, step);
      } else if (status === "done" || status === "blocked") {
        if (previous !== "running") this.emitStepStarted(run, step);
        this.emitStepCompleted(run, step, status);
      }
      tracked.set(step.step, status);
    }
    this.trackedSteps.set(run.run_id, tracked);

    const seen = this.seenTurns.get(run.run_id) ?? new Map<string, number>();
    const children = session.children ?? {};
    for (const [role, turns] of Object.entries(children)) {
      if (!Array.isArray(turns)) continue;
      let last = seen.get(role) ?? 0;
      for (const turn of turns) {
        if (typeof turn.seq !== "number" || turn.seq <= last) continue;
        last = turn.seq;
        this.emit(run, "agent.turn", {
          seq: turn.seq,
          agent_role: turn.agent_role ?? role,
          input_summary: typeof turn.input_summary === "string" ? truncate(turn.input_summary, 500) : "",
          output_summary: typeof turn.output_summary === "string" ? truncate(turn.output_summary, 500) : "",
          tokens: typeof turn.tokens === "number" ? turn.tokens : 0,
          status: String(turn.status),
          model_mode: turn.model_mode ?? null,
          detail: typeof turn.detail === "string" ? truncate(turn.detail, 2000) : "",
        });
      }
      seen.set(role, last);
    }
    this.seenTurns.set(run.run_id, seen);

    const tokenUsed = this.computeTokenUsed(session);
    if (tokenUsed > run.token_used) {
      const delta = tokenUsed - run.token_used;
      run.token_used = tokenUsed;
      this.emit(run, "token.updated", {
        token_used: tokenUsed,
        tokens_delta: delta,
        source: typeof session.tokens_used === "number" ? "session" : "agent_turns",
      });
    }

    run.steps_total = plan.length;
    run.steps_done = plan.filter((step) => String(step.status) === "done").length;
    const active = plan.find((step) => String(step.status) === "running") ?? plan.find((step) => String(step.status) === "pending");
    if (active !== undefined) run.current_step = active.step;
    run.updated_at = this.nowIso();
    this.persistRuns();
  }

  private emitStepStarted(run: RunRecord, step: RuntimePlanStepView): void {
    const risk = step.action_plan?.risk ?? null;
    const requiresConfirmation = step.action_plan?.requires_confirmation === true || step.requires_approval === true;
    this.emit(run, "step.started", {
      step: step.step,
      agent_role: step.agent_role,
      action: step.action,
      summary: step.summary,
      risk,
      requires_confirmation: requiresConfirmation,
    });
    this.emit(run, "tool.called", { tool: step.action, step: step.step, agent_role: step.agent_role });
  }

  private emitStepCompleted(run: RunRecord, step: RuntimePlanStepView, status: string): void {
    this.emit(run, "step.completed", {
      step: step.step,
      agent_role: step.agent_role,
      action: step.action,
      status,
    });
    this.emit(run, "tool.result", { tool: step.action, step: step.step, status });
  }

  private computeTokenUsed(session: RuntimeSessionView): number {
    if (typeof session.tokens_used === "number" && Number.isFinite(session.tokens_used)) {
      return Math.max(0, Math.floor(session.tokens_used));
    }
    let total = 0;
    for (const turns of Object.values(session.children ?? {})) {
      if (!Array.isArray(turns)) continue;
      for (const turn of turns) total += typeof turn.tokens === "number" ? turn.tokens : 0;
    }
    return total;
  }

  /** 首次接管已存在会话（重启/恢复）时静默同步基线，避免重复事件。 */
  private seedTracking(run: RunRecord, session: RuntimeSessionView): void {
    const tracked = new Map<number, string>();
    for (const step of session.plan ?? []) tracked.set(step.step, String(step.status));
    this.trackedSteps.set(run.run_id, tracked);
    const seen = new Map<string, number>();
    for (const [role, turns] of Object.entries(session.children ?? {})) {
      let last = 0;
      if (Array.isArray(turns)) for (const turn of turns) if (typeof turn.seq === "number") last = Math.max(last, turn.seq);
      seen.set(role, last);
    }
    this.seenTurns.set(run.run_id, seen);
    run.token_used = this.computeTokenUsed(session);
    run.steps_total = (session.plan ?? []).length;
    run.steps_done = (session.plan ?? []).filter((step) => String(step.status) === "done").length;
  }

  private startWatcher(run: RunRecord): void {
    if (this.watchers.has(run.run_id)) return;
    const timer = setInterval(() => {
      try {
        const session = this.port.getSession(run.session_id);
        this.syncProgress(run, session);
      } catch {
        /* 轮询异常忽略，主循环会兜底 */
      }
    }, this.pollIntervalMs);
    this.watchers.set(run.run_id, timer);
  }

  private stopWatcher(run: RunRecord): void {
    const timer = this.watchers.get(run.run_id);
    if (timer !== undefined) {
      clearInterval(timer);
      this.watchers.delete(run.run_id);
    }
  }

  // -------------------------------------------------------------------------
  // 内部：时钟/恢复
  // -------------------------------------------------------------------------

  private nowDate(): Date {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new RuntimeValidationError("now() 必须返回合法 Date", "CONFIG", "now");
    }
    return value;
  }

  private nowIso(): string {
    return this.nowDate().toISOString();
  }

  private restore(): void {
    const states = this.store.loadRuns();
    for (const state of states) {
      const run = state.run;
      this.runs.set(run.run_id, run);
      this.internals.set(run.run_id, {
        reworks: typeof state.reworks === "number" ? state.reworks : 0,
        project_started: state.project_started === true,
        plan_ready: state.plan_ready === true,
        rejected_by_human: state.rejected_by_human === true,
      });
      const events = this.store.loadEvents(run.run_id);
      const limited =
        events.length > this.settings.event_retention ? events.slice(events.length - this.settings.event_retention) : events;
      this.events.set(run.run_id, limited);
      // 重启后不自动恢复执行：非终态且非人工暂停的 Run 标记为 paused（由 resumeRun 继续）。
      if (run.status === "running" || run.status === "queued") {
        run.status = "paused";
        run.updated_at = this.nowIso();
      }
    }
    if (states.length > 0) this.persistRuns();
  }
}
