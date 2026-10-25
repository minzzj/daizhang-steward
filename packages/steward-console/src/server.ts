/**
 * packages/steward-console/src/server.ts
 *
 * 本地 Web 控制台 HTTP 服务（零第三方依赖，只用 node:http）：
 * - 只允许监听回环地址（默认 127.0.0.1:4180），非回环 host 直接拒绝启动；
 * - 页面：看板 / 项目时间线 / 账本 / 审批 / 月报 / 接管；静态资源同源内联提供（无 CDN/外链）；
 * - 读接口无需 token；**写接口必须带 `X-Steward-Token`**（默认随机，构造时返回给调用方，
 *   并通过 `<meta name="steward-token">` 注入页面，供同源 JS 使用）；
 * - token 不写日志、不进 URL；响应带 CSP / nosniff / frame-ancestors 等安全头；
 * - `close()` 关闭监听并断开 keep-alive 连接（E2E 用 `port: 0` 时确保不残留端口）。
 *
 * 安全边界（详见 README）：本地单机、单用户、无 HTTPS；不做多用户鉴权/权限模型。
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { BASE_CSS, CLIENT_JS } from "./assets.js";
import {
  renderApprovalsPage,
  renderDashboardPage,
  renderErrorPage,
  renderLedgerPage,
  renderProjectPage,
  renderReportPage,
  renderTakeoverPage,
  type ConsolePageName,
  type PageRenderOptions,
} from "./pages.js";
import type {
  ConsoleDataProvider,
  ConsoleLedgerFilter,
  ConsoleSummaryLevel,
  ConsoleTakeoverStatus,
} from "./provider.js";

export const CONSOLE_DEFAULT_HOST = "127.0.0.1";
export const CONSOLE_DEFAULT_PORT = 4180;

/** 只允许回环地址：控制台是本机单机界面，不允许对外网/局域网暴露。 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface ConsoleServerOptions {
  provider: ConsoleDataProvider;
  /** 默认 127.0.0.1；只允许回环地址（localhost/::1 等价放行）。 */
  host?: string;
  /** 默认 4180；传 0 表示随机端口（E2E/CI 推荐）。 */
  port?: number;
  /** 自定义写操作 token；缺省用 crypto.randomBytes(16) 随机生成。 */
  token?: string;
  /** 请求日志回调（只记录方法/路径/状态/耗时，不记录 token 与请求体）。 */
  log?: (line: string) => void;
}

export interface ConsoleServerHandle {
  server: Server;
  /** 实际监听地址（port 传 0 时为随机端口的真实 URL）。 */
  url: string;
  host: string;
  port: number;
  token: string;
  provider: ConsoleDataProvider;
  close(): Promise<void>;
}

export class ConsoleSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleSecurityError";
  }
}

/** 是否回环地址（控制台只允许这些 host）。 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new ConsoleSecurityError(
      `控制台只允许监听回环地址（127.0.0.1 / ::1 / localhost），拒绝 host=${host}。` +
        "本地单机界面不允许对外暴露。",
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    ...extra,
  };
}

/**
 * 创建并启动控制台服务。返回 `{server, url, token, close()}`（url 为实际监听地址）。
 */
export async function createConsoleServer(options: ConsoleServerOptions): Promise<ConsoleServerHandle> {
  const provider = options.provider;
  if (provider === null || typeof provider !== "object") {
    throw new Error("createConsoleServer 需要 provider（ConsoleDataProvider）");
  }
  const host = options.host ?? CONSOLE_DEFAULT_HOST;
  assertLoopbackHost(host);
  const port = options.port ?? CONSOLE_DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`port 不合法：${String(port)}（0 表示随机端口）`);
  }
  const token = options.token ?? randomBytes(16).toString("hex");
  if (typeof token !== "string" || token.length < 8) {
    throw new Error("token 至少 8 个字符（写接口凭据）");
  }
  const log = options.log ?? (() => {});
  const startedAt = new Date().toISOString();

  const sendJson = (res: ServerResponse, statusCode: number, payload: unknown): number => {
    const body = `${JSON.stringify(payload)}\n`;
    res.writeHead(
      statusCode,
      baseHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(body)),
      }),
    );
    res.end(body);
    return statusCode;
  };

  const sendHtml = (res: ServerResponse, statusCode: number, html: string): number => {
    res.writeHead(
      statusCode,
      baseHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Content-Length": String(Buffer.byteLength(html)),
      }),
    );
    res.end(html);
    return statusCode;
  };

  const sendText = (res: ServerResponse, contentType: string, text: string): number => {
    res.writeHead(
      200,
      baseHeaders({
        "Content-Type": contentType,
        "Content-Length": String(Buffer.byteLength(text)),
      }),
    );
    res.end(text);
    return 200;
  };

  const methodNotAllowed = (res: ServerResponse, allow: string[]): number => {
    res.setHeader("Allow", allow.join(", "));
    return sendJson(res, 405, { ok: false, error: "method_not_allowed", message: `不支持的请求方法（允许：${allow.join(", ")}）` });
  };

  const isWriteAuthorized = (req: IncomingMessage): boolean => {
    const header = req.headers["x-steward-token"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (typeof provided !== "string" || provided.length !== token.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(token, "utf8"));
    } catch {
      return false;
    }
  };

  const requireWriteAuth = (req: IncomingMessage, res: ServerResponse): number | null => {
    if (isWriteAuthorized(req)) return null;
    return sendJson(res, 401, {
      ok: false,
      error: "unauthorized",
      message: "写操作需要 X-Steward-Token（由页面同源注入，不对外暴露）",
    });
  };

  const readJsonBody = async (
    req: IncomingMessage,
  ): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: number; message: string }> => {
    const contentTypeHeader = req.headers["content-type"];
    const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader.toLowerCase() : "";
    if (contentType !== "" && !contentType.includes("application/json")) {
      return { ok: false, status: 415, message: "Content-Type 必须是 application/json" };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) return { ok: false, status: 413, message: "请求体过大（>64KB）" };
      chunks.push(buffer);
    }
    if (chunks.length === 0) return { ok: true, value: {} };
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, status: 400, message: "请求体必须是 JSON 对象" };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, status: 400, message: "请求体不是合法 JSON" };
    }
  };

  const readString = (value: unknown, fallback: string): string => {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    return fallback;
  };

  const safeTakeoverStatus = async (): Promise<ConsoleTakeoverStatus | null> => {
    try {
      return await provider.takeoverStatus();
    } catch {
      return null;
    }
  };

  const pageOptions = async (active: ConsolePageName): Promise<PageRenderOptions> => {
    const status = await safeTakeoverStatus();
    return { token, active, halted: status !== null && status.halted === true };
  };

  const notFoundPage = async (res: ServerResponse, message: string): Promise<number> => {
    const options = await pageOptions("dashboard");
    return sendHtml(res, 404, renderErrorPage(options, 404, "页面不存在", message));
  };

  // -------------------------------------------------------------------------
  // 页面路由
  // -------------------------------------------------------------------------
  const handlePage = async (res: ServerResponse, pathname: string): Promise<number> => {
    if (pathname === "/") {
      const [overview, summaryL0, ledger] = await Promise.all([
        provider.overview(),
        provider.summary("L0"),
        provider.ledger(),
      ]);
      const options = await pageOptions("dashboard");
      return sendHtml(res, 200, renderDashboardPage({ overview, summaryL0, ledger, options }));
    }
    if (pathname === "/ledger") {
      const [entries, overview] = await Promise.all([provider.ledger(), provider.overview()]);
      const options = await pageOptions("ledger");
      return sendHtml(res, 200, renderLedgerPage({ entries, projects: overview.projects, options }));
    }
    if (pathname === "/approvals") {
      const approvals = await provider.approvals();
      const options = await pageOptions("approvals");
      return sendHtml(res, 200, renderApprovalsPage({ approvals, options }));
    }
    if (pathname === "/report") {
      const report = await provider.monthlyReport();
      const options = await pageOptions("report");
      return sendHtml(res, 200, renderReportPage({ report, options }));
    }
    if (pathname === "/takeover") {
      const status = await safeTakeoverStatus();
      const options = await pageOptions("takeover");
      if (status === null) {
        return sendHtml(res, 500, renderErrorPage(options, 500, "接管状态不可用", "provider.takeoverStatus() 调用失败"));
      }
      return sendHtml(res, 200, renderTakeoverPage({ status, options }));
    }
    if (pathname.startsWith("/project/")) {
      const projectId = pathname.slice("/project/".length).trim();
      const options = await pageOptions("project");
      if (projectId === "") return sendHtml(res, 404, renderErrorPage(options, 404, "项目不存在", "缺少项目 ID"));
      const overview = await provider.overview();
      const project = overview.projects.find((item) => item.id === projectId);
      if (project === undefined) {
        return sendHtml(res, 404, renderErrorPage(options, 404, "项目不存在", `未找到项目：${projectId}`));
      }
      const timeline = await provider.projectTimeline(projectId);
      return sendHtml(res, 200, renderProjectPage({ project, timeline, options }));
    }
    return notFoundPage(res, `未找到页面：${pathname}`);
  };

  // -------------------------------------------------------------------------
  // API 路由
  // -------------------------------------------------------------------------
  const handleApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number> => {
    const isRead = method === "GET" || method === "HEAD";
    const readOnlyRoute =
      pathname === "/api/overview" ||
      pathname === "/api/approvals" ||
      pathname === "/api/ledger" ||
      pathname === "/api/monthly-report" ||
      pathname === "/api/summary" ||
      /^\/api\/projects\/[^/]+\/timeline$/.test(pathname) ||
      /^\/api\/evidence\/[^/]+$/.test(pathname) ||
      /^\/api\/ledger\/[^/]+\/facts$/.test(pathname);

    if (readOnlyRoute && !isRead) return methodNotAllowed(res, ["GET", "HEAD"]);

    if (pathname === "/api/overview" && isRead) {
      return sendJson(res, 200, { ok: true, data: await provider.overview() });
    }

    const timelineMatch = /^\/api\/projects\/([^/]+)\/timeline$/.exec(pathname);
    if (timelineMatch !== null && isRead) {
      const projectId = timelineMatch[1] ?? "";
      return sendJson(res, 200, { ok: true, data: await provider.projectTimeline(projectId) });
    }

    const evidenceMatch = /^\/api\/evidence\/([^/]+)$/.exec(pathname);
    if (evidenceMatch !== null && isRead) {
      const ref = evidenceMatch[1] ?? "";
      const evidence = await provider.evidenceDetail(ref);
      if (evidence === null) {
        return sendJson(res, 404, { ok: false, error: "not_found", message: `证据不存在：${ref}` });
      }
      return sendJson(res, 200, { ok: true, data: evidence });
    }

    if (pathname === "/api/ledger" && isRead) {
      const filter: ConsoleLedgerFilter = {};
      const projectId = requestUrl.searchParams.get("project_id");
      if (projectId !== null && projectId !== "") filter.project_id = projectId;
      const type = requestUrl.searchParams.get("type");
      if (type !== null && type !== "") filter.type = type;
      const limitText = requestUrl.searchParams.get("limit");
      if (limitText !== null && /^\d+$/.test(limitText)) filter.limit = Number.parseInt(limitText, 10);
      return sendJson(res, 200, { ok: true, data: await provider.ledger(filter) });
    }

    const factsMatch = /^\/api\/ledger\/([^/]+)\/facts$/.exec(pathname);
    if (factsMatch !== null && isRead) {
      const entryId = factsMatch[1] ?? "";
      const facts = await provider.ledgerFacts(entryId);
      if (facts === null) {
        return sendJson(res, 404, { ok: false, error: "not_found", message: `账本记录不存在：${entryId}` });
      }
      return sendJson(res, 200, { ok: true, data: facts });
    }

    if (pathname === "/api/approvals" && isRead) {
      return sendJson(res, 200, { ok: true, data: await provider.approvals() });
    }

    const decideMatch = /^\/api\/approvals\/([^/]+)\/decide$/.exec(pathname);
    if (decideMatch !== null) {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) {
        return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      }
      const decisionValue = body.value.decision;
      if (decisionValue !== "approve" && decisionValue !== "reject") {
        return sendJson(res, 400, {
          ok: false,
          error: "invalid_decision",
          message: 'decision 只支持 "approve" 或 "reject"',
        });
      }
      const approvalId = decideMatch[1] ?? "";
      const by = readString(body.value.by, "web-console");
      const result = await provider.decideApproval(approvalId, decisionValue, by);
      if (result.status === "not_found") {
        return sendJson(res, 404, { ok: false, error: "not_found", message: result.reason ?? `审批不存在：${approvalId}` });
      }
      if (!result.ok) {
        return sendJson(res, 409, {
          ok: false,
          error: "conflict",
          message: result.reason ?? `审批已处理：${result.status}`,
          data: result,
        });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/takeover" && isRead) {
      const status = await provider.takeoverStatus();
      return sendJson(res, 200, { ok: true, data: status });
    }
    if (pathname === "/api/takeover" && method === "POST") {
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) {
        return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      }
      const reason = readString(body.value.reason, "人工接管（Web 控制台）");
      const by = readString(body.value.by, "web-console");
      const result = await provider.takeover(reason, by);
      return sendJson(res, 200, { ok: true, data: result });
    }
    if (pathname === "/api/takeover/resume") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) {
        return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      }
      const by = readString(body.value.by, "web-console");
      return sendJson(res, 200, { ok: true, data: await provider.resume(by) });
    }
    if (pathname === "/api/takeover") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);

    if (pathname === "/api/monthly-report" && isRead) {
      return sendJson(res, 200, { ok: true, data: await provider.monthlyReport() });
    }

    if (pathname === "/api/summary" && isRead) {
      const rawLevel = (requestUrl.searchParams.get("level") ?? "L0").toUpperCase();
      if (rawLevel !== "L0" && rawLevel !== "L1" && rawLevel !== "L2") {
        return sendJson(res, 400, { ok: false, error: "invalid_level", message: "level 只支持 L0 / L1 / L2" });
      }
      const level = rawLevel as ConsoleSummaryLevel;
      return sendJson(res, 200, { ok: true, data: await provider.summary(level) });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到 API：${pathname}` });
  };

  // -------------------------------------------------------------------------
  // 入口分发
  // -------------------------------------------------------------------------
  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<number> => {
    const method = req.method ?? "GET";
    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      return sendJson(res, 400, { ok: false, error: "bad_request", message: "请求 URL 不合法" });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      return sendJson(res, 400, { ok: false, error: "bad_request", message: "URL 编码不合法" });
    }

    if (pathname === "/assets/app.css") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/css; charset=utf-8", BASE_CSS);
    }
    if (pathname === "/assets/app.js") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/javascript; charset=utf-8", CLIENT_JS);
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204, baseHeaders());
      res.end();
      return 204;
    }
    if (pathname === "/health") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      const status = await safeTakeoverStatus();
      return sendJson(res, 200, {
        ok: true,
        service: "steward-console",
        version: "0.6.0",
        host,
        port,
        local_only: true,
        halted: status !== null && status.halted === true,
        started_at: startedAt,
        uptime_ms: Date.now() - Date.parse(startedAt),
      });
    }
    if (pathname.startsWith("/api/")) return handleApi(req, res, method, pathname, requestUrl);

    if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
    return handlePage(res, pathname);
  };

  const server = createServer((req, res) => {
    const startedMs = Date.now();
    res.on("error", () => {
      // 客户端提前断开（E2E 关闭浏览器）时不抛未处理异常
    });
    void handleRequest(req, res)
      .then((statusCode) => {
        log(`${req.method ?? "?"} ${req.url ?? "/"} → ${String(statusCode)} ${String(Date.now() - startedMs)}ms`);
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        log(`${req.method ?? "?"} ${req.url ?? "/"} → 500 ${message}`);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: "internal_error", message });
        } else {
          res.end();
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const urlHost = host === "::1" ? "[::1]" : host;
  const url = `http://${urlHost}:${String(actualPort)}`;
  log(`[console] 已启动 ${url}（只监听 ${host}，写操作需 X-Steward-Token）`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // 断开 keep-alive 连接，避免 E2E/CLI 退出时挂起或端口残留
      server.closeAllConnections();
    });
    log("[console] 已关闭");
  };

  return { server, url, host, port: actualPort, token, provider, close };
}
