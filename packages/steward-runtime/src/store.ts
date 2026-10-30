/**
 * 持久化：`<root>/runs.json` + `<root>/events-<runId>.jsonl`（均为 tmp+rename 原子写）。
 *
 * - runs.json 存全部 Run 记录（含少量内部恢复字段）；
 * - 每 run 一个事件 JSONL，只保存最近 `event_retention` 条（seq 保持连续递增，旧事件丢弃）；
 * - 读取对损坏文件/行容错（跳过而不是崩溃）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RuntimeValidationError } from "./errors.js";
import type { PersistedRunState, PersistedRunsFile, RuntimeEvent } from "./types.js";

const RUNS_FILE = "runs.json";
const EVENT_FILE_PREFIX = "events-";
const EVENT_FILE_SUFFIX = ".jsonl";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** Run/事件持久化存储。 */
export class RunStore {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new RuntimeValidationError("RunStore 需要非空 root", "CONFIG", "root");
    }
    this.root = root.trim();
  }

  private runsPath(): string {
    return join(this.root, RUNS_FILE);
  }

  private eventsPath(runId: string): string {
    return join(this.root, `${EVENT_FILE_PREFIX}${runId}${EVENT_FILE_SUFFIX}`);
  }

  private ensureRoot(): void {
    mkdirSync(this.root, { recursive: true });
  }

  /** 保存全部 Run 状态（原子写）。 */
  saveRuns(states: PersistedRunState[], nowIso: string): void {
    this.ensureRoot();
    const payload: PersistedRunsFile = { version: 1, generated_at: nowIso, runs: states };
    atomicWrite(this.runsPath(), `${JSON.stringify(payload, null, 2)}\n`);
  }

  /** 读取全部 Run 状态（不存在/损坏 → []；逐项做最小校验）。 */
  loadRuns(): PersistedRunState[] {
    const path = this.runsPath();
    if (!existsSync(path)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return [];
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.runs)) return [];
    const states: PersistedRunState[] = [];
    for (const item of parsed.runs) {
      if (!isRecord(item) || !isRecord(item.run)) continue;
      const run = item.run;
      if (typeof run.run_id !== "string" || typeof run.session_id !== "string") continue;
      const state: PersistedRunState = {
        run: run as unknown as PersistedRunState["run"],
        reworks: typeof item.reworks === "number" && Number.isFinite(item.reworks) ? item.reworks : 0,
        project_started: item.project_started === true,
        plan_ready: item.plan_ready === true,
        rejected_by_human: item.rejected_by_human === true,
      };
      states.push(state);
    }
    return states;
  }

  /** 保存某 run 的事件（只写保留窗口内的；原子覆盖）。 */
  saveEvents(runId: string, events: RuntimeEvent[]): void {
    this.ensureRoot();
    const content = events.map((event) => JSON.stringify(event)).join("\n");
    atomicWrite(this.eventsPath(runId), content.length > 0 ? `${content}\n` : "");
  }

  /** 读取某 run 的事件（坏行跳过）。 */
  loadEvents(runId: string): RuntimeEvent[] {
    const path = this.eventsPath(runId);
    if (!existsSync(path)) return [];
    let content = "";
    try {
      content = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    const events: RuntimeEvent[] = [];
    for (const line of content.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as RuntimeEvent;
        if (typeof parsed === "object" && parsed !== null && typeof parsed.seq === "number") events.push(parsed);
      } catch {
        /* 跳过损坏行 */
      }
    }
    events.sort((left, right) => left.seq - right.seq);
    return events;
  }

  /** 列出已存在事件文件的 run id（诊断/迁移用）。 */
  listEventRunIds(): string[] {
    if (!existsSync(this.root)) return [];
    const ids: string[] = [];
    for (const name of readdirSync(this.root)) {
      if (!name.startsWith(EVENT_FILE_PREFIX) || !name.endsWith(EVENT_FILE_SUFFIX)) continue;
      ids.push(name.slice(EVENT_FILE_PREFIX.length, name.length - EVENT_FILE_SUFFIX.length));
    }
    return ids.sort();
  }
}
