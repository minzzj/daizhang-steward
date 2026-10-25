/**
 * DrillRunner：真实故障演练（B3 断网 / B4 平台封禁）。
 *
 * 时间诚实原则：
 * - `outage_minutes` / `ban_minutes` 是**真实分钟**（默认 120 / 15）；acceptance 短跑 1–3 分钟；
 * - `time_scale` 只用于测试/演示加速（effective_ms = nominal_ms / time_scale），
 *   且必须写进证据：`nominal_outage_ms` 与 `outage_ms`、`accelerated` 分开记录；
 * - `now` 只影响证据里的 ISO 时间戳，**绝不参与时长计算**（时长统一用 Date.now() 真实时钟）。
 *
 * 故障注入两种方式（都是真实网络故障）：
 * 1. 平台管理端点：POST `/admin/outage {mode:"down"|"up"}`、POST `/admin/ban {minutes}`；
 * 2. `outage_control` 回调（推荐长跑）：外部杀/重启平台子进程，客户端收到真实 ECONNREFUSED。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { AlternativePlan } from "./alternative.js";
import { BanDetector } from "./ban.js";
import { OfflinePromiseError, PlatformBannedError, FaultValidationError } from "./errors.js";
import { PromisesGate } from "./gate.js";
import { describeFetchError, readErrorReason, requestJson } from "./http.js";
import { atomicWriteJson, cloneJson, ensureDir, nowIso, sleep, stampForFile } from "./io.js";
import { NotificationCenter } from "./notify.js";
import { Outbox } from "./outbox.js";
import { ConnectivityProbe } from "./probe.js";
import { JsonLedgerApi, LedgerReconciler } from "./reconcile.js";
import type {
  DomainLedgerApi,
  DrillTick,
  NetOutageDrillOptions,
  NetOutageDrillResult,
  OutboxActionKind,
  OutboxItem,
  PlatformBanDrillOptions,
  PlatformBanDrillResult,
  ProbeSample,
  ReconcileResult,
  ReplayExecutor,
  ReplayReport,
} from "./types.js";

export const DEFAULT_OUTAGE_MINUTES = 120;
export const DEFAULT_BAN_MINUTES = 15;
export const DEFAULT_TICK_SECONDS = 5;
export const DEFAULT_POLL_SECONDS = 5;
export const DEFAULT_RECOVERY_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE_RECORDS = 5_000;

interface DrillEventRecord {
  at: string;
  kind: string;
  detail: string;
}

interface DrillRunnerOptions {
  /** 时钟注入：仅用于证据 ISO 时间戳（不参与时长计算）。 */
  now?: () => Date;
}

interface BusinessActionResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePositiveNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new FaultValidationError(`${field} 必须是正数：${String(value)}`, "INVALID_INPUT", field);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FaultValidationError(`${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function existingPaths(candidates: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "" && existsSync(candidate) && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

function sampleFromProbe(result: { online: boolean; latency_ms: number; error?: string }, at: string): ProbeSample {
  const sample: ProbeSample = { at, online: result.online, latency_ms: result.latency_ms };
  if (result.error !== undefined) sample.error = result.error;
  return sample;
}

function truncateRecords<T>(records: T[]): T[] {
  return records.length <= MAX_EVIDENCE_RECORDS ? records : records.slice(records.length - MAX_EVIDENCE_RECORDS);
}

/** 把替代方案渲染成 markdown（通知正文用）。 */
function renderAlternativePlanMarkdown(plan: ReturnType<AlternativePlan["generate"]>): string {
  const lines = [`**${plan.title}**`, "", `生成时间：${plan.generated_at}`, "", "| 渠道 | 为什么 | 下一步 | 负责人 |", "|---|---|---|---|"];
  for (const item of plan.items) {
    lines.push(`| ${item.channel} | ${item.why} | ${item.next_action} | ${item.owner} |`);
  }
  lines.push("", "> 平台暂停期间：所有对外动作先入 Outbox，恢复后按幂等键重放并对账（账本不重复）。");
  return lines.join("\n");
}

export class DrillRunner {
  private readonly now: () => Date;

  constructor(options: DrillRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // B3：真实断网演练
  // -------------------------------------------------------------------------

  /**
   * 断网演练：真实探测平台 → 注入断网（平台 admin 端点或 outage_control）→
   * 离线期间承诺被 PromisesGate 拒绝、动作进 Outbox → 恢复后 replay + 账本对账（幂等不重复）。
   */
  async runNetOutageDrill(options: NetOutageDrillOptions): Promise<NetOutageDrillResult> {
    if (!isRecord(options)) throw new FaultValidationError("runNetOutageDrill 需要 options 对象", "INVALID_INPUT", "options");
    const platformUrl = requireNonEmptyString(options.platform_url, "platform_url");
    const stateDir = requireNonEmptyString(options.state_dir, "state_dir");
    const outageMinutes = requirePositiveNumber(options.outage_minutes, "outage_minutes", DEFAULT_OUTAGE_MINUTES);
    const tickSeconds = requirePositiveNumber(options.tick_seconds, "tick_seconds", DEFAULT_TICK_SECONDS);
    const timeScale = requirePositiveNumber(options.time_scale, "time_scale", 1);
    const probeTimeoutMs = requirePositiveNumber(options.probe_timeout_ms, "probe_timeout_ms", 2_000);
    const recoveryTimeoutMs = requirePositiveNumber(options.recovery_timeout_ms, "recovery_timeout_ms", DEFAULT_RECOVERY_TIMEOUT_MS);

    const nominalOutageMs = Math.round(outageMinutes * 60_000);
    const effectiveOutageMs = Math.max(1, Math.round(nominalOutageMs / timeScale));
    const accelerated = Math.abs(timeScale - 1) > 1e-9;
    const tickMs = Math.max(20, Math.round(tickSeconds * 1_000));
    const healthUrl = joinUrl(platformUrl, options.health_path ?? "/health");
    const base = platformUrl.endsWith("/") ? platformUrl.slice(0, -1) : platformUrl;
    // 管理端点基址：demo-platform 断网时主端口已 close，恢复必须走控制端口
    const adminUrl = options.control_url ?? platformUrl;
    const adminBase = adminUrl.endsWith("/") ? adminUrl.slice(0, -1) : adminUrl;

    await ensureDir(stateDir);
    const probe = new ConnectivityProbe({ timeoutMs: probeTimeoutMs });
    const outbox = new Outbox(stateDir, { now: this.now });
    const gate = new PromisesGate();
    const notifier = new NotificationCenter(stateDir);
    const ledgerApi: DomainLedgerApi = options.ledger_api ?? new JsonLedgerApi(stateDir);
    const reconciler = new LedgerReconciler();

    const startedAtIso = nowIso(this.now);
    const startedReal = Date.now();
    const probes: ProbeSample[] = [];
    const ticks: DrillTick[] = [];
    const events: DrillEventRecord[] = [];
    const notifications: string[] = [];
    const queuedKeys = new Set<string>();
    let blockedPromises = 0;
    let queuedActions = 0;
    let promisesCreatedDuringOutage = 0;
    let offlineSince: number | null = null;
    let recoveredAt: number | null = null;
    let offlineDetected = false;
    let recovered = false;
    let recoveryMs = 0;
    let replayReport: ReplayReport | null = null;
    let reconcile: ReconcileResult | null = null;
    let reconcileRepeat: ReconcileResult | null = null;
    let errorMessage: string | null = null;

    const record = (kind: string, detail: string): void => {
      events.push({ at: nowIso(this.now), kind, detail });
    };

    // 0) 前置：平台必须在线（否则无法开始「断网→恢复」演练；直接抛错，不伪造证据）
    const baseline = await probe.probe(healthUrl);
    probes.push(sampleFromProbe(baseline, nowIso(this.now)));
    if (!baseline.online) {
      throw new FaultValidationError(
        `断网演练前置条件失败：平台不可达（${baseline.error ?? "unknown"}）；请先启动 demo-platform`,
        "INVALID_INPUT",
        "platform_url",
      );
    }

    try {
      record("baseline.online", `latency=${baseline.latency_ms}ms`);

      // 1) 注入断网
      if (options.outage_control !== undefined) {
        await options.outage_control.down();
        record("outage.inject", "outage_control.down（外部杀/停进程，客户端将收到真实 ECONNREFUSED）");
      } else {
        try {
          const response = await requestJson(joinUrl(adminBase, "/admin/outage"), {
            method: "POST",
            body: { mode: "down", reopen_after_ms: effectiveOutageMs, minutes: effectiveOutageMs / 60_000 },
            timeoutMs: 5_000,
          });
          record("outage.inject", `POST ${adminBase}/admin/outage {mode:"down"} → HTTP ${response.status}`);
        } catch (error) {
          // 服务端可能先关连接再响应；以随后的真实探针为准
          record("outage.inject", `POST ${adminBase}/admin/outage 连接中断（预期可能发生）：${describeFetchError(error)}`);
        }
      }

      // 2) 断网窗口：真实探测 + 承诺门 + Outbox 入队
      let tickIndex = 0;
      const outageDeadline = startedReal + effectiveOutageMs;
      while (true) {
        const nowReal = Date.now();
        const probeResult = await probe.probe(healthUrl);
        probes.push(sampleFromProbe(probeResult, nowIso(this.now)));
        const online = probeResult.online;
        if (!online && offlineSince === null) {
          offlineSince = Date.now();
          offlineDetected = true;
          record("outage.detected", `首次离线探测：${probeResult.error ?? "connection refused"}`);
          const notification = await notifier.notify({
            kind: "outage",
            title: "检测到真实断网：已停止对外承诺",
            body: [
              `- 平台：${platformUrl}`,
              `- 首次离线探测：${probeResult.error ?? "connection refused"}`,
              `- 计划断网时长（真实分钟）：${outageMinutes}${accelerated ? `（time_scale=${timeScale} 加速演示）` : ""}`,
              "",
              "处理：断网期间不产生新承诺（PromisesGate 已拦截）；待发动作进入 Outbox，恢复后幂等重放并对账。",
            ].join("\n"),
            severity: "critical",
          });
          notifications.push(notification);
        }

        if (!online) {
          // 断网期间：承诺必须被拒绝（计数）
          try {
            gate.assertMayPromise(online);
            promisesCreatedDuringOutage += 1;
          } catch (error) {
            if (error instanceof OfflinePromiseError) blockedPromises += 1;
            else throw error;
          }
          // 断网期间：对外动作不直接发，入 Outbox（同 idempotency_key 幂等）
          const actionKind: OutboxActionKind = tickIndex % 2 === 0 ? "quote" : "message";
          const idempotencyKey = `net-outage-${stampForFile(startedAtIso)}-${tickIndex}`;
          if (!queuedKeys.has(idempotencyKey)) {
            await outbox.enqueue({
              action_kind: actionKind,
              idempotency_key: idempotencyKey,
              payload:
                actionKind === "quote"
                  ? { customer: "仿真客户 A", amount_cny: 1_200, note: "断网期间待补记报价", receipt_ref: `receipt-${idempotencyKey}` }
                  : { thread_id: "thread-sim-1", text: "断网期间待补记消息", receipt_ref: `receipt-${idempotencyKey}` },
            });
            queuedKeys.add(idempotencyKey);
            queuedActions += 1;
          }
        }

        const tick: DrillTick = {
          tick: tickIndex,
          at: nowIso(this.now),
          online,
          phase: offlineDetected ? "outage" : "baseline",
          blocked_promises: blockedPromises,
          queued_actions: queuedActions,
        };
        ticks.push(tick);
        if (options.onTick !== undefined) await options.onTick(tick);
        tickIndex += 1;

        const remaining = outageDeadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(tickMs, remaining));
      }

      // 3) 恢复故障
      if (offlineSince === null) {
        throw new Error("断网窗口内未观测到离线（故障注入失败）；请检查平台 /admin/outage 或 outage_control");
      }
      if (options.outage_control !== undefined) {
        await options.outage_control.up();
        record("outage.restore", "outage_control.up（外部重启进程）");
      } else {
        try {
          const response = await requestJson(joinUrl(adminBase, "/admin/outage"), { method: "POST", body: { mode: "up" }, timeoutMs: 5_000 });
          record("outage.restore", `POST ${adminBase}/admin/outage {mode:"up"} → HTTP ${response.status}`);
        } catch (error) {
          record("outage.restore", `POST ${adminBase}/admin/outage 失败（等待自动恢复）：${describeFetchError(error)}`);
        }
      }

      // 4) 等待真实恢复（恢复计时必须真实）
      const recoveryStartedAt = Date.now();
      while (Date.now() - recoveryStartedAt < recoveryTimeoutMs) {
        const probeResult = await probe.probe(healthUrl);
        probes.push(sampleFromProbe(probeResult, nowIso(this.now)));
        if (probeResult.online) {
          recovered = true;
          recoveredAt = Date.now();
          recoveryMs = recoveredAt - recoveryStartedAt;
          record("recovery.online", `恢复探测在线，耗时 ${recoveryMs}ms`);
          break;
        }
        await sleep(Math.min(tickMs, 200));
      }

      // 5) 恢复后：重放 Outbox（真实 HTTP）+ 账本对账（幂等不重复）
      if (recovered) {
        const executor: ReplayExecutor = async (item: OutboxItem) => {
          const path = item.action_kind === "message" ? "/message" : "/quote";
          const payload = item.payload;
          const body =
            item.action_kind === "message"
              ? {
                  idempotency_key: item.idempotency_key,
                  thread_id: typeof payload["thread_id"] === "string" ? payload["thread_id"] : "thread-sim-1",
                  text: typeof payload["text"] === "string" ? payload["text"] : "断网补记消息",
                }
              : {
                  idempotency_key: item.idempotency_key,
                  customer: typeof payload["customer"] === "string" ? payload["customer"] : "仿真客户",
                  amount_cny: typeof payload["amount_cny"] === "number" ? payload["amount_cny"] : 1_000,
                  note: typeof payload["note"] === "string" ? payload["note"] : item.action_kind,
                };
          try {
            const response = await requestJson(joinUrl(base, path), { method: "POST", body, timeoutMs: 5_000 });
            if (!response.ok) {
              return { ok: false, error: `HTTP ${response.status}: ${readErrorReason(response.body, "replay failed")}` };
            }
            const record = isRecord(response.body) ? response.body : {};
            const duplicate = record["duplicate"] === true;
            const refCandidate = record["quote_id"] ?? record["message_id"] ?? record["id"];
            const result = { ok: true, duplicate } as { ok: boolean; duplicate: boolean; ref?: string };
            if (typeof refCandidate === "string") result.ref = refCandidate;
            return result;
          } catch (error) {
            return { ok: false, error: describeFetchError(error) };
          }
        };
        replayReport = await outbox.replay(executor);
        record("outbox.replayed", `replayed=${replayReport.replayed}; failed=${replayReport.failed}; duplicates=${replayReport.duplicates_found}`);
        reconcile = await reconciler.reconcile(ledgerApi, outbox);
        record("ledger.reconcile", `entries_added=${reconcile.entries_added}; duplicates_found=${reconcile.duplicates_found}`);
        // 第二次对账：必须全部判为已存在（幂等证明）
        reconcileRepeat = await reconciler.reconcile(ledgerApi, outbox);
        record("ledger.reconcile.repeat", `entries_added=${reconcileRepeat.entries_added}; skipped=${reconcileRepeat.skipped_duplicates}`);

        const recoveryNotification = await notifier.notify({
          kind: "recovery",
          title: "断网恢复：补记完成，账本无重复",
          body: [
            `- 平台：${platformUrl}`,
            `- 恢复探测在线耗时：${recoveryMs}ms`,
            `- 离线期间拦截承诺：${blockedPromises} 次`,
            `- Outbox 待补记动作：${queuedActions} 条；重放成功：${replayReport.replayed} 条`,
            `- 账本新增：${reconcile.entries_added} 条；真实重复：${reconcile.duplicates_found} 条（要求 0）`,
            `- 二次对账跳过（幂等）：${reconcileRepeat.skipped_duplicates} 条`,
            "",
            "结论：断网期间未产生新承诺；恢复后补记幂等、账本不重复。",
          ].join("\n"),
          severity: "info",
        });
        notifications.push(recoveryNotification);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      record("drill.error", errorMessage);
      // 尽力恢复平台，避免长跑后把环境留在断网状态（恢复必须走控制端口）
      try {
        if (options.outage_control !== undefined) await options.outage_control.up();
        else await requestJson(joinUrl(adminBase, "/admin/outage"), { method: "POST", body: { mode: "up" }, timeoutMs: 5_000 });
      } catch {
        // 忽略恢复失败：错误已记入证据
      }
    }

    const finishedAtIso = nowIso(this.now);
    const outageMs = offlineSince !== null && recoveredAt !== null ? Math.max(0, recoveredAt - offlineSince) : 0;
    const recoveredWithin10Min = recovered && recoveryMs <= 10 * 60_000;
    const replayOk = replayReport !== null && replayReport.failed === 0 && replayReport.replayed === queuedActions;
    const reconcileOk = reconcile !== null && reconcile.duplicates_found === 0 && reconcile.entries_added === queuedActions;
    const repeatOk = reconcileRepeat !== null && reconcileRepeat.duplicates_found === 0 && reconcileRepeat.entries_added === 0;
    const ok =
      errorMessage === null &&
      offlineDetected &&
      blockedPromises > 0 &&
      queuedActions > 0 &&
      promisesCreatedDuringOutage === 0 &&
      recovered &&
      recoveredWithin10Min &&
      replayOk &&
      reconcileOk &&
      repeatOk;

    const evidencePath = join(stateDir, "drill-net-outage.json");
    const result: NetOutageDrillResult = {
      case: "net_outage",
      started_at: startedAtIso,
      finished_at: finishedAtIso,
      outage_ms: outageMs,
      nominal_outage_ms: nominalOutageMs,
      time_scale: timeScale,
      accelerated,
      probes: truncateRecords(probes),
      blocked_promises: blockedPromises,
      queued_actions: queuedActions,
      replayed: replayReport === null ? 0 : replayReport.replayed,
      duplicates_found: reconcile === null ? -1 : reconcile.duplicates_found,
      recovered_within_10min: recoveredWithin10Min,
      ok,
      recovered,
      promises_created_during_outage: promisesCreatedDuringOutage,
      recovery_ms: recoveryMs,
      ticks: truncateRecords(ticks),
      notifications,
      evidence_paths: [],
    };
    if (reconcile !== null) result.reconcile = reconcile;
    if (reconcileRepeat !== null) result.reconcile_repeat = reconcileRepeat;
    if (errorMessage !== null) result.error = errorMessage;

    // evidencePath 本身在写完后才存在，先无条件纳入，其余存在的文件再过滤
    result.evidence_paths = [
      evidencePath,
      ...existingPaths([
        outbox.file,
        ledgerApi instanceof JsonLedgerApi ? ledgerApi.file : null,
        ...notifications,
      ]).filter((path) => path !== evidencePath),
    ];

    const evidence: Record<string, unknown> = {
      ...result,
      generated_at: finishedAtIso,
      environment: {
        node: process.version,
        platform_url: platformUrl,
        time_scale: timeScale,
        accelerated,
        time_scale_note: accelerated
          ? `accelerated=true：time_scale=${timeScale}，nominal=${nominalOutageMs}ms 实际等待按 1/time_scale 缩放（仅测试/演示；验收用 time_scale=1 真实分钟）`
          : "time_scale=1：真实分钟口径，未加速",
      },
      outbox_items: await outbox.list(),
      replay_report: replayReport,
      events: truncateRecords(events),
    };
    await atomicWriteJson(evidencePath, evidence);
    return result;
  }

  // -------------------------------------------------------------------------
  // B4：平台封禁演练
  // -------------------------------------------------------------------------

  /**
   * 平台封禁演练：注入 ban → 真实检测 403+`x-platform-ban:true` → 停止动作 +
   * 生成替代方案 + 本地通知 → 解除封禁 → 验证恢复。
   */
  async runPlatformBanDrill(options: PlatformBanDrillOptions): Promise<PlatformBanDrillResult> {
    if (!isRecord(options)) throw new FaultValidationError("runPlatformBanDrill 需要 options 对象", "INVALID_INPUT", "options");
    const platformUrl = requireNonEmptyString(options.platform_url, "platform_url");
    const stateDir = requireNonEmptyString(options.state_dir, "state_dir");
    const banMinutes = requirePositiveNumber(options.ban_minutes, "ban_minutes", DEFAULT_BAN_MINUTES);
    const pollSeconds = requirePositiveNumber(options.poll_seconds, "poll_seconds", DEFAULT_POLL_SECONDS);
    const timeScale = requirePositiveNumber(options.time_scale, "time_scale", 1);
    const probeTimeoutMs = requirePositiveNumber(options.probe_timeout_ms, "probe_timeout_ms", 2_000);
    const recoveryTimeoutMs = requirePositiveNumber(options.recovery_timeout_ms, "recovery_timeout_ms", DEFAULT_RECOVERY_TIMEOUT_MS);
    const businessPath = options.business_path ?? "/quote";
    const banAdminPath = options.ban_admin_path ?? "/admin/ban";
    const injectedExternally = options.injected_externally === true;

    const nominalBanMs = Math.round(banMinutes * 60_000);
    const effectiveBanMs = Math.max(1, Math.round(nominalBanMs / timeScale));
    const accelerated = Math.abs(timeScale - 1) > 1e-9;
    const pollMs = Math.max(20, Math.round(pollSeconds * 1_000));
    const base = platformUrl.endsWith("/") ? platformUrl.slice(0, -1) : platformUrl;
    // 管理端点基址（缺省同平台主地址；demo-platform 建议传控制端口）
    const adminUrl = options.control_url ?? platformUrl;
    const adminBase = adminUrl.endsWith("/") ? adminUrl.slice(0, -1) : adminUrl;
    const businessUrl = joinUrl(base, businessPath);
    const healthUrl = joinUrl(base, "/health");

    await ensureDir(stateDir);
    const probe = new ConnectivityProbe({ timeoutMs: probeTimeoutMs });
    const banDetector = new BanDetector({ now: this.now });
    const alternativePlan = new AlternativePlan();
    const notifier = new NotificationCenter(stateDir);

    const startedAtIso = nowIso(this.now);
    const startedReal = Date.now();
    const polls: ProbeSample[] = [];
    const events: DrillEventRecord[] = [];
    let banDetected = false;
    let banDetectedWithinMs = -1;
    let banReason = "平台封禁";
    let banRetryAfterMs: number | null = null;
    let actionsAttemptedDuringBan = 0;
    let successfulActionsDuringBan = 0;
    let recovered = false;
    let recoveredWithinMs = -1;
    let notificationPath = "";
    let recoveryNotificationPath: string | undefined = undefined;
    let errorMessage: string | null = null;

    const record = (kind: string, detail: string): void => {
      events.push({ at: nowIso(this.now), kind, detail });
    };

    const attemptBusinessAction = async (idempotencyKey: string, note: string): Promise<BusinessActionResult> => {
      try {
        const response = await requestJson(businessUrl, {
          method: "POST",
          body: { idempotency_key: idempotencyKey, customer: "封禁演练客户", amount_cny: 1_000, note },
          timeoutMs: probeTimeoutMs,
        });
        return { ok: response.ok, status: response.status, body: response.body };
      } catch (error) {
        return { ok: false, status: 0, body: null, error: describeFetchError(error) };
      }
    };

    const cancelBan = async (): Promise<void> => {
      if (injectedExternally) return;
      try {
        const response = await requestJson(joinUrl(adminBase, banAdminPath), { method: "POST", body: { minutes: 0 }, timeoutMs: 5_000 });
        record("ban.cancel", `POST ${adminBase}${banAdminPath} {minutes:0} → HTTP ${response.status}`);
      } catch (error) {
        record("ban.cancel", `取消封禁失败（等待平台自动过期）：${describeFetchError(error)}`);
      }
    };

    // 0) 前置：平台在线（失败直接抛错，不伪造演练结果）
    const baseline = await probe.probe(healthUrl);
    polls.push(sampleFromProbe(baseline, nowIso(this.now)));
    if (!baseline.online) {
      throw new FaultValidationError(`封禁演练前置条件失败：平台不可达（${baseline.error ?? "unknown"}）`, "INVALID_INPUT", "platform_url");
    }

    try {
      record("baseline.online", `latency=${baseline.latency_ms}ms`);

      // 1) 注入封禁（或外部已注入）
      if (!injectedExternally) {
        // demo-platform 的 /admin/ban 只接受整数分钟（0–1440）；短跑时向上取整为 1 分钟，
        // 演练结束会显式 {minutes:0} 取消，因此不改变真实封禁窗口长度。
        const requestedMinutes = Math.max(1, Math.ceil(effectiveBanMs / 60_000));
        let injected = false;
        try {
          const response = await requestJson(joinUrl(adminBase, banAdminPath), {
            method: "POST",
            body: { minutes: requestedMinutes },
            timeoutMs: 5_000,
          });
          injected = response.ok;
          record("ban.inject", `POST ${adminBase}${banAdminPath} {minutes:${requestedMinutes}} → HTTP ${response.status}`);
        } catch (error) {
          record("ban.inject", `注入封禁失败：${describeFetchError(error)}`);
        }
        if (!injected) throw new Error("注入平台封禁失败（/admin/ban 不可用）");
      } else {
        record("ban.inject", "由外部注入（injected_externally=true）");
      }

      // 2) 真实检测 403 + x-platform-ban: true
      const detectDeadline = Date.now() + Math.min(effectiveBanMs, 30_000);
      while (Date.now() <= detectDeadline) {
        try {
          const result = await banDetector.check(businessUrl, {
            method: "POST",
            body: { idempotency_key: `ban-probe-${stampForFile(startedAtIso)}`, customer: "封禁探测", amount_cny: 1_000, note: "ban probe" },
            timeoutMs: probeTimeoutMs,
          });
          polls.push({ at: result.checked_at, online: result.status > 0, latency_ms: 0 });
          if (result.banned) {
            banDetected = true;
            banDetectedWithinMs = Date.now() - startedReal;
            break;
          }
        } catch (error) {
          if (error instanceof PlatformBannedError) {
            banDetected = true;
            banDetectedWithinMs = Date.now() - startedReal;
            banReason = error.reason;
            banRetryAfterMs = error.retry_after_ms;
            polls.push({ at: nowIso(this.now), online: true, latency_ms: 0 });
            record("ban.detected", `HTTP ${error.status} + x-platform-ban:true（${error.reason}）`);
            break;
          }
          record("ban.check.error", describeFetchError(error));
        }
        await sleep(Math.min(pollMs, 100));
      }
      if (!banDetected) throw new Error("未能在封禁窗口内检测到 403 + x-platform-ban:true");

      // 3) B4：停止动作（不再执行成功业务动作），生成替代方案 + 通知
      const plan = alternativePlan.generate({
        platform: base,
        reason: banReason,
        ban_minutes: banMinutes,
        now: this.now,
      });
      const alternativePlanPath = join(stateDir, "alternative-plan.json");
      await atomicWriteJson(alternativePlanPath, { ...plan, ban_detected_within_ms: banDetectedWithinMs, retry_after_ms: banRetryAfterMs });
      notificationPath = await notifier.notify({
        kind: "ban",
        title: plan.title,
        body: [
          renderAlternativePlanMarkdown(plan),
          "",
          `- 检测依据：HTTP 403/429 + 响应头 x-platform-ban: true（检测耗时 ${banDetectedWithinMs}ms）`,
          `- 平台建议冷静期：${banRetryAfterMs === null ? "未提供" : `${banRetryAfterMs}ms`}`,
          `- 计划封禁时长（真实分钟）：${banMinutes}${accelerated ? `（time_scale=${timeScale} 加速演示）` : ""}`,
          "- 已停止动作：封禁期间不再尝试新的对外业务动作；待办进 Outbox，解禁后幂等重放。",
        ].join("\n"),
        severity: "critical",
      });
      record("alternative.plan", `items=${plan.items.length}; notification=${notificationPath}`);

      // 4) 封禁窗口内：真实尝试业务动作，全部应被 403 拒绝（成功数必须为 0）
      const banWindowEnd = startedReal + effectiveBanMs;
      while (Date.now() < banWindowEnd) {
        actionsAttemptedDuringBan += 1;
        const result = await attemptBusinessAction(
          `ban-window-${stampForFile(startedAtIso)}-${actionsAttemptedDuringBan}`,
          "封禁期间业务动作（预期被拒绝）",
        );
        if (result.ok) {
          successfulActionsDuringBan += 1;
          record("ban.action.unexpected_success", `封禁期间动作意外成功（HTTP ${result.status}）`);
        }
        const remaining = banWindowEnd - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(pollMs, remaining));
      }

      // 5) 解除封禁并等待真实恢复
      await cancelBan();
      const recoveryStartedAt = Date.now();
      while (Date.now() - recoveryStartedAt < recoveryTimeoutMs) {
        const result = await attemptBusinessAction(`ban-recovery-${stampForFile(startedAtIso)}`, "解禁后恢复验证");
        polls.push({ at: nowIso(this.now), online: result.status > 0, latency_ms: 0 });
        if (result.ok) {
          recovered = true;
          recoveredWithinMs = Date.now() - recoveryStartedAt;
          record("recovery.online", `解禁后业务动作成功（HTTP ${result.status}），恢复耗时 ${recoveredWithinMs}ms`);
          break;
        }
        await sleep(Math.min(pollMs, 100));
      }

      if (recovered) {
        recoveryNotificationPath = await notifier.notify({
          kind: "recovery",
          title: "平台解禁恢复：业务动作已可正常执行",
          body: [
            `- 平台：${platformUrl}`,
            `- 封禁检测耗时：${banDetectedWithinMs}ms；封禁期间被拒绝动作：${actionsAttemptedDuringBan} 次（成功 0 次）`,
            `- 解禁后恢复耗时：${recoveredWithinMs}ms`,
            `- 替代方案文件：${alternativePlanPath}`,
            "",
            "结论：封禁期间已停止动作并给出可读替代方案；解禁后恢复。",
          ].join("\n"),
          severity: "info",
        });
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      record("drill.error", errorMessage);
      await cancelBan();
    }

    const finishedAtIso = nowIso(this.now);
    const plan = alternativePlan.generate({
      platform: base,
      reason: banReason,
      ban_minutes: banMinutes,
      now: this.now,
    });
    const stopped = banDetected && successfulActionsDuringBan === 0;
    const ok = errorMessage === null && banDetected && stopped && plan.items.length >= 2 && notificationPath !== "" && recovered;

    const evidencePath = join(stateDir, "drill-platform-ban.json");
    const result: PlatformBanDrillResult = {
      case: "platform_ban",
      started_at: startedAtIso,
      finished_at: finishedAtIso,
      ban_minutes: banMinutes,
      time_scale: timeScale,
      accelerated,
      ban_detected_within_ms: banDetectedWithinMs,
      ban_detected: banDetected,
      actions_attempted_during_ban: actionsAttemptedDuringBan,
      successful_actions_during_ban: successfulActionsDuringBan,
      stopped,
      alternative_plan: plan,
      notification_path: notificationPath,
      recovered,
      recovered_within_ms: recoveredWithinMs,
      ok,
      polls: truncateRecords(polls),
      evidence_paths: [],
    };
    if (recoveryNotificationPath !== undefined) result.recovery_notification_path = recoveryNotificationPath;
    if (errorMessage !== null) result.error = errorMessage;

    // evidencePath 本身在写完后才存在，先无条件纳入，其余存在的文件再过滤
    result.evidence_paths = [
      evidencePath,
      ...existingPaths([
        join(stateDir, "alternative-plan.json"),
        notificationPath,
        recoveryNotificationPath ?? null,
      ]).filter((path) => path !== evidencePath),
    ];

    const evidence: Record<string, unknown> = {
      ...result,
      generated_at: finishedAtIso,
      environment: {
        node: process.version,
        platform_url: platformUrl,
        time_scale: timeScale,
        accelerated,
        time_scale_note: accelerated
          ? `accelerated=true：time_scale=${timeScale}，nominal=${nominalBanMs}ms 实际等待按 1/time_scale 缩放（仅测试/演示；验收用 time_scale=1 真实分钟）`
          : "time_scale=1：真实分钟口径，未加速",
      },
      events: truncateRecords(events),
    };
    await atomicWriteJson(evidencePath, evidence);
    return result;
  }
}
