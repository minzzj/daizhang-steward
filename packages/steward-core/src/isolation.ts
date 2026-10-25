import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * M2-B / A9：分支隔离（凭据隔离 + profile 独占 + 工具白名单）。
 *
 * 三条独立防线：
 * 1. `CredentialVault`：按 branchId 分命名空间存「引用」（env 变量名 / 文件路径 /
 *    secret 引用名），绝不存明文；跨分支读抛 `CrossBranchAccessError`。
 * 2. `ProfileLock`：`<root>/.locks/<profileId>.lock` 文件锁，同一浏览器/桌面 profile
 *    同时只允许一个分支占用；进程崩溃留下的过期锁可被清理。
 * 3. `assertBranchToolsAllowed()`：步骤执行前的分支工具白名单断言。
 */

// ---------------------------------------------------------------------------
// 1) 凭据隔离
// ---------------------------------------------------------------------------

export type CredentialKind = "env" | "file" | "secret-ref";

/** 凭据引用：只描述「去哪里取」，不保存密钥值本身。 */
export interface CredentialRef {
  /** 引用字符串：`env:NAME` / 裸 `NAME` / `file:<path>` / `secret://<name>`。 */
  ref: string;
  kind: CredentialKind;
  /** 登记/更新时间（ISO 8601），供审计。 */
  updatedAt: string;
}

/** `redactFor()` 返回的可安全展示条目：只含脱敏引用，不含原引用字符串。 */
export interface CredentialSummary {
  key: string;
  kind: CredentialKind;
  /** 脱敏后的引用（保留少量首尾字符），可直接写日志/报告。 */
  refMasked: string;
  updatedAt: string;
}

export class CredentialError extends Error {
  readonly branchId: string;
  readonly key: string;

  constructor(message: string, branchId: string, key: string) {
    super(message);
    this.name = "CredentialError";
    this.branchId = branchId;
    this.key = key;
  }
}

/** 跨分支读取凭据 → 拒绝（A9 核心验收）。 */
export class CrossBranchAccessError extends CredentialError {
  readonly ownerBranchId: string;

  constructor(requestedBranchId: string, ownerBranchId: string, key: string) {
    super(`跨分支凭据访问被拒绝：分支 ${requestedBranchId} 不能读取分支 ${ownerBranchId} 的凭据 ${key}`, requestedBranchId, key);
    this.name = "CrossBranchAccessError";
    this.ownerBranchId = ownerBranchId;
  }
}

export class CredentialNotFoundError extends CredentialError {
  constructor(branchId: string, key: string) {
    super(`凭据不存在：分支 ${branchId} 没有 ${key}`, branchId, key);
    this.name = "CredentialNotFoundError";
  }
}

/** 引用格式不合法（例如疑似明文密钥、路径穿越）→ 拒绝入库。 */
export class UnsafeCredentialReferenceError extends Error {
  readonly reason: string;
  /** 脱敏后的预览，绝不包含原字符串。 */
  readonly maskedPreview: string;

  constructor(reason: string, raw: string) {
    super(`不安全的凭据引用：${reason}（预览 ${maskRef(raw)}）`);
    this.name = "UnsafeCredentialReferenceError";
    this.reason = reason;
    this.maskedPreview = maskRef(raw);
  }
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_REF_PATTERN = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
const FILE_REF_PREFIX = "file:";
const SECRET_REF_PATTERN = /^(?:secret|vault):(?:\/\/)?[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_REF_LENGTH = 256;

function maskText(text: string): string {
  const chars = [...text];
  if (chars.length <= 4) return "*".repeat(Math.max(4, chars.length));
  const head = chars.slice(0, 2).join("");
  const tail = chars.slice(-2).join("");
  const stars = "*".repeat(Math.min(12, Math.max(4, chars.length - 4)));
  return `${head}${stars}${tail}`;
}

/** 脱敏任意引用字符串，可安全写日志/报告。 */
export function maskRef(ref: string): string {
  const value = String(ref ?? "");
  const env = ENV_REF_PATTERN.exec(value);
  if (env !== null) return `env:${maskText(env[1] ?? "")}`;
  if (value.startsWith(FILE_REF_PREFIX)) return `${FILE_REF_PREFIX}${maskText(value.slice(FILE_REF_PREFIX.length))}`;
  if (/^(?:secret|vault):/.test(value)) return `secret:${maskText(value.replace(/^(?:secret|vault):(?:\/\/)?/, ""))}`;
  return maskText(value);
}

function looksLikeFilePath(value: string): boolean {
  if (value.includes("/") || value.includes("\\")) return true;
  if (value.startsWith(".") || value.startsWith("~")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return /\.(?:json|txt|env|pem|key|credentials)$/i.test(value);
}

function rejectRef(reason: string, raw: string): never {
  throw new UnsafeCredentialReferenceError(reason, raw);
}

/** 把用户输入规范化成只含引用的 CredentialRef；拒绝疑似明文。 */
function normalizeRef(input: string | CredentialRef, now: string): CredentialRef {
  if (typeof input === "object" && input !== null) {
    const rawRef = typeof input.ref === "string" ? input.ref.trim() : "";
    const kind = input.kind;
    if (kind !== "env" && kind !== "file" && kind !== "secret-ref") {
      rejectRef(`未知 kind=${String(kind)}`, rawRef);
    }
    if (rawRef === "") rejectRef("引用不能为空", rawRef);
    if (rawRef.length > MAX_REF_LENGTH) rejectRef(`引用过长（>${MAX_REF_LENGTH}），疑似明文密钥`, rawRef);
    if (kind === "env" && !ENV_NAME_PATTERN.test(rawRef) && !ENV_REF_PATTERN.test(rawRef)) {
      rejectRef("env 引用必须是环境变量名（如 DEEPSEEK_API_KEY）", rawRef);
    }
    if (kind === "file" && (!looksLikeFilePath(rawRef) || rawRef.includes(".."))) {
      rejectRef("file 引用必须是文件路径且不能含 ..", rawRef);
    }
    if (kind === "secret-ref" && !SECRET_REF_PATTERN.test(rawRef)) {
      rejectRef("secret-ref 引用必须形如 secret://name 或 vault:name", rawRef);
    }
    const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : now;
    return { ref: rawRef, kind, updatedAt };
  }

  const raw = typeof input === "string" ? input.trim() : "";
  if (raw === "") rejectRef("引用不能为空", raw);
  if (raw.length > MAX_REF_LENGTH) rejectRef(`引用过长（>${MAX_REF_LENGTH}），疑似明文密钥`, raw);
  if (raw.includes("\n") || raw.includes("\r") || raw.includes("\0")) rejectRef("引用不能含换行/控制字符", raw);
  if (ENV_REF_PATTERN.test(raw)) return { ref: raw, kind: "env", updatedAt: now };
  if (raw.startsWith("env:")) rejectRef("env 引用格式应为 env:NAME", raw);
  if (raw.startsWith(FILE_REF_PREFIX)) {
    const path = raw.slice(FILE_REF_PREFIX.length);
    if (path === "" || path.includes("..")) rejectRef("file 引用必须是非空路径且不能含 ..", raw);
    return { ref: raw, kind: "file", updatedAt: now };
  }
  if (SECRET_REF_PATTERN.test(raw)) return { ref: raw, kind: "secret-ref", updatedAt: now };
  if (ENV_NAME_PATTERN.test(raw)) return { ref: raw, kind: "env", updatedAt: now };
  if (looksLikeFilePath(raw) && !raw.includes("..")) return { ref: `${FILE_REF_PREFIX}${raw}`, kind: "file", updatedAt: now };
  rejectRef("只接受环境变量名 / file:路径 / secret://引用，不接受疑似明文值", raw);
}

export interface CredentialVaultOptions {
  /**
   * 可选：把引用登记表持久化到该 JSON 文件（只写引用，不写明文；便于跨进程恢复）。
   * 建议路径：`<root>/.steward/credentials.json`。
   */
  file?: string;
}

interface VaultFileShape {
  version: 1;
  branches: Record<string, Record<string, CredentialRef>>;
}

/**
 * 分支命名空间凭据保险箱。
 *
 * 只登记「引用」：`vault.set("br-a", "deepseek", "DEEPSEEK_API_KEY")`；
 * 真正取值由调用方用 `process.env[...]` / 读文件完成，保险箱本身永不接触明文。
 */
export class CredentialVault {
  readonly file: string | null;
  private readonly records = new Map<string, Map<string, CredentialRef>>();

  constructor(options: CredentialVaultOptions = {}) {
    this.file = options.file === undefined ? null : resolve(options.file);
    if (this.file !== null) this.loadFile();
  }

  /** 登记/更新某分支的凭据引用。 */
  set(branchId: string, key: string, ref: string | CredentialRef): CredentialRef {
    this.assertBranch(branchId);
    this.assertKey(key);
    const normalized = normalizeRef(ref, new Date().toISOString());
    const branch = this.records.get(branchId) ?? new Map<string, CredentialRef>();
    this.records.set(branchId, branch);
    branch.set(key, normalized);
    this.persist();
    return normalized;
  }

  /** 读取本分支的凭据引用；跨分支访问抛 CrossBranchAccessError，未登记抛 CredentialNotFoundError。 */
  get(branchId: string, key: string): CredentialRef {
    this.assertBranch(branchId);
    this.assertKey(key);
    const found = this.records.get(branchId)?.get(key);
    if (found !== undefined) return found;
    const owner = this.findOwnerBranch(key);
    if (owner !== null && owner !== branchId) throw new CrossBranchAccessError(branchId, owner, key);
    throw new CredentialNotFoundError(branchId, key);
  }

  /** 是否存在该分支命名空间下的引用（不暴露其他分支）。 */
  has(branchId: string, key: string): boolean {
    this.assertBranch(branchId);
    this.assertKey(key);
    return this.records.get(branchId)?.has(key) === true;
  }

  /** 本分支已登记的 key 列表（不含其他分支）。 */
  listKeys(branchId: string): string[] {
    this.assertBranch(branchId);
    return [...(this.records.get(branchId)?.keys() ?? [])].sort();
  }

  /** 可安全展示的引用列表（脱敏，不含明文/原引用）。 */
  redactFor(branchId: string): CredentialSummary[] {
    this.assertBranch(branchId);
    const branch = this.records.get(branchId);
    if (branch === undefined) return [];
    return [...branch.entries()]
      .map(([key, ref]) => ({ key, kind: ref.kind, refMasked: maskRef(ref.ref), updatedAt: ref.updatedAt }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** 删除某分支的一个引用；返回是否删除。 */
  delete(branchId: string, key: string): boolean {
    this.assertBranch(branchId);
    this.assertKey(key);
    const removed = this.records.get(branchId)?.delete(key) === true;
    if (removed) this.persist();
    return removed;
  }

  /** 序列化（仅引用，无明文）；持久化与测试断言共用。 */
  toJSON(): VaultFileShape {
    const branches: Record<string, Record<string, CredentialRef>> = {};
    for (const [branchId, refs] of this.records) {
      branches[branchId] = Object.fromEntries(refs.entries());
    }
    return { version: 1, branches };
  }

  private findOwnerBranch(key: string): string | null {
    for (const [branchId, refs] of this.records) {
      if (refs.has(key)) return branchId;
    }
    return null;
  }

  private assertBranch(branchId: string): void {
    if (typeof branchId !== "string" || branchId.trim() === "") {
      throw new CredentialError("branchId 不能为空", String(branchId), "");
    }
  }

  private assertKey(key: string): void {
    if (typeof key !== "string" || key.trim() === "") {
      throw new CredentialError("凭据 key 不能为空", "", String(key));
    }
  }

  private persist(): void {
    if (this.file === null) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.toJSON(), null, 2) + "\n", "utf8");
  }

  private loadFile(): void {
    if (this.file === null || !existsSync(this.file)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      throw new CredentialError(`凭据登记表损坏：${this.file}`, "", "");
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new CredentialError(`凭据登记表格式错误：${this.file}`, "", "");
    }
    const shape = parsed as Partial<VaultFileShape>;
    const branches = shape.branches;
    if (typeof branches !== "object" || branches === null) {
      throw new CredentialError(`凭据登记表缺少 branches：${this.file}`, "", "");
    }
    for (const [branchId, refs] of Object.entries(branches)) {
      if (typeof refs !== "object" || refs === null) continue;
      const target = new Map<string, CredentialRef>();
      for (const [key, value] of Object.entries(refs)) {
        try {
          target.set(key, normalizeRef(value as CredentialRef, new Date().toISOString()));
        } catch {
          // 跳过损坏条目，不阻断其余分支加载
        }
      }
      this.records.set(branchId, target);
    }
  }
}

// ---------------------------------------------------------------------------
// 2) profile 文件锁（同一浏览器/桌面 profile 不得被两个分支并发占用）
// ---------------------------------------------------------------------------

/** 锁超过该毫秒数视为过期（默认 10 分钟），避免进程崩溃后永久占用。 */
export const DEFAULT_PROFILE_LOCK_STALE_MS = 10 * 60 * 1000;

export interface ProfileLockOptions {
  staleMs?: number;
  /** 时间源注入（测试用），默认 Date.now。 */
  now?: () => number;
  /** pid 注入（测试用），默认 process.pid。 */
  pid?: number;
}

/** 锁文件内容（只用于诊断，不是安全边界；安全由单写者窗口 + 过期清理保证）。 */
export interface ProfileLockRecord {
  profileId: string;
  pid: number;
  /** epoch 毫秒。 */
  timestamp: number;
  /** 随机令牌：release 时校验，避免误删他人锁。 */
  token: string;
  hostname: string;
}

export interface ProfileLockInfo {
  profileId: string;
  pid: number;
  token: string;
  timestamp: number;
  path: string;
  /** 是否清理了一枚过期锁后重新获得。 */
  recovered: boolean;
}

export class ProfileBusyError extends Error {
  readonly profileId: string;
  readonly holderPid: number | null;
  readonly holderTimestamp: number | null;

  constructor(profileId: string, holder: ProfileLockRecord | null) {
    const detail =
      holder === null ? "（锁文件存在但无法解析）" : `（持有者 pid=${holder.pid}，since ${new Date(holder.timestamp).toISOString()}）`;
    super(`profile 已被占用：${profileId}${detail}；同一浏览器/桌面 profile 不能并发给两个分支使用`);
    this.name = "ProfileBusyError";
    this.profileId = profileId;
    this.holderPid = holder === null ? null : holder.pid;
    this.holderTimestamp = holder === null ? null : holder.timestamp;
  }
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertProfileId(profileId: string): string {
  if (typeof profileId !== "string" || !PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error(`非法 profileId（只允许字母/数字/._-）：${String(profileId)}`);
  }
  return profileId;
}

/**
 * 文件锁。
 *
 * ```ts
 * const lock = new ProfileLock(root);
 * const info = lock.acquire(`browser-${branchId}`);
 * try { await browser.launch({ userDataDir: info.path ?? profileDir }); }
 * finally { lock.release(`browser-${branchId}`, info.token); }
 * ```
 *
 * 用 `open(..., "wx")` 语义（writeFileSync flag:"wx"）创建锁文件，避免并发竞态；
 * 过期锁（timestamp 超过 staleMs）在 acquire/isLocked 时被清理。
 */
export class ProfileLock {
  readonly root: string;
  readonly lockDir: string;
  readonly staleMs: number;
  private readonly now: () => number;
  private readonly pid: number;

  constructor(root: string, options: ProfileLockOptions = {}) {
    if (typeof root !== "string" || root.trim() === "") throw new Error("ProfileLock 需要非空 root");
    this.root = root;
    this.lockDir = join(resolve(root), ".locks");
    const staleMs = options.staleMs ?? DEFAULT_PROFILE_LOCK_STALE_MS;
    if (!Number.isFinite(staleMs) || staleMs <= 0) throw new Error(`staleMs 必须是正数：${String(staleMs)}`);
    this.staleMs = staleMs;
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
  }

  lockPath(profileId: string): string {
    return join(this.lockDir, `${assertProfileId(profileId)}.lock`);
  }

  /** 获取 profile 锁；已被未过期锁占用则抛 ProfileBusyError。 */
  acquire(profileId: string): ProfileLockInfo {
    const path = this.lockPath(profileId);
    mkdirSync(this.lockDir, { recursive: true });

    let recovered = false;
    const existing = this.readRecord(path);
    if (existing !== null) {
      if (!this.isExpired(existing)) throw new ProfileBusyError(profileId, existing);
      this.removeFile(path);
      recovered = true;
    } else if (existsSync(path)) {
      // 损坏的锁文件视为过期（无法判断持有者）
      this.removeFile(path);
      recovered = true;
    }

    const record: ProfileLockRecord = {
      profileId,
      pid: this.pid,
      timestamp: this.now(),
      token: randomBytes(8).toString("hex"),
      hostname: safeHostname(),
    };
    try {
      writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ProfileBusyError(profileId, this.readRecord(path));
      }
      throw error;
    }
    return { profileId, pid: record.pid, token: record.token, timestamp: record.timestamp, path, recovered };
  }

  /**
   * 释放 profile 锁。传入 token 时校验归属（推荐，避免误删他人锁）。
   * 返回是否实际删除。
   */
  release(profileId: string, token?: string): boolean {
    const path = this.lockPath(profileId);
    const record = this.readRecord(path);
    if (record === null) {
      if (existsSync(path)) {
        this.removeFile(path);
        return true;
      }
      return false;
    }
    if (token !== undefined && token !== record.token) {
      throw new Error(`profile ${profileId} 的锁不属于调用方（token 不匹配），拒绝释放`);
    }
    this.removeFile(path);
    return true;
  }

  /** 是否被未过期锁占用；遇到过期锁会顺手清理（返回 false）。 */
  isLocked(profileId: string): boolean {
    const path = this.lockPath(profileId);
    const record = this.readRecord(path);
    if (record === null) {
      if (existsSync(path)) {
        this.removeFile(path);
        return false;
      }
      return false;
    }
    if (this.isExpired(record)) {
      this.removeFile(path);
      return false;
    }
    return true;
  }

  /** 读取锁记录（诊断用）；不存在或损坏返回 null。 */
  read(profileId: string): ProfileLockRecord | null {
    return this.readRecord(this.lockPath(profileId));
  }

  private isExpired(record: ProfileLockRecord): boolean {
    return this.now() - record.timestamp > this.staleMs;
  }

  private readRecord(path: string): ProfileLockRecord | null {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as Partial<ProfileLockRecord>;
      if (typeof parsed.pid !== "number" || typeof parsed.timestamp !== "number") return null;
      return {
        profileId: typeof parsed.profileId === "string" ? parsed.profileId : "",
        pid: parsed.pid,
        timestamp: parsed.timestamp,
        token: typeof parsed.token === "string" ? parsed.token : "",
        hostname: typeof parsed.hostname === "string" ? parsed.hostname : "",
      };
    } catch {
      return null;
    }
  }

  private removeFile(path: string): void {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function safeHostname(): string {
  try {
    return hostname();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// 3) 分支工具白名单
// ---------------------------------------------------------------------------

export class BranchToolNotAllowedError extends Error {
  readonly requestedTool: string;
  readonly allowedTools: readonly string[];

  constructor(requestedTool: string, allowedTools: readonly string[]) {
    super(
      `工具不在分支白名单：${requestedTool}（允许：${allowedTools.length > 0 ? allowedTools.join(", ") : "（空）"}）`,
    );
    this.name = "BranchToolNotAllowedError";
    this.requestedTool = requestedTool;
    this.allowedTools = allowedTools;
  }
}

/**
 * 执行步骤前的分支工具白名单断言（与 runtime 内的检查逻辑一致，独立实现便于测试）。
 * 通过返回 undefined；不在白名单抛 BranchToolNotAllowedError。
 */
export function assertBranchToolsAllowed(branchTools: readonly string[], requestedTool: string): void {
  const allowed: readonly string[] = Array.isArray(branchTools) ? branchTools : [];
  if (typeof requestedTool !== "string" || requestedTool.trim() === "") {
    throw new BranchToolNotAllowedError(String(requestedTool), allowed);
  }
  if (!allowed.includes(requestedTool)) {
    throw new BranchToolNotAllowedError(requestedTool, allowed);
  }
}

/** 返回白名单内的工具（用于 planner 过滤）；不抛错。 */
export function filterBranchTools(branchTools: readonly string[], requestedTools: readonly string[]): string[] {
  const allowed = new Set(Array.isArray(branchTools) ? branchTools : []);
  return (Array.isArray(requestedTools) ? requestedTools : []).filter((tool) => allowed.has(tool));
}

/** 解析 `file:` 引用的绝对路径（供调用方读取密钥文件；仅路径拼接，不读内容）。 */
export function resolveCredentialPath(root: string, ref: CredentialRef): string | null {
  if (ref.kind !== "file") return null;
  const raw = ref.ref.startsWith(FILE_REF_PREFIX) ? ref.ref.slice(FILE_REF_PREFIX.length) : ref.ref;
  if (isAbsolute(raw)) return raw;
  return resolve(root, raw);
}
