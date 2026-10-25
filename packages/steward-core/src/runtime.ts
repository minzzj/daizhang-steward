import { join } from "node:path";
import { ArtifactBus } from "./artifacts.js";
import { BudgetGuard } from "./budget.js";
import { CheckpointStore } from "./checkpoint.js";
import { EventLog } from "./events.js";
import { newRunId } from "./ids.js";
import { CredentialVault, ProfileLock } from "./isolation.js";
import { PolicyEngine } from "./policy.js";
import { PromptManager } from "./prompts.js";
import { digest } from "./redact.js";
import { renderReport } from "./report.js";
import { StopController, StoppedError } from "./stop-controller.js";
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
  /** Hard upper bound for a single step (ms). Long browser/desktop tools override via STEP_TIMEOUTS. */
  stepTimeoutMs?: number;
}

interface RunInput {
  branch: BranchSpec;
  plan: PlannedStep[];
  runId?: string;
  promptVars?: Record<string, string>;
  /** Resume a previous run from its checkpoint (skip completed steps, keep same run-id/evidence dir). */
  resume?: boolean;
}

/** Per-tool hard timeouts (ms). Stop preemption is separate (abort is immediate). */
const STEP_TIMEOUTS: Record<string, number> = {
  "browser.flow": 300_000,
  "desktop.flow": 300_000,
  "code.loop": 600_000,
  "harness.request": 120_000,
};
const DEFAULT_STEP_TIMEOUT_MS = 60_000;

/**
 * AgentRuntime: plan → act → observe → reflect → report.
 * Operator / Scout / Reviewer are configurations (BranchSpec), not subclasses.
 *
 * M2 additions: global stop key (≤5s preemption via AbortController), per-step checkpoints
 * (resume without repeating completed steps), branch profile locks and credential references.
 */
export class AgentRuntime {
  readonly artifacts: ArtifactBus;
  readonly checkpoints: CheckpointStore;
  private readonly locks: ProfileLock;
  private readonly vault: CredentialVault;
  private readonly stopFile: string;

  constructor(private readonly options: RuntimeOptions) {
    const runsRoot = options.runsRoot ?? join(options.root, "runs");
    this.artifacts = new ArtifactBus(runsRoot);
    this.checkpoints = new CheckpointStore(options.root);
    this.locks = new ProfileLock(options.root);
    this.vault = new CredentialVault({ file: join(options.root, ".steward", "credentials.json") });
    this.stopFile = join(options.root, ".steward", "STOP");
  }

  async listResumable() {
    return this.checkpoints.listResumable();
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
    const resumeCheckpoint = input.resume ? await this.checkpoints.load(runId) : null;
    const doneSteps = new Set(resumeCheckpoint?.doneSteps ?? []);
    const doneList: string[] = [...doneSteps];
    const startIndex = resumeCheckpoint ? resumeCheckpoint.stepIndex + 1 : 0;

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
    const stopController = new StopController(this.stopFile);
    stopController.start();

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
    await this.artifacts.console(
      artifacts,
      `run ${runId} started: ${branch.goal}${resumeCheckpoint ? ` (resume from step ${startIndex})` : ""}`,
    );
    await events.append({
      branch_id: branch.id,
      tool: "branch.start",
      target: branch.goal,
      input_digest: digest({ branch: branch.id, plan: plan.length, resume: startIndex }),
      policy_decision: "allow",
      result: "started",
      evidence_path: this.artifacts.rel(this.options.root, artifacts.meta),
      confidence: "certain",
    });

    const steps: StepResult[] = [];
    let ok = true;

    // 注：不在此处写初始检查点（stepIndex=-1 无意义）；每成功完成一步后由 markStepDone 落盘。

    try {
      for (let index = 0; index < plan.length; index++) {
        const step = plan[index];
        if (!step) continue;
        if (resumeCheckpoint && doneSteps.has(`step-${index}`)) {
          await this.artifacts.console(artifacts, `step ${index} (${step.tool}) skipped: already done in checkpoint`);
          continue;
        }

        if (stopController.isStopped) {
          ok = false;
          const event = stopController.lastEvent;
          steps.push({
            tool: step.tool,
            decision: "deny",
            ok: false,
            summary: `停止键触发，步骤未执行（${event?.reason ?? "manual stop"}）`,
            evidence: [],
          });
          await events.append({
            branch_id: branch.id,
            tool: "stop",
            target: event?.reason ?? "manual stop",
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

        // Branch tool allowlist: a step may only use tools listed in its BranchSpec.
        if (!branch.tools.includes(step.tool)) {
          ok = false;
          steps.push({ tool: step.tool, decision: "deny", ok: false, summary: `工具不在分支白名单：${step.tool}`, evidence: [] });
          await events.append({
            branch_id: branch.id,
            tool: step.tool,
            target: step.description ?? step.tool,
            input_digest: digest(step.args ?? {}),
            policy_decision: "deny",
            result: "failure",
            evidence_path: "",
            confidence: "certain",
          });
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

        const timeoutMs = this.options.stepTimeoutMs ?? STEP_TIMEOUTS[step.tool] ?? DEFAULT_STEP_TIMEOUT_MS;
        let result;
        try {
          result = await stopController.withAbort(
            (signal) =>
              this.options.tools.execute(step.tool, step.args ?? {}, {
                runId,
                branchId: branch.id,
                evidenceDir: artifacts.dir,
                signal,
                locks: this.locks,
                vault: this.vault,
              }),
            timeoutMs,
          );
        } catch (error) {
          ok = false;
          if (error instanceof StoppedError) {
            steps.push({
              tool: step.tool,
              decision: "deny",
              ok: false,
              summary: `停止键在步骤执行中触发（${error.reason}，${error.stoppedAt}）`,
              evidence: [],
            });
            await events.append({
              branch_id: branch.id,
              tool: "stop",
              target: error.reason,
              input_digest: digest(step.args ?? {}),
              policy_decision: "deny",
              result: "failure",
              evidence_path: "",
              confidence: "certain",
            });
          } else {
            steps.push({
              tool: step.tool,
              decision: "allow",
              ok: false,
              summary: `步骤异常：${error instanceof Error ? error.message : String(error)}`,
              evidence: [],
            });
            await events.append({
              branch_id: branch.id,
              tool: step.tool,
              target: step.description ?? step.tool,
              input_digest: digest(step.args ?? {}),
              policy_decision: "allow",
              result: "failure",
              evidence_path: "",
              confidence: "unknown",
            });
          }
          break;
        }

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
        const check = budget.charge(
          step.tool === "harness.request" ? { token: 15_000, time_minutes: 3 } : { token: 2_000, time_minutes: 0.5 },
        );
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
        // 成功一步后写检查点（崩溃/停止后可从下一步恢复）
        doneList.push(`step-${index}`);
        await this.checkpoints.save({
          runId,
          branchId: branch.id,
          stepIndex: index,
          doneSteps: [...doneList],
          completed: false,
          state: { lastTool: step.tool },
        });
      }
    } finally {
      stopController.dispose();
    }

    const finishedAt = new Date().toISOString();
    meta.finishedAt = finishedAt;
    meta.ok = ok;
    meta.steps = steps.length;
    await this.artifacts.writeMeta(artifacts, meta);

    if (ok) {
      try {
        await this.checkpoints.markCompleted(runId);
      } catch {
        // 零步骤运行没有检查点文件；无需标记完成
      }
    }

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
