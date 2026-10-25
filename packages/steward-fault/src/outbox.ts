/**
 * Outbox：离线动作队列（B3 恢复后补记）。
 *
 * 关键语义：
 * - **入队幂等**：同一 `idempotency_key` 重复 enqueue 返回已有项，不会产生两条；
 * - **持久化**：`<state_dir>/outbox.json` 原子写（tmp + rename），重启可继续；
 * - **重放不重复**：`replay()` 跳过 `status === "replayed"` 的项；executor 可用
 *   `duplicate: true` 表示平台侧已按幂等键识别过（写入 `duplicates_found` 统计）；
 * - 失败项记 `failed` + `last_error`，默认继续（`stopOnError: true` 时抛 `OutboxReplayError`）。
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { FaultValidationError, OutboxReplayError } from "./errors.js";
import { atomicWriteJson, cloneJson, nowIso, readJsonIfExists } from "./io.js";
import type {
  OutboxActionKind,
  OutboxEnqueueInput,
  OutboxItem,
  OutboxListFilter,
  OutboxStats,
  OutboxStatus,
  ReplayExecutor,
  ReplayOptions,
  ReplayReport,
} from "./types.js";

export const OUTBOX_VERSION = 1 as const;

const ACTION_KINDS: readonly OutboxActionKind[] = ["quote", "message", "order", "invoice", "payment_request"];
const STATUSES: readonly OutboxStatus[] = ["queued", "replayed", "failed"];

interface OutboxFileShape {
  version: typeof OUTBOX_VERSION;
  updated_at: string;
  items: OutboxItem[];
}

function newOutboxId(): string {
  return `ob-${randomBytes(6).toString("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FaultValidationError(`${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function normalizeLoadedItems(raw: unknown): OutboxItem[] {
  if (!Array.isArray(raw)) return [];
  const items: OutboxItem[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate)) continue;
    const actionKind = candidate.action_kind;
    const status = candidate.status;
    if (typeof actionKind !== "string" || !(ACTION_KINDS as readonly string[]).includes(actionKind)) continue;
    if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) continue;
    const id = typeof candidate.id === "string" && candidate.id !== "" ? candidate.id : newOutboxId();
    const idempotencyKey =
      typeof candidate.idempotency_key === "string" && candidate.idempotency_key !== ""
        ? candidate.idempotency_key
        : `idem-recovered-${id}`;
    const item: OutboxItem = {
      id,
      action_kind: actionKind as OutboxActionKind,
      payload: isRecord(candidate.payload) ? candidate.payload : {},
      idempotency_key: idempotencyKey,
      created_at: typeof candidate.created_at === "string" ? candidate.created_at : new Date(0).toISOString(),
      attempts: typeof candidate.attempts === "number" && Number.isFinite(candidate.attempts) && candidate.attempts >= 0 ? candidate.attempts : 0,
      status: status as OutboxStatus,
    };
    if (typeof candidate.last_error === "string") item.last_error = candidate.last_error;
    if (typeof candidate.replayed_at === "string") item.replayed_at = candidate.replayed_at;
    if (typeof candidate.ref === "string") item.ref = candidate.ref;
    items.push(item);
  }
  return items;
}

export class Outbox {
  readonly stateDir: string;
  readonly file: string;

  private readonly now: () => Date;
  private items: OutboxItem[] | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(stateDir: string, options: { now?: () => Date } = {}) {
    if (typeof stateDir !== "string" || stateDir.trim() === "") {
      throw new FaultValidationError("Outbox 需要非空 state_dir", "INVALID_INPUT", "state_dir");
    }
    this.stateDir = stateDir;
    this.file = join(stateDir, "outbox.json");
    this.now = options.now ?? (() => new Date());
  }

  private async load(): Promise<OutboxItem[]> {
    if (this.items !== null) return this.items;
    const raw = await readJsonIfExists<OutboxFileShape>(this.file);
    if (raw === null) {
      this.items = [];
      return this.items;
    }
    if (!isRecord(raw)) throw new FaultValidationError(`Outbox 文件格式非法：${this.file}`, "INVALID_INPUT", "outbox");
    this.items = normalizeLoadedItems((raw as OutboxFileShape).items);
    return this.items;
  }

  private async persist(): Promise<void> {
    const items = this.items ?? [];
    const payload: OutboxFileShape = { version: OUTBOX_VERSION, updated_at: nowIso(this.now), items };
    const snapshot = cloneJson(payload);
    const run = this.writeChain.then(() => atomicWriteJson(this.file, snapshot));
    this.writeChain = run.catch(() => undefined);
    await run;
  }

  /** 入队（同 idempotency_key 幂等返回已有项）。 */
  async enqueue(input: OutboxEnqueueInput): Promise<OutboxItem> {
    if (!isRecord(input)) throw new FaultValidationError("enqueue 需要输入对象", "INVALID_INPUT", "input");
    const actionKind = requireNonEmptyString(input.action_kind, "action_kind");
    if (!(ACTION_KINDS as readonly string[]).includes(actionKind)) {
      throw new FaultValidationError(`action_kind 非法：${actionKind}（允许 ${ACTION_KINDS.join("/")}）`, "INVALID_INPUT", "action_kind");
    }
    const payload = isRecord(input.payload) ? input.payload : {};
    const idempotencyKey = requireNonEmptyString(input.idempotency_key ?? `idem-${randomBytes(6).toString("hex")}`, "idempotency_key");
    const items = await this.load();
    const existing = items.find((item) => item.idempotency_key === idempotencyKey);
    if (existing !== undefined) return cloneJson(existing);
    const item: OutboxItem = {
      id: newOutboxId(),
      action_kind: actionKind as OutboxActionKind,
      payload: cloneJson(payload),
      idempotency_key: idempotencyKey,
      created_at: typeof input.created_at === "string" ? input.created_at : nowIso(this.now),
      attempts: 0,
      status: "queued",
    };
    items.push(item);
    await this.persist();
    return cloneJson(item);
  }

  /** 列出条目（可按状态/动作类型过滤；按入队顺序）。 */
  async list(filter: OutboxListFilter = {}): Promise<OutboxItem[]> {
    const items = await this.load();
    return items
      .filter((item) => filter.status === undefined || item.status === filter.status)
      .filter((item) => filter.action_kind === undefined || item.action_kind === filter.action_kind)
      .map((item) => cloneJson(item));
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OutboxItem | null> {
    const items = await this.load();
    const found = items.find((item) => item.idempotency_key === idempotencyKey);
    return found === undefined ? null : cloneJson(found);
  }

  /**
   * 按序重放：已 `replayed` 的跳过；queued/failed 逐项调用 executor。
   * - executor `ok:true` → 置 replayed（记录 ref/replayed_at）；
   * - executor `duplicate:true` → 计 `duplicates_found`（平台侧幂等去重成功），仍置 replayed；
   * - executor `ok:false` → 置 failed + last_error，默认继续；
   * - executor 抛异常 → 置 failed 并抛 `OutboxReplayError`（硬失败，立即暴露）。
   */
  async replay(executor: ReplayExecutor, options: ReplayOptions = {}): Promise<ReplayReport> {
    if (typeof executor !== "function") throw new FaultValidationError("replay 需要 executor 函数", "INVALID_INPUT", "executor");
    const items = await this.load();
    const report: ReplayReport = { replayed: 0, skipped_duplicates: 0, failed: 0, duplicates_found: 0, items: [] };
    for (const item of items) {
      if (item.status === "replayed") {
        report.skipped_duplicates += 1;
        report.items.push(cloneJson(item));
        continue;
      }
      item.attempts += 1;
      let result;
      try {
        result = await executor(cloneJson(item));
      } catch (error) {
        item.status = "failed";
        item.last_error = error instanceof Error ? error.message : String(error);
        await this.persist();
        throw new OutboxReplayError(`Outbox 重放失败（${item.id}）：${item.last_error}`, {
          item_id: item.id,
          item_idempotency_key: item.idempotency_key,
        });
      }
      if (result !== null && typeof result === "object" && result.ok === true) {
        item.status = "replayed";
        item.replayed_at = nowIso(this.now);
        delete item.last_error;
        if (typeof result.ref === "string" && result.ref !== "") item.ref = result.ref;
        if (result.duplicate === true) report.duplicates_found += 1;
        report.replayed += 1;
      } else {
        item.status = "failed";
        const errorMessage = result !== null && typeof result === "object" && typeof result.error === "string" ? result.error : "executor 返回失败";
        item.last_error = errorMessage;
        report.failed += 1;
        if (options.stopOnError === true) {
          await this.persist();
          throw new OutboxReplayError(`Outbox 重放在 stopOnError 模式失败（${item.id}）：${errorMessage}`, {
            item_id: item.id,
            item_idempotency_key: item.idempotency_key,
          });
        }
      }
      report.items.push(cloneJson(item));
    }
    await this.persist();
    return report;
  }

  async stats(): Promise<OutboxStats> {
    const items = await this.load();
    return {
      total: items.length,
      queued: items.filter((item) => item.status === "queued").length,
      replayed: items.filter((item) => item.status === "replayed").length,
      failed: items.filter((item) => item.status === "failed").length,
    };
  }

  /** 清空（仅测试/重置演练用）。 */
  async clear(): Promise<void> {
    this.items = [];
    await this.persist();
  }
}
