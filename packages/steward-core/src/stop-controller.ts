import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * M2-B / A8：停止键 ≤5s 生效。
 *
 * 背景：`StopSignal`（stop.ts）只提供「停止文件」读写；运行时的步内检查发生在
 * 「下一个动作开始前」。若某个工具调用本身耗时 10s+，停止键无法在 5s 内生效。
 * 本模块用三层机制补齐：
 *
 * 1. `StopController.request()`：写停止文件 + 同步 `AbortController.abort()`；
 * 2. `StopController.start()`：200ms watchdog 轮询停止文件（外部 CLI `steward stop`
 *    写文件后，本进程无需等待下一步即可感知）；
 * 3. `withAbort()`：把可中断操作包成 race，abort 时立即 reject `StoppedError`，
 *    即使底层工具很慢也能在 ≤5s 内返回停止结果。
 */

/** watchdog 默认轮询间隔（毫秒）。 */
export const DEFAULT_STOP_POLL_INTERVAL_MS = 200;
/** A8 硬上限：停止请求后 5s 内必须返回（也是 withAbort 的默认超时）。 */
export const DEFAULT_ABORT_TIMEOUT_MS = 5_000;

export type StopSource = "request" | "watchdog" | "external";

/** 停止事件记录（`{stoppedAt, reason}` 为核心字段，字段只增不减）。 */
export interface StopEvent {
  /** 停止原因（人类可读）。 */
  reason: string;
  /** 停止实际生效时间（ISO 8601）。 */
  stoppedAt: string;
  /** 触发来源：进程内 request / 文件 watchdog / 外部注入。 */
  source: StopSource;
}

export type StopListener = (event: StopEvent) => void;

export interface StopControllerOptions {
  /** watchdog 轮询间隔，默认 200ms。 */
  pollIntervalMs?: number;
}

/** 停止键触发后，被 withAbort 包裹的操作以该错误 reject。 */
export class StoppedError extends Error {
  readonly reason: string;
  readonly stoppedAt: string;
  readonly code = "STOPPED";

  constructor(reason: string, stoppedAt: string = new Date().toISOString()) {
    super(`已停止：${reason}`);
    this.name = "StoppedError";
    this.reason = reason;
    this.stoppedAt = stoppedAt;
  }
}

function isStopEvent(value: unknown): value is StopEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { reason?: unknown; stoppedAt?: unknown };
  return typeof candidate.reason === "string" && typeof candidate.stoppedAt === "string";
}

function stoppedErrorFrom(signal: AbortSignal, fallbackReason: string): StoppedError {
  const reason: unknown = signal.reason;
  if (reason instanceof StoppedError) return reason;
  if (isStopEvent(reason)) return new StoppedError(reason.reason, reason.stoppedAt);
  if (typeof reason === "string" && reason.trim() !== "") return new StoppedError(reason);
  return new StoppedError(fallbackReason);
}

/**
 * 把可中断操作包成 race：`signal` abort 时立即以 `StoppedError` reject。
 *
 * `promiseFactory` 收到的是本地组合 signal：外部停止或 `timeoutMs` 到期都会 abort 它，
 * 便于底层工具自行清理（关闭页面、杀子进程…）。`timeoutMs` 默认 5000ms（A8 上限），
 * 传 0/负数表示不设硬超时（仍响应 abort）。
 *
 * 注意：不等待底层 promise 结束——停止场景下必须尽快返回；底层 promise 的后续 reject
 * 由 race 内部吞掉，不会变成 unhandledRejection。
 */
export async function withAbort<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_ABORT_TIMEOUT_MS,
): Promise<T> {
  if (typeof promiseFactory !== "function") {
    throw new TypeError("withAbort 需要 (signal) => Promise<T> 形式的 promiseFactory");
  }
  if (signal.aborted) throw stoppedErrorFrom(signal, "停止请求已触发");

  const local = new AbortController();
  const forwardAbort = (): void => {
    if (!local.signal.aborted) local.abort(signal.reason);
  };
  signal.addEventListener("abort", forwardAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onLocalAbort: (() => void) | undefined;

  const aborted = new Promise<never>((_resolve, reject) => {
    onLocalAbort = (): void => reject(stoppedErrorFrom(local.signal, "停止请求已触发"));
    if (local.signal.aborted) {
      onLocalAbort();
      return;
    }
    local.signal.addEventListener("abort", onLocalAbort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!local.signal.aborted) {
          local.abort(new StoppedError(`withAbort 超时（${timeoutMs}ms）`));
        }
      }, timeoutMs);
      timer.unref();
    }
  });

  try {
    const work = promiseFactory(local.signal);
    return await Promise.race([work, aborted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onLocalAbort !== undefined) local.signal.removeEventListener("abort", onLocalAbort);
    signal.removeEventListener("abort", forwardAbort);
    if (!local.signal.aborted) local.abort("withAbort: 操作已结束");
  }
}

/**
 * 停止控制器：一个实例对应一次 run（AbortController 一次性，不可复位）。
 *
 * ```ts
 * const stop = new StopController(paths.stopFile);
 * stop.onStop((e) => console.log("stopped", e.reason));
 * stop.start(); // 200ms watchdog
 * try {
 *   await stop.withAbort((signal) => slowTool({ signal }), 5_000);
 * } finally {
 *   stop.stop();
 * }
 * ```
 */
export class StopController {
  readonly stopFile: string;
  readonly pollIntervalMs: number;

  private readonly abortController = new AbortController();
  private readonly listeners = new Set<StopListener>();
  private readonly stopDeferred: { promise: Promise<StopEvent>; resolve: (event: StopEvent) => void };
  private timer: ReturnType<typeof setInterval> | null = null;
  private stoppedEvent: StopEvent | null = null;

  constructor(stopFile: string, options: StopControllerOptions = {}) {
    if (typeof stopFile !== "string" || stopFile.trim() === "") {
      throw new Error("StopController 需要非空 stopFile 路径");
    }
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_STOP_POLL_INTERVAL_MS;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new Error(`pollIntervalMs 必须是正数：${String(pollIntervalMs)}`);
    }
    this.stopFile = stopFile;
    this.pollIntervalMs = pollIntervalMs;
    let resolve: (event: StopEvent) => void = () => undefined;
    const promise = new Promise<StopEvent>((r) => {
      resolve = r;
    });
    this.stopDeferred = { promise, resolve };
  }

  get isStopped(): boolean {
    return this.stoppedEvent !== null;
  }

  /** 最近一次停止事件；未停止为 null。 */
  get lastEvent(): StopEvent | null {
    return this.stoppedEvent;
  }

  /** 供支持 AbortSignal 的工具（浏览器/桌面/HTTP）直接使用。 */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** 启动 watchdog：立即检查一次停止文件，之后每 `pollIntervalMs` 检查一次。幂等。 */
  start(): void {
    if (this.timer !== null) return;
    const timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
    timer.unref();
    this.timer = timer;
    void this.pollOnce();
  }

  /** 读取停止文件；若存在则触发停止。watchdog 内部使用，也可由运行时主动调用。 */
  async pollOnce(): Promise<StopEvent | null> {
    if (this.isStopped) return this.stoppedEvent;
    let text: string;
    try {
      text = await readFile(this.stopFile, "utf8");
    } catch {
      return null;
    }
    let reason = "watchdog：检测到停止文件";
    let stoppedAt = new Date().toISOString();
    const trimmed = text.trim();
    if (trimmed !== "") {
      try {
        const parsed = JSON.parse(trimmed) as { reason?: unknown; requestedAt?: unknown };
        if (typeof parsed.reason === "string" && parsed.reason.trim() !== "") reason = parsed.reason;
        if (typeof parsed.requestedAt === "string") stoppedAt = parsed.requestedAt;
      } catch {
        // 停止文件也允许是纯文本（人工 `echo stop > .steward/STOP`）
        reason = trimmed;
      }
    }
    return this.trigger({ reason, stoppedAt, source: "watchdog" });
  }

  /**
   * 触发停止：先落盘停止文件（供其他进程/重启后可见），再同步 abort 所有 withAbort。
   * 重复调用返回首次停止事件（幂等）。
   */
  async request(reason: string = "manual stop"): Promise<StopEvent> {
    if (this.isStopped) return this.stoppedEvent as StopEvent;
    const stoppedAt = new Date().toISOString();
    await mkdir(dirname(this.stopFile), { recursive: true });
    await writeFile(this.stopFile, JSON.stringify({ reason, requestedAt: stoppedAt }, null, 2) + "\n", "utf8");
    return this.trigger({ reason, stoppedAt, source: "request" });
  }

  /** 订阅停止事件；若已停止则立即回调一次。返回取消订阅函数。 */
  onStop(listener: StopListener): () => void {
    this.listeners.add(listener);
    const current = this.stoppedEvent;
    if (current !== null) this.invoke(listener, current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 等待停止发生（不会挂住事件循环；未停止则一直 pending）。 */
  whenStopped(): Promise<StopEvent> {
    return this.stopDeferred.promise;
  }

  /** 用本控制器的 signal 包裹可中断操作，默认 5s 硬超时（A8）。 */
  withAbort<T>(promiseFactory: (signal: AbortSignal) => Promise<T>, timeoutMs: number = DEFAULT_ABORT_TIMEOUT_MS): Promise<T> {
    return withAbort(promiseFactory, this.abortController.signal, timeoutMs);
  }

  /** 清理 watchdog 定时器（不触发停止；触发停止请用 request()）。 */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 清理定时器与监听器（进程退出前调用）。 */
  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  /** 删除停止文件（供新一轮 run 复用根目录时清理；本实例仍保持已停止状态）。 */
  async clearStopFile(): Promise<void> {
    await rm(this.stopFile, { force: true });
  }

  private trigger(event: StopEvent): StopEvent {
    const existing = this.stoppedEvent;
    if (existing !== null) return existing;
    this.stoppedEvent = event;
    this.abortController.abort(event);
    this.stopDeferred.resolve(event);
    for (const listener of [...this.listeners]) this.invoke(listener, event);
    return event;
  }

  private invoke(listener: StopListener, event: StopEvent): void {
    try {
      listener(event);
    } catch {
      // 停止回调不得阻断停止传播
    }
  }
}
