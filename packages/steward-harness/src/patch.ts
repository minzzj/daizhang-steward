import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ApplyPatchResult {
  ok: boolean;
  worktree: string;
  checkOutput: string;
  applyOutput: string;
  cleanedUp: boolean;
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Apply a unified diff inside an isolated `git worktree` checkout of HEAD.
 * The main working tree is never modified; call `removeWorktree` when done.
 */
export function applyPatchInWorktree(options: {
  repoRoot: string;
  patch: string;
  label?: string;
}): ApplyPatchResult {
  const label = (options.label ?? "patch").replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  const worktree = mkdtempSync(join(tmpdir(), `steward-wt-${label}-`));
  const fail = (checkOutput: string, applyOutput: string): ApplyPatchResult => {
    removeWorktree(options.repoRoot, worktree);
    return { ok: false, worktree, checkOutput, applyOutput, cleanedUp: true };
  };

  const add = runGit(["worktree", "add", "--detach", worktree, "HEAD"], options.repoRoot);
  if (add.status !== 0) {
    rmSync(worktree, { recursive: true, force: true });
    return { ok: false, worktree, checkOutput: "", applyOutput: add.stderr || add.stdout, cleanedUp: true };
  }

  const patchFile = join(worktree, ".steward-patch.diff");
  try {
    // Normalize line endings: a CRLF-converted working tree must never break `git apply`.
    const normalizedPatch = options.patch.replaceAll("\r\n", "\n");
    writeFileSync(patchFile, normalizedPatch, "utf8");
  } catch (error) {
    return fail("", `写入补丁失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const check = runGit(["apply", "--check", patchFile], worktree);
  if (check.status !== 0) return fail(check.stderr || check.stdout, "");

  const apply = runGit(["apply", patchFile], worktree);
  try {
    rmSync(patchFile, { force: true });
  } catch {
    /* ignore */
  }
  if (apply.status !== 0) return fail("", apply.stderr || apply.stdout);

  return {
    ok: true,
    worktree,
    checkOutput: check.stderr || check.stdout,
    applyOutput: apply.stderr || apply.stdout,
    cleanedUp: false,
  };
}

export function removeWorktree(repoRoot: string, worktree: string): void {
  runGit(["worktree", "remove", "--force", worktree], repoRoot);
  runGit(["worktree", "prune"], repoRoot);
  if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
}
