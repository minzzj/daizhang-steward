/**
 * 文件 IO 小工具：所有写盘 JSON 一律原子写（同目录 tmp + rename），避免半截文件。
 * 纯 Node 内置模块，无第三方依赖。
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 递归建目录。 */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** 原子写 JSON：先写同目录临时文件，再 rename 覆盖。 */
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, JSON.stringify(value, null, 2) + "\n");
}

/** 原子写文本（同上）。 */
export async function atomicWriteText(file: string, text: string): Promise<void> {
  const dir = dirname(file);
  await ensureDir(dir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await writeFile(tmp, text, "utf8");
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 读 JSON；文件不存在返回 null；损坏 JSON 抛错（由调用方决定如何处理）。 */
export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text) as T;
}

/** 列出目录下的普通文件（目录不存在时返回空数组）。 */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** 当前时间 ISO 字符串（可注入时钟用于确定性证据时间戳）。 */
export function nowIso(now?: () => Date): string {
  return (now === undefined ? new Date() : now()).toISOString();
}

/** 真实等待（毫秒）——不允许用假时钟替代真实等待。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** 把 ISO 时间串变成文件名安全片段：2026-10-25T22:47:43.123Z → 2026-10-25T22-47-43-123Z */
export function stampForFile(iso: string): string {
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

/** JSON 深拷贝（契约对象都是纯 JSON）。 */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
