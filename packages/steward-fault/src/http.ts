/**
 * 真实 HTTP 小工具：基于 Node 内置 fetch（undici），零第三方依赖。
 * 网络错误统一转成可读文本（优先保留 ECONNREFUSED / ETIMEDOUT 等真实错误码）。
 */

export interface HttpJsonOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown> | string;
  headers?: Record<string, string>;
  /** 请求超时（真实毫秒，默认 5000）。 */
  timeoutMs?: number;
}

export interface HttpJsonResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** 已解析 JSON（失败时是原始文本）。 */
  body: unknown;
  latency_ms: number;
}

/** 从 fetch 异常里挖出真实网络错误码（ECONNREFUSED/ENOTFOUND/ETIMEDOUT…）。 */
export function networkErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth++) {
    if (typeof current === "object") {
      const record = current as { code?: unknown; cause?: unknown };
      if (typeof record.code === "string" && record.code.trim() !== "") return record.code;
      current = record.cause;
      continue;
    }
    return null;
  }
  return null;
}

/** 把任意网络/超时异常转成人读文本（保留真实错误码）。 */
export function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const code = networkErrorCode(error);
    if (code !== null) return `${code}: ${error.message}`;
    if (error.name === "TimeoutError" || error.name === "AbortError") return `timeout: ${error.message}`;
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** 发真实 HTTP 请求并尽力解析 JSON；网络失败会抛异常（调用方捕获）。 */
export async function requestJson(url: string, options: HttpJsonOptions = {}): Promise<HttpJsonResponse> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const headers: Record<string, string> = { Accept: "application/json", ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body }),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  } else {
    parsed = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body: parsed,
    latency_ms: Date.now() - startedAt,
  };
}

/** 从响应头/响应体里读 retry_after_ms（头是秒，体可能是毫秒）。 */
export function readRetryAfterMs(headers: Headers, body: unknown): number | null {
  const headerValue = headers.get("retry-after");
  if (headerValue !== null && headerValue.trim() !== "") {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  if (typeof body === "object" && body !== null) {
    const record = body as { retry_after_ms?: unknown; retryAfterMs?: unknown };
    for (const value of [record.retry_after_ms, record.retryAfterMs]) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    }
  }
  return null;
}

/** 从响应体里读错误原因（error/reason/message 字段）。 */
export function readErrorReason(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const record = body as { error?: unknown; reason?: unknown; message?: unknown };
    for (const value of [record.error, record.reason, record.message]) {
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  }
  return fallback;
}
