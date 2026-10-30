/**
 * 工作区快照与产物识别：
 * - 运行前递归快照（相对路径 → size/sha256）；
 * - 运行后再快照，diff 出「新增/修改」文件作为 artifacts；
 * - 扩展名分类 kind；跳过 node_modules/.git 等目录、>5MB 大文件、符号链接。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

import {
  HARNESS_SKIP_DIRS,
  HARNESS_SNAPSHOT_MAX_FILE_BYTES,
  type HarnessArtifact,
  type HarnessArtifactKind,
} from "./types.js";

export interface FileSnapshotEntry {
  rel_path: string;
  size: number;
  sha256: string;
}

export type WorkspaceSnapshot = Map<string, FileSnapshotEntry>;

const SKIP_DIR_SET: ReadonlySet<string> = new Set(HARNESS_SKIP_DIRS);

/** 计算文件 sha256（小写 hex）。 */
export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** 计算字符串/字节 sha256。 */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 按扩展名分类产物 kind。 */
export function classifyArtifactKind(relPath: string): HarnessArtifactKind {
  const ext = extname(relPath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md" || ext === ".markdown" || ext === ".mdx") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp" || ext === ".svg" || ext === ".bmp" || ext === ".ico") {
    return "image";
  }
  if (
    ext === ".ts" ||
    ext === ".tsx" ||
    ext === ".js" ||
    ext === ".mjs" ||
    ext === ".cjs" ||
    ext === ".jsx" ||
    ext === ".py" ||
    ext === ".sh" ||
    ext === ".ps1" ||
    ext === ".bat" ||
    ext === ".cmd" ||
    ext === ".css" ||
    ext === ".scss" ||
    ext === ".less" ||
    ext === ".yml" ||
    ext === ".yaml" ||
    ext === ".toml" ||
    ext === ".ini" ||
    ext === ".sql" ||
    ext === ".java" ||
    ext === ".go" ||
    ext === ".rs" ||
    ext === ".c" ||
    ext === ".h" ||
    ext === ".cpp" ||
    ext === ".cs" ||
    ext === ".rb" ||
    ext === ".php" ||
    ext === ".lua" ||
    ext === ".vue" ||
    ext === ".svelte"
  ) {
    return "code";
  }
  if (ext === ".csv" || ext === ".tsv" || ext === ".jsonl" || ext === ".ndjson" || ext === ".xml" || ext === ".xlsx" || ext === ".parquet") {
    return "data";
  }
  if (ext === ".txt" || ext === ".log" || ext === ".rst" || ext === ".text") return "text";
  return "other";
}

/** 运行前工作区快照（跳过目录/大文件/符号链接；读取失败的文件跳过）。 */
export function snapshotWorkspace(workspaceDir: string): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = new Map();
  if (!existsSync(workspaceDir)) return snapshot;
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const absolute = join(dir, name);
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (SKIP_DIR_SET.has(name)) continue;
        walk(absolute);
        continue;
      }
      if (!stat.isFile()) continue; // 跳过符号链接/设备等
      if (stat.size > HARNESS_SNAPSHOT_MAX_FILE_BYTES) continue;
      const relPath = relative(workspaceDir, absolute).split(sep).join("/");
      let sha256: string;
      try {
        sha256 = sha256File(absolute);
      } catch {
        continue;
      }
      snapshot.set(relPath, { rel_path: relPath, size: stat.size, sha256 });
    }
  };
  walk(workspaceDir);
  return snapshot;
}

/** 对比前后快照，返回新增或内容变化的产物（按 rel_path 排序）。 */
export function diffWorkspaceArtifacts(
  workspaceDir: string,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): HarnessArtifact[] {
  const artifacts: HarnessArtifact[] = [];
  for (const [relPath, entry] of after) {
    const previous = before.get(relPath);
    if (previous !== undefined && previous.sha256 === entry.sha256) continue;
    artifacts.push(toArtifact(workspaceDir, entry));
  }
  artifacts.sort((left, right) => left.rel_path.localeCompare(right.rel_path));
  return artifacts;
}

/** 追加一个由运行器自写的文件（report.md）为 artifact。 */
export function artifactForFile(workspaceDir: string, absolutePath: string): HarnessArtifact | null {
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const relPath = relative(workspaceDir, absolutePath).split(sep).join("/");
  let sha256: string;
  try {
    sha256 = sha256File(absolutePath);
  } catch {
    return null;
  }
  return {
    path: absolutePath,
    rel_path: relPath,
    kind: classifyArtifactKind(relPath),
    size: stat.size,
    sha256,
  };
}

function toArtifact(workspaceDir: string, entry: FileSnapshotEntry): HarnessArtifact {
  return {
    path: join(workspaceDir, entry.rel_path.split("/").join(sep)),
    rel_path: entry.rel_path,
    kind: classifyArtifactKind(entry.rel_path),
    size: entry.size,
    sha256: entry.sha256,
  };
}

/** 文件名词（报告标题兜底用）。 */
export function safeBaseName(filePath: string): string {
  return basename(filePath);
}
