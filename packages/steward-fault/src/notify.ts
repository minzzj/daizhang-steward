/**
 * NotificationCenter：本地留痕通知（不发送任何外部消息）。
 *
 * 写 `<state_dir>/notifications/<ts>-<kind>.md`（原子写），返回文件路径；
 * 用于 B3 断网/恢复、B4 封禁/恢复的可读证据。
 */

import { join } from "node:path";

import { FaultValidationError } from "./errors.js";
import { atomicWriteText, ensureDir, listFiles, nowIso, stampForFile } from "./io.js";
import type { NotificationInput, NotificationKind, NotificationSeverity } from "./types.js";

const KINDS: readonly NotificationKind[] = ["outage", "ban", "recovery"];
const SEVERITIES: readonly NotificationSeverity[] = ["info", "warn", "critical"];

export class NotificationCenter {
  readonly stateDir: string;
  readonly dir: string;

  constructor(stateDir: string) {
    if (typeof stateDir !== "string" || stateDir.trim() === "") {
      throw new FaultValidationError("NotificationCenter 需要非空 state_dir", "INVALID_INPUT", "state_dir");
    }
    this.stateDir = stateDir;
    this.dir = join(stateDir, "notifications");
  }

  /** 写一条本地通知 markdown，返回文件路径（同毫秒同名时自动加序号）。 */
  async notify(input: NotificationInput): Promise<string> {
    if (typeof input !== "object" || input === null) {
      throw new FaultValidationError("notify 需要 NotificationInput", "INVALID_INPUT", "input");
    }
    if (!KINDS.includes(input.kind)) throw new FaultValidationError(`通知 kind 非法：${String(input.kind)}`, "INVALID_INPUT", "kind");
    if (!SEVERITIES.includes(input.severity)) {
      throw new FaultValidationError(`通知 severity 非法：${String(input.severity)}`, "INVALID_INPUT", "severity");
    }
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (title === "") throw new FaultValidationError("通知 title 不能为空", "INVALID_INPUT", "title");
    if (body === "") throw new FaultValidationError("通知 body 不能为空", "INVALID_INPUT", "body");

    await ensureDir(this.dir);
    const iso = nowIso();
    const base = `${stampForFile(iso)}-${input.kind}`;
    const existing = new Set(await listFiles(this.dir));
    let filename = `${base}.md`;
    let suffix = 2;
    while (existing.has(filename)) {
      filename = `${base}-${suffix}.md`;
      suffix += 1;
    }
    const file = join(this.dir, filename);
    const content = [
      `# ${title}`,
      "",
      `- kind: ${input.kind}`,
      `- severity: ${input.severity}`,
      `- generated_at: ${iso}`,
      "",
      body,
      "",
      "> 本地留痕：本通知只写入本机文件，不发送到任何外部渠道。",
      "",
    ].join("\n");
    await atomicWriteText(file, content);
    return file;
  }

  /** 已生成的通知文件（绝对路径，按文件名排序）。 */
  async list(): Promise<string[]> {
    const files = await listFiles(this.dir);
    return files.map((file) => join(this.dir, file));
  }
}
