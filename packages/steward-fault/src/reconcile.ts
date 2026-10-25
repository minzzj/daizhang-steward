/**
 * LedgerReconciler：恢复后补记账本对账（B3「账本不重复」）。
 *
 * 语义：
 * - 对 Outbox 中**每一个**条目调用账本 API 的 `recordLedger`（幂等键 = outbox.idempotency_key）；
 * - 账本 API 用 `{duplicate:true}` 表示「同 receipt_ref/idempotency_key 已存在，跳过」；
 * - 最后扫描账本，统计**真实重复**条目数（同一个 receipt_ref 或 idempotency_key 出现多次）——
 *   验收要求 `duplicates_found === 0`；
 * - 同一 Outbox 重复对账第二次时，应得到 `entries_added: 0`、`skipped_duplicates: 全部`、
 *   `duplicates_found: 0`（幂等证明）。
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { FaultValidationError } from "./errors.js";
import { atomicWriteJson, cloneJson, nowIso, readJsonIfExists } from "./io.js";
import type { Outbox } from "./outbox.js";
import type { DomainLedgerApi, LedgerReplayInput, LedgerWriteResult, ReconcileResult } from "./types.js";

export const LEDGER_VERSION = 1 as const;

interface JsonLedgerEntry {
  id: string;
  idempotency_key: string;
  receipt_ref: string;
  action_kind: string;
  amount_cny: number | null;
  occurred_at: string;
  created_at: string;
  payload: Record<string, unknown>;
}

interface JsonLedgerFileShape {
  version: typeof LEDGER_VERSION;
  updated_at: string;
  entries: JsonLedgerEntry[];
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

/** 从 outbox 项推导账本回执号：payload.receipt_ref 优先，否则用幂等键。 */
export function deriveReceiptRef(item: { idempotency_key: string; payload: Record<string, unknown> }): string {
  const candidate = item.payload["receipt_ref"];
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : item.idempotency_key;
}

/**
 * 本地 JSON 账本（可用于演练/离线对账）：`<state_dir>/ledger.json` 原子写。
 * `recordLedger` 按 idempotency_key 或 receipt_ref 去重，重复时返回 `{ok:true, duplicate:true}`。
 */
export class JsonLedgerApi implements DomainLedgerApi {
  readonly stateDir: string;
  readonly file: string;

  private entries: JsonLedgerEntry[] | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(stateDir: string) {
    if (typeof stateDir !== "string" || stateDir.trim() === "") {
      throw new FaultValidationError("JsonLedgerApi 需要非空 state_dir", "INVALID_INPUT", "state_dir");
    }
    this.stateDir = stateDir;
    this.file = join(stateDir, "ledger.json");
  }

  private async load(): Promise<JsonLedgerEntry[]> {
    if (this.entries !== null) return this.entries;
    const raw = await readJsonIfExists<JsonLedgerFileShape>(this.file);
    if (raw === null) {
      this.entries = [];
      return this.entries;
    }
    this.entries = Array.isArray(raw.entries) ? raw.entries.filter((entry): entry is JsonLedgerEntry => isRecord(entry) && typeof entry.id === "string") : [];
    return this.entries;
  }

  private async persist(): Promise<void> {
    const payload: JsonLedgerFileShape = {
      version: LEDGER_VERSION,
      updated_at: nowIso(),
      entries: this.entries ?? [],
    };
    const snapshot = JSON.parse(JSON.stringify(payload)) as JsonLedgerFileShape;
    const run = this.writeChain.then(() => atomicWriteJson(this.file, snapshot));
    this.writeChain = run.catch(() => undefined);
    await run;
  }

  async recordLedger(input: LedgerReplayInput): Promise<LedgerWriteResult> {
    const idempotencyKey = requireNonEmptyString(input.idempotency_key, "idempotency_key");
    const receiptRef = requireNonEmptyString(input.receipt_ref, "receipt_ref");
    const entries = await this.load();
    const duplicate = entries.find((entry) => entry.idempotency_key === idempotencyKey || entry.receipt_ref === receiptRef);
    if (duplicate !== undefined) {
      return { ok: true, duplicate: true, id: duplicate.id };
    }
    const amountCandidate = input.payload["amount_cny"];
    const entry: JsonLedgerEntry = {
      id: `led-${randomBytes(6).toString("hex")}`,
      idempotency_key: idempotencyKey,
      receipt_ref: receiptRef,
      action_kind: typeof input.action_kind === "string" ? input.action_kind : "unknown",
      amount_cny: typeof amountCandidate === "number" && Number.isFinite(amountCandidate) ? amountCandidate : null,
      occurred_at: input.occurred_at,
      created_at: nowIso(),
      payload: cloneJson(input.payload),
    };
    entries.push(entry);
    await this.persist();
    return { ok: true, id: entry.id };
  }

  async ledger(): Promise<Array<Record<string, unknown>>> {
    const entries = await this.load();
    return entries.map((entry) => cloneJson(entry as unknown as Record<string, unknown>));
  }

  /** 便捷：当前条目数。 */
  async count(): Promise<number> {
    return (await this.load()).length;
  }
}

export class LedgerReconciler {
  /**
   * 对账：按 receipt_ref/idempotency_key 去重，返回 {replayed, skipped_duplicates, duplicates_found, entries_added}。
   * 要求 `duplicates_found === 0`。
   */
  async reconcile(domainLedgerApi: DomainLedgerApi, outbox: Outbox): Promise<ReconcileResult> {
    if (typeof domainLedgerApi !== "object" || domainLedgerApi === null || typeof domainLedgerApi.recordLedger !== "function" || typeof domainLedgerApi.ledger !== "function") {
      throw new FaultValidationError("reconcile 需要实现 DomainLedgerApi（recordLedger/ledger）", "INVALID_INPUT", "domainLedgerApi");
    }
    if (typeof outbox !== "object" || outbox === null || typeof outbox.list !== "function") {
      throw new FaultValidationError("reconcile 需要 Outbox 实例", "INVALID_INPUT", "outbox");
    }

    const items = await outbox.list();
    let entriesAdded = 0;
    let skippedDuplicates = 0;
    for (const item of items) {
      const input: LedgerReplayInput = {
        idempotency_key: item.idempotency_key,
        receipt_ref: deriveReceiptRef(item),
        action_kind: item.action_kind,
        payload: cloneJson(item.payload),
        occurred_at: item.created_at,
      };
      const result = await domainLedgerApi.recordLedger(input);
      if (result.duplicate === true) skippedDuplicates += 1;
      else if (result.ok === true) entriesAdded += 1;
    }

    const ledger = await domainLedgerApi.ledger();
    const seenReceipts = new Set<string>();
    const seenIdempotencyKeys = new Set<string>();
    let duplicatesFound = 0;
    for (const entry of ledger) {
      if (!isRecord(entry)) continue;
      const receiptRef = typeof entry["receipt_ref"] === "string" ? entry["receipt_ref"].trim() : "";
      const idempotencyKey = typeof entry["idempotency_key"] === "string" ? entry["idempotency_key"].trim() : "";
      if (receiptRef !== "") {
        if (seenReceipts.has(receiptRef)) duplicatesFound += 1;
        else seenReceipts.add(receiptRef);
      }
      if (idempotencyKey !== "") {
        if (seenIdempotencyKeys.has(idempotencyKey)) duplicatesFound += 1;
        else seenIdempotencyKeys.add(idempotencyKey);
      }
    }

    return {
      replayed: items.length,
      skipped_duplicates: skippedDuplicates,
      duplicates_found: duplicatesFound,
      entries_added: entriesAdded,
      ledger_entries_total: ledger.length,
    };
  }
}
