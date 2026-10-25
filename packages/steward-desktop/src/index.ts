/**
 * 代掌 Steward · Windows 桌面适配器（真实 Windows 桌面）
 *
 * 铁律（docs/zh-CN/adapters.md）：桌面 UI 验收必须在**真实 Windows 桌面会话**里用
 * 真实键鼠完成，禁止 mock 窗口 / 直接调用被测程序内部函数代替；每一步都要有截图证据。
 * 适配器本身**不做任何风控/凭据绕过**：检测到凭据/安全提示窗口一律停止并交人。
 *
 * 架构（两层，零第三方依赖）：
 * - `WindowsDesktop`（本文件，TypeScript）：白名单、失败分类、每步截图证据、步骤账本；
 * - `scripts/desktop_sidecar.py`（Python 标准库 + ctypes，JSON Lines 协议的长驻侧车）：
 *   EnumWindows/GetWindowRect 窗口枚举、SetForegroundWindow 聚焦、BitBlt 真实截图 + 自写
 *   PNG 编码、SendInput 真实鼠标、SendInput + KEYEVENTF_UNICODE 真实键盘（中文可用）。
 *
 * 设计约定：
 * - 一个 `WindowsDesktop` 实例 = 一次 run：`start()` 拉起侧车，`close()` 结束；
 * - 每一步（含失败）自动留证：截图 `evidenceDir/screenshots/<序号>-<动作>.png`，
 *   步骤汇总写 `evidenceDir/steps.json`，侧车诊断写 `evidenceDir/sidecar.log`；
 * - 白名单：构造时传 `allowedWindows`（标题子串，默认「代掌演示表单」「记事本」「Notepad」），
 *   聚焦/点击/输入/窗口截图等**操作类**动作命中非白名单窗口时抛 `DesktopAllowlistError`，
 *   默认拒绝；只读查询（listWindows/waitForWindow）不触发白名单；
 * - 失败分类：window-not-found / focus-lost / timeout / allowlist-denied / unknown；
 * - 输入注入前双重校验：适配器检查前台窗口属于白名单且仍是本次目标窗口，侧车再校验
 *   `focusGuardHwnd`，避免键鼠事件打进其他窗口；
 * - 凭据输入一律交人：`assertNoCredentialPrompt()` 在前台窗口标题命中凭据/安全关键词时
 *   抛 `DesktopCredentialPromptError`（不尝试任何绕过）；密码框本身无法可靠识别（见 README）。
 * - 证据路径一律为绝对路径（与 steward-core 的 ArtifactBus 约定一致）。
 */

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RiskLevel, ToolSpec } from "../../steward-core/src/index.js";

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

/** 失败分类（与 README 的「失败边界」一节一一对应）。 */
export type DesktopFailureKind =
  | "window-not-found"
  | "focus-lost"
  | "timeout"
  | "allowlist-denied"
  | "unknown";

/** 屏幕/窗口矩形（物理像素，左上角原点）。 */
export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopPoint {
  x: number;
  y: number;
}

/** 一个真实顶层窗口的完整快照。 */
export interface DesktopWindowInfo {
  /** Win32 顶层窗口句柄（十进制）。 */
  hwnd: number;
  title: string;
  pid: number;
  processName: string;
  className: string;
  /** GetWindowRect：含 Win10/11 不可见 resize 边框。 */
  rect: DesktopRect;
  /** DWM 可见边框（截图/点击换算优先用它）；拿不到时为 null。 */
  extendedFrame: DesktopRect | null;
  /** 客户区尺寸（宽高）。 */
  clientRect: DesktopRect;
  /** 客户区左上角在屏幕上的物理像素坐标。 */
  clientOrigin: DesktopPoint;
  minimized: boolean;
  visible: boolean;
  /** 是否为系统当前前台窗口。 */
  foreground: boolean;
  /** 与 foreground 同义，保留字段便于阅读。 */
  focused: boolean;
  /** 窗口 DPI（96 = 100%）。 */
  dpi: number;
}

export interface DesktopScreenInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 启动信息（`start()` 返回，也写入 steps.json）。 */
export interface DesktopStartInfo {
  sidecarVersion: string;
  pythonVersion: string;
  pythonExecutable: string;
  sidecarPid: number;
  dpiAwareness: string;
  screen: DesktopScreenInfo;
  evidenceDir: string;
  screenshotsDir: string;
  allowedWindows: string[];
  startedAt: string;
}

/** 结构化步骤结果（字段只增不减）。 */
export interface DesktopStepResult {
  stepIndex: number;
  action: string;
  ok: boolean;
  /** 证据文件绝对路径（截图/日志）。 */
  evidence: string[];
  durationMs: number;
  error?: string;
  failureKind?: DesktopFailureKind;
  /** 读取类动作的结果值（如 getWindowTitle 的标题）。 */
  value?: string;
  /** 动作结构化数据（坐标、窗口信息、JSON 路径等）。 */
  data?: Record<string, unknown>;
}

/** 内部 `recordStep()` 输入。 */
interface DesktopStepInput {
  action: string;
  ok: boolean;
  evidence?: readonly string[];
  error?: string;
  failureKind?: DesktopFailureKind;
  value?: string;
  durationMs?: number;
}

/** 凭据/安全提示窗口命中项。 */
export interface CredentialPromptMatch {
  hwnd: number;
  title: string;
  pid: number;
  processName: string;
  /** 命中的关键词。 */
  keyword: string;
}

export interface DesktopOptions {
  /** 证据目录：截图、steps.json、sidecar.log 都写到这里。缺省不落盘（仅内存步骤账本）。 */
  evidenceDir?: string;
  /** 允许操作的窗口标题子串（大小写不敏感）。默认 `DEFAULT_ALLOWED_WINDOWS`；传 `[]` 表示拒绝一切操作。 */
  allowedWindows?: readonly string[];
  /** Python 解释器；默认 `process.env.STEWARD_PYTHON ?? "python"`。 */
  pythonCommand?: string;
  /** 侧车脚本路径；缺省自动在仓库内查找 `packages/steward-desktop/scripts/desktop_sidecar.py`。 */
  sidecarScript?: string;
  /** 单次侧车调用超时，默认 15000ms。 */
  requestTimeoutMs?: number;
  /** 逐字符键入间隔，默认 8ms（真实键盘事件，间隔太小个别程序可能丢字）。 */
  typingIntervalMs?: number;
  /** 凭据扫描是否检查所有可见窗口（默认 false：只检查前台窗口，避免误伤后台标题）。 */
  scanAllVisibleWindows?: boolean;
}

export interface DesktopCloseInfo {
  /** 启动过侧车并成功关闭。 */
  closed: boolean;
  sidecarExitCode: number | null;
  sidecarSignal: string | null;
  steps: number;
  screenshots: number;
  evidence: string[];
}

export interface PowerShellResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// 默认值 / 工具函数
// ---------------------------------------------------------------------------

/** 默认白名单：只允许操作演示表单与记事本（标题子串、大小写不敏感）。 */
export const DEFAULT_ALLOWED_WINDOWS: readonly string[] = ["代掌演示表单", "记事本", "Notepad"];

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_TYPING_INTERVAL_MS = 8;
export const SIDECAR_PROTOCOL_VERSION = "0.1.0";

/** 凭据/安全提示关键词：命中即停止交人（不做任何绕过）。 */
export const CREDENTIAL_KEYWORDS: readonly string[] = [
  "密码",
  "凭据",
  "登录信息",
  "用户账户控制",
  "安全中心",
  "验证码",
  "人脸识别",
  "指纹",
  "windows security",
  "password",
  "credential",
  "uac",
  "sign in",
];

/** 适配器通用错误（带失败分类）。 */
export class DesktopAdapterError extends Error {
  readonly kind: DesktopFailureKind;
  readonly details: unknown;

  constructor(kind: DesktopFailureKind, message: string, details?: unknown) {
    super(message);
    this.name = "DesktopAdapterError";
    this.kind = kind;
    if (details !== undefined) this.details = details;
  }
}

/** 白名单拒绝：对非白名单窗口执行操作时抛出（默认拒绝）。 */
export class DesktopAllowlistError extends DesktopAdapterError {
  readonly windowTitle: string;
  readonly allowedWindows: readonly string[];

  constructor(windowTitle: string, allowedWindows: readonly string[]) {
    super(
      "allowlist-denied",
      `窗口不在白名单内，已拒绝操作：「${windowTitle}」。允许的窗口标题子串：${
        allowedWindows.length === 0 ? "（空 = 拒绝一切操作）" : allowedWindows.join("、")
      }`,
      { windowTitle, allowedWindows: [...allowedWindows] },
    );
    this.name = "DesktopAllowlistError";
    this.windowTitle = windowTitle;
    this.allowedWindows = allowedWindows;
  }
}

/** 检测到凭据/安全提示：立即停止并交人（凭据输入一律由人完成）。 */
export class DesktopCredentialPromptError extends Error {
  readonly matches: CredentialPromptMatch[];

  constructor(matches: CredentialPromptMatch[]) {
    super(
      `检测到凭据/安全提示窗口，已停止并交人处理（适配器不参与任何凭据输入）：${matches
        .map((match) => `「${match.title}」命中关键词“${match.keyword}”`)
        .join("；")}`,
    );
    this.name = "DesktopCredentialPromptError";
    this.matches = matches;
  }
}

export function formatDesktopError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 把任意错误归类为失败分类（供上层日志/报告与测试断言）。 */
export function classifyDesktopFailure(error: unknown): DesktopFailureKind {
  if (error instanceof DesktopAdapterError) return error.kind;
  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRect(value: unknown): DesktopRect {
  const record = asRecord(value);
  return {
    x: asNumber(record.x),
    y: asNumber(record.y),
    width: asNumber(record.width),
    height: asNumber(record.height),
  };
}

function asPoint(value: unknown): DesktopPoint {
  const record = asRecord(value);
  return { x: asNumber(record.x), y: asNumber(record.y) };
}

function asWindowInfo(value: unknown): DesktopWindowInfo | null {
  const record = asRecord(value);
  if (typeof record.hwnd !== "number" || typeof record.title !== "string") return null;
  return {
    hwnd: record.hwnd,
    title: record.title,
    pid: asNumber(record.pid),
    processName: asString(record.processName),
    className: asString(record.className),
    rect: asRect(record.rect),
    extendedFrame: record.extendedFrame === null || record.extendedFrame === undefined ? null : asRect(record.extendedFrame),
    clientRect: asRect(record.clientRect),
    clientOrigin: asPoint(record.clientOrigin),
    minimized: record.minimized === true,
    visible: record.visible === true,
    foreground: record.foreground === true,
    focused: record.focused === true,
    dpi: asNumber(record.dpi, 96),
  };
}

function asWindowInfoList(value: unknown): DesktopWindowInfo[] {
  if (!Array.isArray(value)) return [];
  const list: DesktopWindowInfo[] = [];
  for (const item of value) {
    const window = asWindowInfo(item);
    if (window !== null) list.push(window);
  }
  return list;
}

/** 文件名清洗：只保留字母数字与 `._-`，其余替换为 `-`（证据文件名安全）。 */
function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "step" : cleaned.slice(0, 80);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * 解析桌面侧车脚本路径。
 *
 * 兼容两种运行位置：仓库源码树（packages/steward-desktop/src/*.ts 由工具链直接引用）
 * 与构建产物（dist/packages/steward-desktop/src/*.js）——都从当前文件目录逐级向上查找。
 */
export function findDesktopSidecarScript(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== "") {
    const path = resolve(explicit);
    if (!existsSync(path)) {
      throw new DesktopAdapterError("unknown", `指定的桌面侧车脚本不存在：${path}`);
    }
    return path;
  }
  const fromEnv = process.env.STEWARD_DESKTOP_SIDECAR;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    const path = resolve(fromEnv);
    if (!existsSync(path)) {
      throw new DesktopAdapterError("unknown", `环境变量 STEWARD_DESKTOP_SIDECAR 指向的侧车脚本不存在：${path}`);
    }
    return path;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  let current = here;
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(join(current, "packages", "steward-desktop", "scripts", "desktop_sidecar.py"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push(resolve(here, "..", "scripts", "desktop_sidecar.py"));
  candidates.push(resolve(here, "..", "..", "scripts", "desktop_sidecar.py"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new DesktopAdapterError(
    "unknown",
    `找不到桌面侧车脚本 desktop_sidecar.py（已尝试：${candidates.join(" | ")}）。` +
      "请用 sidecarScript 参数或 STEWARD_DESKTOP_SIDECAR 环境变量指定。",
  );
}

// ---------------------------------------------------------------------------
// Python 侧车客户端（JSON Lines over stdin/stdout）
// ---------------------------------------------------------------------------

interface PendingRequest {
  op: string;
  timer: NodeJS.Timeout;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

interface SidecarClientOptions {
  pythonCommand: string;
  scriptPath: string;
  requestTimeoutMs: number;
  onStderrLine: (line: string) => void;
}

interface SidecarStopInfo {
  exitCode: number | null;
  signal: string | null;
  requests: number;
  errors: number;
  stderrTail: string[];
}

/** 把侧车返回的错误结构映射为带失败分类的适配器错误。 */
function mapSidecarError(op: string, error: unknown): DesktopAdapterError {
  const record = asRecord(error);
  const kind = asString(record.kind, "unknown");
  const message = asString(record.message, "桌面侧车返回未知错误");
  const mapped: DesktopFailureKind =
    kind === "window-not-found" || kind === "focus-lost" || kind === "timeout" ? kind : "unknown";
  return new DesktopAdapterError(mapped, `[${op}] ${message}`, record.details);
}

class DesktopSidecarClient {
  private readonly options: SidecarClientOptions;
  private child: ChildProcess | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private requestCount = 0;
  private errorCount = 0;
  private stderrTail: string[] = [];
  private exitDescription = "";
  private exited = false;

  constructor(options: SidecarClientOptions) {
    this.options = options;
  }

  /** 启动侧车并完成 ping 握手；失败时抛出带诊断信息的适配器错误。 */
  async start(): Promise<Record<string, unknown>> {
    if (this.child !== null) {
      throw new DesktopAdapterError("unknown", "桌面侧车已启动：一个 WindowsDesktop 实例只对应一次 run");
    }
    const child = spawn(this.options.pythonCommand, ["-u", this.options.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      this.handleStderr(chunk);
    });
    child.on("error", (error) => {
      this.failAll(
        new DesktopAdapterError(
          "unknown",
          `桌面侧车进程启动失败：${error.message}。请确认本机 Python 3.8+ 可用（` +
            `当前命令：${this.options.pythonCommand}；可用 pythonCommand 参数或 STEWARD_PYTHON 环境变量指定解释器）。`,
        ),
      );
    });
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitDescription = `code=${String(code)} signal=${String(signal)}`;
      this.failAll(
        new DesktopAdapterError(
          "unknown",
          `桌面侧车已退出（${this.exitDescription}）。stderr 尾部：${this.stderrTail.slice(-8).join(" | ")}`,
        ),
      );
    });
    const ping = await this.request("ping", {}, 12_000);
    return asRecord(ping);
  }

  async request(op: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const child = this.child;
    if (child === null || this.exited) {
      throw new DesktopAdapterError("unknown", `桌面侧车未运行：${this.exitDescription || "尚未启动"}`);
    }
    const effectiveTimeout = timeoutMs ?? this.options.requestTimeoutMs;
    const id = this.nextId;
    this.nextId += 1;
    this.requestCount += 1;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.errorCount += 1;
        const timeoutError = new DesktopAdapterError(
          "timeout",
          `桌面侧车调用超时（${effectiveTimeout}ms）：op=${op}`,
        );
        rejectPromise(timeoutError);
        // 超时说明侧车可能卡死：结束进程，避免污染后续步骤
        void this.stop();
      }, effectiveTimeout);
      this.pending.set(id, { op, timer, resolve: resolvePromise, reject: rejectPromise });
      try {
        child.stdin?.write(JSON.stringify({ id, op, params }) + "\n");
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(new DesktopAdapterError("unknown", `向桌面侧车写入请求失败：${formatDesktopError(error)}`));
      }
    });
  }

  async stop(): Promise<SidecarStopInfo> {
    const child = this.child;
    this.child = null;
    if (child === null) {
      return {
        exitCode: null,
        signal: null,
        requests: this.requestCount,
        errors: this.errorCount,
        stderrTail: [...this.stderrTail],
      };
    }
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolvePromise) => {
      child.once("exit", (code, signal) => {
        resolvePromise({ code, signal });
      });
    });
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 进程可能已退出
      }
    }, 2500);
    this.failAll(new DesktopAdapterError("unknown", "桌面侧车已关闭"));
    try {
      child.stdin?.end();
    } catch {
      // stdin 可能已关闭
    }
    const exitInfo = await exitPromise;
    clearTimeout(killTimer);
    this.exited = true;
    return {
      exitCode: exitInfo.code,
      signal: exitInfo.signal,
      requests: this.requestCount,
      errors: this.errorCount,
      stderrTail: [...this.stderrTail],
    };
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf("\n");
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line !== "") this.handleResponseLine(line);
      index = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleResponseLine(line: string): void {
    let response: Record<string, unknown>;
    try {
      response = asRecord(JSON.parse(line));
    } catch {
      // 协议行解析失败只记录诊断，不中断（stdout 只用于协议，出现杂行说明侧车异常）
      this.options.onStderrLine(`[protocol] 无法解析侧车输出：${line.slice(0, 300)}`);
      return;
    }
    const id = asNumber(response.id, -1);
    const pending = this.pending.get(id);
    if (pending === undefined) {
      this.options.onStderrLine(`[protocol] 收到未知请求 id 的响应：${line.slice(0, 300)}`);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (response.ok === true) {
      pending.resolve(response.data);
      return;
    }
    this.errorCount += 1;
    pending.reject(mapSidecarError(pending.op, response.error));
  }

  private handleStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    let index = this.stderrBuffer.indexOf("\n");
    while (index >= 0) {
      const line = this.stderrBuffer.slice(0, index).trimEnd();
      this.stderrBuffer = this.stderrBuffer.slice(index + 1);
      if (line !== "") {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 200) this.stderrTail.shift();
        this.options.onStderrLine(line);
      }
      index = this.stderrBuffer.indexOf("\n");
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// WindowsDesktop：真实 Windows 桌面适配器
// ---------------------------------------------------------------------------

/** 一次动作任务的结果（供 executeStep 汇总）。 */
interface StepOutcome {
  value?: string;
  data?: Record<string, unknown>;
}

interface ExecuteStepOptions {
  /** 是否动作后自动截图留证（默认 true）。 */
  autoCapture?: boolean;
  /** 执行前记录的结果值。 */
  value?: string;
}

export class WindowsDesktop {
  private readonly options: DesktopOptions;
  private readonly allowedWindows: readonly string[];
  private readonly requestTimeoutMs: number;
  private readonly typingIntervalMs: number;
  private readonly scanAllVisibleWindows: boolean;
  private client: DesktopSidecarClient | null = null;
  private evidenceDirPath = "";
  private screenshotsDir = "";
  private stepsPath = "";
  private sidecarLogPath = "";
  private startInfo: DesktopStartInfo | null = null;
  private activeWindow: DesktopWindowInfo | null = null;
  private stepList: DesktopStepResult[] = [];
  private stepSeq = 0;
  private evidenceSeq = 0;
  private pendingSidecarLines: string[] = [];
  private runId: string;

  constructor(options: DesktopOptions = {}) {
    this.options = options;
    this.allowedWindows = options.allowedWindows ?? DEFAULT_ALLOWED_WINDOWS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.typingIntervalMs = options.typingIntervalMs ?? DEFAULT_TYPING_INTERVAL_MS;
    this.scanAllVisibleWindows = options.scanAllVisibleWindows ?? false;
    this.runId = `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---- 生命周期 -----------------------------------------------------------

  /**
   * 启动真实桌面侧车（Python 侧车 + ctypes Win32 调用）。
   * 仅 Windows 支持；Linux/macOS 请见 README「跨平台替代路径」。
   */
  async start(): Promise<DesktopStartInfo> {
    if (this.client !== null) {
      throw new DesktopAdapterError("unknown", "桌面适配器已启动：一个 WindowsDesktop 实例只对应一次 run，请先 close()");
    }
    if (process.platform !== "win32") {
      throw new DesktopAdapterError(
        "unknown",
        `桌面适配器仅支持 Windows（当前平台：${process.platform}）。` +
          "Linux 可改用 xdotool + ImageMagick(import)，macOS 可改用 cliclick + screencapture；本项目阶段的真实桌面验收只在 Windows 本机执行。",
      );
    }
    const evidenceDir = this.options.evidenceDir;
    if (evidenceDir !== undefined && evidenceDir.trim() !== "") {
      this.evidenceDirPath = resolve(evidenceDir);
      this.screenshotsDir = join(this.evidenceDirPath, "screenshots");
      this.stepsPath = join(this.evidenceDirPath, "steps.json");
      this.sidecarLogPath = join(this.evidenceDirPath, "sidecar.log");
      await mkdir(this.screenshotsDir, { recursive: true });
    }

    const pythonCommand = this.options.pythonCommand ?? process.env.STEWARD_PYTHON ?? "python";
    const scriptPath = findDesktopSidecarScript(this.options.sidecarScript);
    const client = new DesktopSidecarClient({
      pythonCommand,
      scriptPath,
      requestTimeoutMs: this.requestTimeoutMs,
      onStderrLine: (line) => {
        this.pendingSidecarLines.push(line);
      },
    });
    const ping = await client.start();
    const screenRecord = asRecord(ping.screen);
    const startInfo: DesktopStartInfo = {
      sidecarVersion: asString(ping.version, "unknown"),
      pythonVersion: asString(ping.python, "unknown"),
      pythonExecutable: asString(ping.pythonExecutable, pythonCommand),
      sidecarPid: asNumber(ping.pid),
      dpiAwareness: asString(ping.dpiAwareness, "unknown"),
      screen: {
        x: asNumber(screenRecord.x),
        y: asNumber(screenRecord.y),
        width: asNumber(screenRecord.width),
        height: asNumber(screenRecord.height),
      },
      evidenceDir: this.evidenceDirPath,
      screenshotsDir: this.screenshotsDir,
      allowedWindows: [...this.allowedWindows],
      startedAt: new Date().toISOString(),
    };
    this.client = client;
    this.startInfo = startInfo;
    this.pendingSidecarLines.push(
      `[start] python=${startInfo.pythonVersion} (${startInfo.pythonExecutable}) sidecarPid=${startInfo.sidecarPid} ` +
        `dpi=${startInfo.dpiAwareness} screen=${startInfo.screen.width}x${startInfo.screen.height} ` +
        `allowed=${startInfo.allowedWindows.join("、")}`,
    );
    await this.flushEvidenceFiles();
    return startInfo;
  }

  /** 关闭侧车并落盘证据（steps.json / sidecar.log）；不抛错（尽力清理）。 */
  async close(): Promise<DesktopCloseInfo> {
    const client = this.client;
    this.client = null;
    let exitCode: number | null = null;
    let signal: string | null = null;
    if (client !== null) {
      const stopInfo = await client.stop();
      exitCode = stopInfo.exitCode;
      signal = stopInfo.signal;
      this.pendingSidecarLines.push(
        `[close] sidecarExit code=${String(exitCode)} signal=${String(signal)} requests=${stopInfo.requests} errors=${stopInfo.errors}`,
      );
    }
    this.activeWindow = null;
    await this.flushEvidenceFiles();
    if (this.stepsPath !== "") {
      try {
        await writeFile(this.stepsPath, this.buildStepsPayload(), "utf8");
      } catch {
        // 证据落盘失败不阻断关闭
      }
    }
    const screenshots = this.stepList.reduce(
      (total, step) => total + step.evidence.filter((file) => file.endsWith(".png")).length,
      0,
    );
    return {
      closed: client !== null,
      sidecarExitCode: exitCode,
      sidecarSignal: signal,
      steps: this.stepList.length,
      screenshots,
      evidence: this.evidenceDirPath === "" ? [] : [this.stepsPath, this.sidecarLogPath].filter((item) => item !== ""),
    };
  }

  /** 本次 run 的全部步骤（含证据路径）。 */
  get steps(): DesktopStepResult[] {
    return [...this.stepList];
  }

  /** 启动信息（未启动时为 null）。 */
  get info(): DesktopStartInfo | null {
    return this.startInfo;
  }

  /** 证据目录（未配置时为空串）。 */
  get evidenceDir(): string {
    return this.evidenceDirPath;
  }

  /** 截图目录（未配置时为空串）。 */
  get screenshotsDirPath(): string {
    return this.screenshotsDir;
  }

  // ---- 只读观察 -----------------------------------------------------------

  /** 枚举真实顶层窗口（可见、有标题；默认按前台/面积排序）。只读，不做白名单校验。 */
  async listWindows(filter: { titleContains?: string; visibleOnly?: boolean } = {}): Promise<DesktopWindowInfo[]> {
    const client = this.requireClient();
    const params: Record<string, unknown> = { visibleOnly: filter.visibleOnly ?? true };
    if (filter.titleContains !== undefined) params.titleContains = filter.titleContains;
    const data = await client.request("listWindows", params);
    return asWindowInfoList(data);
  }

  /** 按标题子串查找一个真实窗口（找不到抛 `window-not-found`）。只读，不做白名单校验。 */
  async getWindow(titleSubstring: string): Promise<DesktopWindowInfo> {
    const client = this.requireClient();
    const data = await client.request("findWindow", { titleContains: titleSubstring });
    const window = asWindowInfo(data);
    if (window === null) {
      throw new DesktopAdapterError("window-not-found", `找不到标题包含「${titleSubstring}」的窗口`);
    }
    return window;
  }

  /** 轮询等待窗口出现（默认 20s）；只读，不做白名单校验。 */
  async waitForWindow(titleSubstring: string, options: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<DesktopWindowInfo> {
    const timeoutMs = options.timeoutMs ?? 20_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    this.requireClient();
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    let lastTitles: string[] = [];
    while (Date.now() < deadline) {
      try {
        return await this.getWindow(titleSubstring);
      } catch (error) {
        if (classifyDesktopFailure(error) !== "window-not-found") throw error;
        lastError = error;
        try {
          lastTitles = (await this.listWindows()).slice(0, 12).map((window) => window.title);
        } catch {
          // 枚举失败不覆盖原始错误
        }
      }
      await sleep(pollIntervalMs);
    }
    throw new DesktopAdapterError(
      "timeout",
      `等待窗口超时（${timeoutMs}ms）：未出现标题包含「${titleSubstring}」的窗口。` +
        `最近可见窗口：${lastTitles.length === 0 ? "（无）" : lastTitles.join(" | ")}` +
        `${lastError instanceof Error ? `；最后一次错误：${lastError.message}` : ""}`,
    );
  }

  /** 读取当前前台窗口标题；无前台窗口返回空串。只读。 */
  async getWindowTitle(): Promise<string> {
    const foreground = await this.getForegroundWindow();
    return foreground === null ? "" : foreground.title;
  }

  /** 当前前台窗口是否为目标窗口（不传参数时判断是否落在白名单内）。只读。 */
  async isWindowFocused(titleSubstring?: string): Promise<boolean> {
    const foreground = await this.getForegroundWindow();
    if (foreground === null) return false;
    if (titleSubstring === undefined) return this.isAllowed(foreground.title);
    return foreground.title.includes(titleSubstring);
  }

  /** 读取前台窗口完整信息（无前台窗口返回 null）。只读。 */
  async getForegroundWindow(): Promise<DesktopWindowInfo | null> {
    const client = this.requireClient();
    const data = asRecord(await client.request("getForeground", {}));
    return asWindowInfo(data.window);
  }

  /**
   * 桌面空闲毫秒数（`GetLastInputInfo`，即本交互会话最近一次真人键鼠输入距今多久）。
   * 只读；真实桌面是共享资源，在开始注入键鼠前先确认空闲可降低与真人操作互相打断的概率。
   */
  async getIdleMs(): Promise<number> {
    const client = this.requireClient();
    const data = asRecord(await client.request("getIdleInfo", {}));
    return asNumber(data.idleMs);
  }

  /** 扫描凭据/安全提示窗口；默认只扫描前台窗口（`scanAllVisibleWindows` 可放开）。 */
  async scanCredentialPrompts(): Promise<CredentialPromptMatch[]> {
    const targets: DesktopWindowInfo[] = [];
    if (this.scanAllVisibleWindows) {
      targets.push(...(await this.listWindows()));
    } else {
      const foreground = await this.getForegroundWindow();
      if (foreground !== null) targets.push(foreground);
    }
    const matches: CredentialPromptMatch[] = [];
    for (const window of targets) {
      const lowered = window.title.toLowerCase();
      const keyword = CREDENTIAL_KEYWORDS.find((item) => lowered.includes(item.toLowerCase()));
      if (keyword !== undefined) {
        matches.push({
          hwnd: window.hwnd,
          title: window.title,
          pid: window.pid,
          processName: window.processName,
          keyword,
        });
      }
    }
    return matches;
  }

  /**
   * 凭据输入保护：命中凭据/安全提示时抛 `DesktopCredentialPromptError`（停止并交人）。
   * 注意：Windows 无法从任意窗口可靠识别“密码输入框”，因此本方法只能按窗口标题拦截；
   * 真正的凭据输入一律由人完成，适配器不参与（见 README「凭据与安全边界」）。
   */
  async assertNoCredentialPrompt(): Promise<void> {
    const matches = await this.scanCredentialPrompts();
    if (matches.length > 0) throw new DesktopCredentialPromptError(matches);
  }

  // ---- 操作类动作（白名单 + 每步证据）------------------------------------

  /** 聚焦真实窗口（白名单校验 → SetForegroundWindow，失败分类 window-not-found/timeout/allowlist-denied）。 */
  async focusWindow(titleSubstring: string, options: { timeoutMs?: number } = {}): Promise<DesktopStepResult> {
    return this.executeStep("focusWindow", {}, async () => {
      const target = await this.getWindow(titleSubstring);
      this.assertAllowed(target);
      const client = this.requireClient();
      const timeoutMs = options.timeoutMs ?? 3000;
      const data = asRecord(await client.request("focusWindow", { titleContains: titleSubstring, timeoutMs }));
      const window = asWindowInfo(data.window);
      if (window === null) {
        throw new DesktopAdapterError("unknown", "聚焦成功后未取得窗口信息");
      }
      this.activeWindow = window;
      return {
        data: {
          hwnd: window.hwnd,
          title: window.title,
          pid: window.pid,
          processName: window.processName,
          clientOrigin: window.clientOrigin,
          clientRect: window.clientRect,
          rect: window.rect,
          focused: window.foreground,
          attempts: asNumber(data.attempts),
        },
      };
    });
  }

  /** 真实鼠标左键单击屏幕坐标（物理像素）。 */
  async click(x: number, y: number, options: { button?: "left" | "right" | "middle"; verifyTargetWindow?: boolean } = {}): Promise<DesktopStepResult> {
    return this.executeStep("click", {}, async () => {
      const guard = await this.allowlistedForeground();
      const client = this.requireClient();
      const data = asRecord(
        await client.request("click", {
          x,
          y,
          button: options.button ?? "left",
          count: 1,
          focusGuardHwnd: guard.hwnd,
          requirePointInGuardWindow: options.verifyTargetWindow ?? true,
        }),
      );
      const windowAtPoint = asWindowInfo(data.windowAtPoint);
      return {
        data: {
          x,
          y,
          button: asString(data.button, options.button ?? "left"),
          targetWindow: guard.title,
          windowAtPoint: windowAtPoint === null ? null : { hwnd: windowAtPoint.hwnd, title: windowAtPoint.title },
        },
      };
    });
  }

  /** 真实鼠标左键双击屏幕坐标（物理像素）。 */
  async doubleClick(x: number, y: number, options: { verifyTargetWindow?: boolean } = {}): Promise<DesktopStepResult> {
    return this.executeStep("doubleClick", {}, async () => {
      const guard = await this.allowlistedForeground();
      const client = this.requireClient();
      const data = asRecord(
        await client.request("click", {
          x,
          y,
          button: "left",
          count: 2,
          focusGuardHwnd: guard.hwnd,
          requirePointInGuardWindow: options.verifyTargetWindow ?? true,
        }),
      );
      const windowAtPoint = asWindowInfo(data.windowAtPoint);
      return {
        data: {
          x,
          y,
          count: asNumber(data.count, 2),
          targetWindow: guard.title,
          windowAtPoint: windowAtPoint === null ? null : { hwnd: windowAtPoint.hwnd, title: windowAtPoint.title },
        },
      };
    });
  }

  /**
   * 真实键盘输入文本（SendInput + KEYEVENTF_UNICODE，支持中文；不走剪贴板）。
   * - 输入前检查白名单 + 凭据提示窗口；文本本身不写入步骤数据（避免敏感信息进证据）。
   * - `\n`/`\t` 分别映射为 Enter/Tab；其他特殊键请用 `pressKey`。
   */
  async typeText(text: string): Promise<DesktopStepResult> {
    return this.executeStep("typeText", {}, async () => {
      await this.assertNoCredentialPrompt();
      const guard = await this.allowlistedForeground();
      const client = this.requireClient();
      const data = asRecord(
        await client.request("typeText", {
          text,
          focusGuardHwnd: guard.hwnd,
          intervalMs: this.typingIntervalMs,
        }),
      );
      // 不回显输入文本：只记录长度（防敏感信息进入证据/事件账本）
      return {
        data: {
          length: asNumber(data.length, [...text].length),
          utf16Units: asNumber(data.utf16Units),
          targetWindow: guard.title,
        },
      };
    });
  }

  /**
   * 真实键盘按键（如 TAB / ENTER / ESC / CTRL+S / SHIFT+TAB / F5）。
   * 传数组时逐个执行并各自记录一步（每一步都有截图证据）。
   */
  async pressKey(keys: string | readonly string[]): Promise<DesktopStepResult> {
    if (typeof keys === "string") return this.pressOneKey(keys);
    if (keys.length === 0) {
      throw new DesktopAdapterError("unknown", "pressKey 至少要传一个按键");
    }
    let last: DesktopStepResult | null = null;
    for (const key of keys) {
      last = await this.pressOneKey(key);
    }
    if (last === null) throw new DesktopAdapterError("unknown", "pressKey 没有执行任何按键");
    return last;
  }

  /** 真实截图（默认截当前目标窗口的可见外框；`mode:"screen"` 截整个虚拟屏幕）。 */
  async screenshot(
    name = "screenshot",
    options: { mode?: "window" | "client" | "screen"; window?: string } = {},
  ): Promise<DesktopStepResult> {
    const mode = options.mode ?? "window";
    const startedAt = Date.now();
    if (this.evidenceDirPath === "") {
      throw new DesktopAdapterError("unknown", "截图必须配置 evidenceDir（构造 WindowsDesktop 时传入）");
    }
    const client = this.requireClient();
    const file = join(this.screenshotsDir, this.nextEvidenceName(name, "png"));
    const params: Record<string, unknown> = { path: file, mode };
    if (mode === "screen") {
      params.mode = "screen";
    } else {
      let target: DesktopWindowInfo;
      if (options.window !== undefined) {
        target = await this.getWindow(options.window);
        this.assertAllowed(target);
      } else {
        target = await this.ensureActiveWindow();
      }
      params.hwnd = target.hwnd;
    }
    const data = asRecord(await client.request("screenshot", params));
    const step = this.recordStep({
      action: "screenshot",
      ok: true,
      evidence: [file],
      durationMs: Date.now() - startedAt,
      value: name,
    });
    step.data = {
      mode,
      path: file,
      width: asNumber(data.width),
      height: asNumber(data.height),
      rect: asRect(data.rect),
    };
    await this.flushEvidenceFiles();
    return step;
  }

  /** 关闭真实窗口（WM_CLOSE；应用不响应时由调用方决定 taskkill 兜底）。 */
  async closeWindow(titleSubstring: string, options: { timeoutMs?: number } = {}): Promise<DesktopStepResult> {
    return this.executeStep("closeWindow", { autoCapture: false }, async () => {
      const target = await this.getWindow(titleSubstring);
      this.assertAllowed(target);
      const client = this.requireClient();
      const data = asRecord(
        await client.request("closeWindow", { hwnd: target.hwnd, timeoutMs: options.timeoutMs ?? 3000 }),
      );
      if (this.activeWindow !== null && this.activeWindow.hwnd === target.hwnd) this.activeWindow = null;
      return {
        data: {
          hwnd: target.hwnd,
          title: target.title,
          posted: data.posted === true,
          closed: data.closed === true,
          waitedMs: asNumber(data.waitedMs),
        },
      };
    });
  }

  // ---- 系统能力：一次性 PowerShell / Python 脚本 --------------------------

  /**
   * 执行一次性 Windows PowerShell 脚本（诊断/兜底用；主路径是 Python 侧车）。
   * 输出统一按 UTF-8 解码；脚本经 `-EncodedCommand` 传入，中文不会被代码页破坏。
   */
  runPowerShell(script: string, options: { timeoutMs?: number } = {}): PowerShellResult {
    if (process.platform !== "win32") {
      throw new DesktopAdapterError("unknown", "runPowerShell 仅支持 Windows");
    }
    const startedAt = Date.now();
    const prefix =
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" +
      "$OutputEncoding = [System.Text.Encoding]::UTF8\n";
    const encoded = Buffer.from(prefix + script, "utf16le").toString("base64");
    const result: SpawnSyncReturns<string> = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { encoding: "utf8", timeout: options.timeoutMs ?? 30_000, windowsHide: true, env: { ...process.env } },
    );
    return {
      ok: result.status === 0,
      exitCode: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      durationMs: Date.now() - startedAt,
    };
  }

  /** 执行一次性 Python 脚本（UTF-8 模式，诊断/兜底用）。 */
  runPython(script: string, options: { timeoutMs?: number } = {}): PowerShellResult {
    const startedAt = Date.now();
    const pythonCommand = this.options.pythonCommand ?? process.env.STEWARD_PYTHON ?? "python";
    const result: SpawnSyncReturns<string> = spawnSync(pythonCommand, ["-X", "utf8", "-u", "-c", script], {
      encoding: "utf8",
      timeout: options.timeoutMs ?? 30_000,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    return {
      ok: result.status === 0,
      exitCode: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      durationMs: Date.now() - startedAt,
    };
  }

  // ---- 白名单 / 前台校验 ---------------------------------------------------

  /** 判断标题是否落在白名单（大小写不敏感的子串匹配）。 */
  isAllowed(title: string): boolean {
    const lowered = title.toLowerCase();
    return this.allowedWindows.some((pattern) => lowered.includes(pattern.toLowerCase()));
  }

  /** 操作类动作统一入口：非白名单窗口直接抛 `DesktopAllowlistError`（默认拒绝）。 */
  assertAllowed(window: DesktopWindowInfo): void {
    if (!this.isAllowed(window.title)) throw new DesktopAllowlistError(window.title, this.allowedWindows);
  }

  // ---- 内部实现 -----------------------------------------------------------

  private requireClient(): DesktopSidecarClient {
    if (this.client === null) {
      throw new DesktopAdapterError("unknown", "桌面适配器尚未启动：请先 await desktop.start()");
    }
    return this.client;
  }

  private async flushSidecarLog(): Promise<void> {
    if (this.sidecarLogPath === "" || this.pendingSidecarLines.length === 0) return;
    const lines = this.pendingSidecarLines.splice(0, this.pendingSidecarLines.length);
    const body = lines.map((line) => `[${new Date().toISOString()}] ${line}`).join("\n") + "\n";
    try {
      await appendFile(this.sidecarLogPath, body, "utf8");
    } catch {
      // 诊断日志写失败不阻断动作：截图/步骤账本是主证据
    }
  }

  private buildStepsPayload(): string {
    return (
      JSON.stringify(
        {
          runId: this.runId,
          start: this.startInfo,
          steps: this.stepList,
          sidecarDiagnostics: this.pendingSidecarLines.length,
        },
        null,
        2,
      ) + "\n"
    );
  }

  private async flushEvidenceFiles(): Promise<void> {
    await this.flushSidecarLog();
    if (this.stepsPath === "" || this.startInfo === null) return;
    try {
      await writeFile(this.stepsPath, this.buildStepsPayload(), "utf8");
    } catch {
      // steps.json 写失败不阻断动作
    }
  }

  /** 当前目标窗口：优先本次聚焦的目标窗口；没有则退回「前台且白名单内」的窗口。 */
  private async ensureActiveWindow(): Promise<DesktopWindowInfo> {
    if (this.activeWindow !== null) return this.activeWindow;
    const foreground = await this.getForegroundWindow();
    if (foreground === null) {
      throw new DesktopAdapterError("focus-lost", "当前没有前台窗口（桌面可能已锁定或无交互会话）");
    }
    this.assertAllowed(foreground);
    this.activeWindow = foreground;
    return foreground;
  }

  /**
   * 输入注入前的前台校验：
   * 1) 必须有前台窗口；2) 前台窗口必须在白名单内；3) 若本次 run 已有目标窗口，必须仍是它。
   */
  private async allowlistedForeground(): Promise<DesktopWindowInfo> {
    const foreground = await this.getForegroundWindow();
    if (foreground === null) {
      throw new DesktopAdapterError("focus-lost", "当前没有前台窗口（桌面可能已锁定或无交互会话）");
    }
    this.assertAllowed(foreground);
    if (this.activeWindow !== null && this.activeWindow.hwnd !== foreground.hwnd) {
      throw new DesktopAdapterError(
        "focus-lost",
        `目标窗口已失去前台焦点：期望「${this.activeWindow.title}」(hwnd=${this.activeWindow.hwnd})，` +
          `当前前台「${foreground.title}」(hwnd=${foreground.hwnd})`,
      );
    }
    this.activeWindow = foreground;
    return foreground;
  }

  private nextEvidenceName(name: string, extension: string): string {
    this.evidenceSeq += 1;
    return `${String(this.evidenceSeq).padStart(3, "0")}-${sanitizeName(name)}.${extension}`;
  }

  private recordStep(input: DesktopStepInput): DesktopStepResult {
    this.stepSeq += 1;
    const step: DesktopStepResult = {
      stepIndex: this.stepSeq,
      action: input.action,
      ok: input.ok,
      evidence: [...(input.evidence ?? [])],
      durationMs: input.durationMs ?? 0,
    };
    if (input.value !== undefined) step.value = input.value;
    if (input.error !== undefined) step.error = input.error;
    if (input.failureKind !== undefined) step.failureKind = input.failureKind;
    this.stepList.push(step);
    return step;
  }

  /** 动作成功后自动截图留证（失败时截 `-error` 现场；窗口不可用时回退为全屏截图）。 */
  private async captureWindowEvidence(label: string, failed: boolean): Promise<string | null> {
    if (this.evidenceDirPath === "") return null;
    const name = failed ? `${label}-error` : label;
    const client = this.requireClient();
    let target = this.activeWindow;
    if (target === null) {
      try {
        target = await this.ensureActiveWindow();
      } catch {
        target = null;
      }
    }
    if (target !== null) {
      const fresh = await this.getWindowByHwnd(target.hwnd);
      const window = fresh ?? target;
      this.assertAllowed(window);
      const file = join(this.screenshotsDir, this.nextEvidenceName(name, "png"));
      try {
        const data = asRecord(await client.request("screenshot", { path: file, mode: "window", hwnd: window.hwnd }));
        const refreshed = asWindowInfo(data.window);
        if (refreshed !== null) this.activeWindow = refreshed;
        return file;
      } catch {
        // 窗口刚关闭/移出屏幕：回退为全屏截图，保证失败也有现场证据
      }
    }
    try {
      const fallbackFile = join(this.screenshotsDir, this.nextEvidenceName(`${name}-screen`, "png"));
      await client.request("screenshot", { path: fallbackFile, mode: "screen" });
      return fallbackFile;
    } catch {
      return null;
    }
  }

  private async getWindowByHwnd(hwnd: number): Promise<DesktopWindowInfo | null> {
    const client = this.requireClient();
    try {
      return asWindowInfo(await client.request("findWindow", { hwnd }));
    } catch {
      return null;
    }
  }

  /**
   * 统一动作执行器：执行 → （自动截图留证）→ 记录步骤 → 落盘证据。
   * 白名单拒绝与凭据停止属于「必须交给人」的硬错误：记录失败步骤后**向上抛出**；
   * 其他失败记录为 `ok:false` 的结构化步骤结果（带 failureKind）。
   */
  private async executeStep(
    action: string,
    options: ExecuteStepOptions,
    task: () => Promise<StepOutcome>,
  ): Promise<DesktopStepResult> {
    const startedAt = Date.now();
    this.requireClient();
    let outcome: StepOutcome = {};
    let failure: unknown = null;
    try {
      outcome = await task();
    } catch (error) {
      failure = error;
    }

    const evidence: string[] = [];
    let captureError: unknown = null;
    if (options.autoCapture !== false) {
      try {
        const file = await this.captureWindowEvidence(action, failure !== null);
        if (file !== null) evidence.push(file);
      } catch (error) {
        captureError = error;
      }
    }
    if (failure === null && captureError !== null) failure = captureError;

    const input: DesktopStepInput = {
      action,
      ok: failure === null,
      evidence,
      durationMs: Date.now() - startedAt,
    };
    if (failure !== null) {
      input.error = formatDesktopError(failure);
      input.failureKind = classifyDesktopFailure(failure);
    } else if (outcome.value !== undefined) {
      input.value = outcome.value;
    }
    const step = this.recordStep(input);
    if (outcome.data !== undefined) step.data = outcome.data;
    await this.flushEvidenceFiles();

    if (failure instanceof DesktopAllowlistError || failure instanceof DesktopCredentialPromptError) {
      throw failure;
    }
    return step;
  }

  private async pressOneKey(bodyKey: string): Promise<DesktopStepResult> {
    const combo = bodyKey.trim();
    if (combo === "") {
      throw new DesktopAdapterError("unknown", "pressKey 的按键不能为空");
    }
    return this.executeStep("pressKey", {}, async () => {
      const guard = await this.allowlistedForeground();
      const client = this.requireClient();
      const data = asRecord(await client.request("pressKey", { combo, focusGuardHwnd: guard.hwnd }));
      return {
        value: combo,
        data: { combo: asString(data.combo, combo), repeat: asNumber(data.repeat, 1), targetWindow: guard.title },
      };
    });
  }
}

// ---------------------------------------------------------------------------
// 与 steward-core ToolRegistry 的衔接（M2 Operator 分支注册用）
// ---------------------------------------------------------------------------

interface DesktopToolDefinition {
  name: string;
  description: string;
  risk: RiskLevel;
  evidence: boolean;
}

const DESKTOP_TOOLS: ReadonlyArray<DesktopToolDefinition> = [
  { name: "desktop.listWindows", description: "枚举真实 Windows 桌面窗口（标题/pid/rect/是否前台）", risk: "low", evidence: false },
  { name: "desktop.focusWindow", description: "聚焦真实窗口（白名单校验，非白名单拒绝）", risk: "medium", evidence: true },
  { name: "desktop.screenshot", description: "真实屏幕/窗口截图留证（PNG）", risk: "low", evidence: true },
  { name: "desktop.click", description: "真实鼠标单击屏幕坐标（物理像素）", risk: "medium", evidence: true },
  { name: "desktop.doubleClick", description: "真实鼠标双击屏幕坐标（物理像素）", risk: "medium", evidence: true },
  { name: "desktop.typeText", description: "真实键盘输入文本（Unicode，支持中文；不回显内容）", risk: "medium", evidence: true },
  { name: "desktop.pressKey", description: "真实键盘按键（TAB/ENTER/CTRL+S 等）", risk: "medium", evidence: true },
  { name: "desktop.getWindowTitle", description: "读取当前前台窗口标题", risk: "low", evidence: false },
  { name: "desktop.isWindowFocused", description: "判断目标窗口是否在前台/是否白名单内", risk: "low", evidence: false },
  { name: "desktop.assertNoCredentialPrompt", description: "凭据/安全提示保护：命中即停止交人", risk: "low", evidence: false },
];

/** 桌面工具规格：交给 `ToolRegistry.register()` 使用（handler 由 M2 Operator 装配）。 */
export function desktopToolSpecs(): ToolSpec[] {
  return DESKTOP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    requiresApproval: false,
    evidence: tool.evidence,
  }));
}
