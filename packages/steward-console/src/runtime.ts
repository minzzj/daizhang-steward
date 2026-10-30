/**
 * packages/steward-console/src/runtime.ts
 *
 * v1.4 契约：**发送即执行 + SSE 实时流**。
 *
 * - `ConsoleRuntimeProvider`：run 级运行时。`/chat` 发送消息 → `POST /api/chat/runs` 直接
 *   创建并启动 run；run 的事件（思考中/计划/每步/每 agent 轮次/审批/完成）通过 SSE
 *   `GET /api/chat/runs/:id/stream?since=<seq>` 实时推送；审批/打断/恢复一一对应。
 * - `createDemoRuntimeProvider()`：内存、确定性、自动推进（每 150ms 一个事件）的演示实现：
 *   自动生成 5 步计划 → 逐步执行（含 agent 轮次摘要/Token）→ 高风险步骤暂停等待审批 →
 *   完成/失败；刷新页面可从事件回放恢复（since=0 重放）。
 *
 * 事件类型（SSE `data` 的 `type`）：
 *   run.created / run.started / conductor.thinking / plan.created
 *   step.started / agent.turn.started / agent.turn.completed / step.completed
 *   approval.required / approval.approved / approval.rejected
 *   run.interrupted / run.resumed / run.completed / run.failed
 */

import type { MaybePromise } from "./provider.js";
import type { FlowEvent } from "./admin.js";
import type { AgentTranscript, ChatMessage, ChatPlanStep, ChatSession, EvidenceItem, RunDetail } from "./chat.js";

// ---------------------------------------------------------------------------
// 事件 / run 记录
// ---------------------------------------------------------------------------

export interface ConsoleRuntimeEvent {
  seq: number;
  at: string;
  run_id: string;
  session_id: string;
  /** 事件类型，见文件头注释。 */
  type: string;
  data: Record<string, unknown>;
}

export type RuntimeRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "interrupted"
  | "done"
  | "blocked"
  | "failed";

export interface RuntimePendingApproval {
  step: number;
  summary: string;
  risk?: string;
}

export interface ConsoleRunRecord {
  run_id: string;
  session_id: string;
  goal: string;
  status: RuntimeRunStatus;
  steps_total: number;
  steps_done: number;
  token_used: number;
  created_at: string;
  updated_at: string;
  current_step?: number;
  pending_approval?: RuntimePendingApproval;
  error?: string;
  plan?: ChatPlanStep[];
  mode?: string;
}

export interface RuntimeCreateInput {
  goal: string;
  budget_cny?: number;
  token_limit?: number;
  mode?: string;
}

export interface RuntimeCreateResult {
  session: ChatSession;
  run: ConsoleRunRecord;
}

/** 订阅取消函数。 */
export type RuntimeUnsubscribe = () => void;

export interface ConsoleRuntimeProvider {
  /** 发送即执行：创建 session + run 并自动开始（无需点击开始执行）。 */
  createAndStart(input: RuntimeCreateInput): MaybePromise<RuntimeCreateResult>;
  listRuns(): MaybePromise<ConsoleRunRecord[]>;
  getRun(runId: string): MaybePromise<ConsoleRunRecord | null>;
  approve(runId: string, step: number, decision: "approve" | "reject"): MaybePromise<ConsoleRunRecord>;
  interrupt(runId: string): MaybePromise<ConsoleRunRecord>;
  resume(runId: string): MaybePromise<ConsoleRunRecord>;
  /** 事件回放 + 订阅：sinceSeq 之后先逐条回放，再实时回调；返回取消函数（SSE 断开时调用）。 */
  subscribeRun(runId: string, sinceSeq: number, onEvent: (event: ConsoleRuntimeEvent) => void): RuntimeUnsubscribe;
  eventLog(runId: string, sinceSeq?: number): ConsoleRuntimeEvent[];
  // ---- console 页面扩展（断线恢复/证据/记录展示；真实 RunManager 适配器也建议实现） ----
  getSession(sessionId: string): ChatSession | null;
  listSessions(): ChatSession[];
  getRunDetail(runId: string): RunDetail | null;
  getAgentTranscripts(role?: string): AgentTranscript[];
}

// ---------------------------------------------------------------------------
// 工具：内联 SVG 证据占位（无外网请求）
// ---------------------------------------------------------------------------

function svgDataUri(label: string, sub: string, accent: string, width = 800, height = 500): string {
  const escape = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 800 500">` +
    `<rect width="800" height="500" fill="#070b14"/>` +
    `<rect x="24" y="24" width="752" height="452" rx="12" fill="#0d1526" stroke="${accent}" stroke-width="2"/>` +
    `<rect x="24" y="24" width="752" height="56" rx="12" fill="#111c33"/>` +
    `<circle cx="58" cy="52" r="7" fill="#ff5f57"/><circle cx="84" cy="52" r="7" fill="#febc2e"/><circle cx="110" cy="52" r="7" fill="#28c840"/>` +
    `<text x="180" y="58" font-family="system-ui,sans-serif" font-size="20" fill="#8fa3bd">${escape(sub)}</text>` +
    `<text x="400" y="235" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#e9f1fa">${escape(label)}</text>` +
    `<text x="400" y="285" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" fill="#66e3d2">LIVE RUN EVIDENCE（演示占位）</text>` +
    `<rect x="280" y="330" width="240" height="8" rx="4" fill="#1b2a44"/><rect x="280" y="330" width="170" height="8" rx="4" fill="${accent}"/>` +
    `<text x="400" y="430" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#5f7288">真实截图由浏览器/桌面适配器写入；演示为内联 SVG</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// 演示运行时
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERN = /付款|支付|对外|外发|发送给|发给|发布|上线|部署|签约|合同|用印|删除|授权|转账/;
const CODING_PATTERN = /页面|代码|网站|报价单|表单|接口|修复|bug|功能/i;
const RESEARCH_PATTERN = /竞品|调研|查一下|检索|资料|对比/i;

function buildRuntimePlan(goal: string): ChatPlanStep[] {
  const coding = CODING_PATTERN.test(goal);
  const research = RESEARCH_PATTERN.test(goal);
  const highRisk = HIGH_RISK_PATTERN.test(goal);
  const steps: ChatPlanStep[] = [
    { step: 1, agent_role: "conductor", action: "确认目标与验收标准", summary: "澄清范围/预算/Token 上限与交付标准", status: "pending" },
    {
      step: 2,
      agent_role: research ? "research" : "operator",
      action: research ? "检索资料并标注来源" : "真实浏览器/桌面执行任务",
      summary: research ? "只读检索公开资料，引用来源" : "有头真实浏览器或真实窗口操作，每步截图留证",
      status: "pending",
    },
    coding
      ? { step: 3, agent_role: "harness", action: "写代码并跑测试", summary: "隔离 worktree 生成补丁，真实浏览器验收", status: "pending" }
      : { step: 3, agent_role: "content", action: "产出交付稿（草稿）", summary: "只起草，外发前需人工审批", status: "pending" },
    { step: 4, agent_role: "reviewer", action: "核查证据链并出结论", summary: "只读复核截图/日志/report，必要时打回", status: "pending" },
    {
      step: 5,
      agent_role: "conductor",
      action: highRisk ? "高风险对外动作（需人工审批）" : "对外交付确认（需审批）",
      summary: highRisk ? "涉及付款/外发/发布等高风险动作：暂停等待人工审批，不绕过" : "人工审批后交付客户；预算与 Token 控制在设定范围内",
      status: "pending",
      ...(highRisk ? { requires_approval: true } : {}),
    },
  ];
  return steps;
}

const AGENT_TITLE: Record<string, string> = {
  supervisor: "超级总调度",
  conductor: "项目总调度",
  operator: "执行（浏览器/桌面）",
  harness: "写代码 Harness",
  customer: "客户对接",
  finance: "财务记账",
  reviewer: "核查复核",
  backend: "后台值守",
  scout: "找客户",
  content: "内容创作",
  research: "调研检索",
  enterprise_admin: "企业合规/用印",
};

const RUNTIME_STEP_DELAY_MS = 150;
const RUNTIME_THINK_DELAY_MS = 120;

interface RuntimeState {
  record: ConsoleRunRecord;
  session: ChatSession;
  events: ConsoleRuntimeEvent[];
  seq: number;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(event: ConsoleRuntimeEvent) => void>;
  approvalRisk?: string;
}

export interface DemoRuntimeProviderOptions {
  /** 每步事件间隔（默认 150ms；E2E 要求 300ms 内出现思考中/执行中）。 */
  stepDelayMs?: number;
  now?: () => Date;
}

export function createDemoRuntimeProvider(options: DemoRuntimeProviderOptions = {}): ConsoleRuntimeProvider {
  const now = options.now ?? (() => new Date());
  const stepDelay = options.stepDelayMs ?? RUNTIME_STEP_DELAY_MS;
  const iso = (offsetMs = 0): string => new Date(now().getTime() + offsetMs).toISOString();
  const states = new Map<string, RuntimeState>();
  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(3, "0")}`;
  };

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const emit = (state: RuntimeState, type: string, data: Record<string, unknown>): ConsoleRuntimeEvent => {
    state.seq += 1;
    const event: ConsoleRuntimeEvent = {
      seq: state.seq,
      at: iso(0),
      run_id: state.record.run_id,
      session_id: state.record.session_id,
      type,
      data,
    };
    state.events.push(event);
    state.record.updated_at = event.at;
    for (const listener of [...state.listeners]) {
      try {
        listener({ ...event, data: { ...data } });
      } catch {
        // 单个订阅者异常不影响其它订阅
      }
    }
    return event;
  };

  const latestBySession = (sessionId: string): RuntimeState | undefined => {
    const list = [...states.values()].filter((state) => state.record.session_id === sessionId);
    return list.sort((a, b) => b.record.created_at.localeCompare(a.record.created_at))[0];
  };

  const schedule = (state: RuntimeState, delay: number): void => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      advance(state);
    }, delay);
  };

  const complete = (state: RuntimeState): void => {
    state.record.status = "done";
    state.record.steps_done = state.record.steps_total;
    state.record.plan = (state.record.plan ?? []).map((step) => ({ ...step, status: "done" as const }));
    emit(state, "run.completed", {
      steps_total: state.record.steps_total,
      steps_done: state.record.steps_done,
      token_used: state.record.token_used,
      evidence_count: 3,
    });
    state.session.status = "done";
    state.session.plan = (state.record.plan ?? []).map((step) => ({ ...step }));
    state.session.updated_at = iso(0);
    state.session.messages.push({
      id: nextId("msg"),
      role: "conductor",
      text: "执行完成：计划全部步骤已完成，证据已留档，可在完成卡查看 run 详情与证据。",
      summary: "执行完成并留证",
      at: iso(0),
      kind: "result",
    });
  };

  const advance = (state: RuntimeState): void => {
    if (state.record.status !== "running" && state.record.status !== "queued") return;
    const plan = state.record.plan ?? [];
    const nextStep = plan.find((step) => step.status === "pending");
    if (nextStep === undefined) {
      complete(state);
      return;
    }
    const record = state.record;
    if (record.status === "queued") {
      record.status = "running";
      emit(state, "run.started", { mode: record.mode ?? "personal" });
    }
    const stepIndex = plan.findIndex((step) => step.step === nextStep.step);
    const current = plan[stepIndex];
    if (current === undefined) return;
    current.status = "running";
    record.current_step = current.step;
    emit(state, "step.started", {
      step: current.step,
      agent_role: current.agent_role,
      agent_title: AGENT_TITLE[current.agent_role] ?? current.agent_role,
      action: current.action,
      summary: current.summary,
    });
    const tokens = 620 + current.step * 180;
    const inputSummary =
      current.step === 1
        ? `用户目标：${record.goal.slice(0, 60)}`
        : `来自步骤 ${String(current.step - 1)} 的交接：${plan[current.step - 2]?.action ?? "执行结果"}`;
    const outputSummary =
      current.step === 1
        ? `已确认验收标准：计划 ${String(record.steps_total)} 步；预算/Token 上限已设置`
        : current.step === 2
          ? "真实浏览器/桌面执行完成，关键界面截图已留证"
          : current.step === 3
            ? CODING_PATTERN.test(record.goal)
              ? "统一补丁已应用，真实浏览器验收测试转绿"
              : "交付稿草稿已产出（未外发）"
            : current.step === 4
              ? "证据链复核通过：截图/日志/report 齐全"
              : "对外交付动作已完成（人工审批后执行）";
    emit(state, "agent.turn.started", {
      step: current.step,
      agent_role: current.agent_role,
      agent_title: AGENT_TITLE[current.agent_role] ?? current.agent_role,
      input_summary: inputSummary,
    });
    emit(state, "agent.turn.completed", {
      step: current.step,
      agent_role: current.agent_role,
      agent_title: AGENT_TITLE[current.agent_role] ?? current.agent_role,
      output_summary: outputSummary,
      tokens,
      model_mode: "local-demO",
      input_summary: inputSummary,
    });
    record.token_used += tokens;
    emit(state, "step.completed", { step: current.step, status: "done", agent_role: current.agent_role });

    if (current.requires_approval === true) {
      // 高风险步骤：暂停等待人工审批（SSE 立即推送审批卡）
      record.status = "awaiting_approval";
      record.pending_approval = { step: current.step, summary: current.summary, risk: "高风险：对外交付/付款类动作必须人工批准，AI 不绕过" };
      current.status = "running";
      emit(state, "approval.required", {
        step: current.step,
        summary: current.summary,
        risk: record.pending_approval.risk,
        action: current.action,
      });
      return;
    }
    current.status = "done";
    record.steps_done = plan.filter((step) => step.status === "done").length;
    schedule(state, stepDelay);
  };

  const subscribeRun = (runId: string, sinceSeq: number, onEvent: (event: ConsoleRuntimeEvent) => void): RuntimeUnsubscribe => {
    const state = states.get(runId);
    if (state === undefined) return () => {};
    for (const event of state.events) {
      if (event.seq > sinceSeq) onEvent({ ...event, data: { ...event.data } });
    }
    state.listeners.add(onEvent);
    return () => {
      state.listeners.delete(onEvent);
    };
  };

  const getState = (runId: string): RuntimeState | null => states.get(runId) ?? null;

  const recordOf = (state: RuntimeState): ConsoleRunRecord => clone(state.record);
  const sessionOf = (state: RuntimeState): ChatSession => clone(state.session);

  const agentTranscriptsFor = (state: RuntimeState): AgentTranscript[] => {
    const byRole = new Map<string, AgentTranscript>();
    for (const event of state.events) {
      if (event.type !== "agent.turn.completed") continue;
      const role = String(event.data.agent_role ?? "agent");
      const title = AGENT_TITLE[role] ?? role;
      const turn = {
        seq: (byRole.get(role)?.turns.length ?? 0) + 1,
        at: event.at,
        input_summary: String(event.data.input_summary ?? ""),
        output_summary: String(event.data.output_summary ?? ""),
        tokens: Number(event.data.tokens ?? 0),
        status: "ok",
        evidence_ref: `runs/${state.record.run_id}/report.md`,
      };
      const existing = byRole.get(role);
      if (existing === undefined) {
        byRole.set(role, { agent_role: role, title, turns: [turn] });
      } else {
        existing.turns.push(turn);
      }
    }
    return [...byRole.values()];
  };

  const runDetailOf = (state: RuntimeState): RunDetail => {
    const record = state.record;
    const plan = record.plan ?? [];
    const events: FlowEvent[] = [];
    let seq = 0;
    const push = (phase: string, actor: string, summary: string, evidenceRef?: string): void => {
      seq += 1;
      events.push({
        seq,
        phase,
        ts: iso(-Math.max(1, plan.length - seq) * 30_000),
        actor,
        summary,
        ...(evidenceRef === undefined ? {} : { evidence_ref: evidenceRef }),
      });
    };
    push("plan", "conductor", `生成 ${String(plan.length)} 步计划：${plan.map((step) => step.action).join(" → ")}`);
    for (const step of plan) {
      push("action", step.agent_role, `步骤 ${String(step.step)}：${step.action}`);
      push("observe", step.agent_role, `观察步骤 ${String(step.step)} 输出：${step.summary}`);
    }
    push("verify", "reviewer", "复核证据链与验收标准：通过（截图/日志/report 齐全）");
    push("evidence", "operator", "留证：截图 2 张 + report.md + console.log + events.jsonl", `runs/${record.run_id}/screenshots/001-live.png`);
    const thumb = svgDataUri("Live Run 截图", "真实浏览器/桌面执行（演示占位）", "#66e3d2");
    const thumb2 = svgDataUri("验收结果", "步骤完成后的页面状态（演示占位）", "#ffb45c");
    const evidence: EvidenceItem[] = [
      { path: `runs/${record.run_id}/screenshots/001-live.png`, kind: "screenshot", title: "步骤执行截图（缩略图可点开大图）", description: "SSE 实时 run 的截图证据；演示为内联 SVG 占位", thumb_url: thumb, full_url: thumb },
      { path: `runs/${record.run_id}/screenshots/002-result.png`, kind: "screenshot", title: "验收结果截图", description: "步骤完成后的验收页面", thumb_url: thumb2, full_url: thumb2 },
      {
        path: `runs/${record.run_id}/report.md`,
        kind: "report",
        title: "运行报告 report.md",
        description: "目标 / 步骤 / 证据 / 结论",
        preview_text: `# 运行报告 — ${record.run_id}\n\n## 目标\n\n${record.goal}\n\n## 结论\n\n- 状态：${record.status}\n- 步骤：${String(record.steps_done)}/${String(record.steps_total)}\n- Token：${String(record.token_used)}\n`,
      },
      {
        path: `runs/${record.run_id}/console.log`,
        kind: "log",
        title: "执行日志 console.log",
        description: "SSE 事件与执行日志（节选）",
        preview_text: state.events.map((event) => `[${event.at}] ${event.type} ${JSON.stringify(event.data).slice(0, 120)}`).join("\n"),
      },
      {
        path: `runs/${record.run_id}/events.jsonl`,
        kind: "json",
        title: "事件流 events.jsonl",
        description: "SSE 事件序列（seq/type）",
        preview_text: JSON.stringify(
          state.events.map((event) => ({ seq: event.seq, type: event.type })),
          null,
          2,
        ),
      },
    ];
    const agents = agentTranscriptsFor(state);
    return {
      run_id: record.run_id,
      goal: record.goal,
      status: record.status,
      started_at: record.created_at,
      ...(record.status === "done" ? { finished_at: record.updated_at } : {}),
      events,
      evidence,
      report_md: `# 运行报告 — ${record.run_id}\n\n## 目标\n\n${record.goal}\n\n## 计划与进度\n\n${plan
        .map((step) => `- [${step.status === "done" ? "x" : " "}] 步骤 ${String(step.step)}｜${step.agent_role}｜${step.action} — ${step.summary}`)
        .join("\n")}\n\n## 证据\n\n- 截图 2 张（缩略图可点开大图）\n- 日志 console.log\n- 事件流 events.jsonl\n\n## 结论\n\n- 状态：**${record.status}**\n- 步骤：${String(record.steps_done)}/${String(record.steps_total)}\n- Token：${String(record.token_used)}\n`,
      agents,
      token_used: record.token_used,
      budget_used_cny: Math.min(420, Math.round((record.steps_done / Math.max(1, record.steps_total)) * 420)),
      session_id: record.session_id,
    };
  };

  const createAndStart = (input: RuntimeCreateInput): RuntimeCreateResult => {
    const goal = String(input.goal ?? "").trim();
    if (goal.length < 4) throw new Error("目标至少 4 个字（告诉总调度你要做什么）");
    const mode = input.mode === "personal" || input.mode === "enterprise" ? input.mode : "demo";
    const budget = Number.isFinite(input.budget_cny) ? Math.max(0, Number(input.budget_cny)) : 3000;
    const tokenLimit = Number.isFinite(input.token_limit) ? Math.max(1000, Number(input.token_limit)) : 200_000;
    const runId = nextId("run-live");
    const sessionId = nextId("chat-live");
    const plan = buildRuntimePlan(goal);
    const session: ChatSession = {
      id: sessionId,
      title: goal.slice(0, 24) + (goal.length > 24 ? "…" : ""),
      goal,
      mode,
      status: "planning",
      created_at: iso(0),
      updated_at: iso(0),
      messages: [
        { id: nextId("msg"), role: "user", text: goal, summary: `用户目标：${goal.slice(0, 40)}`, at: iso(0) },
      ],
      plan: plan.map((step) => ({ ...step })),
      budget_cny: budget,
      token_limit: tokenLimit,
      interruptible: true,
    };
    const record: ConsoleRunRecord = {
      run_id: runId,
      session_id: sessionId,
      goal,
      status: "queued",
      steps_total: plan.length,
      steps_done: 0,
      token_used: 0,
      created_at: iso(0),
      updated_at: iso(0),
      mode,
      plan: plan.map((step) => ({ ...step })),
    };
    const state: RuntimeState = {
      record,
      session,
      events: [],
      seq: 0,
      timer: null,
      listeners: new Set(),
    };
    states.set(runId, state);
    // 发送即执行：立即推 run.created + conductor.thinking，随后生成计划并逐步推进
    emit(state, "run.created", { goal, mode, steps_total: plan.length, budget_cny: budget, token_limit: tokenLimit });
    emit(state, "conductor.thinking", { summary: "总调度思考中：理解目标、拆解计划、分配智能体…" });
    state.timer = setTimeout(() => {
      state.timer = null;
      emit(state, "plan.created", {
        steps: plan.map((step) => ({
          step: step.step,
          agent_role: step.agent_role,
          agent_title: AGENT_TITLE[step.agent_role] ?? step.agent_role,
          action: step.action,
          summary: step.summary,
          requires_approval: step.requires_approval === true,
        })),
        steps_total: plan.length,
      });
      session.status = "running";
      session.messages.push({
        id: nextId("msg"),
        role: "conductor",
        text: `收到目标「${goal}」。已拆解为 ${String(plan.length)} 步计划并**自动开始执行**（无需手动点开始），每步进展会实时推送到本页；高风险步骤会暂停等你审批。`,
        summary: `总调度已拆解 ${String(plan.length)} 步并自动开始执行`,
        at: iso(0),
        kind: "plan",
      });
      record.status = "running";
      emit(state, "run.started", { mode });
      schedule(state, RUNTIME_THINK_DELAY_MS);
    }, RUNTIME_THINK_DELAY_MS);
    return { session: clone(session), run: recordOf(state) };
  };

  const provider: ConsoleRuntimeProvider = {
    createAndStart: (input) => createAndStart(input),
    listRuns: () => [...states.values()].map((state) => recordOf(state)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    getRun: (runId) => {
      const state = getState(runId);
      return state === null ? null : recordOf(state);
    },
    approve: (runId, step, decision) => {
      const state = getState(runId);
      if (state === null) throw new Error(`run 不存在：${runId}`);
      if (state.record.pending_approval === undefined || state.record.pending_approval.step !== step) {
        throw new Error(`没有待审批步骤：${String(step)}`);
      }
      if (decision === "approve") {
        emit(state, "approval.approved", { step, summary: state.record.pending_approval.summary });
        const plan = state.record.plan ?? [];
        const target = plan.find((item) => item.step === step);
        if (target !== undefined) target.status = "done";
        delete state.record.pending_approval;
        state.record.steps_done = plan.filter((item) => item.status === "done").length;
        state.record.status = "running";
        emit(state, "run.resumed", { reason: "approval_approved" });
        schedule(state, stepDelay);
      } else {
        emit(state, "approval.rejected", { step, summary: state.record.pending_approval.summary });
        delete state.record.pending_approval;
        state.record.status = "blocked";
        state.session.status = "blocked";
        emit(state, "run.failed", { error: "人工驳回了高风险步骤，run 已阻塞", step });
      }
      return recordOf(state);
    },
    interrupt: (runId) => {
      const state = getState(runId);
      if (state === null) throw new Error(`run 不存在：${runId}`);
      if (state.record.status === "running" || state.record.status === "queued" || state.record.status === "awaiting_approval") {
        if (state.timer !== null) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        const current = (state.record.plan ?? []).find((step) => step.status === "running");
        if (current !== undefined) current.status = "blocked";
        state.record.status = "interrupted";
        state.session.status = "paused";
        emit(state, "run.interrupted", { reason: "user_interrupt", current_step: state.record.current_step ?? null });
      }
      return recordOf(state);
    },
    resume: (runId) => {
      const state = getState(runId);
      if (state === null) throw new Error(`run 不存在：${runId}`);
      if (state.record.status === "interrupted") {
        state.record.status = "running";
        state.session.status = "running";
        const current = (state.record.plan ?? []).find((step) => step.status === "blocked");
        if (current !== undefined) current.status = "running";
        emit(state, "run.resumed", { reason: "user_resume" });
        schedule(state, stepDelay);
      }
      return recordOf(state);
    },
    subscribeRun,
    eventLog: (runId, sinceSeq) => {
      const state = getState(runId);
      if (state === null) return [];
      return state.events.filter((event) => event.seq > (sinceSeq ?? 0)).map((event) => ({ ...event, data: { ...event.data } }));
    },
    getSession: (sessionId) => {
      const state = latestBySession(sessionId);
      return state === undefined ? null : sessionOf(state);
    },
    listSessions: () =>
      [...states.values()]
        .sort((a, b) => b.record.created_at.localeCompare(a.record.created_at))
        .map((state) => sessionOf(state)),
    getRunDetail: (runId) => {
      const state = getState(runId);
      return state === null ? null : runDetailOf(state);
    },
    getAgentTranscripts: (role) => {
      const all: AgentTranscript[] = [];
      for (const state of [...states.values()].sort((a, b) => b.record.created_at.localeCompare(a.record.created_at))) {
        for (const transcript of agentTranscriptsFor(state)) {
          if (role !== undefined && transcript.agent_role !== role) continue;
          const existing = all.find((item) => item.agent_role === transcript.agent_role);
          if (existing === undefined) all.push({ ...transcript, turns: [...transcript.turns] });
          else existing.turns.push(...transcript.turns);
        }
      }
      return all;
    },
  };
  return provider;
}

/** 便捷：判断目标是否包含高风险步骤（E2E / UI 提示用）。 */
export function runtimeGoalNeedsApproval(goal: string): boolean {
  return HIGH_RISK_PATTERN.test(goal);
}

/** SSE 事件类型中文标签（前端时间线展示用）。 */
export const RUNTIME_EVENT_LABELS: Record<string, string> = {
  "run.created": "已排队",
  "run.started": "开始执行",
  "conductor.thinking": "总调度思考中",
  "plan.created": "计划生成",
  "step.started": "步骤开始",
  "agent.turn.started": "智能体开始",
  "agent.turn.completed": "智能体完成",
  "step.completed": "步骤完成",
  "approval.required": "等待审批",
  "approval.approved": "审批通过",
  "approval.rejected": "审批驳回",
  "run.interrupted": "已打断",
  "run.resumed": "已恢复",
  "run.completed": "执行完成",
  "run.failed": "执行失败",
};
