/**
 * ConnectivityProbe：真实网络探针（Node 内置 fetch）。
 *
 * 判定口径：**能拿到任意 HTTP 响应（含 403/500）就算在线**——关注的是链路可达性，
 * 不是业务是否成功；只有连接被拒（ECONNREFUSED）、DNS 失败、超时等才判离线。
 */

import { describeFetchError, networkErrorCode } from "./http.js";
import type { ProbeOptions, ProbeResult } from "./types.js";

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

export class ConnectivityProbe {
  private readonly defaultTimeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    const timeout = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`timeoutMs 必须是正数：${String(timeout)}`);
    this.defaultTimeoutMs = timeout;
  }

  /** 对 `url` 发真实请求并返回在线状态与真实时延。 */
  async probe(url: string, timeoutMsOrOptions: number | ProbeOptions = this.defaultTimeoutMs): Promise<ProbeResult> {
    const options: ProbeOptions = typeof timeoutMsOrOptions === "number" ? { timeoutMs: timeoutMsOrOptions } : timeoutMsOrOptions;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: { Accept: "application/json", ...(options.headers ?? {}) },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 读完响应体，确保连接被释放；内容本身不影响可达性判定
      await response.arrayBuffer().catch(() => undefined);
      return { online: true, latency_ms: Date.now() - startedAt };
    } catch (error) {
      const code = networkErrorCode(error);
      const result: ProbeResult = {
        online: false,
        latency_ms: Date.now() - startedAt,
        error: code === null ? describeFetchError(error) : `${code}: ${describeFetchError(error)}`,
      };
      return result;
    }
  }

  /** 等待 `url` 变为在线（真实轮询，最多 timeoutMs）；返回首次在线的探针结果或 null。 */
  async waitOnline(url: string, timeoutMs: number, intervalMs = 200, probeTimeoutMs?: number): Promise<ProbeResult | null> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() <= deadline) {
      const result = await this.probe(url, probeTimeoutMs === undefined ? this.defaultTimeoutMs : probeTimeoutMs);
      if (result.online) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
    return null;
  }
}
