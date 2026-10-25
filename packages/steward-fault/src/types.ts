/**
 * 阶段二 P2「故障演练」契约（B3 断网 / B4 平台封禁）。
 *
 * 设计原则：
 * - 零第三方依赖，只用 Node 内置能力（`fetch`、`node:http` 仅测试侧）；
 * - 网络必须真实：探针/封禁检测/重放都发真实 HTTP 请求，不用 mock/stub 替代网络；
 * - 本地留痕：所有写盘 JSON 原子写（tmp + rename），通知只写本地文件，绝不外发；
 * - 时间诚实：`outage_minutes` / `ban_minutes` 以**真实分钟**计量；`time_scale` 仅用于
 *   测试/演示加速，且必须写进证据（`nominal_*_ms` 与 `*_ms` 分开记录）。
 */

// ---------------------------------------------------------------------------
// 1) 连通性探针
// ---------------------------------------------------------------------------

export interface ProbeResult {
  online: boolean;
  latency_ms: number;
  /** 失败原因（真实网络错误码优先，如 ECONNREFUSED/timeout）。 */
  error?: string;
}

export interface ProbeOptions {
  timeoutMs?: number;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 2) Outbox（离线动作队列，幂等重放）
// ---------------------------------------------------------------------------

/** 可排队重放的对外动作类型。 */
export type OutboxActionKind = "quote" | "message" | "order" | "invoice" | "payment_request";

export type OutboxStatus = "queued" | "replayed" | "failed";

export interface OutboxItem {
  id: string;
  action_kind: OutboxActionKind;
  payload: Record<string, unknown>;
  /** 幂等键：同键重复入队返回已有项；重放/账本 dedupe 都靠它。 */
  idempotency_key: string;
  created_at: string;
  attempts: number;
  status: OutboxStatus;
  last_error?: string;
  replayed_at?: string;
  /** 重放成功后平台返回的引用（quote_id/message_id…）。 */
  ref?: string;
}

export interface OutboxEnqueueInput {
  action_kind: OutboxActionKind;
  payload: Record<string, unknown>;
  /** 缺省自动生成；建议调用方显式传入（同键幂等）。 */
  idempotency_key?: string;
  created_at?: string;
}

export interface OutboxListFilter {
  status?: OutboxStatus;
  action_kind?: OutboxActionKind;
}

export interface OutboxStats {
  total: number;
  queued: number;
  replayed: number;
  failed: number;
}

/** 重放执行器：真实调用外部平台；duplicate=true 表示平台已按幂等键识别过。 */
export interface ReplayExecutorResult {
  ok: boolean;
  duplicate?: boolean;
  ref?: string;
  error?: string;
}

export type ReplayExecutor = (item: OutboxItem) => Promise<ReplayExecutorResult> | ReplayExecutorResult;

export interface ReplayOptions {
  /** true 时遇到一次失败立即抛 OutboxReplayError（默认 false：记 failed 继续）。 */
  stopOnError?: boolean;
}

export interface ReplayReport {
  replayed: number;
  skipped_duplicates: number;
  failed: number;
  /** executor 报告 duplicate=true 的次数（平台侧去重成功）。 */
  duplicates_found: number;
  items: OutboxItem[];
}

// ---------------------------------------------------------------------------
// 3) 断网承诺门 / 平台封禁检测 / 替代方案 / 通知 / 账本对账
// ---------------------------------------------------------------------------

export type NotificationKind = "outage" | "ban" | "recovery";
export type NotificationSeverity = "info" | "warn" | "critical";

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  severity: NotificationSeverity;
}

export interface AlternativePlanItem {
  channel: string;
  why: string;
  next_action: string;
  owner: string;
}

export interface AlternativePlanContext {
  platform?: string;
  reason?: string;
  ban_minutes?: number;
  /** 可用替代渠道（缺省内置：企业微信/邮件/电话人工/本地交付/稍后重试）。 */
  available_channels?: string[];
  now?: () => Date;
}

export interface AlternativePlanResult {
  title: string;
  items: AlternativePlanItem[];
  generated_at: string;
  platform?: string;
  reason?: string;
}

export interface BanDetectorOptions {
  timeoutMs?: number;
  /** 时钟注入（仅用于证据时间戳；不影响真实等待）。 */
  now?: () => Date;
}

export interface BanRequestOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface BanCheckResult {
  banned: boolean;
  status: number;
  url: string;
  checked_at: string;
  /** 平台建议的冷却时间（毫秒）。 */
  retry_after_ms?: number;
  reason?: string;
  /** 网络层错误（超时/拒连）；banned=false 时仍可能非空。 */
  error?: string;
}

/** 账本重放输入（一个 Outbox 项对应一笔待补记账）。 */
export interface LedgerReplayInput {
  idempotency_key: string;
  receipt_ref: string;
  action_kind: OutboxActionKind;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface LedgerWriteResult {
  ok: boolean;
  id?: string;
  /** true = 相同 receipt_ref/idempotency_key 已存在，未新增（幂等跳过）。 */
  duplicate?: boolean;
  error?: string;
}

/** 对账用的最小账本 API（可由 steward-domain / 控制台 provider 适配）。 */
export interface DomainLedgerApi {
  recordLedger(input: LedgerReplayInput): LedgerWriteResult | Promise<LedgerWriteResult>;
  ledger(): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
}

export interface ReconcileResult {
  /** 本轮参与对账的 outbox 条目数。 */
  replayed: number;
  /** 被账本 API 判为已存在而跳过（幂等去重成功）。 */
  skipped_duplicates: number;
  /** 账本中真实重复的条目数（必须为 0）。 */
  duplicates_found: number;
  /** 本轮新增条目数。 */
  entries_added: number;
  ledger_entries_total: number;
}

// ---------------------------------------------------------------------------
// 4) 演练（DrillRunner）
// ---------------------------------------------------------------------------

export interface ProbeSample {
  at: string;
  online: boolean;
  latency_ms: number;
  error?: string;
}

export type DrillPhase = "baseline" | "outage" | "recovery";

export interface DrillTick {
  tick: number;
  at: string;
  online: boolean;
  phase: DrillPhase;
  blocked_promises: number;
  queued_actions: number;
}

/** 外部故障注入钩子（如杀/重启平台子进程；比平台 admin 端点更底层，仍是真实 ECONNREFUSED）。 */
export interface OutageControl {
  down: () => Promise<void>;
  up: () => Promise<void>;
}

export interface NetOutageDrillOptions {
  platform_url: string;
  state_dir: string;
  /**
   * 管理端点基址（控制端口，缺省 = platform_url）。
   * demo-platform 断网时主端口已 close，`/admin/outage {mode:"up"}` 必须走控制端口恢复。
   */
  control_url?: string;
  /** 真实分钟（默认 120）；短跑验收用 1–3 分钟。 */
  outage_minutes?: number;
  /** 探测/动作 tick 间隔（秒，允许小数；默认 5）。 */
  tick_seconds?: number;
  /** 仅测试/演示加速：effective_ms = nominal_ms / time_scale（默认 1，证据会记录）。 */
  time_scale?: number;
  /** 仅用于证据时间戳（不影响真实等待；禁止用它伪造时长）。 */
  now?: () => Date;
  onTick?: (tick: DrillTick) => void | Promise<void>;
  probe_timeout_ms?: number;
  health_path?: string;
  /** 恢复等待上限（真实毫秒，默认 60000）。 */
  recovery_timeout_ms?: number;
  /** 外部故障注入（优先于平台 /admin/outage）。 */
  outage_control?: OutageControl;
  /** 账本 API（缺省使用本地 JSON 账本 <state_dir>/ledger.json）。 */
  ledger_api?: DomainLedgerApi;
}

export interface NetOutageDrillResult {
  case: "net_outage";
  started_at: string;
  finished_at: string;
  /** 实际观测到的离线时长（真实毫秒）。 */
  outage_ms: number;
  /** outage_minutes × 60_000（真实分钟口径）。 */
  nominal_outage_ms: number;
  time_scale: number;
  /** time_scale !== 1 时为 true（证据必须能看出被加速过）。 */
  accelerated: boolean;
  probes: ProbeSample[];
  blocked_promises: number;
  queued_actions: number;
  replayed: number;
  duplicates_found: number;
  recovered_within_10min: boolean;
  ok: boolean;
  recovered: boolean;
  /** 断网期间是否产生过对外承诺（必须为 0）。 */
  promises_created_during_outage: number;
  /** 恢复后等待在线耗时（真实毫秒）。 */
  recovery_ms: number;
  ticks: DrillTick[];
  notifications: string[];
  evidence_paths: string[];
  /** 第一次对账（新增待补记账）。 */
  reconcile?: ReconcileResult;
  /** 第二次对账（应 skipped_duplicates=全部、entries_added=0、duplicates_found=0）。 */
  reconcile_repeat?: ReconcileResult;
  error?: string;
}

export interface PlatformBanDrillOptions {
  platform_url: string;
  state_dir: string;
  /** 管理端点基址（控制端口，缺省 = platform_url）；用于 /admin/ban 注入与取消。 */
  control_url?: string;
  /** 真实分钟（默认 15）；短跑验收用 1–3 分钟。 */
  ban_minutes?: number;
  /** 轮询间隔（秒，允许小数；默认 5）。 */
  poll_seconds?: number;
  /** 仅测试/演示加速：effective_ms = nominal_ms / time_scale（默认 1）。 */
  time_scale?: number;
  now?: () => Date;
  onPoll?: (sample: ProbeSample) => void | Promise<void>;
  probe_timeout_ms?: number;
  /** 业务端点路径（默认 /quote）。 */
  business_path?: string;
  /** ban 管理端点路径（默认 /admin/ban）。 */
  ban_admin_path?: string;
  recovery_timeout_ms?: number;
  /** true = 由外部注入 ban（drill 不再调用 /admin/ban）。 */
  injected_externally?: boolean;
}

export interface PlatformBanDrillResult {
  case: "platform_ban";
  started_at: string;
  finished_at: string;
  ban_minutes: number;
  time_scale: number;
  accelerated: boolean;
  /** 从注入 ban 到检测到 403+header 的真实毫秒数（未检测到时为 -1）。 */
  ban_detected_within_ms: number;
  ban_detected: boolean;
  actions_attempted_during_ban: number;
  /** ban 期间成功的业务动作数必须为 0。 */
  successful_actions_during_ban: number;
  stopped: boolean;
  alternative_plan: AlternativePlanResult;
  notification_path: string;
  recovery_notification_path?: string;
  recovered: boolean;
  recovered_within_ms: number;
  ok: boolean;
  polls: ProbeSample[];
  evidence_paths: string[];
  error?: string;
}
