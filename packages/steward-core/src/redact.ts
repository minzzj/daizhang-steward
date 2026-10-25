import { createHash } from "node:crypto";

/** Patterns that must never reach logs, artifacts or the event ledger. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9]{20,}/g, "sk-***REDACTED***"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/g, "sk-proj-***REDACTED***"],
  [/ghp_[A-Za-z0-9]{30,}/g, "ghp_***REDACTED***"],
  [/github_pat_[A-Za-z0-9_]{30,}/g, "github_pat_***REDACTED***"],
  [/gho_[A-Za-z0-9]{30,}/g, "gho_***REDACTED***"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA***REDACTED***"],
  [/(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\s]{6,}["']/gi, "***REDACTED_ASSIGNMENT***"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "***REDACTED_PRIVATE_KEY***"],
];

/** Redact credentials and personal data patterns from arbitrary text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Stable short digest used for event input_digest (never the raw input). */
export function digest(input: unknown): string {
  const raw = typeof input === "string" ? input : JSON.stringify(input ?? null);
  return createHash("sha256").update(redactSecrets(raw)).digest("hex").slice(0, 16);
}

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}
