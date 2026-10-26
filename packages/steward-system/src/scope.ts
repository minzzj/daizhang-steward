/**
 * 受管范围与路径安全（系统总控动作层的第一道安全边界）。
 *
 * 铁律：
 * - 只允许操作「受管应用清单」内的 app id 与 `<plugins_dir>` 下的插件子目录；
 * - 所有路径先 `resolve` 再判断是否在允许的根目录内（大小写不敏感、Windows 反斜杠）；
 * - 拒绝 `..` 路径穿越、绝对路径越界、NUL/控制字符、通配符；
 * - 删除目标必须**严格位于**受管 root 内，且绝不允许系统关键路径（Windows 目录/Program Files/
 *   ProgramData、盘符根、POSIX 系统目录）。
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, normalize, resolve, sep } from "node:path";
import { SystemActionError } from "./errors.js";

/** 受管 id 允许的字符（字母数字开头，只含字母数字/._-，≤64）。 */
export const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 校验受管 id（app/plugin），非法抛 SystemActionError。 */
export function assertSafeId(id: unknown, label: string): string {
  if (typeof id !== "string" || !SAFE_ID_PATTERN.test(id)) {
    throw new SystemActionError(
      "invalid-id",
      `${label} 非法：只允许字母数字开头、由字母数字/._- 组成、长度 1-64 的 id（收到 ${JSON.stringify(id)}）`,
    );
  }
  return id;
}

function isWindows(): boolean {
  return process.platform === "win32";
}

/** 统一路径比较形式：resolve + normalize；Windows 下小写。 */
export function normalizeForCompare(input: string): string {
  const resolved = resolve(input);
  return isWindows() ? resolved.toLowerCase() : resolved;
}

/** child 是否在 parent 内（含相等时由 strict 控制）。 */
export function isPathInside(parent: string, child: string, options: { strict?: boolean } = {}): boolean {
  const parentNorm = normalizeForCompare(parent);
  const childNorm = normalizeForCompare(child);
  if (options.strict === true && parentNorm === childNorm) return false;
  if (childNorm === parentNorm) return true;
  const prefix = parentNorm.endsWith(sep) ? parentNorm : parentNorm + sep;
  return childNorm.startsWith(prefix);
}

/** 系统关键路径根（Windows：SystemRoot/Program Files/ProgramData/盘符根；POSIX：/etc、/usr…）。 */
export function systemCriticalRoots(): string[] {
  const raw: Array<string | undefined> = [];
  if (isWindows()) {
    // 注意：不把 SystemDrive（C:）纳入「前缀根」，否则所有 C 盘路径都会被判为系统路径；
    // 盘符根本身由 isSystemCriticalPath() 开头的正则单独处理。
    raw.push(process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]);
    raw.push(process.env.ProgramW6432, process.env.ProgramData);
  } else {
    raw.push("/etc", "/usr", "/bin", "/sbin", "/boot", "/dev", "/proc", "/sys", "/System", "/Library", "/Applications", "/private");
  }
  const roots: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.trim() === "") continue;
    let candidate = item;
    if (isWindows() && /^[A-Za-z]:$/.test(item)) candidate = `${item}${sep}`;
    if (!isAbsolute(candidate)) continue;
    const normalized = normalizeForCompare(candidate);
    if (!roots.includes(normalized)) roots.push(normalized);
  }
  return roots;
}

/** 是否是系统关键路径（自身或位于系统目录内）→ 删除/写操作一律拒绝。 */
export function isSystemCriticalPath(input: string): boolean {
  if (typeof input !== "string" || input.trim() === "") return false;
  const normalized = normalizeForCompare(input);
  // 盘符根（C:\）与 POSIX 根
  if (/^[a-z]:[\\/]?$/.test(normalized)) return true;
  if (normalized === sep || normalized === "") return true;
  for (const root of systemCriticalRoots()) {
    if (normalized === root) return true;
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

/** 拒绝未受管的相对路径参数中的穿越/绝对路径/通配符/控制字符；返回规范化相对路径。 */
export function assertSafeRelativePath(raw: unknown, label: string): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") {
    throw new SystemActionError("invalid-path", `${label} 必须是字符串（收到 ${typeof raw}）`);
  }
  const value = raw.trim();
  if (value === "") return "";
  if (value.length > 512) throw new SystemActionError("invalid-path", `${label} 过长（>512）`);
  if (/[\0\r\n]/.test(value)) throw new SystemActionError("invalid-path", `${label} 含换行/NUL 等控制字符`);
  if (/[*?<>|"]/.test(value)) throw new SystemActionError("invalid-path", `${label} 不允许通配符/特殊字符：${value}`);
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new SystemActionError("path-traversal", `${label} 不允许绝对路径：${value}`);
  }
  const segments = value.split(/[\\/]+/);
  const safeSegments: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw new SystemActionError("path-traversal", `${label} 不允许路径穿越（..）：${value}`);
    }
    safeSegments.push(segment);
  }
  return safeSegments.join(sep);
}

/**
 * 解析 base 目录内的目标路径（用于 file.list 等相对访问）。
 * 返回绝对路径；越界/穿越抛 SystemActionError。
 */
export function resolveWithin(baseDir: string, rawRelative: unknown, label: string): string {
  const base = resolve(baseDir);
  const relative = assertSafeRelativePath(rawRelative, label);
  const target = relative === "" ? base : resolve(base, relative);
  if (!isPathInside(base, target)) {
    throw new SystemActionError("path-traversal", `${label} 越界：${String(rawRelative)} 不在 ${base} 内`);
  }
  return target;
}

/**
 * 校验「删除目标」的安全性（app.remove / plugin.remove 共用）：
 * - 必须存在；
 * - 必须严格位于受管 root 内（不能等于 root 本身、不能是 root 的祖先）；
 * - 不能位于 state_dir（回收站/审计）内；
 * - 不能是 plugins_dir 根本身（插件子目录允许）；
 * - 不能是系统关键路径。
 * 返回 realpath（存在符号链接时按真实路径判断）。
 */
export function assertRemovableTarget(options: {
  root: string;
  stateDir: string;
  pluginsDir: string;
  targetPath: string;
  label: string;
}): string {
  const { root, stateDir, pluginsDir, targetPath, label } = options;
  if (typeof targetPath !== "string" || targetPath.trim() === "") {
    throw new SystemActionError("no-removal-path", `${label} 未声明可删除的路径（需要 path/cwd）`);
  }
  const resolvedTarget = resolve(targetPath);
  if (!existsSync(resolvedTarget)) {
    throw new SystemActionError("not-found", `${label} 的删除目标不存在：${resolvedTarget}`);
  }
  const realTarget = safeRealpath(resolvedTarget);
  const realRoot = safeRealpath(resolve(root));
  const realStateDir = safeRealpath(resolve(stateDir));
  const realPluginsDir = safeRealpath(resolve(pluginsDir));

  if (normalizeForCompare(realTarget) === normalizeForCompare(realRoot)) {
    throw new SystemActionError("out-of-scope", `${label} 的删除目标是受管根目录本身，禁止删除：${realTarget}`);
  }
  if (!isPathInside(realRoot, realTarget, { strict: true })) {
    throw new SystemActionError("out-of-scope", `${label} 的删除目标不在受管根目录内：${realTarget}（root=${realRoot}）`);
  }
  if (isPathInside(realStateDir, realTarget)) {
    throw new SystemActionError("out-of-scope", `${label} 的删除目标位于状态目录（审计/回收站）内，禁止删除：${realTarget}`);
  }
  if (normalizeForCompare(realTarget) === normalizeForCompare(realPluginsDir)) {
    throw new SystemActionError("out-of-scope", `${label} 的删除目标是插件根目录本身，禁止删除：${realTarget}`);
  }
  if (isSystemCriticalPath(realTarget) || isSystemCriticalPath(realRoot)) {
    throw new SystemActionError("system-path", `${label} 的删除目标或受管根目录属于系统关键路径，禁止删除：${realTarget}`);
  }
  return realTarget;
}

/** 解析插件目录（`<plugins_dir>/<id>`）；id 非法/越界抛错。 */
export function resolvePluginDir(pluginsDir: string, pluginId: unknown): string {
  const id = assertSafeId(pluginId, "插件 id");
  const base = resolve(pluginsDir);
  const target = resolve(base, id);
  if (!isPathInside(base, target, { strict: true })) {
    throw new SystemActionError("path-traversal", `插件目录越界：${String(pluginId)}`);
  }
  return target;
}

/** 安全的 realpath：不存在时退回 resolve 结果（避免报错打断规划）。 */
export function safeRealpath(input: string): string {
  const resolved = resolve(input);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/** 进程名（去掉扩展名），用于诊断/审计摘要。 */
export function processNameFor(app: { command: string; name?: string }): string {
  const base = basename(app.command);
  const withoutExt = isWindows() ? base.replace(/\.(exe|cmd|bat|ps1)$/i, "") : base;
  return withoutExt === "" ? (app.name ?? "process") : withoutExt;
}

/** 目标路径的简短展示（最多 maxLength 字符）。 */
export function briefPath(input: string, maxLength = 120): string {
  const value = String(input ?? "");
  const chars = [...value];
  if (chars.length <= maxLength) return value;
  const head = chars.slice(0, Math.floor(maxLength / 2) - 2).join("");
  const tail = chars.slice(-Math.floor(maxLength / 2) + 2).join("");
  return `${head}…${tail}`;
}

/** 归一化路径展示（统一正斜杠，便于审计与跨平台报告）。 */
export function displayPath(input: string): string {
  return resolve(input).replaceAll("\\", "/");
}

/** 是否 Windows（供上层判断真实执行能力）。 */
export { isWindows };
