/**
 * HarnessAgentRunner：真实 DeepSeek Harness 执行器（headless NDJSON）。
 *
 * 调用方式（Windows 上必须 node + lib/bin.js 绝对路径；直接 spawn "dsh" 会 ENOENT）：
 *   node <dsh_bin> --profile headless --json "<system_prompt + task>"
 *
 * 行为：
 * - spawn 前递归快照工作区（跳过 node_modules/.git/大文件>5MB），结束后 diff 出新增/修改产物
 *   （sha256/size/kind）；自动写 `<workspace>/report.md` 并列入产物；
 * - stdout 逐行解析 NDJSON → 实时 `on_event`（seq 从 1 连续）、thinking/tool_calls/usage 汇总；
 * - `tool_result` 长输出按 `max_output_bytes` 截断（≤ 上限字节）；
 * - 超时/AbortSignal → kill 子进程并返回 `ok:false`（保留已收集事件/产物）；非 0 退出/不可用/工作区缺失
 *   → `ok:false` + 可读 error（**不抛异常**）；错误信息只含 stderr 尾部，不含环境变量/密钥。
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import {
  artifactForFile,
  diffWorkspaceArtifacts,
  snapshotWorkspace,
  type WorkspaceSnapshot,
} from "./snapshot.js";
import {
  HARNESS_DEFAULT_MAX_OUTPUT_BYTES,
  HARNESS_DEFAULT_PROFILE,
  HARNESS_DEFAULT_TIMEOUT_MS,
  HARNESS_ENV_WHITELIST,
  type HarnessArtifact,
  type HarnessEvent,
  type HarnessEventType,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessRunnerOptions,
  type HarnessToolCall,
  type HarnessUsage,
} from "./types.js";

// ---------------------------------------------------------------------------
// 常量/小工具
// ---------------------------------------------------------------------------

const STDERR_TAIL_MAX = 8 * 1024;
const REPORT_MAX_SECTION_CHARS = 8_000;
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<HarnessEventType>([
  "session",
  "status",
  "thinking",
  "tool_call",
  "tool_result",
  "text",
  "usage",
  "final",
  "error",
]);
const SECRET_ENV_PATTERN = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/iu;
const SAFE_EXTRA_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/** 按 UTF-8 字节数截断，保证输出 ≤ maxBytes（不会切坏多字节字符）。 */
export function truncateBytes(text: string, maxBytes: number): string {
  const value = typeof text === "string" ? text : String(text ?? "");
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return value;
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let output = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    output += char;
    bytes += charBytes;
  }
  return output;
}

function emptyUsage(): HarnessUsage {
  return { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };
}

// ---------------------------------------------------------------------------
// dsh 可执行文件定位
// ---------------------------------------------------------------------------

/** 默认 dsh bin 路径：env STEWARD_DSH_BIN → APPDATA 下 npm 全局安装的 lib/bin.js。 */
export function defaultDshBin(): string {
  const fromEnv = typeof process.env.STEWARD_DSH_BIN === "string" ? process.env.STEWARD_DSH_BIN.trim() : "";
  if (fromEnv.length > 0) return fromEnv;
  const appData =
    typeof process.env.APPDATA === "string" && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA.trim()
      : join(process.env.USERPROFILE ?? process.env.HOME ?? "", "AppData", "Roaming");
  return join(appData, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
}

function isFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 环境变量（白名单；不注入密钥）
// ---------------------------------------------------------------------------

/** 构建子进程环境：系统必需变量白名单 + 调用方额外变量（过滤密钥类 key）。 */
export function buildHarnessEnv(extra?: Record<string, string>): Record<string, string> {
  const whitelist = new Set(HARNESS_ENV_WHITELIST);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (!whitelist.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  if (isRecord(extra)) {
    for (const [key, value] of Object.entries(extra)) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      if (!SAFE_EXTRA_ENV_PATTERN.test(key)) continue;
      if (SECRET_ENV_PATTERN.test(key)) continue;
      env[key] = value;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// NDJSON 解析辅助
// ---------------------------------------------------------------------------

function usageToSnake(raw: unknown): Partial<HarnessUsage> {
  if (!isRecord(raw)) return {};
  const read = (camel: string, snake: string): number | undefined => {
    const value = raw[camel] ?? raw[snake];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  };
  const partial: Partial<HarnessUsage> = {};
  const input = read("inputTokens", "input_tokens");
  const output = read("outputTokens", "output_tokens");
  const cacheRead = read("cacheReadTokens", "cache_read_tokens");
  const total = read("totalTokens", "total_tokens");
  if (input !== undefined) partial.input_tokens = input;
  if (output !== undefined) partial.output_tokens = output;
  if (cacheRead !== undefined) partial.cache_read_tokens = cacheRead;
  if (total !== undefined) partial.total_tokens = total;
  return partial;
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

interface ReportInput {
  input: HarnessRunInput;
  workspaceDir: string;
  ok: boolean;
  error: string | undefined;
  sessionId: string | undefined;
  finalText: string;
  thinking: string[];
  toolCalls: HarnessToolCall[];
  usage: HarnessUsage;
  artifacts: HarnessArtifact[];
  events: HarnessEvent[];
  durationMs: number;
  exitCode: number | null;
  command: string[];
  profile: string;
}

/** 生成并写入 `<workspace>/report.md`（final 文本 + 元数据 + tokens + 工具 + 产物清单）。 */
export function writeHarnessReport(params: ReportInput): string {
  const { input, workspaceDir, ok, error, sessionId, finalText, thinking, toolCalls, usage, artifacts, events, durationMs, exitCode, command, profile } = params;
  const toolCounts = new Map<string, number>();
  for (const call of toolCalls) toolCounts.set(call.tool, (toolCounts.get(call.tool) ?? 0) + 1);
  const eventCounts = new Map<string, number>();
  for (const event of events) eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);

  const lines: string[] = [
    `# ${input.role} · Harness 报告`,
    "",
    `- 生成时间：${nowIso()}`,
    `- 角色：${input.role}`,
    `- profile：${profile}`,
    `- 工作区：${workspaceDir}`,
    `- 任务：${truncateChars(input.task, 500)}`,
    `- 命令：${command.join(" ")}`,
    `- session_id：${sessionId ?? "（未获取）"}`,
    `- 状态：${ok ? "成功" : "失败"}${error === undefined ? "" : `（${truncateChars(error, 300)}）`}`,
    `- 耗时：${durationMs} ms`,
    `- 退出码：${exitCode === null ? "（未知）" : String(exitCode)}`,
    "",
    "## Tokens",
    "",
    `- input：${usage.input_tokens}`,
    `- output：${usage.output_tokens}`,
    `- cache_read：${usage.cache_read_tokens}`,
    `- total：${usage.total_tokens}`,
    "",
    "## 工具调用",
    "",
    ...(toolCalls.length === 0
      ? ["（无工具调用）"]
      : [
          `统计：${[...toolCounts.entries()].map(([tool, count]) => `${tool}×${count}`).join("、")}`,
          "",
          ...toolCalls.slice(0, 40).map((call, index) => `${index + 1}. \`${call.tool}\` — ${truncateChars(JSON.stringify(call.input ?? {}), 240)}`),
        ]),
    "",
    "## 思考过程（节选）",
    "",
    thinking.length === 0 ? "（无 thinking 输出）" : truncateChars(thinking.join("\n\n"), REPORT_MAX_SECTION_CHARS),
    "",
    "## 最终结论",
    "",
    finalText.trim().length === 0 ? "（无 final 文本）" : truncateChars(finalText, REPORT_MAX_SECTION_CHARS),
    "",
    "## 产物清单",
    "",
    ...(artifacts.length === 0
      ? ["（无新增/修改文件）"]
      : [
          "| 相对路径 | kind | 大小(B) | sha256（前 16） |",
          "|---|---|---|---|",
          ...artifacts.map(
            (artifact) => `| ${artifact.rel_path} | ${artifact.kind} | ${artifact.size} | ${artifact.sha256.slice(0, 16)} |`,
          ),
        ]),
    "",
    "## 事件统计",
    "",
    ...(events.length === 0
      ? ["（无事件）"]
      : [`共 ${events.length} 条：${[...eventCounts.entries()].map(([type, count]) => `${type}×${count}`).join("、")}`]),
    "",
    "> 本报告由 `packages/steward-harness-runtime` 在真实 DeepSeek Harness（headless NDJSON）运行后自动生成；",
    "> 不含密钥与环境变量，产物 sha256 可用于证据核对。",
    "",
  ];
  const reportPath = join(workspaceDir, "report.md");
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

// ---------------------------------------------------------------------------
// HarnessAgentRunner
// ---------------------------------------------------------------------------

interface SpawnOutcome {
  exitCode: number | null;
  signal: string | null;
  spawnError: string | undefined;
  timedOut: boolean;
  aborted: boolean;
  stderrTail: string;
}

export class HarnessAgentRunner {
  private readonly dshBin: string;
  private readonly profile: string;
  private readonly nodeBin: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: HarnessRunnerOptions = {}) {
    const input = isRecord(options) ? options : {};
    this.dshBin =
      typeof input.dsh_bin === "string" && input.dsh_bin.trim().length > 0 ? input.dsh_bin.trim() : defaultDshBin();
    this.profile =
      typeof input.profile === "string" && input.profile.trim().length > 0
        ? input.profile.trim()
        : HARNESS_DEFAULT_PROFILE;
    this.nodeBin =
      typeof input.node_bin === "string" && input.node_bin.trim().length > 0 ? input.node_bin.trim() : process.execPath;
    this.defaultTimeoutMs =
      typeof input.timeout_ms === "number" && Number.isFinite(input.timeout_ms) && input.timeout_ms > 0
        ? Math.floor(input.timeout_ms)
        : HARNESS_DEFAULT_TIMEOUT_MS;
  }

  /** dsh bin 是否存在（不存在时 run 返回 ok:false，不抛）。 */
  isAvailable(): boolean {
    return isFile(this.dshBin);
  }

  /** 可执行描述（供控制台/诊断展示；不含环境变量）。 */
  describe(): {
    available: boolean;
    dsh_bin: string;
    profile: string;
    node: string;
    hint?: string;
  } {
    const available = this.isAvailable();
    const base = { available, dsh_bin: this.dshBin, profile: this.profile, node: this.nodeBin };
    return available
      ? base
      : {
          ...base,
          hint: `未找到 DeepSeek Harness：${this.dshBin}。可设置环境变量 STEWARD_DSH_BIN 或构造参数 dsh_bin 指向 dsh 的 lib/bin.js（npm i -g @deepseek-ai/dsh）。`,
        };
  }

  /** 执行一次真实 harness 任务（永不抛异常；失败通过 ok:false + error 表达）。 */
  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const startedAt = Date.now();
    const baseUsage = emptyUsage();
    if (!isRecord(input)) {
      return this.failureResult(input, startedAt, "run 入参必须是对象", undefined, baseUsage);
    }
    const role = typeof input.role === "string" && input.role.trim().length > 0 ? input.role.trim() : "agent";
    const task = typeof input.task === "string" ? input.task.trim() : "";
    if (task.length === 0) {
      return this.failureResult(input, startedAt, "task 不能为空", undefined, baseUsage);
    }
    const workspaceDir = typeof input.workspace_dir === "string" ? input.workspace_dir.trim() : "";
    if (workspaceDir.length === 0 || !existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
      return this.failureResult(
        { ...input, role, task },
        startedAt,
        `工作区不存在或不是目录：${workspaceDir || "（空）"}。每个 step 必须先创建独立工作区。`,
        undefined,
        baseUsage,
      );
    }
    const profile =
      typeof input.profile === "string" && input.profile.trim().length > 0 ? input.profile.trim() : this.profile;
    if (!this.isAvailable()) {
      return this.failureResult(
        { ...input, role, task },
        startedAt,
        `DeepSeek Harness 不可用：未找到 ${this.dshBin}。请设置 STEWARD_DSH_BIN 或构造参数 dsh_bin。`,
        undefined,
        baseUsage,
      );
    }

    const timeoutMs =
      typeof input.timeout_ms === "number" && Number.isFinite(input.timeout_ms) && input.timeout_ms > 0
        ? Math.floor(input.timeout_ms)
        : this.defaultTimeoutMs;
    const maxOutputBytes =
      typeof input.max_output_bytes === "number" && Number.isFinite(input.max_output_bytes) && input.max_output_bytes > 0
        ? Math.floor(input.max_output_bytes)
        : HARNESS_DEFAULT_MAX_OUTPUT_BYTES;

    const before: WorkspaceSnapshot = snapshotWorkspace(workspaceDir);
    const prompt = this.buildPrompt(input.system_prompt, task);
    const command = [this.nodeBin, this.dshBin, "--profile", profile, "--json", prompt];
    const env = buildHarnessEnv(input.env);

    const collected: {
      events: HarnessEvent[];
      thinking: string[];
      toolCalls: HarnessToolCall[];
      finalText: string;
      sessionId: string | undefined;
      usageByStep: Map<string, HarnessUsage>;
      usageEvents: HarnessUsage[];
      streamError: string | undefined;
    } = {
      events: [],
      thinking: [],
      toolCalls: [],
      finalText: "",
      sessionId: undefined,
      usageByStep: new Map(),
      usageEvents: [],
      streamError: undefined,
    };
    let seq = 0;
    const emit = (type: HarnessEventType, data: Record<string, unknown>): HarnessEvent => {
      seq += 1;
      const event: HarnessEvent = { seq, at: nowIso(), type, data };
      collected.events.push(event);
      if (typeof input.on_event === "function") {
        try {
          input.on_event(event);
        } catch {
          /* 订阅方异常不影响执行 */
        }
      }
      return event;
    };

    const currentUsage = (): HarnessUsage => {
      const total = emptyUsage();
      for (const usage of collected.usageByStep.values()) {
        total.input_tokens += usage.input_tokens;
        total.output_tokens += usage.output_tokens;
        total.cache_read_tokens += usage.cache_read_tokens;
        total.total_tokens += usage.total_tokens;
      }
      if (total.total_tokens === 0) total.total_tokens = total.input_tokens + total.output_tokens;
      return total;
    };
    const notifyUsage = (): void => {
      if (typeof input.on_usage !== "function") return;
      try {
        input.on_usage(currentUsage());
      } catch {
        /* 忽略订阅方异常 */
      }
    };
    const recordUsage = (usage: Partial<HarnessUsage>, key: string): void => {
      if (Object.keys(usage).length === 0) return;
      const normalized: HarnessUsage = {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        cache_read_tokens: usage.cache_read_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
      };
      if (normalized.total_tokens === 0) normalized.total_tokens = normalized.input_tokens + normalized.output_tokens;
      collected.usageByStep.set(key, normalized);
      {
        const total = currentUsage();
        const summary = emptyUsage();
        summary.input_tokens = total.input_tokens;
        summary.output_tokens = total.output_tokens;
        summary.cache_read_tokens = total.cache_read_tokens;
        summary.total_tokens = total.total_tokens;
        collected.usageEvents.push(summary);
      }
      notifyUsage();
    };

    const handleLine = (rawLine: string): void => {
      const line = rawLine.replace(/^\uFEFF/u, "").trim();
      if (line.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        emit("error", {
          parse_error: true,
          message: "无法解析 harness NDJSON 行（已跳过，不影响后续事件）",
          raw: truncateBytes(line, Math.min(maxOutputBytes, 2_000)),
        });
        return;
      }
      if (!isRecord(parsed)) {
        emit("error", { parse_error: true, message: "harness NDJSON 行不是对象（已跳过）" });
        return;
      }
      const rawType = typeof parsed.type === "string" ? parsed.type : "";
      const data: Record<string, unknown> = { ...parsed };
      delete data.type;

      if (rawType === "session") {
        const sessionId = parsed.sessionId ?? parsed.session_id;
        if (typeof sessionId === "string" && sessionId.length > 0) collected.sessionId = sessionId;
        emit("session", data);
        return;
      }
      if (rawType === "status") {
        const usage = usageToSnake(parsed.usage);
        const turn = typeof parsed.turn === "number" ? parsed.turn : "-";
        const step = typeof parsed.step === "number" ? parsed.step : "-";
        if (Object.keys(usage).length > 0) recordUsage(usage, `${String(turn)}:${String(step)}`);
        emit("status", data);
        return;
      }
      if (rawType === "usage") {
        const usage = usageToSnake(parsed.usage ?? parsed);
        if (Object.keys(usage).length > 0) recordUsage(usage, `usage-event:${String(seq + 1)}`);
        emit("usage", data);
        return;
      }
      if (rawType === "thinking") {
        const text = typeof parsed.text === "string" ? parsed.text : "";
        if (text.length > 0) collected.thinking.push(text);
        emit("thinking", data);
        return;
      }
      if (rawType === "tool_call") {
        const tool = typeof parsed.tool === "string" && parsed.tool.length > 0 ? parsed.tool : "unknown";
        const callInput = isRecord(parsed.input) ? { ...parsed.input } : {};
        collected.toolCalls.push({ tool, input: callInput });
        emit("tool_call", data);
        return;
      }
      if (rawType === "tool_result") {
        const rawResult = parsed.result;
        const text =
          typeof rawResult === "string"
            ? rawResult
            : rawResult === undefined
              ? ""
              : JSON.stringify(rawResult);
        const truncated = truncateBytes(text, maxOutputBytes);
        data.result = truncated;
        if (truncated.length !== text.length) {
          data.truncated = true;
          data.original_chars = Array.from(text).length;
        }
        emit("tool_result", data);
        return;
      }
      if (rawType === "text") {
        if (typeof parsed.text === "string" && parsed.text.length > 0) emit("text", data);
        else emit("text", data);
        return;
      }
      if (rawType === "final") {
        const text = typeof parsed.text === "string" ? parsed.text : "";
        if (text.length > 0) collected.finalText = text;
        emit("final", data);
        return;
      }
      if (rawType === "error") {
        const message =
          typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.error === "string"
              ? parsed.error
              : typeof parsed.text === "string"
                ? parsed.text
                : "harness 报告错误";
        collected.streamError = truncateBytes(message, 2_000);
        emit("error", data);
        return;
      }
      // 未知事件类型：保留为 error（不阻断执行），原文截断
      emit("error", {
        unrecognized_type: rawType || "（缺失 type）",
        message: `遇到未识别的 harness 事件类型：${rawType || "（缺失）"}`,
        raw: truncateBytes(line, Math.min(maxOutputBytes, 2_000)),
      });
    };

    const spawnResult = await this.spawnHarness({
      command,
      env,
      cwd: workspaceDir,
      timeoutMs,
      signal: input.signal,
      onStdoutLine: handleLine,
      maxStderrBytes: STDERR_TAIL_MAX,
    });

    const durationMs = Date.now() - startedAt;
    const after = snapshotWorkspace(workspaceDir);
    const artifacts = diffWorkspaceArtifacts(workspaceDir, before, after);
    const usage = currentUsage();

    const hasFinal = collected.finalText.trim().length > 0;
    const ok =
      spawnResult.spawnError === undefined &&
      !spawnResult.timedOut &&
      !spawnResult.aborted &&
      spawnResult.exitCode === 0 &&
      hasFinal;

    let error: string | undefined;
    if (spawnResult.spawnError !== undefined) {
      error = `无法启动 DeepSeek Harness：${spawnResult.spawnError}`;
    } else if (spawnResult.timedOut) {
      error = `DeepSeek Harness 执行超时（${timeoutMs}ms），子进程已终止`;
    } else if (spawnResult.aborted) {
      error = "DeepSeek Harness 执行被 AbortSignal 中断，子进程已终止";
    } else if (spawnResult.exitCode !== 0) {
      error = `DeepSeek Harness 退出码 ${spawnResult.exitCode ?? "未知"}${spawnResult.stderrTail.length > 0 ? `：${truncateChars(spawnResult.stderrTail, 600)}` : ""}`;
    } else if (collected.streamError !== undefined && !hasFinal) {
      error = `DeepSeek Harness 报错且未产出 final：${collected.streamError}`;
    } else if (!hasFinal) {
      error = "DeepSeek Harness 结束但未收到 final/text 输出";
    }

    // 自动报告（即使失败也写，保留现场；report.md 本身计入产物）
    let reportPath: string | undefined;
    try {
      reportPath = writeHarnessReport({
        input: { ...input, role, task, workspace_dir: workspaceDir },
        workspaceDir,
        ok,
        error,
        sessionId: collected.sessionId,
        finalText: collected.finalText,
        thinking: collected.thinking,
        toolCalls: collected.toolCalls,
        usage,
        artifacts,
        events: collected.events,
        durationMs,
        exitCode: spawnResult.exitCode,
        command,
        profile,
      });
      const reportArtifact = artifactForFile(workspaceDir, reportPath);
      if (reportArtifact !== null) {
        artifacts.push(reportArtifact);
        artifacts.sort((left, right) => left.rel_path.localeCompare(right.rel_path));
      }
    } catch {
      reportPath = undefined;
    }

    const result: HarnessRunResult = {
      ok,
      final_text: collected.finalText,
      events: collected.events,
      thinking: collected.thinking,
      tool_calls: collected.toolCalls,
      usage,
      artifacts,
      duration_ms: durationMs,
      role,
      profile,
      workspace_dir: workspaceDir,
      exit_code: spawnResult.exitCode,
      signal: spawnResult.signal,
      stderr_tail: spawnResult.stderrTail,
      command,
    };
    if (error !== undefined) result.error = error;
    if (collected.sessionId !== undefined) result.session_id = collected.sessionId;
    if (reportPath !== undefined) result.report_path = reportPath;
    return result;
  }

  private buildPrompt(systemPrompt: unknown, task: string): string {
    const system = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
    if (system.length === 0) return task;
    return `${system}\n\n---\n\n${task}`;
  }

  private failureResult(
    input: Partial<HarnessRunInput> | undefined,
    startedAt: number,
    error: string,
    reportPath: string | undefined,
    usage: HarnessUsage,
  ): HarnessRunResult {
    const workspaceDir = typeof input?.workspace_dir === "string" ? input.workspace_dir : "";
    const result: HarnessRunResult = {
      ok: false,
      error,
      final_text: "",
      events: [],
      thinking: [],
      tool_calls: [],
      usage: { ...usage },
      artifacts: [],
      duration_ms: Date.now() - startedAt,
      role: typeof input?.role === "string" ? input.role : "agent",
      profile: typeof input?.profile === "string" ? input.profile : this.profile,
      workspace_dir: workspaceDir,
      exit_code: null,
      signal: null,
      stderr_tail: "",
      command: [this.nodeBin, this.dshBin, "--profile", this.profile, "--json", "<task>"],
    };
    if (reportPath !== undefined) result.report_path = reportPath;
    return result;
  }

  /** spawn 子进程、逐行回调 stdout、收集 stderr 尾部；超时/abort 时终止子进程。 */
  private spawnHarness(options: {
    command: string[];
    env: Record<string, string>;
    cwd: string;
    timeoutMs: number;
    signal: AbortSignal | undefined;
    onStdoutLine: (line: string) => void;
    maxStderrBytes: number;
  }): Promise<SpawnOutcome> {
    return new Promise<SpawnOutcome>((resolve) => {
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(options.command[0] ?? process.execPath, options.command.slice(1), {
          cwd: options.cwd,
          env: options.env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: false,
        });
      } catch (error) {
        resolve({
          exitCode: null,
          signal: null,
          spawnError: error instanceof Error ? error.message : String(error),
          timedOut: false,
          aborted: false,
          stderrTail: "",
        });
        return;
      }

      let timedOut = false;
      let aborted = false;
      let finished = false;
      let killTimer: NodeJS.Timeout | undefined;
      let stderr = "";
      let stderrBytes = 0;
      let stderrTail = "";
      const decoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let stdoutBuffer = "";
      const appendStderr = (text: string): void => {
        stderr += text;
        stderrBytes += Buffer.byteLength(text, "utf8");
        if (stderrBytes > options.maxStderrBytes * 2) {
          stderr = truncateChars(stderr, 4_000);
          stderrBytes = Buffer.byteLength(stderr, "utf8");
        }
        stderrTail = truncateBytes(stderr, options.maxStderrBytes);
      };

      const terminate = (): void => {
        if (finished) return;
        try {
          child.kill("SIGTERM");
        } catch {
          /* 忽略 */
        }
        // 宽限 500ms 后强杀（不 unref：确保测试/进程等待期间定时器有效；close 后会清理）
        killTimer = setTimeout(() => {
          if (finished) return;
          try {
            child.kill("SIGKILL");
          } catch {
            /* 忽略 */
          }
        }, 500);
      };

      const finish = (outcome: SpawnOutcome): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (options.signal !== undefined) options.signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
      const onAbort = (): void => {
        aborted = true;
        terminate();
      };
      if (options.signal !== undefined) {
        if (options.signal.aborted) {
          aborted = true;
          terminate();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      const processStdout = (chunk: string): void => {
        stdoutBuffer += chunk;
        let index = stdoutBuffer.indexOf("\n");
        while (index >= 0) {
          const line = stdoutBuffer.slice(0, index);
          stdoutBuffer = stdoutBuffer.slice(index + 1);
          try {
            options.onStdoutLine(line);
          } catch {
            /* 单行解析异常不影响整体 */
          }
          index = stdoutBuffer.indexOf("\n");
        }
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        processStdout(typeof chunk === "string" ? chunk : decoder.write(chunk));
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        appendStderr(typeof chunk === "string" ? chunk : stderrDecoder.write(chunk));
      });
      child.on("error", (error) => {
        finish({
          exitCode: null,
          signal: null,
          spawnError: error.message,
          timedOut,
          aborted,
          stderrTail,
        });
      });
      child.on("close", (code, signal) => {
        const remaining = `${decoder.end()}${stdoutBuffer}`;
        if (remaining.trim().length > 0) {
          try {
            options.onStdoutLine(remaining);
          } catch {
            /* 忽略 */
          }
        }
        appendStderr(stderrDecoder.end());
        finish({
          exitCode: typeof code === "number" ? code : null,
          signal: signal === null ? null : String(signal),
          spawnError: undefined,
          timedOut,
          aborted,
          stderrTail,
        });
      });
    });
  }
}

export type HarnessRunner = Pick<HarnessAgentRunner, "run">;
export { isRecord };
