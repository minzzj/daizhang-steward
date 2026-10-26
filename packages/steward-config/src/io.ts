/**
 * 同步文件 IO 小工具：配置文件小（<100KB），同步读写让 CLI/控制台调用更简单；
 * 所有 JSON 写盘一律原子写（同目录 tmp + rename）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ConfigIOError } from "./errors.js";

export function ensureDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 原子写 JSON：同目录 tmp → rename 覆盖。 */
export function atomicWriteJsonSync(file: string, value: unknown): void {
  const dir = dirname(file);
  ensureDirSync(dir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    renameSync(tmp, file);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // 清理失败不影响主错误
    }
    throw error instanceof ConfigIOError ? error : new ConfigIOError(`配置原子写失败：${(error as Error).message}`, file);
  }
}

/** 读 JSON；文件不存在返回 null；损坏/不可解析抛 ConfigIOError。 */
export function readJsonFileSync<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigIOError(`配置文件读取失败：${(error as Error).message}`, file);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ConfigIOError(`配置文件 JSON 损坏：${(error as Error).message}`, file);
  }
}

/** 追加一行 JSON（审计/Token 用量日志；只追加不覆盖）。 */
export function appendJsonLineSync(file: string, value: unknown): void {
  try {
    ensureDirSync(dirname(file));
    appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
  } catch (error) {
    throw new ConfigIOError(`追加写入失败：${(error as Error).message}`, file);
  }
}

/** 读取 JSONL（文件不存在返回空数组；损坏行跳过）。 */
export function readJsonLinesSync<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigIOError(`日志读取失败：${(error as Error).message}`, file);
  }
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // 单行损坏不影响整体读取
    }
  }
  return out;
}
