/**
 * 回收站（备份/恢复）：破坏性动作（`app.remove` / `plugin.remove`）**先备份再删除**。
 *
 * 布局：`<state_dir>/recycle/<timestamp>/<label>/<被备份项原名>`。
 * 删除失败时备份保留，便于人工恢复；`restoreBackup()` 可把备份复制回目标位置。
 */

import { cp, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { SystemActionError } from "./errors.js";
import { isPathInside, normalizeForCompare } from "./scope.js";
import type { RestoreResult } from "./types.js";

/** 回收站根：`<state_dir>/recycle`。 */
export function recycleRoot(stateDir: string): string {
  return join(resolve(stateDir), "recycle");
}

/** 时间戳 slug：`YYYYMMDD-HHMMSS-mmm`（本地时间，便于人工定位）。 */
export function recycleStamp(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
    `${pad(now.getMilliseconds(), 3)}`
  );
}

function safeLabel(input: string): string {
  const cleaned = String(input ?? "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned === "" ? "item" : cleaned).slice(0, 80);
}

/** 备份路径是否位于回收站内（restoreBackup 的安全校验）。 */
export function isRecyclePath(stateDir: string, candidate: string): boolean {
  return isPathInside(recycleRoot(stateDir), candidate);
}

/**
 * 把一个文件/目录备份到回收站；返回**实际备份项**的路径（`.../recycle/<stamp>/<label>/<basename>`）。
 * 备份采用复制（保留原件到调用方删除），目录递归复制。
 */
export async function backupToRecycle(options: {
  stateDir: string;
  sourcePath: string;
  label: string;
  now?: Date;
}): Promise<string> {
  const source = resolve(options.sourcePath);
  if (!existsSync(source)) {
    throw new SystemActionError("not-found", `备份失败：要备份的路径不存在：${source}`);
  }
  const stamp = recycleStamp(options.now ?? new Date());
  const label = safeLabel(options.label);
  const backupDir = join(recycleRoot(options.stateDir), stamp, label);
  const target = join(backupDir, basename(source) === "" ? "item" : basename(source));
  await mkdir(backupDir, { recursive: true });
  try {
    const info = await stat(source);
    await cp(source, target, { recursive: info.isDirectory(), force: true, errorOnExist: false });
  } catch (error) {
    throw new SystemActionError(
      "backup-failed",
      `备份失败（${source} → ${target}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return target;
}

/**
 * 恢复备份：把 `backupPath`（备份项）复制到 `destination`。
 * - `backupPath` 必须存在；
 * - `destination` 不能已存在（除非 `force: true`）；
 * - 目录递归复制、文件复制。
 */
export async function restoreBackup(
  backupPath: string,
  destination: string,
  options: { force?: boolean } = {},
): Promise<RestoreResult> {
  const source = resolve(backupPath);
  const target = resolve(destination);
  if (!existsSync(source)) {
    throw new SystemActionError("not-found", `恢复失败：备份不存在：${source}`);
  }
  if (existsSync(target) && options.force !== true) {
    throw new SystemActionError("destination-exists", `恢复失败：目标已存在（禁止静默覆盖）：${target}`);
  }
  if (normalizeForCompare(source) === normalizeForCompare(target)) {
    throw new SystemActionError("invalid-destination", `恢复失败：目标与备份是同一路径：${target}`);
  }
  try {
    await mkdir(dirname(target), { recursive: true });
    const info = await stat(source);
    await cp(source, target, { recursive: info.isDirectory(), force: options.force === true, errorOnExist: false });
  } catch (error) {
    throw new SystemActionError(
      "restore-failed",
      `恢复失败（${source} → ${target}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { backup_path: source, destination: target, restored: true };
}
