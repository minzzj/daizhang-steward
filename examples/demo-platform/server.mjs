#!/usr/bin/env node
// 代掌 Steward · demo-platform：真实 localhost 外部平台 fixtures（零第三方依赖）
//
// 用途：阶段二 P2 故障演练（B3 断网 / B4 封禁）。纯本地仿真平台，只监听 127.0.0.1，
// 不访问外网、不产生真实支付、不保存真实个人信息。
//
// 启动：node server.mjs [--port 4195] [--control-port 4196] [--json] [--quiet]
//
// 重要设计（断网恢复）：
//   - 主端口（默认 4195）承载业务端点；模拟断网时会被真正 close 并销毁所有 socket，
//     于是客户端收到的是操作系统级真实 ECONNREFUSED，而不是伪造错误。
//   - 控制端口（默认主端口 + 1，即 4196）始终只监听 127.0.0.1，负责在主端口不可用时
//     执行 /admin/outage {mode:"up"} 恢复监听。主端口正常时，两个端口都接受 /admin/*。
//   - 详细端点、幂等语义与演练步骤见同目录 README.zh-CN.md。

import { createServer } from "node:http";

const HOST = "127.0.0.1"; // 只监听回环地址，禁止对外暴露
const DEFAULT_PORT = 4195;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BAN_MINUTES = 24 * 60;
const MAX_AUTO_REOPEN_MS = 24 * 60 * 60 * 1000; // 断网自动恢复最长 24 小时（演练默认 1–120 分钟）
const MAX_AMOUNT_CNY = 100_000_000;
const MAX_TEXT_CHARS = 4000;

// 内存状态：进程重启即清空，不落盘、不连数据库
const state = {
  startedAt: Date.now(),
  quotes: [],
  messages: [],
  quoteByKey: new Map(), // idempotency_key -> quote_id
  messageByKey: new Map(), // idempotency_key -> message_id
  threadCounters: new Map(), // thread_id -> 已追加消息数
  quoteCounter: 0,
  messageCounter: 0,
  banUntil: 0, // epoch ms；0 表示未封禁
  outage: false, // 主端口是否处于模拟断网状态
};

let main = null; // { server, sockets }：主端口
let control = null; // { server, sockets }：控制端口（始终监听）
let mainPort = DEFAULT_PORT;
let controlPort = DEFAULT_PORT + 1;
let shuttingDown = false;
let quiet = false;
let jsonMode = false;
// 断网自动恢复定时器：down 请求可带 reopen_after_ms / minutes；
// 主端口断开后无法再经 HTTP 发 up，演练脚本依赖到点自动恢复（控制端口仍可手动恢复）
let autoReopenTimer = null;
let autoReopenAt = null;

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function mainUrl() {
  return `http://${HOST}:${mainPort}`;
}

function controlUrl() {
  return `http://${HOST}:${controlPort}`;
}

// 启动/管理事件日志：非 --json 模式写 stdout；--json 模式写 stderr，
// 保证 stdout 的第一行就是启动 JSON（便于演练脚本/CLI 直接解析）。
function log(message) {
  if (jsonMode) {
    console.error(`[demo-platform] ${message}`);
    return;
  }
  console.log(`[demo-platform] ${message}`);
}

// 请求日志固定写 stdout（方法/路径/状态/耗时，不含请求体内容）
function logRequest(role, req, res, startedAt) {
  if (quiet) return;
  const path = String(req.url ?? "/").split("?")[0];
  const duration = Date.now() - startedAt;
  console.log(`[demo-platform] [${role}] ${req.method} ${path} → ${res.statusCode} ${duration}ms`);
}

// 统一 JSON 响应；客户端已断开时跳过写入
function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

// 读取并解析 JSON 请求体；返回 { ok:true, value } 或 { ok:false, error }
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { ok: false, error: "请求体过大（上限 64KB）" };
    chunks.push(chunk);
  }
  if (chunks.length === 0) return { ok: true, value: {} };
  try {
    const text = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/^\uFEFF/, "");
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "请求体必须是 JSON 对象" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "请求体不是合法 JSON" };
  }
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "请求方法不被支持" });
}

function notFound(res, path) {
  return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到端点：${path}` });
}

// ---------------------------------------------------------------------------
// 封禁（ban）状态
// ---------------------------------------------------------------------------

function banSnapshot() {
  const now = Date.now();
  if (state.banUntil > now) {
    return {
      active: true,
      until: new Date(state.banUntil).toISOString(),
      remaining_ms: state.banUntil - now,
    };
  }
  state.banUntil = 0;
  return { active: false, until: null, remaining_ms: 0 };
}

// 业务端点封禁拦截：返回 true 表示已响应 403
function rejectIfBanned(res) {
  const ban = banSnapshot();
  if (!ban.active) return false;
  sendJson(
    res,
    403,
    {
      ok: false,
      error: "platform_banned",
      retry_after_ms: ban.remaining_ms,
      until: ban.until,
      message: "平台封禁模拟中：业务端点暂停（/health 不受影响）",
    },
    {
      "x-platform-ban": "true",
      "Retry-After": String(Math.ceil(ban.remaining_ms / 1000)),
    },
  );
  return true;
}

// ---------------------------------------------------------------------------
// 业务端点：/health、/quote、/message（幂等）
// ---------------------------------------------------------------------------

function handleHealth(res) {
  return sendJson(res, 200, { ok: true, ts: nowIso() });
}

async function handleQuote(req, res) {
  if (rejectIfBanned(res)) return;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return sendJson(res, 400, { ok: false, error: "invalid_body", message: parsed.error });

  const idempotencyKey = trimmedString(parsed.value.idempotency_key);
  if (!idempotencyKey) {
    return sendJson(res, 400, {
      ok: false,
      error: "missing_idempotency_key",
      message: "idempotency_key 必填：同一 key 只会创建一张报价单",
    });
  }

  // 幂等：同 key 直接返回首次创建结果，不重复建单
  const existingQuoteId = state.quoteByKey.get(idempotencyKey);
  if (existingQuoteId !== undefined) {
    const quote = state.quotes.find((item) => item.quote_id === existingQuoteId) ?? null;
    return sendJson(res, 200, { ok: true, quote_id: existingQuoteId, duplicate: true, quote });
  }

  const customer = trimmedString(parsed.value.customer);
  if (!customer) {
    return sendJson(res, 400, { ok: false, error: "missing_customer", message: "customer 必填" });
  }
  if (customer.length > 200) {
    return sendJson(res, 400, { ok: false, error: "invalid_customer", message: "customer 超长（≤200 字符）" });
  }
  const amount = parsed.value.amount_cny;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT_CNY) {
    return sendJson(res, 400, {
      ok: false,
      error: "invalid_amount_cny",
      message: `amount_cny 必须是 0–${MAX_AMOUNT_CNY} 之间的数字（单位：元）`,
    });
  }
  const note = trimmedString(parsed.value.note);
  if (note.length > 2000) {
    return sendJson(res, 400, { ok: false, error: "invalid_note", message: "note 超长（≤2000 字符）" });
  }

  state.quoteCounter += 1;
  const quote = {
    quote_id: `quote-${String(state.quoteCounter).padStart(4, "0")}`,
    customer,
    amount_cny: amount,
    note,
    created_at: nowIso(),
  };
  state.quotes.push(quote);
  state.quoteByKey.set(idempotencyKey, quote.quote_id);
  return sendJson(res, 200, { ok: true, quote_id: quote.quote_id, duplicate: false, quote });
}

async function handleMessage(req, res) {
  if (rejectIfBanned(res)) return;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return sendJson(res, 400, { ok: false, error: "invalid_body", message: parsed.error });

  const idempotencyKey = trimmedString(parsed.value.idempotency_key);
  if (!idempotencyKey) {
    return sendJson(res, 400, {
      ok: false,
      error: "missing_idempotency_key",
      message: "idempotency_key 必填：同一 key 只会追加一条消息",
    });
  }

  const existingMessageId = state.messageByKey.get(idempotencyKey);
  if (existingMessageId !== undefined) {
    const message = state.messages.find((item) => item.message_id === existingMessageId) ?? null;
    return sendJson(res, 200, {
      ok: true,
      message_id: existingMessageId,
      duplicate: true,
      thread_id: message ? message.thread_id : null,
      message,
    });
  }

  const threadId = trimmedString(parsed.value.thread_id);
  if (!threadId) {
    return sendJson(res, 400, { ok: false, error: "missing_thread_id", message: "thread_id 必填" });
  }
  const text = trimmedString(parsed.value.text);
  if (!text) {
    return sendJson(res, 400, { ok: false, error: "missing_text", message: "text 必填" });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return sendJson(res, 400, { ok: false, error: "invalid_text", message: `text 超长（≤${MAX_TEXT_CHARS} 字符）` });
  }

  const threadSeq = (state.threadCounters.get(threadId) ?? 0) + 1;
  state.threadCounters.set(threadId, threadSeq);
  state.messageCounter += 1;
  const message = {
    message_id: `msg-${String(state.messageCounter).padStart(4, "0")}`,
    thread_id: threadId,
    text,
    thread_seq: threadSeq,
    created_at: nowIso(),
  };
  state.messages.push(message);
  state.messageByKey.set(idempotencyKey, message.message_id);
  return sendJson(res, 200, {
    ok: true,
    message_id: message.message_id,
    duplicate: false,
    thread_id: threadId,
    thread_seq: threadSeq,
    message,
  });
}

// ---------------------------------------------------------------------------
// 管理端点：/admin/state、/admin/outage、/admin/ban、/admin/reset、/admin/shutdown
// ---------------------------------------------------------------------------

function handleAdminState(res) {
  return sendJson(res, 200, {
    ok: true,
    ts: nowIso(),
    quotes: state.quotes.length,
    messages: state.messages.length,
    bans: banSnapshot(),
    outage: state.outage,
    auto_reopen_at: autoReopenAt === null ? null : new Date(autoReopenAt).toISOString(),
    port: mainPort,
    control_port: controlPort,
    main_url: mainUrl(),
    control_url: controlUrl(),
    counters: { quote: state.quoteCounter, message: state.messageCounter },
    quote_list: state.quotes,
    message_list: state.messages,
    uptime_ms: Date.now() - state.startedAt,
  });
}

function recoveryHint() {
  return {
    method: "POST",
    url: `${controlUrl()}/admin/outage`,
    body: { mode: "up" },
    hint: "主端口恢复只能走控制端口：down 之后主端口已不再监听，无法再收到 HTTP 请求",
  };
}

// 解析 down 请求里的可选自动恢复参数：reopen_after_ms（毫秒，优先）或 minutes（分钟，可为小数）
function parseReopenDelay(body) {
  if (body.reopen_after_ms !== undefined && body.reopen_after_ms !== null) {
    const value = Number(body.reopen_after_ms);
    if (!Number.isFinite(value) || value < 1 || value > MAX_AUTO_REOPEN_MS) {
      return { ok: false, message: `reopen_after_ms 必须是 1–${MAX_AUTO_REOPEN_MS} 的毫秒数` };
    }
    return { ok: true, delayMs: Math.round(value), source: "reopen_after_ms" };
  }
  if (body.minutes !== undefined && body.minutes !== null) {
    const value = Number(body.minutes);
    if (!Number.isFinite(value) || value <= 0 || value * 60_000 > MAX_AUTO_REOPEN_MS) {
      return { ok: false, message: `minutes 必须是 >0 且不超过 ${MAX_AUTO_REOPEN_MS / 60_000} 的分钟数` };
    }
    return { ok: true, delayMs: Math.max(1, Math.round(value * 60_000)), source: "minutes" };
  }
  return { ok: true, delayMs: null, source: null };
}

function cancelAutoReopen() {
  if (autoReopenTimer !== null) {
    clearTimeout(autoReopenTimer);
    autoReopenTimer = null;
  }
  autoReopenAt = null;
}

// 到点自动恢复监听：供演练脚本在 down 时传 reopen_after_ms（主端口断开后无法再发 HTTP up）
function scheduleAutoReopen(delayMs) {
  cancelAutoReopen();
  autoReopenAt = Date.now() + delayMs;
  const plannedAt = new Date(autoReopenAt).toISOString();
  autoReopenTimer = setTimeout(async () => {
    autoReopenTimer = null;
    autoReopenAt = null;
    if (!state.outage) return;
    try {
      await startMainListener(mainPort);
      log(`自动恢复完成：主端口重新监听 ${mainUrl()}（计划时间 ${plannedAt}）`);
    } catch (error) {
      console.error(
        `[demo-platform] 自动恢复失败：${error && (error.code || error.message)}（可用控制端口 /admin/outage {mode:"up"} 手动恢复）`,
      );
    }
  }, delayMs);
  if (typeof autoReopenTimer.unref === "function") autoReopenTimer.unref();
  log(`已安排自动恢复：${delayMs}ms 后重新监听主端口（计划 ${plannedAt}）`);
}

function outagePayload(extra = {}) {
  return {
    ok: true,
    mode: "down",
    outage: true,
    control_url: controlUrl(),
    recovery: recoveryHint(),
    auto_reopen: autoReopenTimer !== null,
    reopen_after_ms: autoReopenAt === null ? null : Math.max(0, autoReopenAt - Date.now()),
    reopen_at: autoReopenAt === null ? null : new Date(autoReopenAt).toISOString(),
    ...extra,
  };
}

async function handleAdminOutage(req, res) {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return sendJson(res, 400, { ok: false, error: "invalid_body", message: parsed.error });
  const mode = parsed.value.mode;
  if (mode !== "down" && mode !== "up") {
    return sendJson(res, 400, { ok: false, error: "invalid_mode", message: 'mode 必须是 "down" 或 "up"' });
  }

  if (mode === "down") {
    const reopen = parseReopenDelay(parsed.value);
    if (!reopen.ok) {
      return sendJson(res, 400, { ok: false, error: "invalid_reopen", message: reopen.message });
    }
    if (state.outage) {
      if (reopen.delayMs !== null) scheduleAutoReopen(reopen.delayMs);
      return sendJson(res, 200, outagePayload({ already: true }));
    }
    // 立即停止接受新连接（server.close 只关 listener，不打断当前响应）；
    // 本次响应仍走已建立的连接返回；其余连接 100ms 后销毁。
    state.outage = true;
    if (reopen.delayMs !== null) scheduleAutoReopen(reopen.delayMs);
    stopMainListener("admin 触发模拟断网");
    return sendJson(
      res,
      200,
      outagePayload({
        message:
          reopen.delayMs === null
            ? "主端口已停止监听；之后的连接会收到真实 ECONNREFUSED（需经控制端口手动 up）"
            : `主端口已停止监听；${reopen.delayMs}ms 后自动恢复（也可经控制端口手动 up）`,
      }),
      { Connection: "close" },
    );
  }

  // mode === "up"：主端口不可达时由控制端口执行恢复；主端口正常时为幂等 no-op
  cancelAutoReopen();
  if (!state.outage && main !== null) {
    return sendJson(res, 200, { ok: true, mode: "up", already: true, outage: false, url: mainUrl() });
  }
  try {
    await startMainListener(mainPort);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: "listen_failed",
      message: `主端口 ${mainPort} 重新监听失败：${error && (error.code || error.message)}`,
    });
  }
  log(`模拟断网已恢复：主端口重新监听 ${mainUrl()}`);
  return sendJson(res, 200, { ok: true, mode: "up", outage: false, url: mainUrl() });
}

async function handleAdminBan(req, res) {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return sendJson(res, 400, { ok: false, error: "invalid_body", message: parsed.error });
  const rawMinutes = parsed.value.minutes;
  const minutes = typeof rawMinutes === "number" ? rawMinutes : Number(rawMinutes);
  // 允许小数分钟（演练脚本会按加速比例传 effectiveBanMs/60000，例如 0.033）
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_BAN_MINUTES) {
    return sendJson(res, 400, {
      ok: false,
      error: "invalid_minutes",
      message: `minutes 必须是 0–${MAX_BAN_MINUTES} 的数字（0 = 取消封禁；支持小数分钟，如 0.05）`,
    });
  }
  if (minutes === 0) {
    state.banUntil = 0;
    log("模拟平台封禁已取消（minutes=0）");
    return sendJson(res, 200, { ok: true, minutes: 0, bans: banSnapshot() });
  }
  const durationMs = Math.max(1, Math.round(minutes * 60_000));
  state.banUntil = Date.now() + durationMs;
  log(`模拟平台封禁 ${minutes} 分钟（${durationMs}ms），至 ${new Date(state.banUntil).toISOString()}`);
  return sendJson(res, 200, { ok: true, minutes, duration_ms: durationMs, bans: banSnapshot() });
}

function handleAdminReset(res) {
  const cleared = {
    quotes: state.quotes.length,
    messages: state.messages.length,
    ban: banSnapshot().active,
  };
  state.quotes.length = 0;
  state.messages.length = 0;
  state.quoteByKey.clear();
  state.messageByKey.clear();
  state.threadCounters.clear();
  state.quoteCounter = 0;
  state.messageCounter = 0;
  state.banUntil = 0;
  log(`已重置内存数据：quotes=${cleared.quotes}, messages=${cleared.messages}, ban=${cleared.ban}（断网状态不变）`);
  return sendJson(res, 200, {
    ok: true,
    cleared,
    quotes: 0,
    messages: 0,
    bans: banSnapshot(),
    outage: state.outage,
  });
}

function handleAdminShutdown(res) {
  res.once("finish", () => {
    setTimeout(() => shutdown("HTTP /admin/shutdown"), 30);
  });
  return sendJson(res, 200, { ok: true, shutting_down: true, ts: nowIso() }, { Connection: "close" });
}

async function handleAdmin(req, res, path) {
  if (path === "/admin/state") return req.method === "GET" ? handleAdminState(res) : methodNotAllowed(res);
  if (path === "/admin/outage") return req.method === "POST" ? handleAdminOutage(req, res) : methodNotAllowed(res);
  if (path === "/admin/ban") return req.method === "POST" ? handleAdminBan(req, res) : methodNotAllowed(res);
  if (path === "/admin/reset") return req.method === "POST" ? handleAdminReset(res) : methodNotAllowed(res);
  if (path === "/admin/shutdown") return req.method === "POST" ? handleAdminShutdown(res) : methodNotAllowed(res);
  return notFound(res, path);
}

// ---------------------------------------------------------------------------
// HTTP 服务器与监听生命周期
// ---------------------------------------------------------------------------

function createHttpServer(role) {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const startedAt = Date.now();
    res.on("finish", () => logRequest(role, req, res, startedAt));
    void route(req, res, role).catch((error) => {
      console.error(`[demo-platform] [${role}] 请求处理异常：`, error && error.message ? error.message : error);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: "internal_error", message: "服务器内部错误" });
      } else {
        try {
          res.destroy();
        } catch {
          /* ignore */
        }
      }
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  });
  return { server, sockets };
}

function listenBundle(bundle, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      bundle.server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      bundle.server.removeListener("error", onError);
      resolve();
    };
    bundle.server.once("error", onError);
    bundle.server.once("listening", onListening);
    bundle.server.listen(port, HOST);
  }).then(() => {
    bundle.server.on("error", (error) => {
      console.error(`[demo-platform] 监听错误：${error && (error.code || error.message)}`);
    });
    return bundle.server.address().port;
  });
}

async function startMainListener(desiredPort) {
  const bundle = createHttpServer("main");
  let port;
  try {
    port = await listenBundle(bundle, desiredPort);
  } catch (error) {
    try {
      bundle.server.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
  main = bundle;
  mainPort = port;
  state.outage = false;
  log(`主端口已监听：${mainUrl()}`);
  return port;
}

async function startControlListener(desiredPort) {
  const bundle = createHttpServer("control");
  let port;
  try {
    port = await listenBundle(bundle, desiredPort);
  } catch (error) {
    try {
      bundle.server.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
  control = bundle;
  controlPort = port;
  log(`控制端口已监听：${controlUrl()}（断网恢复专用）`);
  return port;
}

// 真实断网：立即关闭主端口 listener（server.close 只停止接受新连接，不打断当前响应），
// 已建立的连接给 100ms 把响应送完后再销毁 → 新连接收到操作系统级 ECONNREFUSED。
// 注意：本函数在 down 请求的响应发送前调用（响应走已建立的连接，不受影响）。
function stopMainListener(reason) {
  const bundle = main;
  state.outage = true;
  if (bundle === null) return;
  main = null;
  try {
    bundle.server.close(() => {
      log(`主端口 ${mainPort} 已停止监听（${reason}）：客户端将收到真实 ECONNREFUSED`);
    });
  } catch {
    /* ignore */
  }
  const timer = setTimeout(() => {
    for (const socket of bundle.sockets) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    bundle.sockets.clear();
  }, 100);
  if (typeof timer.unref === "function") timer.unref();
  log(`主端口 ${mainPort} 立即停止监听（${reason}）：新连接将收到真实 ECONNREFUSED；用控制端口 /admin/outage {mode:"up"} 或 reopen_after_ms 自动恢复`);
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

async function route(req, res, role) {
  let url;
  try {
    url = new URL(req.url ?? "/", `http://${HOST}`);
  } catch {
    return sendJson(res, 400, { ok: false, error: "bad_request", message: "请求 URL 不合法" });
  }
  const path = url.pathname;

  if (role === "main") {
    if (path === "/health") return req.method === "GET" ? handleHealth(res) : methodNotAllowed(res);
    if (path === "/quote") return req.method === "POST" ? await handleQuote(req, res) : methodNotAllowed(res);
    if (path === "/message") return req.method === "POST" ? await handleMessage(req, res) : methodNotAllowed(res);
    if (path.startsWith("/admin/")) return await handleAdmin(req, res, path);
    return notFound(res, path);
  }

  // control：只接受 /health 与 /admin/*；业务端点必须走主端口
  if (path === "/health") return req.method === "GET" ? handleHealth(res) : methodNotAllowed(res);
  if (path.startsWith("/admin/")) return await handleAdmin(req, res, path);
  return sendJson(res, 404, {
    ok: false,
    error: "not_found",
    message: "控制端口只接受 /health 与 /admin/*；业务端点请访问主端口",
  });
}

// ---------------------------------------------------------------------------
// 启动 / 关闭 / 参数
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`用法：node server.mjs [选项]

选项：
  --port <端口>           主端口（业务端点），默认 ${DEFAULT_PORT}（也可用环境变量 PORT；0=随机端口）
  --control-port <端口>   控制端口（断网恢复用），默认主端口+1（也可用环境变量 CONTROL_PORT；0=随机端口）
  --json                  启动成功后向 stdout 打印一行 JSON：{"ok":true,"url":...,"port":...,"control_url":...}
  --quiet                 不打印请求日志（仍打印启动/管理事件）
  -h, --help              显示本帮助

示例：
  node server.mjs
  node server.mjs --port 0 --json
  node server.mjs --port 4195 --control-port 4196 --json`);
}

function errorExit(message) {
  console.error(`[demo-platform] ${message}`);
  process.exit(1);
}

function parsePortValue(raw, source) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) {
    console.error(`[demo-platform] ${source} 不是合法端口：${raw}`);
    process.exit(2);
  }
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`[demo-platform] ${source} 超出端口范围（0-65535）：${raw}`);
    process.exit(2);
  }
  return port;
}

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, controlPort: null, json: false, quiet: false };
  if (process.env.PORT !== undefined && process.env.PORT !== "") {
    args.port = parsePortValue(process.env.PORT, "环境变量 PORT");
  }
  if (process.env.CONTROL_PORT !== undefined && process.env.CONTROL_PORT !== "") {
    args.controlPort = parsePortValue(process.env.CONTROL_PORT, "环境变量 CONTROL_PORT");
  }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--quiet") {
      args.quiet = true;
    } else if (arg === "--port") {
      i += 1;
      if (i >= argv.length) {
        console.error("[demo-platform] --port 缺少参数值");
        process.exit(2);
      }
      args.port = parsePortValue(argv[i], "--port");
    } else if (arg.startsWith("--port=")) {
      args.port = parsePortValue(arg.slice("--port=".length), "--port");
    } else if (arg === "--control-port") {
      i += 1;
      if (i >= argv.length) {
        console.error("[demo-platform] --control-port 缺少参数值");
        process.exit(2);
      }
      args.controlPort = parsePortValue(argv[i], "--control-port");
    } else if (arg.startsWith("--control-port=")) {
      args.controlPort = parsePortValue(arg.slice("--control-port=".length), "--control-port");
    } else {
      console.error(`[demo-platform] 未知参数：${arg}`);
      printUsage();
      process.exit(2);
    }
  }
  if (args.controlPort !== null && args.controlPort === args.port && args.port !== 0) {
    console.error(`[demo-platform] 控制端口不能与主端口相同：${args.port}`);
    process.exit(2);
  }
  return args;
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  cancelAutoReopen();
  log(`正在关闭（${reason}）…`);
  const closeBundle = (bundle) =>
    new Promise((resolve) => {
      if (bundle === null) return resolve();
      for (const socket of bundle.sockets) {
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
      }
      bundle.sockets.clear();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        bundle.server.close(finish);
      } catch {
        finish();
      }
      const timer = setTimeout(finish, 800);
      if (typeof timer.unref === "function") timer.unref();
    });
  Promise.all([closeBundle(main), closeBundle(control)]).then(() => {
    main = null;
    control = null;
    log("已关闭，端口已释放");
    setTimeout(() => process.exit(0), 20);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  console.error("[demo-platform] 未捕获异常：", error);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("[demo-platform] 未处理 Promise 拒绝：", reason);
});

async function boot() {
  const args = parseArgs(process.argv);
  quiet = args.quiet;
  jsonMode = args.json;

  try {
    await startMainListener(args.port);
  } catch (error) {
    errorExit(`主端口 ${args.port} 监听失败：${error && (error.code || error.message)}（端口被占用？可用 --port 换端口）`);
  }

  // 控制端口候选：显式指定则只用它；否则尝试 主端口+1 … 主端口+20
  const candidates = [];
  if (args.controlPort !== null) {
    candidates.push(args.controlPort);
  } else {
    for (let offset = 1; offset <= 20; offset += 1) {
      const candidate = mainPort + offset;
      if (candidate > 65535) break;
      candidates.push(candidate);
    }
  }
  let controlError = null;
  for (const candidate of candidates) {
    try {
      await startControlListener(candidate);
      controlError = null;
      break;
    } catch (error) {
      controlError = error;
      if (args.controlPort !== null) break;
    }
  }
  if (control === null) {
    errorExit(
      `控制端口监听失败：${controlError && (controlError.code || controlError.message)}（断网恢复需要控制端口；可用 --control-port 指定）`,
    );
  }

  const payload = {
    ok: true,
    url: mainUrl(),
    port: mainPort,
    control_url: controlUrl(),
    control_port: controlPort,
    pid: process.pid,
  };
  if (args.json) {
    // --json：第一行即为可解析的启动 JSON（请求日志在其后逐行输出）
    console.log(JSON.stringify(payload));
  } else {
    log(`演示平台已启动：${payload.url}`);
    log(`控制端口（断网恢复用）：${payload.control_url}`);
    log(`请求日志输出到 stdout；按 Ctrl+C 或 POST /admin/shutdown 优雅关闭`);
  }
}

void boot();
