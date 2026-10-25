import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sha256, redactSecrets } from "./redact.js";
import type { EventInput, StewardEvent } from "./types.js";

const GENESIS = "genesis";

/**
 * Append-only, tamper-evident event ledger (one JSON object per line).
 * Each event carries seq + prev_hash + hash, forming a hash chain.
 */
export class EventLog {
  private seq = 0;
  private lastHash: string = GENESIS;
  private loaded = false;

  private constructor(public readonly file: string) {}

  static async open(file: string): Promise<EventLog> {
    const log = new EventLog(file);
    await mkdir(dirname(file), { recursive: true });
    await log.loadTail();
    return log;
  }

  private async loadTail(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await readFile(this.file, "utf8");
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const last = lines[lines.length - 1];
      if (last) {
        const ev = JSON.parse(last) as StewardEvent;
        this.seq = ev.seq;
        this.lastHash = ev.hash;
      }
    } catch {
      // file does not exist yet
    }
  }

  async append(input: EventInput): Promise<StewardEvent> {
    await this.loadTail();
    const seq = this.seq + 1;
    const ts = input.ts ?? new Date().toISOString();
    const payload = {
      ...input,
      target: redactSecrets(input.target),
      seq,
      ts,
      prev_hash: this.lastHash,
    };
    const hash = sha256(JSON.stringify(payload));
    const event: StewardEvent = { ...payload, hash };
    await appendFile(this.file, JSON.stringify(event) + "\n", "utf8");
    this.seq = seq;
    this.lastHash = hash;
    return event;
  }

  async read(): Promise<StewardEvent[]> {
    try {
      const text = await readFile(this.file, "utf8");
      return text
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as StewardEvent);
    } catch {
      return [];
    }
  }

  /** Verify the hash chain; returns the first broken seq if any. */
  async verify(): Promise<{ ok: boolean; brokenAt?: number; reason?: string }> {
    const events = await this.read();
    let prev = GENESIS;
    for (const ev of events) {
      if (ev.prev_hash !== prev) {
        return { ok: false, brokenAt: ev.seq, reason: "prev_hash mismatch" };
      }
      const { hash: _hash, ...payload } = ev;
      const expected = sha256(JSON.stringify(payload));
      if (expected !== ev.hash) {
        return { ok: false, brokenAt: ev.seq, reason: "hash mismatch (tampered?)" };
      }
      prev = ev.hash;
    }
    return { ok: true };
  }

  get length(): number {
    return this.seq;
  }
}
