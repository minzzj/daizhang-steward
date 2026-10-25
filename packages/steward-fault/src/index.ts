/**
 * `steward-fault`：阶段二 P2 故障演练模块（B3 断网 / B4 平台封禁）。
 *
 * 零第三方依赖；真实 HTTP（Node 内置 fetch）；本地留痕（原子写 JSON + markdown 通知）；
 * 时间诚实（真实分钟 + 可显式加速并写入证据）。
 */

export type {
  AlternativePlanContext,
  AlternativePlanItem,
  AlternativePlanResult,
  BanCheckResult,
  BanDetectorOptions,
  BanRequestOptions,
  DomainLedgerApi,
  DrillPhase,
  DrillTick,
  LedgerReplayInput,
  LedgerWriteResult,
  NetOutageDrillOptions,
  NetOutageDrillResult,
  NotificationInput,
  NotificationKind,
  NotificationSeverity,
  OutageControl,
  OutboxActionKind,
  OutboxEnqueueInput,
  OutboxItem,
  OutboxListFilter,
  OutboxStats,
  OutboxStatus,
  PlatformBanDrillOptions,
  PlatformBanDrillResult,
  ProbeOptions,
  ProbeResult,
  ProbeSample,
  ReconcileResult,
  ReplayExecutor,
  ReplayExecutorResult,
  ReplayOptions,
  ReplayReport,
} from "./types.js";

export type { FaultErrorCode } from "./errors.js";
export {
  FaultValidationError,
  OfflinePromiseError,
  OutboxReplayError,
  PlatformBannedError,
} from "./errors.js";

export {
  atomicWriteJson,
  atomicWriteText,
  cloneJson,
  ensureDir,
  listFiles,
  nowIso,
  readJsonIfExists,
  sleep,
  stampForFile,
} from "./io.js";

export {
  DEFAULT_BAN_TIMEOUT_MS,
  PLATFORM_BAN_HEADER,
  BanDetector,
} from "./ban.js";
export { ConnectivityProbe, DEFAULT_PROBE_TIMEOUT_MS } from "./probe.js";
export { OUTBOX_VERSION, Outbox } from "./outbox.js";
export { PromisesGate } from "./gate.js";
export { AlternativePlan } from "./alternative.js";
export { NotificationCenter } from "./notify.js";
export {
  LEDGER_VERSION,
  JsonLedgerApi,
  LedgerReconciler,
  deriveReceiptRef,
} from "./reconcile.js";
export {
  DEFAULT_BAN_MINUTES,
  DEFAULT_OUTAGE_MINUTES,
  DEFAULT_POLL_SECONDS,
  DEFAULT_RECOVERY_TIMEOUT_MS,
  DEFAULT_TICK_SECONDS,
  DrillRunner,
} from "./drill.js";
export { describeFetchError, networkErrorCode, readErrorReason, readRetryAfterMs, requestJson } from "./http.js";
