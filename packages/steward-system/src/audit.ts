/**
 * 系统总控审计（追加式 JSONL，不做任何「静默改写」）。
 *
 * - 每次 `execute()`（成功 / 执行失败 / 策略拒绝 / 确认缺失）都追加一行
 *   `<state_dir>/system-audit.jsonl`；
 * - 摘要与原因经过脱敏（API Key / Bearer / password=… 等）并截断，审计文件不含密钥明文；
 * - 只追加，不提供删除/改写 API；`tail()` 只读。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { AUDIT_REASON_MAX, AUDIT_SUMMARY_MAX } from "./types.js";
import type { AuditEntry } from "./types.js";

/** 审计文件名（位于 state_dir 下）。 */
export const SYSTEM_AUDIT_FILE = "system-audit.jsonl";

/** 脱敏 + 截断任意文本，可安全写入审计/日志。 */
export function redactAuditText(input: unknown, maxLength = AUDIT_SUMMARY_MAX): string {
  let text = typeof input === "string" ? input : String(input ?? "");
  text = text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_KEY]");
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]");
  text = text.replace(
    /((?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*)([^\s,;{}"]{4,})/gi,
    "$1[REDACTED]",
  );
  text = text.replace(/[\r\n\t]+/g, " ");
  text = text.replace(/[\u0000-\u001f\u007f]/g, "");
  const chars = [...text];
  if (chars.length > maxLength) {
    return chars.slice(0, Math.max(0, maxLength - 1)).join("") + "…";
  }
  return text;
}

/** 脱敏审计原因（更短）。 */
export function redactAuditReason(input: unknown): string {
  return redactAuditText(input, AUDIT_REASON_MAX);
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<AuditEntry>;
  return (
    typeof record.audit_id === "string" &&
    typeof record.at === "string" &&
    typeof record.action === "string" &&
    typeof record.ok === "boolean" &&
    typeof record.summary === "string"
  );
}

/**
 * JSONL 审计仓库：`append()` 原子追加；`tail()` 只读最近 N 条（跳过损坏行）。
 * 同步实现（与契约 `auditTrail(): AuditEntry[]` 的同步签名一致，文件很小）。
 */
export class JsonlAuditTrail {
  readonly file: string;

  constructor(file: string) {
    if (typeof file !== "string" || file.trim() === "") {
      throw new Error("JsonlAuditTrail 需要非空文件路径");
    }
    this.file = file;
  }

  /** 追加一条审计记录（目录自动创建）。 */
  append(entry: AuditEntry): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
  }

  /** 读取最近 `limit` 条（默认 50；limit<=0 表示全部）。 */
  tail(limit = 50): AuditEntry[] {
    const entries = this.readAll();
    if (!Number.isFinite(limit) || limit <= 0) return entries;
    return entries.slice(Math.max(0, entries.length - Math.floor(limit)));
  }

  /** 读取全部可解析条目。 */
  readAll(): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    const entries: AuditEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isAuditEntry(parsed)) entries.push(parsed);
      } catch {
        // 损坏行跳过：审计读取不能因单行损坏而整体失败
      }
    }
    return entries;
  }

  /** 审计条数。 */
  count(): number {
    return this.readAll().length;
  }
}
