/**
 * 阶段二 P2：故障演练 CLI（B3 断网 / B4 平台封禁）。
 * 真实故障注入：spawn `examples/demo-platform/server.mjs`（真实 localhost HTTP），
 * 由 steward-fault DrillRunner 执行真实探测/断网/封禁/恢复演练，证据写 runs/drill-*。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { DrillRunner } from "../../../packages/steward-fault/src/index.js";

type Flags = Record<string, string | boolean>;
export interface FaultArgs {
  flags: Flags;
}

const flag = (flags: Flags, name: string): string | undefined => {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
};
const flagNumber = (flags: Flags, name: string, fallback: number): number => {
  const value = flag(flags, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

interface PlatformHandle {
  url: string;
  controlUrl: string;
  port: number;
  child: ReturnType<typeof spawn>;
  logs: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startPlatform(root: string): Promise<PlatformHandle> {
  const script = join(root, "examples", "demo-platform", "server.mjs");
  if (!existsSync(script)) throw new Error(`缺少示例平台：${script}`);
  const child = spawn(process.execPath, [script, "--port", "0", "--json"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  const logs: string[] = [];
  const firstJson = await new Promise<{ url: string; control_url: string; port: number }>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`示例平台 15s 内未就绪：${buffer.slice(0, 300)}`)), 15_000);
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      buffer += text;
      logs.push(text);
      const lines = buffer.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed?.url && parsed?.port) {
            clearTimeout(timer);
            resolve(parsed);
            return;
          }
        } catch {
          /* not json line */
        }
      }
    });
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`示例平台提前退出 code=${code}`));
      }
    });
  });
  // 等 /health 可用（真实网络）
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(new URL("/health", firstJson.url));
      if (response.ok) {
        return { url: firstJson.url, controlUrl: firstJson.control_url ?? firstJson.url, port: firstJson.port, child, logs };
      }
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error("示例平台 /health 未就绪");
}

function stopPlatform(platform: PlatformHandle | null): void {
  if (!platform) return;
  try {
    platform.child.kill();
  } catch {
    /* ignore */
  }
}

export async function cmdFaultDrill(parsed: FaultArgs): Promise<number> {
  const root = findRepoRoot();
  const drillCase = flag(parsed.flags, "case") ?? "net-outage";
  if (drillCase !== "net-outage" && drillCase !== "platform-ban") {
    console.error("--case 只能是 net-outage 或 platform-ban");
    return 2;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const stateDir = join(root, "runs", `drill-${drillCase}-${stamp}`);
  await mkdir(stateDir, { recursive: true });
  const json = parsed.flags.json === true;
  const runner = new DrillRunner();
  let platform: PlatformHandle | null = null;
  const startedAt = Date.now();
  try {
    platform = await startPlatform(root);
    if (json) console.log(JSON.stringify({ ok: true, phase: "platform_started", url: platform.url, control_url: platform.controlUrl, port: platform.port }));
    const common = { platform_url: platform.url, control_url: platform.controlUrl, state_dir: stateDir };
    const result =
      drillCase === "net-outage"
        ? await runner.runNetOutageDrill({
            ...common,
            outage_minutes: flagNumber(parsed.flags, "outage-minutes", 120),
            tick_seconds: flagNumber(parsed.flags, "tick-seconds", 5),
          })
        : await runner.runPlatformBanDrill({
            ...common,
            ban_minutes: flagNumber(parsed.flags, "ban-minutes", 15),
            poll_seconds: flagNumber(parsed.flags, "poll-seconds", 5),
          });
    const durationMs = Date.now() - startedAt;
    if (json) {
      console.log(
        JSON.stringify(
          {
            ...result,
            ok: result.ok === true,
            case: result.case,
            duration_ms: durationMs,
            evidence_dir: stateDir,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`故障演练：${result.case} ok=${result.ok}（耗时 ${Math.round(durationMs / 1000)}s）`);
      if (result.case === "net_outage") {
        console.log(`  断网期间被拒绝承诺：${result.blocked_promises}；排队动作：${result.queued_actions}；重放：${result.replayed}`);
        console.log(`  账本重复：${result.duplicates_found}；恢复≤10min：${result.recovered_within_10min}`);
      } else {
        console.log(`  ban 检测：${result.ban_detected_within_ms}ms；停止动作：${result.stopped}；替代方案条目：${result.alternative_plan.items.length}`);
        console.log(`  通知：${result.notification_path}`);
      }
      console.log(`  证据目录：${stateDir}`);
    }
    return result.ok === true ? 0 : 1;
  } catch (error) {
    console.error(`故障演练失败：${error instanceof Error ? error.message : String(error)}`);
    if (json) console.log(JSON.stringify({ ok: false, error: String(error), evidence_dir: stateDir }));
    return 1;
  } finally {
    stopPlatform(platform);
  }
}

/** 读取一次演练结果（验收脚本用，避免重复解析输出）。 */
export function readDrillResult(stateDir: string): { json: unknown; logs: string[] } | null {
  const file = join(stateDir, "drill-net-outage.json");
  const banFile = join(stateDir, "drill-platform-ban.json");
  const path = existsSync(file) ? file : existsSync(banFile) ? banFile : null;
  if (!path) return null;
  return { json: JSON.parse(readFileSync(path, "utf8")), logs: [] };
}
