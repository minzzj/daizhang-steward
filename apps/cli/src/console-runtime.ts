/**
 * v1.4：控制台真实 Runtime Provider。
 * ConsoleRuntimeProvider ← RunManager（自动执行/事件流）+ OrchestratorEngine（会话/证据/摘要）+ ConfigEngine（运行时设置）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import type {
  AgentTranscript,
  ChatMessage,
  ChatPlanStep,
  ChatSession,
  ConsoleRunRecord,
  ConsoleRuntimeEvent,
  ConsoleRuntimeProvider,
  EvidenceItem,
  HarnessArtifactContent,
  HarnessArtifactView,
  HarnessReportView,
  RunDetail,
  RunMetricsView,
  RuntimeArtifactFilter,
  RuntimeReportFilter,
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

  // ---- v1.5：真实 Harness 数据（产物/报告/数据指标/内容/下载）+ 事件轮询 ----
  const runsRoot = join(root, "runs");
  const insideRuns = (abs: string): boolean => {
    try {
      const rel = relative(runsRoot, abs);
      return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
    } catch {
      return false;
    }
  };
  const kindOfPath = (relPath: string): HarnessArtifactView["kind"] => {
    const lower = relPath.toLowerCase();
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
    if (lower.endsWith(".json") || lower.endsWith(".jsonl")) return "json";
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) return "image";
    if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|cs|sh|ps1|bat|sql|yml|yaml|toml)$/i.test(lower)) return "code";
    if (/\.(csv|tsv|xlsx?|parquet)$/i.test(lower)) return "data";
    if (/\.(txt|log|diff|patch)$/i.test(lower)) return "text";
    return "other";
  };
  const mimeOfKind = (kind: HarnessArtifactView["kind"]): string => {
    switch (kind) {
      case "html": return "text/html; charset=utf-8";
      case "markdown": return "text/markdown; charset=utf-8";
      case "json": return "application/json; charset=utf-8";
      case "image": return "image/png";
      case "code": return "text/plain; charset=utf-8";
      case "data": return "text/csv; charset=utf-8";
      default: return "text/plain; charset=utf-8";
    }
  };
  const sessionDirsWithHarness = (): string[] => {
    try {
      return readdirSync(runsRoot).filter((name) => name.startsWith("sess-") && existsSync(join(runsRoot, name, "harness")));
    } catch {
      return [];
    }
  };
  const runIdForSession = (sessionId: string): string | undefined => manager.listRuns().find((record) => record.session_id === sessionId)?.run_id;
  const sessionForRunId = (runId: string): string | undefined => {
    const record = manager.getRun(runId) ?? manager.listRuns().find((item) => item.session_id === runId);
    return record?.session_id;
  };
  const artifactViewsForSession = (sessionId: string): HarnessArtifactView[] => {
    const out: HarnessArtifactView[] = [];
    const harnessDir = join(runsRoot, sessionId, "harness");
    if (!existsSync(harnessDir)) return out;
    let names: string[] = [];
    try { names = readdirSync(harnessDir); } catch { return out; }
    const stepRoles = new Map<number, string>();
    for (const name of names) {
      const match = /^step-(\d+)-summary\.json$/.exec(name);
      if (match === null) continue;
      try {
        const summary = JSON.parse(readFileSync(join(harnessDir, name), "utf8")) as { role?: string };
        stepRoles.set(Number(match[1]), summary.role ?? "");
      } catch { /* ignore */ }
    }
    for (const name of names) {
      const match = /^step-(\d+)-artifacts\.json$/.exec(name);
      if (match === null) continue;
      const step = Number(match[1]);
      try {
        const manifest = JSON.parse(readFileSync(join(harnessDir, name), "utf8")) as { artifacts?: Array<Record<string, unknown>> };
        for (const entry of manifest.artifacts ?? []) {
          const relPath = String(entry.rel_path ?? "");
          if (relPath.length === 0) continue;
          const abs = join(runsRoot, relPath);
          if (!insideRuns(abs)) continue;
          const kind = (String(entry.kind ?? "") as HarnessArtifactView["kind"]) || kindOfPath(relPath);
          let size = Number(entry.size ?? 0);
          try { size = statSync(abs).size; } catch { /* ignore */ }
          let createdAt = new Date().toISOString();
          try { createdAt = statSync(abs).mtime.toISOString(); } catch { /* ignore */ }
          const id = `${sessionId}::${relPath.replaceAll("\\", "/")}`;
          out.push({
            id,
            run_id: runIdForSession(sessionId) ?? sessionId,
            session_id: sessionId,
            step,
            agent_role: stepRoles.get(step) ?? "",
            rel_path: relPath.replaceAll("\\", "/"),
            kind,
            title: basename(relPath),
            mime: mimeOfKind(kind),
            size,
            created_at: createdAt,
            preview_url: `/api/artifacts/${encodeURIComponent(id)}/preview`,
            download_url: `/api/artifacts/${encodeURIComponent(id)}/download`,
          });
        }
      } catch { /* ignore */ }
    }
    return out;
  };
  const listArtifacts = (filter?: RuntimeArtifactFilter): HarnessArtifactView[] => {
    let sessions = sessionDirsWithHarness();
    if (filter?.run_id) {
      const resolved = sessionForRunId(filter.run_id);
      sessions = resolved ? sessions.filter((id) => id === resolved) : [];
    }
    if (filter?.session_id) sessions = sessions.filter((id) => id === filter.session_id);
    let views = sessions.flatMap((sessionId) => artifactViewsForSession(sessionId));
    if (filter?.agent_role) views = views.filter((view) => view.agent_role === filter.agent_role);
    if (filter?.kind) views = views.filter((view) => view.kind === filter.kind);
    views.sort((left, right) => right.created_at.localeCompare(left.created_at));
    const limit = (filter as { limit?: number } | undefined)?.limit;
    return typeof limit === "number" ? views.slice(0, limit) : views;
  };
  const reportViewsForSession = (sessionId: string): HarnessReportView[] => {
    const out: HarnessReportView[] = [];
    const harnessDir = join(runsRoot, sessionId, "harness");
    if (!existsSync(harnessDir)) return out;
    let names: string[] = [];
    try { names = readdirSync(harnessDir); } catch { return out; }
    const stepRoles = new Map<number, string>();
    for (const name of names) {
      const match = /^step-(\d+)-summary\.json$/.exec(name);
      if (match === null) continue;
      try {
        const summary = JSON.parse(readFileSync(join(harnessDir, name), "utf8")) as { role?: string };
        stepRoles.set(Number(match[1]), summary.role ?? "");
      } catch { /* ignore */ }
    }
    for (const name of names) {
      const match = /^step-(\d+)-report\.md$/.exec(name);
      if (match === null) continue;
      const step = Number(match[1]);
      try {
        const abs = join(harnessDir, name);
        const markdown = readFileSync(abs, "utf8");
        const createdAt = statSync(abs).mtime.toISOString();
        const role = stepRoles.get(step) ?? "";
        out.push({
          id: `${sessionId}::harness/${name}`,
          run_id: runIdForSession(sessionId) ?? sessionId,
          session_id: sessionId,
          step,
          agent_role: role,
          title: `步骤 ${step} · ${role || "agent"} 报告`,
          markdown,
          created_at: createdAt,
        });
      } catch { /* ignore */ }
    }
    return out;
  };
  const listReports = (filter?: RuntimeReportFilter): HarnessReportView[] => {
    let sessions = sessionDirsWithHarness();
    if (filter?.run_id) {
      const resolved = sessionForRunId(filter.run_id);
      sessions = resolved ? sessions.filter((id) => id === resolved) : [];
    }
    if (filter?.session_id) sessions = sessions.filter((id) => id === filter.session_id);
    let views = sessions.flatMap((sessionId) => reportViewsForSession(sessionId));
    if (filter?.agent_role) views = views.filter((view) => view.agent_role === filter.agent_role);
    views.sort((left, right) => right.created_at.localeCompare(left.created_at));
    const limit = (filter as { limit?: number } | undefined)?.limit;
    return typeof limit === "number" ? views.slice(0, limit) : views;
  };
  const metricsForSession = (sessionId: string): RunMetricsView | null => {
    const path = join(runsRoot, sessionId, "harness", "metrics.json");
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { totals?: Record<string, number>; tool_call_counts?: Record<string, number>; model_modes?: string[] };
      const totals = raw.totals ?? {};
      return {
        token_input: totals.input_tokens ?? 0,
        token_output: totals.output_tokens ?? 0,
        token_cache_read: totals.cache_read_tokens ?? 0,
        token_total: totals.total_tokens ?? 0,
        steps: totals.steps ?? 0,
        duration_ms: totals.duration_ms ?? 0,
        tool_calls: totals.tool_calls ?? 0,
        tool_call_counts: raw.tool_call_counts ?? {},
        events: totals.events ?? 0,
        model_modes: raw.model_modes ?? ["harness"],
        budget_used_cny: 0,
      };
    } catch {
      return null;
    }
  };
  const parseArtifactId = (id: string): { sessionId: string; relPath: string } | null => {
    const idx = id.indexOf("::");
    if (idx <= 0) return null;
    return { sessionId: id.slice(0, idx), relPath: id.slice(idx + 2) };
  };
  const artifactContent = (id: string): HarnessArtifactContent => {
    const parsed = parseArtifactId(id);
    if (parsed === null) return { ok: false, kind: "other", error: "产物 ID 非法" };
    if (!/^sess-[A-Za-z0-9_-]+$/.test(parsed.sessionId)) return { ok: false, kind: "other", error: "会话 ID 非法" };
    const abs = join(runsRoot, parsed.sessionId, parsed.relPath);
    if (!insideRuns(abs) || !existsSync(abs)) return { ok: false, kind: "other", error: "产物不存在或不在 runs 目录内" };
    const kind = kindOfPath(parsed.relPath);
    const contentKind: HarnessArtifactContent["kind"] = kind === "html" ? "html" : kind === "markdown" ? "markdown" : kind === "json" ? "json" : kind === "image" ? "image" : "text";
    try {
      if (contentKind === "image") return { ok: true, kind: contentKind, mime: mimeOfKind(kind), path: abs };
      const content = readFileSync(abs, "utf8");
      return { ok: true, kind: contentKind, mime: mimeOfKind(kind), content: content.slice(0, 512 * 1024), path: abs };
    } catch (error) {
      return { ok: false, kind: contentKind, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const artifactFilePath = (id: string): string | null => {
    const parsed = parseArtifactId(id);
    if (parsed === null) return null;
    if (!/^sess-[A-Za-z0-9_-]+$/.test(parsed.sessionId)) return null;
    const abs = join(runsRoot, parsed.sessionId, parsed.relPath);
    return insideRuns(abs) && existsSync(abs) ? abs : null;
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
    subscribeRun: (runId, sinceSeq, onEvent) => {
      const record = manager.getRun(runId);
      const sessionId = record?.session_id ?? runId;
      const unsubscribeManager = manager.subscribeRun(runId, (event) => onEvent(event as unknown as ConsoleRuntimeEvent), sinceSeq);
      const harnessDir = join(runsRoot, sessionId, "harness");
      const offsets = new Map<string, number>();
      const seenArtifacts = new Set<string>();
      const seenReports = new Set<string>();
      let syntheticSeq = 1_000_000;
      const emit = (type: string, data: Record<string, unknown>) => {
        syntheticSeq += 1;
        try { onEvent({ seq: syntheticSeq, at: new Date().toISOString(), run_id: runId, session_id: sessionId, type, data } as unknown as ConsoleRuntimeEvent); } catch { /* ignore */ }
      };
      const tick = () => {
        if (!existsSync(harnessDir)) return;
        let names: string[] = [];
        try { names = readdirSync(harnessDir); } catch { return; }
        const stepRoles = new Map<number, string>();
        for (const name of names) {
          const match = /^step-(\d+)-summary\.json$/.exec(name);
          if (match === null) continue;
          try {
            const summary = JSON.parse(readFileSync(join(harnessDir, name), "utf8")) as { role?: string };
            stepRoles.set(Number(match[1]), summary.role ?? "");
          } catch { /* ignore */ }
        }
        for (const name of names) {
          const match = /^step-(\d+)-events\.jsonl$/.exec(name);
          if (match === null) continue;
          const step = Number(match[1]);
          const path = join(harnessDir, name);
          let offset = offsets.get(path) ?? 0;
          let content = "";
          try { content = readFileSync(path, "utf8"); } catch { continue; }
          if (content.length <= offset) continue;
          const chunk = content.slice(offset);
          offsets.set(path, content.length);
          for (const line of chunk.split("\n")) {
            if (line.trim() === "") continue;
            let event: Record<string, unknown>;
            try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
            const type = String(event.type ?? "");
            const data = (event.data ?? {}) as Record<string, unknown>;
            const role = stepRoles.get(step) ?? "";
            if (type === "thinking") emit("harness.thinking", { step, agent_role: role, text: String(data.text ?? ""), at: event.at });
            else if (type === "tool_call") emit("harness.tool_call", { step, agent_role: role, tool: String(data.tool ?? ""), input: data.input ?? {}, callId: data.callId });
            else if (type === "tool_result") emit("harness.tool_result", { step, agent_role: role, tool: String(data.tool ?? ""), callId: data.callId, status: String(data.status ?? ""), result_preview: String(data.result ?? "").slice(0, 500) });
          }
        }
        const artifacts = artifactViewsForSession(sessionId);
        for (const artifact of artifacts) {
          if (seenArtifacts.has(artifact.id)) continue;
          seenArtifacts.add(artifact.id);
          emit("artifact.created", { artifact });
        }
        const reports = reportViewsForSession(sessionId);
        for (const report of reports) {
          if (seenReports.has(report.id)) continue;
          seenReports.add(report.id);
          emit("report.created", { report });
        }
      };
      const timer = setInterval(tick, 400);
      tick();
      return () => {
        clearInterval(timer);
        unsubscribeManager();
      };
    },
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
    listArtifacts: (filter) => listArtifacts(filter),
    listReports: (filter) => listReports(filter),
    getRunMetrics: (runId) => {
      const record = manager.getRun(runId) ?? manager.listRuns().find((item) => item.session_id === runId);
      if (!record) return null;
      return metricsForSession(record.session_id);
    },
    getArtifactContent: (id) => artifactContent(id),
    getArtifactFilePath: (id) => artifactFilePath(id),
  };
}
