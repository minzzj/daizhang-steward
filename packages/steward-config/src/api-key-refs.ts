/**
 * API 密钥引用与本地 secrets 文件（v1.2）。
 *
 * 安全原则（密钥绝不入库）：
 * - `config.json` 只存**引用**：`env:NAME`（环境变量名）或 `file:<相对路径>#<key>`（本地 secrets 文件片段）；
 * - 明文密钥只存在于进程环境变量或 `<root>/secrets.json`（`setLocalApiKey` 写入，尽力 0600）；
 * - `resolveAgentModel` 只返回 `has_key`，`getApiKeyForProvider` 返回的明文仅限运行时使用，
 *   引擎**不写日志、不写审计、不落盘**。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath, sep } from "node:path";

/** 本地 secrets 文件名（相对提供方根目录；`.gitignore` 已忽略 secrets*）。 */
export const SECRETS_FILE_NAME = "secrets.json";

export type ParsedApiKeyRef =
  | { kind: "empty" }
  | { kind: "env"; name: string }
  | { kind: "file"; path: string; key: string };

const ENV_REF_PATTERN = /^env:([A-Za-z_][A-Za-z0-9_]*)$/u;
const FILE_REF_PATTERN = /^file:([^#]+)#([A-Za-z0-9._-]+)$/u;

/** 路径必须为相对路径且不含 `..`（防止密钥文件被指向根目录外）。 */
function isSafeRelativePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").trim();
  if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) return false;
  return !normalized.split("/").some((segment) => segment === ".." || segment === "");
}

/** 解析密钥引用；格式非法返回 null。空字符串表示未配置。 */
export function parseApiKeyRef(ref: string): ParsedApiKeyRef | null {
  const value = typeof ref === "string" ? ref.trim() : "";
  if (value === "") return { kind: "empty" };
  const envMatch = ENV_REF_PATTERN.exec(value);
  if (envMatch !== null) {
    const name = envMatch[1];
    return name === undefined ? null : { kind: "env", name };
  }
  const fileMatch = FILE_REF_PATTERN.exec(value);
  if (fileMatch !== null) {
    const path = fileMatch[1]?.trim();
    const key = fileMatch[2];
    if (path === undefined || key === undefined || !isSafeRelativePath(path)) return null;
    return { kind: "file", path, key };
  }
  return null;
}

/** 引用格式是否合法（空字符串=未配置，也算合法）。 */
export function isValidApiKeyRef(ref: string): boolean {
  return parseApiKeyRef(ref) !== null;
}

function maskText(text: string): string {
  const chars = [...text];
  if (chars.length <= 4) return "*".repeat(Math.max(3, chars.length));
  return `${chars.slice(0, 2).join("")}***${chars.slice(-2).join("")}`;
}

/** 展示用掩码引用：env:DEE***KEY / file:secrets.json#de***ek / （未配置）。 */
export function maskApiKeyRef(ref: string): string {
  const parsed = parseApiKeyRef(ref);
  if (parsed === null) return "（非法引用）";
  if (parsed.kind === "empty") return "（未配置）";
  if (parsed.kind === "env") return `env:${maskText(parsed.name)}`;
  const fileName = parsed.path.replaceAll("\\", "/").split("/").pop() ?? parsed.path;
  return `file:${fileName}#${maskText(parsed.key)}`;
}

/** `<root>/secrets.json`；纯内存模式返回 null（不允许落盘明文）。 */
export function secretsFilePathFor(root: string | null): string | null {
  return root === null ? null : resolvePath(root, SECRETS_FILE_NAME);
}

/** 读取 secrets 文件（不存在返回空对象；损坏抛错）。 */
export function readSecretsFile(root: string): Record<string, Record<string, unknown>> {
  const file = secretsFilePathFor(root);
  if (file === null) return {};
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`secrets.json 格式非法：应为对象（${file}）`);
  }
  return parsed as Record<string, Record<string, unknown>>;
}

function writeSecretsFile(root: string, data: Record<string, unknown>): string {
  const file = secretsFilePathFor(root);
  if (file === null) throw new Error("纯内存模式没有 secrets 文件可写");
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  // 尽力 0600：POSIX 生效；Windows 上 Node 的 mode 仅影响部分权限位，失败不阻断（文件在本地单机）
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows/受限文件系统上尽力而为
  }
  return file;
}

/** 写入/更新某 provider 的本地明文密钥（只落 secrets.json，绝不进 config.json）。 */
export function setLocalSecret(root: string, providerId: string, plaintext: string): string {
  const data = readSecretsFile(root);
  const existing = data[providerId];
  data[providerId] = {
    ...(typeof existing === "object" && existing !== null ? existing : {}),
    api_key: plaintext,
    updated_at: new Date().toISOString(),
  };
  return writeSecretsFile(root, data);
}

/** 删除某 provider 的本地密钥；返回是否删除。 */
export function removeLocalSecret(root: string, providerId: string): boolean {
  const file = secretsFilePathFor(root);
  if (file === null || !existsSync(file)) return false;
  const data = readSecretsFile(root);
  if (!(providerId in data)) return false;
  delete data[providerId];
  writeSecretsFile(root, data);
  return true;
}

export interface ResolvedApiKey {
  ok: boolean;
  value?: string;
  source: "env" | "file" | "missing";
  env_name?: string;
  file?: string;
  error?: string;
}

/**
 * 运行时解析密钥引用：env → process.env；file → 读 `<root>/<path>` 的片段。
 * **返回值含明文，仅供运行时调用；引擎不写日志/审计/配置。**
 */
export function resolveApiKeyRef(ref: string, root: string | null): ResolvedApiKey {
  const parsed = parseApiKeyRef(ref);
  if (parsed === null) return { ok: false, source: "missing", error: "密钥引用格式非法（只允许 env:NAME / file:path#key）" };
  if (parsed.kind === "empty") return { ok: false, source: "missing", error: "尚未配置 API 密钥引用" };
  if (parsed.kind === "env") {
    const value = process.env[parsed.name];
    if (typeof value === "string" && value.trim() !== "") {
      return { ok: true, source: "env", value, env_name: parsed.name };
    }
    return { ok: false, source: "missing", env_name: parsed.name, error: `环境变量未设置：${parsed.name}` };
  }
  if (root === null) return { ok: false, source: "missing", error: "纯内存模式无法读取本地 secrets 文件" };
  const rootResolved = resolvePath(root);
  const fileResolved = resolvePath(rootResolved, parsed.path);
  if (!fileResolved.startsWith(rootResolved + sep) && fileResolved !== rootResolved) {
    return { ok: false, source: "missing", file: fileResolved, error: "secrets 文件路径越出 root（拒绝读取）" };
  }
  if (!existsSync(fileResolved)) {
    return { ok: false, source: "missing", file: fileResolved, error: `secrets 文件不存在：${parsed.path}` };
  }
  let parsedFile: unknown;
  try {
    parsedFile = JSON.parse(readFileSync(fileResolved, "utf8"));
  } catch (error) {
    return { ok: false, source: "missing", file: fileResolved, error: `secrets 文件 JSON 损坏：${(error as Error).message}` };
  }
  if (typeof parsedFile !== "object" || parsedFile === null) {
    return { ok: false, source: "missing", file: fileResolved, error: "secrets 文件格式非法（应为对象）" };
  }
  const record = parsedFile as Record<string, unknown>;
  const node = record[parsed.key];
  const value = typeof node === "string" ? node : typeof node === "object" && node !== null ? (node as { api_key?: unknown }).api_key : undefined;
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, source: "missing", file: fileResolved, error: `secrets 文件中缺少 ${parsed.key}.api_key` };
  }
  return { ok: true, source: "file", value, file: fileResolved };
}

/** 便捷：把本地 secrets 文件转成可展示的 provider 引用状态（不含明文）。 */
export function describeApiKeyRef(ref: string): { masked: string; configured: boolean; source: "env" | "file" | "none" } {
  const parsed = parseApiKeyRef(ref);
  if (parsed === null) return { masked: "（非法引用）", configured: false, source: "none" };
  if (parsed.kind === "empty") return { masked: "（未配置）", configured: false, source: "none" };
  return { masked: maskApiKeyRef(ref), configured: true, source: parsed.kind === "env" ? "env" : "file" };
}

/** 清理临时文件（异常路径）。 */
export function removeFileQuietly(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // ignore
  }
}
