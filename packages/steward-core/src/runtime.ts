import { join } from "node:path";
import { ArtifactBus } from "./artifacts.js";
import { BudgetGuard } from "./budget.js";
import { EventLog } from "./events.js";
import { newRunId } from "./ids.js";
import { PolicyEngine } from "./policy.js";
import { PromptManager } from "./prompts.js";
import { digest } from "./redact.js";
import { renderReport } from "./report.js";
import { StopSignal } from "./stop.js";
import type { ToolRegistry } from "./tools.js";
import type {
  BranchSpec,
  PlannedStep,
  RunArtifacts,
  RunMeta,
  RunResult,
  StepResult,
} from "./types.js";

export interface RuntimeOptions {
  root: string;
  tools: ToolRegistry;
  prompts?: PromptManager;
  runsRoot?: string;
}

interface RunInput {
  branch: BranchSpec;
  plan: PlannedStep[];
  runId?: string;
  promptVars?: Record<string, string>;
}

/**
 * AgentRuntime: plan → act → observe → reflect → report.
 * Operator / Scout / Reviewer are configurations (BranchSpec), not subclasses.
 */
export class AgentRuntime {
  readonly artifacts: ArtifactBus;
  private readonly stopSignal: StopSignal;

  constructor(private readonly options: RuntimeOptions) {
    this.artifacts = new ArtifactBus(options.runsRoot ?? join(options.root, "runs"));
    this.stopSignal = new StopSignal(join(options.root, ".steward", "STOP"));
  }

  async run(input: RunInput): Promise<RunResult> {
    const { branch, plan } = input;
    this.options.tools.require(branch.tools);

    const promptId = branch.prompt_ref.split("@")[0] ?? branch.role;
    const vars: Record<string, string> = {
      goal: branch.goal,
      branch_id: branch.id,
      branch_role: branch.role,
      tools: branch.tools.join(", "),
      ...(input.promptVars ?? {}),
    };
    let promptText = `# ${branch.role} branch prompt (no PromptManager attached)\n\nGoal: ${branch.goal}\n`;
    if (this.options.prompts) promptText = await this.options.prompts.render(promptId, vars);

    const runId = input.runId ?? newRunId();
    const artifacts: RunArtifacts = await this.artifacts.createRun({
      goal: branch.goal,
      branchId: branch.id,
      runId,
      promptText,
    });
    const events = await EventLog.open(artifacts.events);
    const policy = new PolicyEngine({
      require_approval: branch.approval_policy.require_approval,
      deny: branch.approval_policy.deny,
    });
    const budget = new BudgetGuard(branch.budget);

    const startedAt = new Date().toISOString();
    const meta: RunMeta = {
      runId,
      goal: branch.goal,
      branchId: branch.id,
      branchRole: branch.role,
      promptRef: branch.prompt_ref,
      startedAt,
      evidenceRoot: this.artifacts.rel(this.options.root, artifacts.dir),
    };
    await this.artifacts.writeMeta(artifacts, meta);
    await this.artifacts.console(artifacts, `run ${runId} started: ${branch.goal}`);
    await events.append({
      branch_id: branch.id,
      tool: "branch.start",
      target: branch.goal,
      input_digest: digest({ branch: branch.id, plan: plan.length }),
      policy_decision: "allow",
      result: "started",
      evidence_path: this.artifacts.rel(this.options.root, artifacts.meta),
      confidence: "certain",
    });

    const steps: StepResult[] = [];
    let ok = true;

    for (const step of plan) {
      const stop = await this.stopSignal.read();
      if (stop.stopped) {
        ok = false;
        steps.push({ tool: step.tool, decision: "deny", ok: false, summary: `停止键触发：${stop.reason ?? "手动停止"}`, evidence: [] });
        await events.append({
          branch_id: branch.id,
          tool: "stop",
          target: stop.reason ?? "manual stop",
          input_digest: digest(branch.id),
          policy_decision: "deny",
          result: "failure",
          evidence_path: "",
          confidence: "certain",
        });
        break;
      }

      const spec = this.options.tools.get(step.tool);
      if (!spec) {
        ok = false;
        steps.push({ tool: step.tool, decision: "deny", ok: false, summary: `工具未注册：${step.tool}`, evidence: [] });
        break;
      }

      const verdict = policy.evaluate({ tool: step.tool, risk: spec.risk });
      if (verdict.decision !== "allow") {
        ok = false;
        steps.push({ tool: step.tool, decision: verdict.decision, ok: false, summary: verdict.reason, evidence: [] });
        await events.append({
          branch_id: branch.id,
          tool: step.tool,
          target: step.description ?? step.tool,
          input_digest: digest(step.args ?? {}),
          policy_decision: verdict.decision,
          result: "pending_approval",
          evidence_path: "",
          confidence: "probable",
        });
        break;
      }

      const result = await this.options.tools.execute(step.tool, step.args ?? {}, {
        runId,
        branchId: branch.id,
        evidenceDir: artifacts.dir,
      });
      const evidence = result.evidence ?? [];
      steps.push({
        tool: step.tool,
        decision: verdict.decision,
        ok: result.ok,
        summary: result.summary,
        evidence,
      });
      await events.append({
        branch_id: branch.id,
        tool: step.tool,
        target: step.description ?? step.tool,
        input_digest: digest(step.args ?? {}),
        policy_decision: "allow",
        result: result.ok ? "success" : "failure",
        evidence_path: evidence.map((p) => this.artifacts.rel(this.options.root, p)).join(","),
        confidence: "certain",
      });
      const check = budget.charge(step.tool === "harness.request" ? { token: 15_000, time_minutes: 3 } : { token: 2_000, time_minutes: 0.5 });
      await this.artifacts.console(artifacts, `${step.tool}: ${result.summary} (${check.reason})`);
      if (check.status === "exceeded") {
        ok = false;
        steps.push({ tool: "budget", decision: "deny", ok: false, summary: check.reason, evidence: [] });
        break;
      }
      if (!result.ok) {
        ok = false;
        break;
      }
    }

    const finishedAt = new Date().toISOString();
    meta.finishedAt = finishedAt;
    meta.ok = ok;
    meta.steps = steps.length;
    await this.artifacts.writeMeta(artifacts, meta);

    const finalEvents = await events.read();
    const report = renderReport({
      meta,
      events: finalEvents,
      steps,
      artifacts,
      root: this.options.root,
    });
    await this.artifacts.write(artifacts.report, report);
    await events.append({
      branch_id: branch.id,
      tool: "branch.end",
      target: ok ? "ok" : "failed",
      input_digest: digest({ steps: steps.length, ok }),
      policy_decision: "allow",
      result: "ended",
      evidence_path: this.artifacts.rel(this.options.root, artifacts.report),
      confidence: "certain",
    });
    await this.artifacts.console(artifacts, `run ${runId} finished: ${ok ? "ok" : "failed"}`);

    return {
      runId,
      branchId: branch.id,
      ok,
      steps,
      artifacts,
      reportPath: artifacts.report,
    };
  }
}
