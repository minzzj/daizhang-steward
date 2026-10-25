import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeResult, CodeTask } from "../../steward-core/src/index.js";
import type { HarnessAdapter } from "./index.js";
import { applyPatchInWorktree, removeWorktree } from "./patch.js";

export interface CodeLoopRound {
  round: number;
  patchAvailable: boolean;
  patchApplied: boolean;
  acceptanceExit: number | null;
  acceptanceOutput: string;
  note: string;
}

export interface CodeLoopResult {
  ok: boolean;
  escalated: boolean;
  rounds: CodeLoopRound[];
  patch: string;
  summary: string;
  testLog: string;
  evidence: string[];
}

export interface CodeLoopOptions {
  task: CodeTask;
  harness: HarnessAdapter;
  repoRoot: string;
  /** Shell command run inside the patched worktree. `{worktree}` / `{evidenceDir}` are substituted. */
  acceptanceCommand: string;
  evidenceDir: string;
  testLogPath: string;
  maxRounds?: number;
  /** Make the harness fail on the first round (failure-injection for the two-round escalation path). */
  simulateFailureFirstRound?: boolean;
  onLog?: (line: string) => void;
}

const DEFAULT_MAX_ROUNDS = 2;

function log(options: CodeLoopOptions, line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  appendFileSync(options.testLogPath, stamped + "\n", "utf8");
  options.onLog?.(line);
}

function runAcceptance(command: string, cwd: string): { exit: number; output: string } {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, NO_COLOR: "1", STEWARD_WORKTREE: cwd },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { exit: result.status ?? -1, output };
}

/**
 * CodeTask → Harness → patch → isolated worktree → real acceptance test.
 * Max two rounds, then escalate to a human (no infinite retries).
 */
export async function runCodeLoop(options: CodeLoopOptions): Promise<CodeLoopResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const rounds: CodeLoopRound[] = [];
  const evidence: string[] = [];
  let lastPatch = "";
  let lastSummary = "";

  log(options, `code loop start: task=${options.task.task_id} maxRounds=${maxRounds}`);

  for (let round = 1; round <= maxRounds; round++) {
    const simulateFailure = round === 1 && options.simulateFailureFirstRound === true;
    let result: CodeResult;
    try {
      result = await options.harness.runTask(options.task, { simulateFailure });
    } catch (error) {
      lastSummary = `Harness 调用失败：${error instanceof Error ? error.message : String(error)}`;
      rounds.push({ round, patchAvailable: false, patchApplied: false, acceptanceExit: null, acceptanceOutput: "", note: lastSummary });
      log(options, lastSummary);
      continue;
    }

    lastPatch = result.patch;
    lastSummary = result.summary;
    if (!result.patch.trim()) {
      rounds.push({ round, patchAvailable: false, patchApplied: false, acceptanceExit: null, acceptanceOutput: "", note: `第 ${round} 轮无补丁：${result.summary}` });
      log(options, `round ${round}: no patch returned (${result.summary})`);
      continue;
    }

    const applied = applyPatchInWorktree({ repoRoot: options.repoRoot, patch: result.patch, label: `r${round}` });
    if (!applied.ok) {
      rounds.push({ round, patchAvailable: true, patchApplied: false, acceptanceExit: null, acceptanceOutput: applied.applyOutput || applied.checkOutput, note: "补丁无法应用" });
      log(options, `round ${round}: patch apply failed: ${applied.applyOutput || applied.checkOutput}`);
      continue;
    }

    const command = options.acceptanceCommand
      .replaceAll("{worktree}", applied.worktree)
      .replaceAll("{evidenceDir}", options.evidenceDir);
    log(options, `round ${round}: patch applied in isolated worktree ${applied.worktree}`);
    log(options, `round ${round}: acceptance command = ${command}`);
    const acceptance = runAcceptance(command, applied.worktree);
    log(options, `round ${round}: acceptance exit=${acceptance.exit}`);
    if (acceptance.output) log(options, `round ${round}: acceptance output:\n${acceptance.output}`);
    removeWorktree(options.repoRoot, applied.worktree);

    rounds.push({
      round,
      patchAvailable: true,
      patchApplied: true,
      acceptanceExit: acceptance.exit,
      acceptanceOutput: acceptance.output,
      note: acceptance.exit === 0 ? "验收通过" : "验收未通过",
    });

    if (acceptance.exit === 0) {
      const summary = `第 ${round} 轮通过：${result.summary}`;
      log(options, summary);
      return { ok: true, escalated: false, rounds, patch: result.patch, summary, testLog: options.testLogPath, evidence };
    }
  }

  const escalated = true;
  const summary = `连续 ${maxRounds} 轮未通过，已停止并升级人类（不无限重试）。最后补丁说明：${lastSummary}`;
  log(options, summary);
  return { ok: false, escalated, rounds, patch: lastPatch, summary, testLog: options.testLogPath, evidence };
}

/** Resolve the repo-relative evidence path helper used by CLI handlers. */
export function evidencePaths(evidenceDir: string, ...names: string[]): string[] {
  return names.map((name) => join(evidenceDir, name));
}
