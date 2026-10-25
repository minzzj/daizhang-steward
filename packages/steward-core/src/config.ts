import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface StewardPaths {
  root: string;
  runs: string;
  prompts: string;
  examples: string;
  stopFile: string;
}

/** Walk upwards until a pnpm-workspace.yaml (repo root) is found. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function stewardPaths(root: string = findRepoRoot()): StewardPaths {
  return {
    root,
    runs: join(root, "runs"),
    prompts: join(root, "prompts"),
    examples: join(root, "examples"),
    stopFile: join(root, ".steward", "STOP"),
  };
}
