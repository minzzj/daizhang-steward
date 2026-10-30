/**
 * v1.5-A「DeepSeek Harness 真实智能体执行器」数据契约。
 *
 * 目标：把每个 agent 换成真实 harness 代理（`dsh --profile headless --json "<task>"`），
 * 让用户看到产物 / 数据 / 报告 / 思考过程：
 * - 实时 NDJSON 事件（session/status/thinking/tool_call/tool_result/text/final/usage/error）；
 * - 工作区隔离 + 前后快照 → 新增/修改产物（sha256/size/kind）；
 * - 自动 `<workspace>/report.md`；超时/abort/不可用 → `ok:false` 不抛异常。
 *
 * 零第三方依赖；Windows 上必须 `process.execPath` + dsh `lib/bin.js` 绝对路径（spawn "dsh" 会 ENOENT）。
 */

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------

export type HarnessEventType =
  | "session"
  | "status"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "text"
  | "usage"
  | "final"
  | "error";

/** 一条 harness 事件（seq 为本执行器解析顺序，从 1 连续递增）。 */
export interface HarnessEvent {
  seq: number;
  at: string;
  type: HarnessEventType;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 产物
// ---------------------------------------------------------------------------

export type HarnessArtifactKind =
  | "html"
  | "markdown"
  | "json"
  | "text"
  | "image"
  | "code"
  | "data"
  | "other";

/** 工作区新增/修改文件（运行前后快照 diff 得到）。 */
export interface HarnessArtifact {
  /** 绝对路径。 */
  path: string;
  /** 相对 workspace_dir（正斜杠）。 */
  rel_path: string;
  kind: HarnessArtifactKind;
  size: number;
  /** 文件内容 sha256（小写 hex）。 */
  sha256: string;
}

// ---------------------------------------------------------------------------
// 运行入参 / 结果
// ---------------------------------------------------------------------------

export interface HarnessUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
}

export interface HarnessToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface HarnessRunInput {
  /** conductor / operator / harness / reviewer / …（用于报告与事件标注）。 */
  role: string;
  /** 任务说明（不含 system prompt）。 */
  task: string;
  /** 专业提示词（会拼在任务前交给 harness）。 */
  system_prompt?: string;
  /** 已存在的隔离工作区（每个 step 一个；不存在 → ok:false）。 */
  workspace_dir: string;
  /** dsh profile，默认 "headless"。 */
  profile?: string;
  /** 超时毫秒，默认 300_000。 */
  timeout_ms?: number;
  /** 单条 tool_result 结果截断字节/字符数，默认 64KB。 */
  max_output_bytes?: number;
  /** 额外环境变量（**不含密钥**；密钥类 key 会被过滤）。 */
  env?: Record<string, string>;
  /** 实时事件回调（SSE/终端流用；每解析一行调用一次）。 */
  on_event?: (event: HarnessEvent) => void;
  /** usage 汇总回调（每次 status/usage 更新后调用）。 */
  on_usage?: (usage: HarnessUsage) => void;
  signal?: AbortSignal;
}

export interface HarnessRunResult {
  ok: boolean;
  error?: string;
  session_id?: string;
  final_text: string;
  events: HarnessEvent[];
  /** thinking 文本按序拼接（数组）。 */
  thinking: string[];
  tool_calls: HarnessToolCall[];
  usage: HarnessUsage;
  artifacts: HarnessArtifact[];
  /** 自动写入的 `<workspace>/report.md` 绝对路径。 */
  report_path?: string;
  duration_ms: number;
  // ---- 附加字段（只增不减；便于证据/控制台展示）----
  role?: string;
  profile?: string;
  workspace_dir?: string;
  exit_code?: number | null;
  signal?: string | null;
  stderr_tail?: string;
  /** 实际执行的命令（不含环境变量/密钥）。 */
  command?: string[];
}

export interface HarnessRunnerOptions {
  /** dsh 的 lib/bin.js 绝对路径（缺省 env STEWARD_DSH_BIN 或 APPDATA 下 npm 全局安装路径）。 */
  dsh_bin?: string;
  /** 默认 profile（默认 "headless"）。 */
  profile?: string;
  /** node 可执行文件（默认 process.execPath；Windows 直接 spawn "dsh" 会 ENOENT）。 */
  node_bin?: string;
  /** 默认超时（毫秒，默认 300_000）。 */
  timeout_ms?: number;
}

export interface HarnessDescribe {
  available: boolean;
  dsh_bin: string;
  profile: string;
  node: string;
  /** dsh bin 不存在时给可执行修复建议。 */
  hint?: string;
}

export interface HarnessAgentPoolOptions {
  runner?: { run(input: HarnessRunInput): Promise<HarnessRunResult> };
  /** 并发数（默认 2，最小 1）。 */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const HARNESS_DEFAULT_PROFILE = "headless";
export const HARNESS_DEFAULT_TIMEOUT_MS = 300_000;
export const HARNESS_DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
export const HARNESS_DEFAULT_POOL_CONCURRENCY = 2;
/** 快照跳过单文件 > 5MB（避免把大二进制纳入产物 diff）。 */
export const HARNESS_SNAPSHOT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** 快照目录跳过：依赖/版本库（不是 agent 产物）。 */
export const HARNESS_SKIP_DIRS: readonly string[] = ["node_modules", ".git", ".hg", ".svn"];

/** 环境变量白名单（只透传运行所需的系统变量；密钥类 env 一律不传）。 */
export const HARNESS_ENV_WHITELIST: readonly string[] = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "HOME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "NODE_ENV",
  "DSH_HOME",
  "DSH_CONFIG_DIR",
  "DSH_PROFILE",
];
