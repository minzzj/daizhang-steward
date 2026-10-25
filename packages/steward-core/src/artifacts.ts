import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { newRunId } from "./ids.js";
import type { RunArtifacts, RunMeta } from "./types.js";

/** Owns the runs/<run-id>/ evidence directory layout. */
export class ArtifactBus {
  constructor(public readonly runsRoot: string) {}

  async createRun(input: {
    goal: string;
    branchId: string;
    runId?: string;
    promptText?: string;
  }): Promise<RunArtifacts> {
    const runId = input.runId ?? newRunId();
    const dir = join(this.runsRoot, runId);
    await mkdir(join(dir, "screenshots"), { recursive: true });
    const art: RunArtifacts = {
      runId,
      dir,
      prompt: join(dir, "prompt.md"),
      patch: join(dir, "patch.diff"),
      testLog: join(dir, "test.log"),
      screenshotsDir: join(dir, "screenshots"),
      report: join(dir, "report.md"),
      consoleLog: join(dir, "console.log"),
      meta: join(dir, "meta.json"),
      events: join(dir, "events.jsonl"),
    };
    if (input.promptText !== undefined) await this.write(art.prompt, input.promptText);
    return art;
  }

  async write(file: string, content: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }

  async append(file: string, content: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, content, "utf8");
  }

  async writeJSON(file: string, value: unknown): Promise<void> {
    await this.write(file, JSON.stringify(value, null, 2) + "\n");
  }

  async writeMeta(art: RunArtifacts, meta: RunMeta): Promise<void> {
    await this.writeJSON(art.meta, meta);
  }

  async console(art: RunArtifacts, line: string): Promise<void> {
    await this.append(art.consoleLog, `[${new Date().toISOString()}] ${line}\n`);
  }

  /** Repository-relative path with forward slashes (for evidence fields and docs). */
  rel(root: string, file: string): string {
    return relative(root, file).replaceAll("\\", "/");
  }

  async listRuns(): Promise<Array<{ runId: string; dir: string; meta?: RunMeta }>> {
    const out: Array<{ runId: string; dir: string; meta?: RunMeta }> = [];
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(this.runsRoot, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
      const dir = join(this.runsRoot, entry.name);
      const metaPath = join(dir, "meta.json");
      try {
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as RunMeta;
        out.push({ runId: entry.name, dir, meta });
      } catch {
        out.push({ runId: entry.name, dir });
      }
    }
    out.sort((a, b) => b.runId.localeCompare(a.runId));
    return out;
  }

  async latestRun(): Promise<{ runId: string; dir: string; meta?: RunMeta } | undefined> {
    return (await this.listRuns())[0];
  }
}
