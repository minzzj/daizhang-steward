/**
 * 代掌 Steward · E2E 共享工具：自管 demo-web 服务
 *
 * - 启动：spawn `node <workdir>/server.mjs --port <port>`（只监听 127.0.0.1）
 * - 就绪：轮询 `GET /health` 直到 200（失败时带 server.mjs 输出方便排查端口占用）
 * - 停止：Windows 用 `taskkill /PID /T /F` 结束进程树，其它平台 SIGTERM；
 *   停止后确认端口已释放，并把服务端输出写到 `<evidenceDir>/server.log`
 * - 零第三方依赖，只使用 node 内置模块
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_PORT = 4173;
const HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

/** 等待指定毫秒。 */
export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** 统一的错误文本（不含堆栈，便于写 result.json）。 */
export function errorText(error) {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** 轮询 `check()` 直到返回 true 或超时。 */
export async function waitUntil(check, timeoutMs, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function serverLogText(logs) {
  return logs.join("");
}

/** 截取 server.mjs 输出末尾若干行（用于启动失败时定位原因）。 */
export function formatServerLogTail(logs, maxLines = 20) {
  const text = serverLogText(logs).trim();
  if (text === "") return "（无输出）";
  return text.split(/\r?\n/).slice(-maxLines).join("\n");
}

async function fetchHealth(baseUrl, timeoutMs = 1000) {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 启动 demo-web 并等待 /health 200。
 * @returns {Promise<{baseUrl: string, port: number, pid: number|undefined, health: object, logs: string[], child: import("node:child_process").ChildProcess, stop: () => Promise<{released: boolean, exited: boolean, exitCode: number|null, forced: boolean, log: string}>}>}
 */
export async function startDemoServer({ workdir, port = DEFAULT_PORT, evidenceDir }) {
  const baseUrl = `http://${HOST}:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["server.mjs", "--port", String(port)], {
    cwd: workdir,
    // PORT 置空，避免外层环境变量覆盖 --port
    env: { ...process.env, NO_COLOR: "1", PORT: "" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  let stopResult = null;

  const killProcessTree = () => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (result.error) {
        try {
          child.kill("SIGKILL");
        } catch {
          // 进程已退出
        }
      }
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        // 进程已退出
      }
    }
  };

  const waitForExit = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) return true;
      await sleep(100);
    }
    return child.exitCode !== null || child.signalCode !== null;
  };

  const stop = async () => {
    if (stopResult !== null) return stopResult;
    killProcessTree();
    const exited = await waitForExit(STOP_TIMEOUT_MS);
    // 端口释放检查：/health 不再可访问即视为已释放（避免 4173 残留）
    const released = exited
      ? await waitUntil(async () => {
          try {
            await fetchHealth(baseUrl, 800);
            return false;
          } catch {
            return true;
          }
        }, STOP_TIMEOUT_MS)
      : false;
    const log = serverLogText(logs);
    if (evidenceDir) {
      try {
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(join(evidenceDir, "server.log"), log, "utf8");
      } catch {
        // 证据写入失败不阻止清理
      }
    }
    stopResult = { released, exited, exitCode: child.exitCode, forced: process.platform === "win32", log };
    return stopResult;
  };

  // 等 /health 200；若进程提前退出（如端口占用）立即失败并带上服务端输出
  const health = await waitForHealth(baseUrl, { isExited: () => child.exitCode !== null });
  if (health === null) {
    await stop();
    const hint =
      child.exitCode !== null
        ? `demo-web 进程提前退出（退出码 ${child.exitCode}），端口 ${port} 可能被占用。`
        : `demo-web 健康检查超时（${HEALTH_TIMEOUT_MS / 1000}s）：${baseUrl}/health 未返回 200，端口 ${port} 可能被占用。`;
    throw new Error(`${hint}\n请先停止占用 ${port} 端口的进程，或用 --port 指定其它端口。\n--- server.mjs 输出 ---\n${formatServerLogTail(logs)}`);
  }

  return { baseUrl, port, pid: child.pid, health, logs, child, stop };
}

async function waitForHealth(baseUrl, { timeoutMs = HEALTH_TIMEOUT_MS, isExited = () => false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isExited()) return null;
    try {
      const health = await fetchHealth(baseUrl);
      if (health !== null && health.ok === true) return health;
    } catch {
      // 服务未就绪，继续轮询
    }
    await sleep(150);
  }
  return null;
}
