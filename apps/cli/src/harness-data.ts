/**
 * v1.5.1：Harness 产物/报告/数据读取（供 ChatTools 与控制台真实 Provider 复用）。
 * 数据目录：`<runsRoot>/<sessionId>/harness/` 与 `<runsRoot>/<sessionId>/artifacts/`。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";

export type HarnessArtifactKind = "html" | "markdown" | "json" | "text" | "image" | "code" | "data" | "other";

export interface HarnessArtifactView {
  id: string;
  run_id: string;
  session_id: string;
  step?: number;
  agent_role?: string;
  rel_path: string;
  kind: HarnessArtifactKind;
  title: string;
  mime: string;
  size: number;
  created_at: string;
  preview_url?: string;
  download_url?: string;
}

export interface HarnessReportView {
  id: string;
  run_id: string;
  session_id: string;
  step?: number;
  agent_role?: string;
  title: string;
  markdown: string;
  created_at: string;
}

export interface HarnessMetricsView {
  token_input: number;
  token_output: number;
  token_cache_read: number;
  token_total: number;
  steps: number;
  duration_ms: number;
  tool_calls: number;
  tool_call_counts: Record<string, number>;
  events: number;
  model_modes: string[];
  budget_used_cny: number;
}

export function classifyArtifactKind(relPath: string): HarnessArtifactKind {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) return "json";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) return "image";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|cs|sh|ps1|bat|sql|yml|yaml|toml)$/i.test(lower)) return "code";
  if (/\.(csv|tsv|xlsx?|parquet)$/i.test(lower)) return "data";
  if (/\.(txt|log|diff|patch)$/i.test(lower)) return "text";
  return "other";
}

export function mimeOfKind(kind: HarnessArtifactKind): string {
  switch (kind) {
    case "html": return "text/html; charset=utf-8";
    case "markdown": return "text/markdown; charset=utf-8";
    case "json": return "application/json; charset=utf-8";
    case "image": return "image/png";
    case "code": return "text/plain; charset=utf-8";
    case "data": return "text/csv; charset=utf-8";
    default: return "text/plain; charset=utf-8";
  }
}

export function harnessSessions(runsRoot: string): string[] {
  try {
    return readdirSync(runsRoot).filter((name) => name.startsWith("sess-") && existsSync(join(runsRoot, name, "harness")));
  } catch {
    return [];
  }
}

function inside(runsRoot: string, abs: string): boolean {
  try {
    const rel = relative(runsRoot, abs);
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

function stepRolesFor(runsRoot: string, sessionId: string): Map<number, string> {
  const roles = new Map<number, string>();
  const harnessDir = join(runsRoot, sessionId, "harness");
  if (!existsSync(harnessDir)) return roles;
  let names: string[] = [];
  try { names = readdirSync(harnessDir); } catch { return roles; }
  for (const name of names) {
    const match = /^step-(\d+)-summary\.json$/.exec(name);
    if (match === null) continue;
    try {
      const summary = JSON.parse(readFileSync(join(harnessDir, name), "utf8")) as { role?: string };
      roles.set(Number(match[1]), summary.role ?? "");
    } catch { /* ignore */ }
  }
  return roles;
}

export function listHarnessArtifacts(
  runsRoot: string,
  filter: { run_id?: string; session_id?: string; agent_role?: string; kind?: string; limit?: number } = {},
  runIdForSession: (sessionId: string) => string | undefined = (sessionId) => sessionId,
): HarnessArtifactView[] {
  let sessions = harnessSessions(runsRoot);
  if (filter.session_id) sessions = sessions.filter((id) => id === filter.session_id);
  const out: HarnessArtifactView[] = [];
  for (const sessionId of sessions) {
    const harnessDir = join(runsRoot, sessionId, "harness");
    let names: string[] = [];
    try { names = readdirSync(harnessDir); } catch { continue; }
    const stepRoles = stepRolesFor(runsRoot, sessionId);
    for (const name of names) {
      const match = /^step-(\d+)-artifacts\.json$/.exec(name);
      if (match === null) continue;
      const step = Number(match[1]);
      try {
        const manifest = JSON.parse(readFileSync(join(harnessDir, name), "utf8")) as { artifacts?: Array<Record<string, unknown>> };
        for (const entry of manifest.artifacts ?? []) {
          const relPath = String(entry.rel_path ?? "").replaceAll("\\", "/");
          if (relPath.length === 0) continue;
          const abs = join(runsRoot, relPath);
          if (!inside(runsRoot, abs) || !existsSync(abs)) continue;
          const kind = classifyArtifactKind(relPath);
          let size = Number(entry.size ?? 0);
          let createdAt = new Date().toISOString();
          try {
            const st = statSync(abs);
            size = st.size;
            createdAt = st.mtime.toISOString();
          } catch { /* ignore */ }
          const id = `${sessionId}::${relPath}`;
          out.push({
            id,
            run_id: runIdForSession(sessionId) ?? sessionId,
            session_id: sessionId,
            step,
            agent_role: stepRoles.get(step) ?? "",
            rel_path: relPath,
            kind,
            title: basename(relPath),
            mime: mimeOfKind(kind),
            size,
            created_at: createdAt,
            preview_url: `/api/artifacts/${encodeURIComponent(id)}/preview`,
            download_url: `/api/artifacts/${encodeURIComponent(id)}/download`,
          });
        }
      } catch { /* ignore */ }
    }
  }
  const unique = new Map<string, HarnessArtifactView>();
  for (const view of out) if (!unique.has(view.id)) unique.set(view.id, view);
  let views = [...unique.values()];
  if (filter.agent_role) views = views.filter((view) => view.agent_role === filter.agent_role);
  if (filter.kind) views = views.filter((view) => view.kind === filter.kind);
  views.sort((left, right) => right.created_at.localeCompare(left.created_at));
  return typeof filter.limit === "number" ? views.slice(0, filter.limit) : views;
}

export function sanitizeLocalPaths(text: string): string {
  return text
    .replace(/C:(?:\\\\|\\)Users(?:\\\\|\\)[^\\\s"',]+(?:\\\\|\\)AppData(?:\\\\|\\)Local(?:\\\\|\\)Temp(?:\\\\|\\)steward-harness/gi, "<harness-workspace>")
    .replace(/H:(?:\\\\|\\)minzzj[^\\\s"',]+(?:\\\\|\\)daizhang-steward/gi, "<repo>")
    .replace(/C:(?:\\\\|\\)Users(?:\\\\|\\)[^\\\s"',]+(?:\\\\|\\)AppData[^\s"',]*/gi, "<local-path>")
    .replace(/C:(?:\\\\|\\)Program Files(?:\\\\|\\)nodejs(?:\\\\|\\)node\.exe/gi, "<node>")
    .replace(/C:(?:\\\\|\\)Users(?:\\\\|\\)[^\\\s"',]+/gi, "<user>");
}
export function listHarnessReports(
  runsRoot: string,
  filter: { run_id?: string; session_id?: string; agent_role?: string; limit?: number } = {},
  runIdForSession: (sessionId: string) => string | undefined = (sessionId) => sessionId,
): HarnessReportView[] {
  let sessions = harnessSessions(runsRoot);
  if (filter.session_id) sessions = sessions.filter((id) => id === filter.session_id);
  const out: HarnessReportView[] = [];
  for (const sessionId of sessions) {
    const harnessDir = join(runsRoot, sessionId, "harness");
    let names: string[] = [];
    try { names = readdirSync(harnessDir); } catch { continue; }
    const stepRoles = stepRolesFor(runsRoot, sessionId);
    for (const name of names) {
      const match = /^step-(\d+)-report\.md$/.exec(name);
      if (match === null) continue;
      const step = Number(match[1]);
      try {
        const abs = join(harnessDir, name);
        const markdown = sanitizeLocalPaths(readFileSync(abs, "utf8"));
        const createdAt = statSync(abs).mtime.toISOString();
        const role = stepRoles.get(step) ?? "";
        out.push({
          id: `${sessionId}::harness/${name}`,
          run_id: runIdForSession(sessionId) ?? sessionId,
          session_id: sessionId,
          step,
          agent_role: role,
          title: `步骤 ${step} · ${role || "agent"} 报告`,
          markdown,
          created_at: createdAt,
        });
      } catch { /* ignore */ }
    }
  }
  let views = out;
  if (filter.agent_role) views = views.filter((view) => view.agent_role === filter.agent_role);
  views.sort((left, right) => right.created_at.localeCompare(left.created_at));
  return typeof filter.limit === "number" ? views.slice(0, filter.limit) : views;
}

export function harnessMetrics(runsRoot: string, sessionId: string): HarnessMetricsView | null {
  const path = join(runsRoot, sessionId, "harness", "metrics.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { totals?: Record<string, number>; tool_call_counts?: Record<string, number>; model_modes?: string[] };
    const totals = raw.totals ?? {};
    return {
      token_input: totals.input_tokens ?? 0,
      token_output: totals.output_tokens ?? 0,
      token_cache_read: totals.cache_read_tokens ?? 0,
      token_total: totals.total_tokens ?? 0,
      steps: totals.steps ?? 0,
      duration_ms: totals.duration_ms ?? 0,
      tool_calls: totals.tool_calls ?? 0,
      tool_call_counts: raw.tool_call_counts ?? {},
      events: totals.events ?? 0,
      model_modes: raw.model_modes ?? ["harness"],
      budget_used_cny: 0,
    };
  } catch {
    return null;
  }
}

export function parseArtifactId(id: string): { sessionId: string; relPath: string } | null {
  const idx = id.indexOf("::");
  if (idx <= 0) return null;
  for (const part of [id.slice(0, idx), id.slice(idx + 2)]) if (part.length === 0) return null;
  return { sessionId: id.slice(0, idx), relPath: id.slice(idx + 2) };
}

export function readHarnessArtifact(
  runsRoot: string,
  id: string,
): { ok: boolean; kind: HarnessArtifactKind; content?: string; mime?: string; path?: string; error?: string } {
  const parsed = parseArtifactId(id);
  if (parsed === null) return { ok: false, kind: "other", error: "产物 ID 非法" };
  if (!/^sess-[A-Za-z0-9_-]+$/.test(parsed.sessionId)) return { ok: false, kind: "other", error: "会话 ID 非法" };
  const rel = parsed.relPath.replaceAll("\\", "/");
  const abs = rel.startsWith(parsed.sessionId + "/") ? join(runsRoot, rel) : join(runsRoot, parsed.sessionId, rel);
  if (!inside(runsRoot, abs) || !existsSync(abs)) return { ok: false, kind: "other", error: "产物不存在或不在 runs 目录内" };
  const kind = classifyArtifactKind(parsed.relPath);
  try {
    if (kind === "image") return { ok: true, kind, mime: mimeOfKind(kind), path: abs };
    return { ok: true, kind, mime: mimeOfKind(kind), content: readFileSync(abs, "utf8").slice(0, 512 * 1024), path: abs };
  } catch (error) {
    return { ok: false, kind, error: error instanceof Error ? error.message : String(error) };
  }
}

export function harnessArtifactFilePath(runsRoot: string, id: string): string | null {
  const parsed = parseArtifactId(id);
  if (parsed === null) return null;
  if (!/^sess-[A-Za-z0-9_-]+$/.test(parsed.sessionId)) return null;
  const rel = parsed.relPath.replaceAll("\\", "/");
  const abs = rel.startsWith(parsed.sessionId + "/") ? join(runsRoot, rel) : join(runsRoot, parsed.sessionId, rel);
  return inside(runsRoot, abs) && existsSync(abs) ? abs : null;
}
