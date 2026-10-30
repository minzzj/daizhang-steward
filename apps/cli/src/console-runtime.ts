/**
 * v1.4：控制台真实 Runtime Provider。
 * ConsoleRuntimeProvider ← RunManager（自动执行/事件流）+ OrchestratorEngine（会话/证据/摘要）+ ConfigEngine（运行时设置）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentTranscript,
  ChatMessage,
  ChatPlanStep,
  ChatSession,
  ConsoleRunRecord,
  ConsoleRuntimeEvent,
  ConsoleRuntimeProvider,
  EvidenceItem,
  RunDetail,
} from "../../../packages/steward-console/src/index.js";
import { RunManager, type RunRecord } from "../../../packages/steward-runtime/src/index.js";
import { createRuntime } from "./agent-cli.js";

function roleTitle(role: string): string {
  const titles: Record<string, string> = {
    supervisor: "系统总控",
    conductor: "项目总调度",
    operator: "办公执行",
    harness: "编码代理",
    customer: "客户沟通",
    finance: "财务",
    reviewer: "核查",
    backend: "后台运维",
    scout: "线索",
    content: "内容",
    research: "调研",
  };
  return titles[role] ?? role;
}

export interface RealConsoleRuntimeOptions {
  /** 运行时设置的覆盖（缺省取配置中心 runtime 字段）。 */
  maxConcurrentRuns?: number;
  root?: string;
}

export function createRealConsoleRuntimeProvider(root: string, options: RealConsoleRuntimeOptions = {}): ConsoleRuntimeProvider {
  const runtime = createRuntime(root, { autoApprove: false });
  const { config, orchestrator } = runtime;
  const cfg = config.load();
  const runtimeSettings = config.getRuntimeSettings();
  const manager = new RunManager({
    orchestrator: {
      createSession: (input) => orchestrator.createSession(input as never),
      sendMessage: (sessionId, text) => orchestrator.sendMessage(sessionId, text),
      startProject: (sessionId) => orchestrator.startProject(sessionId),
      runStep: (sessionId) => orchestrator.runStep(sessionId),
      getSession: (sessionId) => {
        const session = orchestrator.getSession(sessionId);
        return {
          id: session.id,
          status: session.status,
          plan: session.plan.map((step) => ({
            step: step.step,
            agent_role: step.agent_role,
            action: step.action,
            summary: step.summary,
            status: step.status,
            ...(step.requires_approval ? { requires_approval: true } : {}),
            ...(step.action_plan
              ? { action_plan: { ...(step.action_plan.risk ? { risk: step.action_plan.risk } : {}), ...(step.action_plan.requires_confirmation ? { requires_confirmation: true } : {}) } }
              : {}),
          })),
          approvals: Object.fromEntries(Object.entries(session.approvals ?? {}).map(([key, value]) => [key, { status: value.status }])),
          messages: session.messages.map((message) => ({
            ...(message.role ? { role: message.role } : {}),
            ...(message.kind ? { kind: message.kind } : {}),
            text: message.text,
            ...(message.summary ? { summary: message.summary } : {}),
          })),
          children: Object.fromEntries(
            Object.entries(session.children).map(([role, turns]) => [
              role,
              turns.map((turn) => ({
                seq: turn.seq,
                agent_role: turn.agent_role,
                input_summary: turn.input_summary,
                output_summary: turn.output_summary,
                tokens: turn.tokens,
                status: turn.status,
                ...(turn.model_mode ? { model_mode: turn.model_mode } : {}),
                ...(turn.detail ? { detail: turn.detail } : {}),
              })),
            ]),
          ),
          ...(session.tokens_used ? { tokens_used: session.tokens_used } : {}),
        };
      },
      decideApproval: (sessionId, step, decision) => orchestrator.decideApproval(sessionId, step, decision, "human:console"),
      interrupt: (sessionId, reason) => (reason ? orchestrator.interrupt(sessionId, reason) : orchestrator.interrupt(sessionId)),
      resume: (sessionId) => orchestrator.resume(sessionId),
    },
    settings: {
      auto_run: runtimeSettings.auto_run,
      approval_mode: runtimeSettings.approval_mode,
      full_auto: runtimeSettings.full_auto,
      max_auto_steps: runtimeSettings.max_auto_steps,
      rework_limit: runtimeSettings.rework_limit,
      event_retention: runtimeSettings.event_retention,
    },
    root: options.root ?? join(root, ".steward", "runtime"),
    maxConcurrentRuns: options.maxConcurrentRuns ?? 3,
  });

  const toConsoleRun = (record: RunRecord): ConsoleRunRecord => {
    let plan: ChatPlanStep[] = [];
    try {
      plan = orchestrator.getSession(record.session_id).plan.map((step) => ({
        step: step.step,
        agent_role: step.agent_role,
        action: step.action,
        summary: step.summary,
        status: step.status,
        ...(step.requires_approval ? { requires_approval: true } : {}),
      }));
    } catch {
      plan = [];
    }
    return {
      run_id: record.run_id,
      session_id: record.session_id,
      goal: record.goal,
      status: record.status as ConsoleRunRecord["status"],
      steps_total: record.steps_total,
      steps_done: record.steps_done,
      token_used: record.token_used,
      created_at: record.created_at,
      updated_at: record.updated_at,
      ...(record.current_step !== undefined ? { current_step: record.current_step } : {}),
      ...(record.pending_approval
        ? { pending_approval: { step: record.pending_approval.step, summary: record.pending_approval.summary, ...(record.pending_approval.risk ? { risk: record.pending_approval.risk } : {}) } }
        : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(plan.length > 0 ? { plan } : {}),
      mode: cfg.profile.mode,
    };
  };

  const toConsoleSession = (sessionId: string): ChatSession | null => {
    try {
      const session = orchestrator.getSession(sessionId);
      const messages: ChatMessage[] = session.messages.map((message) => ({
        id: message.id,
        role: (message.role === "user" ? "user" : message.role === "conductor" || message.role === "supervisor" ? "conductor" : "agent") as ChatMessage["role"],
        ...(message.agent_role ? { agent_role: message.agent_role } : {}),
        text: message.text,
        ...(message.summary ? { summary: message.summary } : {}),
        at: message.at,
        kind: (message.kind === "plan" || message.kind === "approval" || message.kind === "result" || message.kind === "error" ? message.kind : "result") as NonNullable<ChatMessage["kind"]>,
      }));
      return {
        id: session.id,
        title: session.title,
        goal: session.goal,
        mode: session.mode,
        status: (session.status === "interrupted" ? "paused" : session.status) as ChatSession["status"],
        created_at: session.created_at,
        updated_at: session.updated_at,
        run_id: session.id,
        messages,
        plan: session.plan.map((step) => ({
          step: step.step,
          agent_role: step.agent_role,
          action: step.action,
          summary: step.summary,
          status: step.status,
          ...(step.requires_approval ? { requires_approval: true } : {}),
        })),
        budget_cny: session.budget_cny,
        token_limit: session.token_limit,
        interruptible: session.status === "running" || session.status === "planning",
      };
    } catch {
      return null;
    }
  };

  const evidenceItem = (item: { path: string; kind: string; title: string }): EvidenceItem => {
    const abs = join(root, "runs", item.path);
    const kind: EvidenceItem["kind"] =
      item.kind === "html" ? "html" : item.kind === "report" ? "report" : item.kind === "json" ? "json" : item.kind === "screenshot" ? "screenshot" : "log";
    const mapped: EvidenceItem = { path: item.path, kind, title: item.title };
    if (existsSync(abs)) {
      try {
        if (kind === "screenshot" && /\.png$/i.test(abs)) {
          const data = readFileSync(abs).toString("base64");
          mapped.thumb_url = `data:image/png;base64,${data}`;
          mapped.full_url = mapped.thumb_url;
        } else if (kind !== "html" && kind !== "screenshot") {
          mapped.preview_text = readFileSync(abs, "utf8").slice(0, 4000);
        }
      } catch {
        /* ignore */
      }
    }
    return mapped;
  };

  const transcriptsForSession = (sessionId: string): AgentTranscript[] => {
    const detail = orchestrator.getRunDetail(sessionId);
    const byRole = new Map<string, AgentTranscript["turns"]>();
    for (const turn of detail.turns) {
      const list = byRole.get(turn.agent_role) ?? [];
      list.push({
        seq: turn.seq,
        at: turn.at,
        input_summary: turn.input_summary,
        output_summary: turn.output_summary,
        tokens: turn.tokens,
        status: turn.status,
        ...(turn.evidence_refs[0] ? { evidence_ref: turn.evidence_refs[0] } : {}),
      });
      byRole.set(turn.agent_role, list);
    }
    return [...byRole.entries()].map(([role, turns]) => ({ agent_role: role, title: roleTitle(role), turns }));
  };

  const runDetailForSession = (sessionId: string): RunDetail | null => {
    try {
      const session = orchestrator.getSession(sessionId);
      const detail = orchestrator.getRunDetail(sessionId);
      const reportFile = join(root, "runs", sessionId, "deliverable.md");
      return {
        run_id: sessionId,
        goal: session.goal,
        status: session.status,
        started_at: session.created_at,
        ...(session.status === "done" || session.status === "blocked" ? { finished_at: session.updated_at } : {}),
        events: [
          ...session.plan.map((step) => ({
            seq: step.step,
            phase: step.status === "done" ? "verify" : step.status === "blocked" ? "error" : "action",
            ts: session.updated_at,
            actor: step.agent_role,
            summary: `${step.action}：${step.summary}（${step.status}）`,
          })),
          ...detail.turns.map((turn) => ({ seq: 100 + turn.seq, phase: "evidence", ts: turn.at, actor: turn.agent_role, summary: turn.output_summary })),
        ],
        evidence: detail.evidence.map(evidenceItem),
        ...(existsSync(reportFile) ? { report_md: readFileSync(reportFile, "utf8") } : {}),
        agents: transcriptsForSession(sessionId),
        token_used: detail.turns.reduce((sum, turn) => sum + turn.tokens, 0),
        budget_used_cny: 0,
        session_id: sessionId,
      };
    } catch {
      return null;
    }
  };

  return {
    createAndStart: async (input) => {
      const run = await manager.createRun({ goal: input.goal, ...(input.budget_cny ? { budget_cny: input.budget_cny } : {}), ...(input.token_limit ? { token_limit: input.token_limit } : {}), mode: input.mode ?? cfg.profile.mode });
      const session = toConsoleSession(run.session_id);
      if (!session) throw new Error(`会话未创建：${run.session_id}`);
      return { session, run: toConsoleRun(run) };
    },
    listRuns: () => manager.listRuns().map(toConsoleRun),
    getRun: (runId) => {
      const run = manager.getRun(runId);
      return run ? toConsoleRun(run) : null;
    },
    approve: async (runId, step, decision) => {
      await manager.approve(runId, step, decision, "human:console");
      return toConsoleRun(manager.getRun(runId) as RunRecord);
    },
    interrupt: async (runId) => {
      await manager.interruptRun(runId);
      return toConsoleRun(manager.getRun(runId) as RunRecord);
    },
    resume: async (runId) => {
      await manager.resumeRun(runId);
      return toConsoleRun(manager.getRun(runId) as RunRecord);
    },
    subscribeRun: (runId, sinceSeq, onEvent) => manager.subscribeRun(runId, (event) => onEvent(event as unknown as ConsoleRuntimeEvent), sinceSeq),
    eventLog: (runId, sinceSeq) => manager.eventLog(runId, sinceSeq ?? 0) as unknown as ConsoleRuntimeEvent[],
    getSession: (sessionId) => toConsoleSession(sessionId),
    listSessions: () =>
      manager
        .listRuns()
        .map((record) => toConsoleSession(record.session_id))
        .filter((session): session is ChatSession => session !== null),
    getRunDetail: (runId) => {
      const run = manager.getRun(runId) ?? manager.listRuns().find((item) => item.session_id === runId) ?? null;
      if (!run) return null;
      return runDetailForSession(run.session_id);
    },
    getAgentTranscripts: (role) => {
      const sessions = new Set(manager.listRuns().map((record) => record.session_id));
      const all: AgentTranscript[] = [];
      for (const sessionId of sessions) {
        for (const transcript of transcriptsForSession(sessionId)) {
          if (!role || transcript.agent_role === role) all.push(transcript);
        }
      }
      return all;
    },
  };
}
