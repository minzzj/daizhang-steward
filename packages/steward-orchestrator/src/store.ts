/**
 * 会话持久化：`<root>/orchestrator/sessions-<id>.json`（tmp + rename 原子写）。
 *
 * - 一个会话一个文件，便于控制台直接读取/备份；
 * - 启动时扫描目录恢复全部会话（损坏文件跳过，不让单个坏文件拖垮整体）；
 * - root 由引擎注入（默认为 `<cwd>/runs`），因此默认落在 `runs/orchestrator/`。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OrchestratorPersistenceError } from "./errors.js";
import type { OrchestratorSession } from "./types.js";

const SESSION_FILE_PATTERN = /^sessions-(.+)\.json$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验/补全会话结构（旧版本文件缺字段时给默认值，保证向后兼容）。 */
function normalizeLoadedSession(raw: unknown): OrchestratorSession | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id.length === 0) return null;
  const session: OrchestratorSession = {
    id,
    title: typeof raw.title === "string" ? raw.title : id,
    goal: typeof raw.goal === "string" ? raw.goal : "",
    mode: raw.mode === "personal" || raw.mode === "enterprise" ? raw.mode : "demo",
    kind: raw.kind === "system" ? "system" : "project",
    status:
      raw.status === "planning" ||
      raw.status === "running" ||
      raw.status === "paused" ||
      raw.status === "interrupted" ||
      raw.status === "done" ||
      raw.status === "blocked"
        ? raw.status
        : "active",
    created_at: typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString(),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
    budget_cny: typeof raw.budget_cny === "number" && Number.isFinite(raw.budget_cny) ? raw.budget_cny : 0,
    token_limit:
      typeof raw.token_limit === "number" && Number.isFinite(raw.token_limit) ? raw.token_limit : 0,
    messages: Array.isArray(raw.messages) ? (raw.messages as OrchestratorSession["messages"]) : [],
    plan: Array.isArray(raw.plan) ? (raw.plan as OrchestratorSession["plan"]) : [],
    children: isRecord(raw.children) ? (raw.children as OrchestratorSession["children"]) : {},
    approvals: isRecord(raw.approvals) ? (raw.approvals as NonNullable<OrchestratorSession["approvals"]>) : {},
    tokens_used: typeof raw.tokens_used === "number" && Number.isFinite(raw.tokens_used) ? raw.tokens_used : 0,
    store_version: 1,
  };
  if (typeof raw.project_id === "string" && raw.project_id.trim().length > 0) {
    session.project_id = raw.project_id.trim();
  }
  if (typeof raw.evidence_dir === "string" && raw.evidence_dir.trim().length > 0) {
    session.evidence_dir = raw.evidence_dir.trim();
  }
  if (typeof raw.parent_id === "string" && raw.parent_id.trim().length > 0) {
    session.parent_id = raw.parent_id.trim();
  }
  if (Array.isArray(raw.child_sessions)) {
    const children = raw.child_sessions.filter((item): item is string => typeof item === "string");
    if (children.length > 0) session.child_sessions = children;
  }
  return session;
}

/** 会话存储（原子写 + 启动恢复）。 */
export class SessionStore {
  /** `<root>/orchestrator`。 */
  readonly sessionsDir: string;

  constructor(root: string) {
    this.sessionsDir = join(root, "orchestrator");
  }

  private fileFor(sessionId: string): string {
    return join(this.sessionsDir, `sessions-${sessionId}.json`);
  }

  /** 原子写会话文件（tmp + rename）。 */
  save(session: OrchestratorSession): void {
    try {
      mkdirSync(this.sessionsDir, { recursive: true });
      const target = this.fileFor(session.id);
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, `${JSON.stringify({ ...session, store_version: 1 }, null, 2)}\n`, "utf8");
      renameSync(tmp, target);
    } catch (error) {
      throw new OrchestratorPersistenceError(
        `保存会话失败：${error instanceof Error ? error.message : String(error)}`,
        this.sessionsDir,
      );
    }
  }

  /** 读取单个会话（不存在返回 null）。 */
  load(sessionId: string): OrchestratorSession | null {
    const target = this.fileFor(sessionId);
    if (!existsSync(target)) return null;
    try {
      return normalizeLoadedSession(JSON.parse(readFileSync(target, "utf8")));
    } catch {
      return null;
    }
  }

  /** 启动恢复：扫描全部会话文件（损坏文件跳过）。 */
  loadAll(): OrchestratorSession[] {
    if (!existsSync(this.sessionsDir)) return [];
    const sessions: OrchestratorSession[] = [];
    for (const name of readdirSync(this.sessionsDir)) {
      if (!SESSION_FILE_PATTERN.test(name)) continue;
      const session = this.load(name.replace(SESSION_FILE_PATTERN, "$1"));
      if (session !== null) sessions.push(session);
    }
    sessions.sort((left, right) => left.created_at.localeCompare(right.created_at));
    return sessions;
  }
}
