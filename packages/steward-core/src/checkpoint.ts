import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";

/**
 * M2-B / A8：检查点与重启恢复（不重复执行已完成步骤）。
 *
 * 目录布局：`<root>/runs/<runId>/checkpoint.json`，与 ArtifactBus 的 run 目录同源，
 * 但不依赖 ArtifactBus（纯文件 JSON、无第三方依赖）。
 *
 * 写入采取「同目录 tmp 文件 + rename」的原子替换：进程在任意时刻被杀，旧检查点仍完整，
 * 不会读到半截 JSON。恢复时：`load(runId)` → 跳过 `doneSteps` → 从 `stepIndex` 继续。
 */

export const CHECKPOINT_VERSION = 1 as const;

export interface Checkpoint {
  version: typeof CHECKPOINT_VERSION;
  runId: string;
  branchId: string;
  /** 最近完成的步骤序号（下一步从 stepIndex + 1 继续）。 */
  stepIndex: number;
  /** 已完成的步骤标签（幂等去重，如 "step-0"/"step-1"）。 */
  doneSteps: string[];
  /** 整个 run 是否已完成；true 的行不会出现在 listResumable()。 */
  completed: boolean;
  /** ISO 8601 更新时间。 */
  updatedAt: string;
  /** 运行时可放任意可 JSON 序列化的上下文（供恢复后续跑）。 */
  state: Record<string, unknown>;
}

/** 可恢复运行：检查点 + 磁盘路径（供 CLI/report 展示）。 */
export interface ResumePoint extends Checkpoint {
  path: string;
}

export interface SaveCheckpointInput {
  runId: string;
  branchId: string;
  stepIndex: number;
  doneSteps?: string[];
  completed?: boolean;
  state?: Record<string, unknown>;
  /** 可选：注入更新时间（测试/回放用；缺省 new Date().toISOString()）。 */
  updatedAt?: string;
}

export class CheckpointError extends Error {
  readonly runId: string;

  constructor(message: string, runId: string) {
    super(message);
    this.name = "CheckpointError";
    this.runId = runId;
  }
}

export class CheckpointNotFoundError extends CheckpointError {
  readonly path: string;

  constructor(path: string, runId: string) {
    super(`检查点不存在：${path}（runId=${runId}）`, runId);
    this.name = "CheckpointNotFoundError";
    this.path = path;
  }
}

export class CheckpointCorruptError extends CheckpointError {
  readonly path: string;

  constructor(path: string, runId: string, detail: string) {
    super(`检查点损坏：${path} — ${detail}`, runId);
    this.name = "CheckpointCorruptError";
    this.path = path;
  }
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new CheckpointError(`非法 runId（只允许字母/数字/._-，不能含 ..）：${String(runId)}`, String(runId));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDoneSteps(doneSteps: unknown): string[] {
  if (doneSteps === undefined) return [];
  if (!Array.isArray(doneSteps)) throw new Error("doneSteps 必须是字符串数组");
  const out: string[] = [];
  for (const item of doneSteps) {
    if (typeof item !== "string") throw new Error(`doneSteps 含有非字符串项：${String(item)}`);
    if (item.trim() !== "" && !out.includes(item)) out.push(item);
  }
  return out;
}

function parseCheckpoint(text: string, path: string, runId: string): Checkpoint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CheckpointCorruptError(path, runId, `JSON 解析失败：${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new CheckpointCorruptError(path, runId, "顶层不是对象");
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== CHECKPOINT_VERSION) {
    throw new CheckpointCorruptError(path, runId, `不支持的 version：${String(raw.version)}（期望 ${CHECKPOINT_VERSION}）`);
  }
  if (typeof raw.runId !== "string" || raw.runId === "") {
    throw new CheckpointCorruptError(path, runId, "缺少 runId");
  }
  if (typeof raw.branchId !== "string" || raw.branchId === "") {
    throw new CheckpointCorruptError(path, runId, "缺少 branchId");
  }
  const stepIndex = typeof raw.stepIndex === "number" && Number.isInteger(raw.stepIndex) && raw.stepIndex >= 0 ? raw.stepIndex : 0;
  return {
    version: CHECKPOINT_VERSION,
    runId: raw.runId,
    branchId: raw.branchId,
    stepIndex,
    doneSteps: normalizeDoneSteps(raw.doneSteps),
    completed: raw.completed === true,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    state: isRecord(raw.state) ? raw.state : {},
  };
}

/** 原子写 JSON：同目录 tmp → rename 覆盖。 */
async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.checkpoint-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const body = JSON.stringify(value, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * 检查点存储（一次构造可服务多个 run）。
 *
 * ```ts
 * const store = new CheckpointStore(root);
 * await store.save({ runId, branchId, stepIndex: 0, doneSteps: [], state: { plan } });
 * await store.markStepDone(runId, 0);
 * for (const point of await store.listResumable()) {
 *   // 从 point.stepIndex + 1 继续，跳过 point.doneSteps
 * }
 * ```
 */
export class CheckpointStore {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.trim() === "") throw new Error("CheckpointStore 需要非空 root");
    this.root = root;
  }

  get runsRoot(): string {
    return join(this.root, "runs");
  }

  /** `<root>/runs/<runId>/checkpoint.json` */
  checkpointPath(runId: string): string {
    assertSafeRunId(runId);
    return join(this.runsRoot, runId, "checkpoint.json");
  }

  async save(input: SaveCheckpointInput): Promise<Checkpoint> {
    assertSafeRunId(input.runId);
    if (typeof input.branchId !== "string" || input.branchId.trim() === "") {
      throw new CheckpointError("save 需要非空 branchId", input.runId);
    }
    if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
      throw new CheckpointError(`stepIndex 必须是非负整数：${String(input.stepIndex)}`, input.runId);
    }
    const checkpoint: Checkpoint = {
      version: CHECKPOINT_VERSION,
      runId: input.runId,
      branchId: input.branchId,
      stepIndex: input.stepIndex,
      doneSteps: normalizeDoneSteps(input.doneSteps),
      completed: input.completed === true,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      state: isRecord(input.state) ? input.state : {},
    };
    await atomicWriteJson(this.checkpointPath(input.runId), checkpoint);
    return checkpoint;
  }

  /** 读取检查点；文件不存在返回 null；存在但损坏抛 CheckpointCorruptError。 */
  async load(runId: string): Promise<Checkpoint | null> {
    const path = this.checkpointPath(runId);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return parseCheckpoint(text, path, runId);
  }

  /** 扫描 runs/*\/checkpoint.json，返回未 completed 的运行（updatedAt 新的在前）。 */
  async listResumable(): Promise<ResumePoint[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.runsRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: ResumePoint[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue;
      let checkpoint: Checkpoint | null;
      try {
        checkpoint = await this.load(entry.name);
      } catch {
        continue; // 损坏检查点不应阻断其他 run 的恢复
      }
      if (checkpoint === null || checkpoint.completed) continue;
      out.push({ ...checkpoint, path: this.checkpointPath(entry.name) });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.runId.localeCompare(a.runId));
    return out;
  }

  /**
   * 便利方法：把某一步标记为完成。
   * 目标 run 必须先有检查点（否则抛 CheckpointNotFoundError）。
   * `state` 传入时与已有 state 浅合并；`doneSteps` 追加 "step-<index>" 且幂等。
   */
  async markStepDone(
    runId: string,
    stepIndex: number,
    options: { state?: Record<string, unknown>; branchId?: string } = {},
  ): Promise<Checkpoint> {
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      throw new CheckpointError(`stepIndex 必须是非负整数：${String(stepIndex)}`, runId);
    }
    const current = await this.load(runId);
    if (current === null) throw new CheckpointNotFoundError(this.checkpointPath(runId), runId);
    const label = `step-${stepIndex}`;
    const doneSteps = current.doneSteps.includes(label) ? current.doneSteps : [...current.doneSteps, label];
    const state = options.state === undefined ? current.state : { ...current.state, ...options.state };
    return this.save({
      runId,
      branchId: options.branchId ?? current.branchId,
      stepIndex: Math.max(current.stepIndex, stepIndex),
      doneSteps,
      completed: current.completed,
      state,
    });
  }

  /** 便利方法：把 run 标记为已完成（完成后不再出现在 listResumable）。 */
  async markCompleted(runId: string): Promise<Checkpoint> {
    const current = await this.load(runId);
    if (current === null) throw new CheckpointNotFoundError(this.checkpointPath(runId), runId);
    return this.save({
      runId,
      branchId: current.branchId,
      stepIndex: current.stepIndex,
      doneSteps: current.doneSteps,
      completed: true,
      state: current.state,
    });
  }
}
