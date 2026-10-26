/**
 * 真实进程/删除执行器（Windows）：child_process 启动 + PowerShell（tasklist/Stop-Process）停止。
 *
 * - `start(app)`：spawn 受管应用，返回真实 pid；
 * - `stop(app, pid)`：按**本执行器记录的 pid** 停止（绝不按进程名批量杀，避免误杀同名系统进程），
 *   PowerShell `Stop-Process -Id <pid> -Force` + 轮询真实退出；
 * - `list()`：PowerShell `Get-Process` 枚举（只读诊断）；
 * - `remove(app)`：先备份到 `<state_dir>/recycle/…` 再删除受管程序目录/文件，返回备份路径；
 * - 非 Windows 构造/执行抛 `UnsupportedPlatformError`（可注入自定义 `ProcessOps` 替代）。
 */

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { SystemActionError, UnsupportedPlatformError } from "./errors.js";
import { backupToRecycle } from "./recycle.js";
import { assertRemovableTarget } from "./scope.js";
import type { ManagedApp, ProcessInfo, ProcessOps, StartedProcess } from "./types.js";

/** PowerShell 一次性执行结果。 */
export interface PowerShellRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface WindowsProcessOpsOptions {
  /** 受管根目录（remove 的二次范围校验）。 */
  root: string;
  /** 状态目录（recycle 备份落点）。 */
  stateDir: string;
  /** 受管插件根目录（范围校验用；缺省 `<root>/plugins`）。 */
  pluginsDir?: string;
  /** PowerShell 单次超时，默认 20000ms。 */
  timeoutMs?: number;
}

const DEFAULT_PS_TIMEOUT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * 执行一次 Windows PowerShell 脚本（UTF-16LE `-EncodedCommand`，中文/引号安全；输出按 UTF-8 解码）。
 * 非 Windows 抛 `UnsupportedPlatformError`。
 */
export function runPowerShell(script: string, timeoutMs = DEFAULT_PS_TIMEOUT_MS): PowerShellRunResult {
  if (process.platform !== "win32") {
    throw new UnsupportedPlatformError(process.platform, "PowerShell 真实执行仅在 Windows 可用");
  }
  if (typeof script !== "string" || script.trim() === "") {
    throw new SystemActionError("invalid-script", "PowerShell 脚本不能为空");
  }
  const prefix =
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\n" +
    "$OutputEncoding = [System.Text.Encoding]::UTF8\n";
  const encoded = Buffer.from(prefix + script, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { encoding: "utf8", windowsHide: true, timeout: timeoutMs, env: { ...process.env } },
  );
  if (result.error !== undefined) {
    return {
      ok: false,
      exitCode: null,
      stdout: result.stdout ?? "",
      stderr: `${result.error.message}\n${result.stderr ?? ""}`.trim(),
    };
  }
  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** pid 是否仍存活（`process.kill(pid, 0)`；EPERM 视为存活）。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

/**
 * 默认执行器：Windows 真实进程管理。
 * 只在 Windows 上可用；其他平台请注入自定义 `ProcessOps`（见 README「平台限制」）。
 */
export class WindowsProcessOps implements ProcessOps {
  readonly root: string;
  readonly stateDir: string;
  readonly pluginsDir: string;
  readonly timeoutMs: number;
  private readonly children = new Map<number, ChildProcess>();
  private readonly trackedPids = new Map<string, number>();

  constructor(options: WindowsProcessOpsOptions) {
    if (process.platform !== "win32") {
      throw new UnsupportedPlatformError(
        process.platform,
        "默认 WindowsProcessOps 使用 child_process + PowerShell（tasklist/Stop-Process）真实执行",
      );
    }
    this.root = options.root;
    this.stateDir = options.stateDir;
    this.pluginsDir = options.pluginsDir ?? `${options.root}\\plugins`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PS_TIMEOUT_MS;
  }

  /** 真实启动受管应用，返回 pid（spawn 失败抛 SystemActionError）。 */
  async start(app: ManagedApp): Promise<StartedProcess> {
    if (typeof app.command !== "string" || app.command.trim() === "") {
      throw new SystemActionError("invalid-command", `受管应用 ${app.id} 未配置启动命令`);
    }
    if (app.cwd !== undefined && !existsSync(app.cwd)) {
      throw new SystemActionError("cwd-not-found", `受管应用 ${app.id} 的工作目录不存在：${app.cwd}`);
    }
    const child = spawn(app.command, app.args ?? [], {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env },
      ...(app.cwd !== undefined ? { cwd: app.cwd } : {}),
    });
    const pid = await new Promise<number>((resolvePromise, rejectPromise) => {
      const onSpawn = (): void => {
        const spawnedPid = child.pid;
        if (typeof spawnedPid === "number" && spawnedPid > 0) resolvePromise(spawnedPid);
        else rejectPromise(new SystemActionError("spawn-failed", `受管应用 ${app.id} 启动后没有 pid`));
      };
      const onError = (error: Error): void => {
        rejectPromise(
          new SystemActionError("spawn-failed", `受管应用 ${app.id} 启动失败（${app.command}）：${error.message}`),
        );
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
    this.children.set(pid, child);
    this.trackedPids.set(app.id, pid);
    child.once("exit", () => {
      this.children.delete(pid);
    });
    // 子进程不阻塞宿主进程退出（主动 stop 时仍可被 PowerShell 结束）
    child.unref();
    return { pid, started_at: new Date().toISOString() };
  }

  /** 停止受管应用（只按记录 pid 停止；未记录过则返回 false，绝不按名字批量杀进程）。 */
  async stop(app: ManagedApp, pid?: number | null): Promise<boolean> {
    const targetPid = typeof pid === "number" && pid > 0 ? pid : (this.trackedPids.get(app.id) ?? null);
    if (targetPid === null || !isProcessAlive(targetPid)) {
      if (targetPid !== null) this.trackedPids.delete(app.id);
      return false;
    }
    const child = this.children.get(targetPid);
    if (child !== undefined) {
      try {
        child.kill();
      } catch {
        // 交给 PowerShell 兜底
      }
    }
    const result = runPowerShell(
      `Stop-Process -Id ${-(-Math.trunc(targetPid))} -Force -ErrorAction SilentlyContinue; exit 0`,
      this.timeoutMs,
    );
    if (!result.ok) {
      throw new SystemActionError(
        "stop-failed",
        `停止受管应用 ${app.id}（pid=${targetPid}）失败：${result.stderr.trim() || `PowerShell exit=${String(result.exitCode)}`}`,
      );
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!isProcessAlive(targetPid)) {
        this.children.delete(targetPid);
        this.trackedPids.delete(app.id);
        return true;
      }
      await sleep(100);
    }
    const stillAlive = isProcessAlive(targetPid);
    if (!stillAlive) {
      this.children.delete(targetPid);
      this.trackedPids.delete(app.id);
    }
    return !stillAlive;
  }

  /** 真实枚举系统进程（只读诊断；失败时返回空数组）。 */
  async list(): Promise<ProcessInfo[]> {
    const result = runPowerShell(
      "Get-Process -ErrorAction SilentlyContinue | Select-Object -Property Id,ProcessName | ConvertTo-Json -Compress",
      this.timeoutMs,
    );
    if (!result.ok || result.stdout.trim() === "") return [];
    try {
      const parsed: unknown = JSON.parse(result.stdout.trim());
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const processes: ProcessInfo[] = [];
      for (const item of items) {
        if (item === null || typeof item !== "object") continue;
        const record = item as { Id?: unknown; ProcessName?: unknown };
        if (typeof record.Id === "number" && typeof record.ProcessName === "string") {
          processes.push({ pid: record.Id, name: record.ProcessName });
        }
      }
      return processes;
    } catch {
      return [];
    }
  }

  /** 备份并删除受管程序目录/文件（返回备份路径）。 */
  async remove(app: ManagedApp): Promise<string> {
    const sourcePath =
      app.path ?? app.cwd ?? (isAbsolute(app.command) ? app.command : undefined);
    if (sourcePath === undefined) {
      throw new SystemActionError(
        "no-removal-path",
        `受管应用 ${app.id} 未声明可删除路径（请配置 path 或 cwd；不存在可定位的删除目标）`,
      );
    }
    // 二次防御：执行器自己也做一次范围校验（不信任上层）
    const realTarget = assertRemovableTarget({
      root: this.root,
      stateDir: this.stateDir,
      pluginsDir: this.pluginsDir,
      targetPath: sourcePath,
      label: `受管应用 ${app.id}`,
    });
    const backupPath = await backupToRecycle({
      stateDir: this.stateDir,
      sourcePath: realTarget,
      label: `app-${app.id}`,
    });
    try {
      await rm(realTarget, { recursive: true, force: true });
    } catch (error) {
      throw new SystemActionError(
        "remove-failed",
        `删除受管应用 ${app.id} 失败（备份已保留：${backupPath}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return backupPath;
  }

  /** 本执行器记录过的 pid（诊断/审计用）。 */
  getTrackedPid(appId: string): number | null {
    return this.trackedPids.get(appId) ?? null;
  }
}
