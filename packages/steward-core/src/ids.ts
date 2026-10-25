import { randomBytes } from "node:crypto";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Timestamped, sortable run id: run-YYYYMMDD-HHmmss-xxxxxx */
export function newRunId(now: Date = new Date()): string {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `run-${d}-${t}-${randomBytes(3).toString("hex")}`;
}

export function newBranchId(role: string, now: Date = new Date()): string {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `br-${role}-${d}${t}-${randomBytes(2).toString("hex")}`;
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/** utc ISO timestamp with seconds precision. */
export function nowIso(): string {
  return new Date().toISOString();
}
