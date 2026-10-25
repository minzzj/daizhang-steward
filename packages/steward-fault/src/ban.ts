/**
 * BanDetector：平台封禁检测（B4）。
 *
 * 判定条件（真实响应）：HTTP 403/429 **且** 响应头 `x-platform-ban: true`
 * （大小写不敏感）→ 平台封禁，抛 `PlatformBannedError`（含 retry_after_ms / 原因）。
 *
 * 非封禁的 403/429（无该头）不误判；网络超时/拒连不算封禁（保留上次已知状态）。
 */

import { PlatformBannedError } from "./errors.js";
import { describeFetchError, readErrorReason, readRetryAfterMs, requestJson } from "./http.js";
import { cloneJson, nowIso } from "./io.js";
import type { BanCheckResult, BanDetectorOptions, BanRequestOptions } from "./types.js";

export const PLATFORM_BAN_HEADER = "x-platform-ban";
export const DEFAULT_BAN_TIMEOUT_MS = 5_000;

export class BanDetector {
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private banned = false;
  private lastResult: BanCheckResult | null = null;

  constructor(options: BanDetectorOptions = {}) {
    const timeout = options.timeoutMs ?? DEFAULT_BAN_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`timeoutMs 必须是正数：${String(timeout)}`);
    this.timeoutMs = timeout;
    this.now = options.now ?? (() => new Date());
  }

  /** 最近一次检测是否判定为封禁。 */
  get isBanned(): boolean {
    return this.banned;
  }

  /** 最近一次检测结果（诊断用）。 */
  get last(): BanCheckResult | null {
    return this.lastResult === null ? null : cloneJson(this.lastResult);
  }

  reset(): void {
    this.banned = false;
    this.lastResult = null;
  }

  /**
   * 对 `url` 发真实请求检测封禁。
   * - 403/429 + `x-platform-ban: true` → 抛 `PlatformBannedError`；
   * - 其他情况返回 `{banned:false, status, ...}`（含网络错误，error 字段说明）。
   */
  async check(url: string, options: BanRequestOptions = {}): Promise<BanCheckResult> {
    const checkedAt = nowIso(this.now);
    let response;
    try {
      response = await requestJson(url, {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        ...(options.body === undefined ? {} : { body: options.body }),
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
      });
    } catch (error) {
      const result: BanCheckResult = {
        banned: false,
        status: 0,
        url,
        checked_at: checkedAt,
        error: describeFetchError(error),
      };
      this.lastResult = cloneJson(result);
      // 网络错误不改变 isBanned 的已知状态（可能只是临时断网）
      return result;
    }

    const headerValue = response.headers.get(PLATFORM_BAN_HEADER);
    const banHeader = headerValue !== null && headerValue.trim().toLowerCase() === "true";
    const isBan = (response.status === 403 || response.status === 429) && banHeader;

    if (isBan) {
      const retryAfter = readRetryAfterMs(response.headers, response.body);
      const reason = readErrorReason(response.body, `platform_ban (HTTP ${response.status})`);
      const result: BanCheckResult = {
        banned: true,
        status: response.status,
        url,
        checked_at: checkedAt,
        reason,
      };
      if (retryAfter !== null) result.retry_after_ms = retryAfter;
      this.banned = true;
      this.lastResult = cloneJson(result);
      throw new PlatformBannedError({
        url,
        status: response.status,
        reason,
        retry_after_ms: retryAfter,
      });
    }

    const result: BanCheckResult = {
      banned: false,
      status: response.status,
      url,
      checked_at: checkedAt,
    };
    if (response.status === 403 || response.status === 429) {
      result.reason = readErrorReason(response.body, `HTTP ${response.status}（无平台封禁标记，按普通错误处理）`);
    }
    this.banned = false;
    this.lastResult = cloneJson(result);
    return result;
  }
}
