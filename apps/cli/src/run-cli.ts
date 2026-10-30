/**
 * v1.4：CLI「自动执行 / 实时事件流」入口（steward runtime）。
 *
 * 用户痛点：发消息后不实时、还要手动点执行。
 * 现在：一个命令创建 Run 并自动执行到完成/暂停，实时打印事件；可审批/打断/恢复/查看。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { RunManager, type RunRecord, type RuntimeEvent } from "../../../packages/steward-runtime/src/index.js";
import { createRuntime } from "./agent-cli.js";

type Flags = Record<string, string | boolean>;
export interface RuntimeArgs {
  flags: Flags;
}
const flag = (flags: Flags, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);
const flagNum = (flags: Flags, name: string, fallback: number): number => {
  const value = flag(flags, name);
  if (value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};
const printJson = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const EVENT_LABELS: Record<string, string> = {
  "run.queued": "已排队",
  "run.started": "开始执行",
  "plan.generating": "总调度思考中/生成计划",
  "plan.ready": "计划就绪",
  "step.started": "开始步骤",
  "step.completed": "步骤完成",
  "agent.turn": "智能体轮次",
  "tool.called": "调用工具",
  "tool.result": "工具结果",
  "approval.required": "需要人工确认",
  "run.paused": "已暂停",
  "run.resumed": "已恢复",
  "run.interrupted": "已打断",
  "run.completed": "执行完成",
  "run.blocked": "被阻塞",
  "run.failed": "执行失败",
  "token.updated": "Token 更新",
};

function printEvent(event: RuntimeEvent): void {
  const label = EVENT_LABELS[event.type] ?? event.type;
  const data = event.data ?? {};
  const parts: string[] = [];
  if (typeof data.step === "number") parts.push(`步骤 ${data.step}`);
  if (typeof data.agent_role === "string") parts.push(String(data.agent_role));
  if (typeof data.action === "string") parts.push(String(data.action));
  if (typeof data.summary === "string") parts.push(String(data.summary).slice(0, 140));
  if (typeof data.output_summary === "string") parts.push(String(data.output_summary).slice(0, 160));
  if (typeof data.input_summary === "string") parts.push(`in=${String(data.input_summary).slice(0, 80)}`);
  if (typeof data.risk === "string") parts.push(`risk=${data.risk}`);
  if (typeof data.tokens === "number") parts.push(`${data.tokens} tokens`);
  if (typeof data.used_tokens === "number") parts.push(`used=${data.used_tokens}`);
  console.log(`[${event.at.slice(11, 19)}] #${event.seq} ${label}${parts.length ? " · " + parts.join(" · ") : ""}`);
}

function printRun(run: RunRecord): void {
  console.log(`run ${run.run_id}（${run.status}）目标：${run.goal}`);
  console.log(`  进度：${run.steps_done}/${run.steps_total} 步；Token：${run.token_used}`);
  if (run.pending_approval) console.log(`  ⏳ 待确认：步骤 ${run.pending_approval.step}（${run.pending_approval.risk ?? "risk?"}）${run.pending_approval.summary}`);
  if (run.error) console.log(`  错误：${run.error}`);
}

/** v1.5：实时 tail Harness 事件文件（thinking/tool/artifact），用于 CLI 实时显示。 */
function startHarnessTail(repoRoot: string, sessionId: string, onEvent: (step: number, event: Record<string, unknown>) => void): () => void {
  const dir = join(repoRoot, "runs", sessionId, "harness");
  const offsets = new Map<string, number>();
  let seenReports = new Set<string>();
  const tick = () => {
    if (!existsSync(dir)) return;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!/^step-\d+-events\.jsonl$/.test(name)) continue;
      const step = Number(/^step-(\d+)-/.exec(name)?.[1] ?? 0);
      const path = join(dir, name);
      const offset = offsets.get(path) ?? 0;
      let size = 0;
      try { size = readFileSync(path).length; } catch { continue; }
      if (size <= offset) continue;
      let buf = "";
      try { buf = readFileSync(path, "utf8").slice(offset); } catch { continue; }
      offsets.set(path, size);
      for (const line of buf.split("\n")) {
        if (line.trim() === "") continue;
        try { onEvent(step, JSON.parse(line) as Record<string, unknown>); } catch { /* ignore */ }
      }
    }
    for (const name of names) {
      if (!/^step-\d+-report\.md$/.test(name)) continue;
      if (seenReports.has(name)) continue;
      seenReports.add(name);
      const step = Number(/^step-(\d+)-/.exec(name)?.[1] ?? 0);
      onEvent(step, { type: "report.created", at: new Date().toISOString(), data: { report: name } });
    }
  };
  const timer = setInterval(tick, 400);
  tick();
  return () => clearInterval(timer);
}

function readHarnessSummary(repoRoot: string, sessionId: string): { artifacts: unknown[]; metrics: Record<string, unknown> | null; reports: string[] } {
  const dir = join(repoRoot, "runs", sessionId, "harness");
  const artifacts: unknown[] = [];
  const reports: string[] = [];
  let metrics: Record<string, unknown> | null = null;
  if (!existsSync(dir)) return { artifacts, metrics, reports };
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return { artifacts, metrics, reports }; }
  for (const name of names) {
    try {
      if (/^step-\d+-artifacts\.json$/.test(name)) {
        const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
        const list = Array.isArray(parsed.artifacts) ? (parsed.artifacts as unknown[]) : [];
        artifacts.push(...list);
      } else if (/^step-\d+-report\.md$/.test(name)) {
        reports.push(name);
      } else if (name === "metrics.json") {
        metrics = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      }
    } catch { /* ignore */ }
  }
  return { artifacts, metrics, reports };
}

export async function cmdRuntime(parsed: RuntimeArgs): Promise<number> {
  const root = findRepoRoot();
  const json = parsed.flags.json === true;
  const action = (flag(parsed.flags, "action") ?? "start").toLowerCase();
  const { config, orchestrator } = createRuntime(root, { autoApprove: false });
  const settings = config.getRuntimeSettings();
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
            ...(step.action_plan ? { action_plan: { ...(step.action_plan.risk ? { risk: step.action_plan.risk } : {}), ...(step.action_plan.requires_confirmation ? { requires_confirmation: true } : {}) } } : {}),
          })),
          approvals: Object.fromEntries(Object.entries(session.approvals ?? {}).map(([key, value]) => [key, { status: value.status }])),
          messages: session.messages.map((message) => ({ ...(message.role ? { role: message.role } : {}), ...(message.kind ? { kind: message.kind } : {}), text: message.text, ...(message.summary ? { summary: message.summary } : {}) })),
          children: Object.fromEntries(
            Object.entries(session.children).map(([role, turns]) => [
              role,
              turns.map((turn) => ({ seq: turn.seq, agent_role: turn.agent_role, input_summary: turn.input_summary, output_summary: turn.output_summary, tokens: turn.tokens, status: turn.status, ...(turn.model_mode ? { model_mode: turn.model_mode } : {}), ...(turn.detail ? { detail: turn.detail } : {}) })),
            ]),
          ),
        };
      },
      decideApproval: (sessionId, step, decision) => orchestrator.decideApproval(sessionId, step, decision, "human:cli"),
      interrupt: (sessionId, reason) => (reason ? orchestrator.interrupt(sessionId, reason) : orchestrator.interrupt(sessionId)),
      resume: (sessionId) => orchestrator.resume(sessionId),
    },
    settings: {
      auto_run: settings.auto_run,
      approval_mode: settings.approval_mode,
      full_auto: settings.full_auto,
      max_auto_steps: settings.max_auto_steps,
      rework_limit: settings.rework_limit,
      event_retention: settings.event_retention,
    },
    root: join(root, ".steward", "runtime"),
    maxConcurrentRuns: 3,
  });

  try {
    switch (action) {
      case "start": {
        const goal = flag(parsed.flags, "goal");
        if (!goal || goal.trim().length === 0) {
          console.error('用法：steward runtime --goal "帮我做一个报价单页面" [--json] [--manual]');
          return 2;
        }
        const harnessEvents: Array<{ step: number; event: Record<string, unknown> }> = [];
        const subscribe = manager.subscribeAll((event) => {
          if (!json) printEvent(event);
        });
        let stopHarnessTail: (() => void) | undefined;
        const startTail = (sessionId: string) => {
          stopHarnessTail = startHarnessTail(root, sessionId, (step, event) => {
            harnessEvents.push({ step, event });
            if (!json) {
              const type = String(event.type ?? "harness");
              const data = (event.data ?? {}) as Record<string, unknown>;
              if (type === "thinking") console.log(`[harness:thinking] step${step} ${String(data.text ?? "").slice(0, 160)}`);
              else if (type === "tool_call") console.log(`[harness:tool] step${step} ${String(data.tool ?? "")} ${JSON.stringify(data.input ?? {}).slice(0, 120)}`);
              else if (type === "tool_result") console.log(`[harness:tool-result] step${step} ${String(data.tool ?? "")} ${String(data.status ?? "")}`);
              else if (type === "final") console.log(`[harness:final] step${step} ${String(data.text ?? "").slice(0, 160)}`);
              else if (type === "report.created") console.log(`[harness:report] step${step} ${String(data.report ?? "")}`);
            }
          });
        };
        const created = await manager.createRun({
          goal: goal.trim(),
          ...(flagNum(parsed.flags, "budget", 0) > 0 ? { budget_cny: flagNum(parsed.flags, "budget", 0) } : {}),
          ...(flag(parsed.flags, "token-limit") ? { token_limit: flagNum(parsed.flags, "token-limit", 0) } : {}),
          autoStart: parsed.flags.manual === true ? false : true,
        });
        if (!json) {
          console.log(`已创建 Run：${created.run_id}（状态 ${created.status}）——发送即执行，无需手动点开始`);
          printRun(created);
        }
        if (parsed.flags.manual === true) {
          subscribe();
          if (json) printJson({ ok: true, run: manager.getRun(created.run_id) });
          return 0;
        }
        startTail(created.session_id);
        const finished = await manager.waitFor(created.run_id, ["done", "blocked", "failed", "paused", "awaiting_approval", "interrupted"], flagNum(parsed.flags, "timeout", 300_000));
        stopHarnessTail?.();
        subscribe();
        const harnessSummary = readHarnessSummary(root, finished.session_id);
        if (json) {
          printJson({ ok: finished.status === "done", run: finished, events: manager.eventLog(created.run_id), harness_events: harnessEvents, harness_artifacts: harnessSummary.artifacts, harness_reports: harnessSummary.reports, harness_metrics: harnessSummary.metrics });
        } else {
          console.log("— 执行结束 —");
          printRun(finished);
          if (finished.status === "awaiting_approval" || finished.status === "paused") {
            console.log(`  审批/继续：steward runtime --action approve --run ${finished.run_id} --step <步骤号>`);
          }
          console.log(`  查看事件：steward runtime --action stream --run ${finished.run_id}`);
          if (harnessSummary.artifacts.length > 0) {
            console.log("  Harness 产物：");
            for (const artifact of harnessSummary.artifacts as Array<Record<string, unknown>>) console.log(`    - ${String(artifact.rel_path ?? "")}（${String(artifact.kind ?? "")}，${String(artifact.size ?? 0)}B）`);
          }
          if (harnessSummary.reports.length > 0) console.log("  Harness 报告：" + harnessSummary.reports.join("、"));
        }
        const exitCode = finished.status === "done" ? 0 : finished.status === "awaiting_approval" ? 0 : 1;
        process.exit(exitCode);
      }
      case "list": {
        const runs = manager.listRuns();
        if (json) printJson({ ok: true, runs });
        else for (const run of runs) printRun(run);
        return 0;
      }
      case "status": {
        const runId = flag(parsed.flags, "run");
        if (!runId) {
          console.error("用法：steward runtime --action status --run <run-id>");
          return 2;
        }
        const run = manager.getRun(runId);
        if (!run) {
          console.error(`Run 不存在：${runId}`);
          return 2;
        }
        if (json) printJson({ ok: true, run, events: manager.eventLog(runId) });
        else printRun(run);
        return 0;
      }
      case "stream": {
        const runId = flag(parsed.flags, "run");
        if (!runId) {
          console.error("用法：steward runtime --action stream --run <run-id>");
          return 2;
        }
        const since = flagNum(parsed.flags, "since", 0);
        if (json) {
          printJson({ ok: true, events: manager.eventLog(runId, since) });
          return 0;
        }
        for (const event of manager.eventLog(runId, since)) printEvent(event);
        const run = manager.getRun(runId);
        if (run && ["done", "blocked", "failed", "paused", "awaiting_approval", "interrupted"].includes(run.status)) return 0;
        await new Promise<void>((resolve) => {
          const unsubscribe = manager.subscribeRun(runId, (event) => {
            printEvent(event);
            if (["run.completed", "run.blocked", "run.failed", "run.paused", "run.interrupted", "approval.required"].includes(event.type)) {
              if (event.type !== "approval.required") {
                unsubscribe();
                resolve();
              }
            }
          }, since);
        });
        return 0;
      }
      case "approve":
      case "reject": {
        const runId = flag(parsed.flags, "run");
        const step = flagNum(parsed.flags, "step", 0);
        if (!runId || step <= 0) {
          console.error(`用法：steward runtime --action ${action} --run <id> --step <步骤号>`);
          return 2;
        }
        await manager.approve(runId, step, action === "approve" ? "approve" : "reject", "human:cli");
        const run = manager.getRun(runId);
        if (json) printJson({ ok: true, run });
        else if (run) printRun(run);
        return 0;
      }
      case "interrupt":
      case "resume": {
        const runId = flag(parsed.flags, "run");
        if (!runId) {
          console.error(`用法：steward runtime --action ${action} --run <id>`);
          return 2;
        }
        if (action === "interrupt") await manager.interruptRun(runId);
        else await manager.resumeRun(runId);
        const run = manager.getRun(runId);
        if (json) printJson({ ok: true, run });
        else if (run) printRun(run);
        return 0;
      }
      default:
        console.error(`未知 action：${action}（start|list|status|stream|approve|reject|interrupt|resume）`);
        return 2;
    }
  } catch (error) {
    console.error(`runtime 命令失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
