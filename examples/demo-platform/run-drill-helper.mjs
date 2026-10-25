#!/usr/bin/env node
// demo-platform 演练辅助脚本（可选，零依赖）
//
// 作用：把 examples/demo-platform/server.mjs 作为子进程启动，打印主端口/控制端口 URL，
// 并从 stdin 接受管理命令，方便 CLI/验收进程或人工做 B3/B4 故障演练。
//
// 用法：node run-drill-helper.mjs [--port 4195] [--control-port 4196]
// 命令（每行一条）：
//   state            查看 /admin/state
//   down             模拟断网（主端口停止监听 → 客户端真实 ECONNREFUSED）
//   up               经控制端口恢复主端口监听
//   ban <分钟>       模拟平台封禁（默认 15 分钟；0 = 取消）
//   reset            清空内存数据与封禁
//   shutdown | quit  优雅关闭平台子进程并退出本 helper
//
// 说明：仅用于本地仿真；只监听 127.0.0.1，不产生真实外网请求或真实支付。

import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";

function printUsage() {
  console.log(`用法：node run-drill-helper.mjs [选项]

选项：
  --port <端口>           转发给 server.mjs 的主端口（默认 4195）
  --control-port <端口>   转发给 server.mjs 的控制端口（默认主端口+1）
  -h, --help              显示本帮助

命令（stdin 每行一条）：state | down | up | ban <分钟> | reset | shutdown | quit`);
}

function parseArgs(argv) {
  const args = { port: null, controlPort: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--port") {
      i += 1;
      if (i >= argv.length) {
        console.error("[demo-platform-helper] --port 缺少参数值");
        process.exit(2);
      }
      args.port = String(argv[i]);
    } else if (arg.startsWith("--port=")) {
      args.port = arg.slice("--port=".length);
    } else if (arg === "--control-port") {
      i += 1;
      if (i >= argv.length) {
        console.error("[demo-platform-helper] --control-port 缺少参数值");
        process.exit(2);
      }
      args.controlPort = String(argv[i]);
    } else if (arg.startsWith("--control-port=")) {
      args.controlPort = arg.slice("--control-port=".length);
    } else {
      console.error(`[demo-platform-helper] 未知参数：${arg}`);
      printUsage();
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const serverArgs = [join(ROOT, "server.mjs"), "--json"];
if (args.port !== null) serverArgs.push("--port", args.port);
if (args.controlPort !== null) serverArgs.push("--control-port", args.controlPort);

const child = spawn(process.execPath, serverArgs, {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
});

let startup = null;
let startupResolve;
const ready = new Promise((resolve) => {
  startupResolve = resolve;
});

function handleServerLine(line) {
  if (line.length === 0) return;
  if (startup === null && line.trim().startsWith("{")) {
    try {
      startup = JSON.parse(line.trim());
    } catch {
      /* 非启动 JSON，按普通日志处理 */
    }
    if (startup !== null) {
      console.log(`[demo-platform-helper] server_url=${startup.url}`);
      console.log(`[demo-platform-helper] control_url=${startup.control_url}`);
      console.log(`[demo-platform-helper] pid=${startup.pid}`);
      console.log("[demo-platform-helper] 命令：state | down | up | ban <分钟> | reset | shutdown | quit");
      startupResolve(startup);
      return;
    }
  }
  console.log(`[server] ${line}`);
}

let stdoutBuffer = "";
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString("utf8");
  let index;
  while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.slice(0, index).replace(/\r$/, "");
    stdoutBuffer = stdoutBuffer.slice(index + 1);
    handleServerLine(line);
  }
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(`[helper][server:err] ${chunk}`);
});
child.on("exit", (code, signal) => {
  console.log(`[demo-platform-helper] server 已退出 code=${code}${signal ? ` signal=${signal}` : ""}`);
  process.exit(code ?? 0);
});

function httpJson(method, path, body) {
  const base = startup !== null ? startup.control_url : null;
  if (base === null) return Promise.resolve({ ok: false, error: "server_not_ready" });
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { Connection: "close" };
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = httpRequest(`${base}${path}`, { method, agent: false, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ ok: false, error: "invalid_json", raw });
        }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ ok: false, error: error.code || error.message }));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

async function shutdownChild() {
  if (startup !== null) {
    printResult(await httpJson("POST", "/admin/shutdown"));
  }
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 5000).unref?.();
}

async function runCommand(line) {
  const parts = line.trim().split(/\s+/);
  const command = parts[0] ?? "";
  if (command === "") return;
  if (command === "help") {
    console.log("[demo-platform-helper] 命令：state | down | up | ban <分钟> | reset | shutdown | quit");
    return;
  }
  if (command === "quit" || command === "shutdown") {
    await shutdownChild();
    return;
  }
  if (startup === null) {
    console.log("[demo-platform-helper] 平台尚未就绪，请稍候再试");
    return;
  }
  if (command === "state") return printResult(await httpJson("GET", "/admin/state"));
  if (command === "down") return printResult(await httpJson("POST", "/admin/outage", { mode: "down" }));
  if (command === "up") return printResult(await httpJson("POST", "/admin/outage", { mode: "up" }));
  if (command === "ban") {
    const raw = parts[1];
    const minutes = raw === undefined ? 15 : Number(raw);
    return printResult(await httpJson("POST", "/admin/ban", { minutes }));
  }
  if (command === "reset") return printResult(await httpJson("POST", "/admin/reset"));
  console.log(`[demo-platform-helper] 未知命令：${command}（help 查看命令列表）`);
}

const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
readline.on("line", (line) => {
  void runCommand(line).catch((error) => {
    console.error(`[demo-platform-helper] 命令失败：${error && error.message ? error.message : error}`);
  });
});
readline.on("close", () => {
  // stdin 结束时保持运行（平台子进程仍由父进程/信号管理）；只有收到 quit 才主动关闭
  void ready;
});

process.on("SIGINT", () => {
  void shutdownChild();
  setTimeout(() => process.exit(0), 2000);
});
process.on("SIGTERM", () => {
  if (child.exitCode === null) child.kill();
  process.exit(0);
});
