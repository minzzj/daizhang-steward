#!/usr/bin/env node
// 代掌 Steward · demo-web 演示服务器（零第三方依赖）
//
// 仅用于本地演示：只监听 127.0.0.1，不连数据库、不访问外网、不落盘。
// 启动：node server.mjs [--port 4173]
// 页面侧故意保留了一个登录超时缺陷，复现与验收见同目录 README.zh-CN.md。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1"; // 只监听回环地址，禁止对外暴露
const DEFAULT_PORT = 4173;
const LOGIN_OK_DELAY_MS = 300; // 正常登录：等待 300ms 后返回 200
const LOGIN_TIMEOUT_DELAY_MS = 4000; // 慢网模拟：等待 4000ms 后返回 504
const PROJECT_DELAY_MS = 150; // 提交项目的轻微延迟，便于观察 loading 态
const MAX_BODY_BYTES = 64 * 1024;

// 内存数据：进程重启即清空，不做持久化
const projects = [];
const startedAt = Date.now();

// 静态资源白名单：不做目录遍历，只返回下面列出的文件
const STATIC_ROUTES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/login", { file: "index.html", type: "text/html; charset=utf-8" }], // 契约文档中的复现路径 /login
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/style.css", { file: "style.css", type: "text/css; charset=utf-8" }],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 统一 JSON 响应；客户端已断开时直接跳过，避免写已关闭的连接
function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// 读取并解析 JSON 请求体；返回 {ok:true, value} 或 {ok:false, error}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { ok: false, error: "请求体过大" };
    chunks.push(chunk);
  }
  if (chunks.length === 0) return { ok: true, value: {} };
  try {
    // 容错：去掉个别命令行工具写入的 UTF-8 BOM（浏览器正常请求不含 BOM）
    const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "请求体必须是 JSON 对象" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "请求体不是合法 JSON" };
  }
}

async function handleLogin(req, res, url) {
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, 400, { ok: false, error: "invalid_body", message: body.error });

  const account = typeof body.value.account === "string" ? body.value.account.trim() : "";
  const password = typeof body.value.password === "string" ? body.value.password : "";
  if (!account || !password) {
    return sendJson(res, 400, { ok: false, error: "missing_credentials", message: "账号和密码不能为空" });
  }

  // 慢网演示：/api/login?timeout=1 → 延迟 4s 后返回 504
  const slowMode = url.searchParams.get("timeout") === "1";
  const delayMs = slowMode ? LOGIN_TIMEOUT_DELAY_MS : LOGIN_OK_DELAY_MS;
  console.log(
    `[demo-web] POST /api/login${slowMode ? "?timeout=1" : ""} → 等待 ${delayMs}ms 后返回 ${slowMode ? 504 : 200}`,
  );
  await sleep(delayMs);

  if (res.writableEnded || res.destroyed) {
    // 页面侧 3s 超时已中止请求（见 app.js）；延迟结束后放弃写响应即可
    console.log("[demo-web] 客户端已中止登录请求，跳过响应写入");
    return;
  }
  if (slowMode) {
    return sendJson(res, 504, { ok: false, error: "request_timeout", message: "请求超时，请重试" });
  }
  return sendJson(res, 200, {
    ok: true,
    token: `demo-session-${randomUUID()}`,
    account,
    display_name: account,
  });
}

async function handleCreateProject(req, res) {
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, 400, { ok: false, error: "invalid_body", message: body.error });

  const name = typeof body.value.name === "string" ? body.value.name.trim() : "";
  const note = typeof body.value.note === "string" ? body.value.note.trim() : "";
  if (!name) return sendJson(res, 400, { ok: false, error: "missing_name", message: "项目名称不能为空" });

  await sleep(PROJECT_DELAY_MS);
  const project = {
    id: randomUUID(),
    name,
    note,
    created_at: new Date().toISOString(),
  };
  projects.unshift(project);
  console.log(`[demo-web] POST /api/projects → 200 项目「${name}」（内存中共 ${projects.length} 条）`);
  return sendJson(res, 200, { ok: true, project });
}

async function serveStatic(pathname, res) {
  if (pathname === "/favicon.ico") {
    // 演示站不提供图标，直接 204，避免浏览器控制台出现 404 噪音
    if (!res.writableEnded && !res.destroyed) {
      res.writeHead(204);
      res.end();
    }
    return;
  }
  const route = STATIC_ROUTES.get(pathname);
  if (!route) {
    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到资源：${pathname}` });
  }
  const data = await readFile(join(ROOT, route.file));
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(200, {
    "Content-Type": route.type,
    "Content-Length": data.length,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "不支持的请求方法" });
}

function createDemoServer() {
  return createServer(async (req, res) => {
    // 客户端提前断开时不抛未处理异常
    res.on("error", () => {});
    req.on("error", () => {});

    let url;
    try {
      url = new URL(req.url ?? "/", `http://${HOST}`);
    } catch {
      return sendJson(res, 400, { ok: false, error: "bad_request", message: "请求 URL 不合法" });
    }

    try {
      if (url.pathname === "/health") {
        if (req.method !== "GET") return methodNotAllowed(res);
        return sendJson(res, 200, {
          ok: true,
          status: "ok",
          service: "demo-web",
          started_at: new Date(startedAt).toISOString(),
          uptime_ms: Date.now() - startedAt,
          projects: projects.length,
        });
      }

      if (url.pathname === "/api/login") {
        if (req.method !== "POST") return methodNotAllowed(res);
        return await handleLogin(req, res, url);
      }

      if (url.pathname === "/api/projects") {
        if (req.method === "POST") return await handleCreateProject(req, res);
        if (req.method === "GET") {
          // 便于自动化/人工核对内存中的项目；重启即清空
          return sendJson(res, 200, { ok: true, projects });
        }
        return methodNotAllowed(res);
      }

      if (req.method === "GET") return await serveStatic(url.pathname, res);
      return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到资源：${url.pathname}` });
    } catch (error) {
      console.error("[demo-web] 请求处理异常：", error);
      return sendJson(res, 500, { ok: false, error: "internal_error", message: "服务器内部错误" });
    }
  });
}

function printUsage() {
  console.log(`用法：node server.mjs [--port <端口>]

选项：
  --port <端口>   监听端口，默认 ${DEFAULT_PORT}（也可用环境变量 PORT）
  -h, --help      显示本帮助

示例：
  node server.mjs
  node server.mjs --port 4180
  PORT=4180 node server.mjs`);
}

function parsePortValue(raw, source) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) {
    console.error(`[demo-web] ${source} 不是合法端口：${raw}`);
    process.exit(2);
  }
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`[demo-web] ${source} 超出端口范围（0-65535）：${raw}`);
    process.exit(2);
  }
  return port;
}

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  if (process.env.PORT !== undefined && process.env.PORT !== "") {
    port = parsePortValue(process.env.PORT, "环境变量 PORT");
  }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--port") {
      i += 1;
      if (i >= argv.length) {
        console.error("[demo-web] --port 缺少参数值");
        process.exit(2);
      }
      port = parsePortValue(argv[i], "--port");
    } else if (arg.startsWith("--port=")) {
      port = parsePortValue(arg.slice("--port=".length), "--port");
    } else {
      console.error(`[demo-web] 未知参数：${arg}`);
      printUsage();
      process.exit(2);
    }
  }
  return port;
}

const port = parseArgs(process.argv);
const server = createDemoServer();

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`[demo-web] 端口 ${port} 已被占用，请先停止占用进程或用 --port 指定其他端口。`);
  } else {
    console.error("[demo-web] 服务器错误：", error);
  }
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : port;
  console.log(`[demo-web] 演示站点已启动：http://${HOST}:${actualPort}/`);
  console.log(`[demo-web] 慢网复现入口：http://${HOST}:${actualPort}/login?timeout=1`);
  console.log("[demo-web] 按 Ctrl+C 停止");
});

// 优雅退出：Ctrl+C / SIGTERM / 任务管理器结束前尽量关闭连接
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[demo-web] 收到 ${signal}，正在关闭服务器…`);
  server.close(() => {
    console.log("[demo-web] 已关闭");
    process.exit(0);
  });
  setTimeout(() => {
    console.warn("[demo-web] 关闭超时，强制退出");
    process.exit(0);
  }, 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
