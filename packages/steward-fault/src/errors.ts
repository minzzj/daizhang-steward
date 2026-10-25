/**
 * 故障演练模块错误类型。
 *
 * 设计：把「输入/环境不合法」「断网拒绝承诺」「平台封禁」「Outbox 重放失败」分开，
 * 便于 CLI 映射退出码与用户可见提示（错误码只增不减）。
 */

export type FaultErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "OFFLINE_PROMISE"
  | "PLATFORM_BANNED"
  | "OUTBOX_REPLAY";

/** 入参/环境不合法（如平台初始不可达、参数越界）。 */
export class FaultValidationError extends Error {
  readonly code: FaultErrorCode;
  readonly field: string | null;

  constructor(message: string, code: FaultErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "FaultValidationError";
    this.code = code;
    this.field = field;
  }
}

/** 断网期间禁止产生新承诺（B3 核心红线）。 */
export class OfflinePromiseError extends Error {
  readonly code = "OFFLINE_PROMISE" as const;
  /** 累计被拦下的承诺次数（PromisesGate 计数器同步值）。 */
  readonly blocked_count: number;

  constructor(message = "断网期间不产生新承诺：已拦截对外承诺；恢复后由 Outbox 补记，避免账本重复。", blockedCount = 0) {
    super(message);
    this.name = "OfflinePromiseError";
    this.blocked_count = blockedCount;
  }
}

/** 平台封禁（B4）：403/429 且带 `x-platform-ban: true` 响应头。 */
export class PlatformBannedError extends Error {
  readonly code = "PLATFORM_BANNED" as const;
  readonly status: number;
  /** 平台建议的冷却时间；拿不到时为 null。 */
  readonly retry_after_ms: number | null;
  readonly reason: string;
  readonly url: string;

  constructor(input: { url: string; status: number; reason: string; retry_after_ms: number | null }) {
    super(`平台封禁中（HTTP ${input.status}）：${input.reason}${input.retry_after_ms === null ? "" : `，建议冷静期 ${input.retry_after_ms}ms`}`);
    this.name = "PlatformBannedError";
    this.status = input.status;
    this.retry_after_ms = input.retry_after_ms;
    this.reason = input.reason;
    this.url = input.url;
  }
}

/** Outbox 重放硬失败（executor 抛异常 / 拒绝继续）。 */
export class OutboxReplayError extends Error {
  readonly code = "OUTBOX_REPLAY" as const;
  readonly item_id: string | null;
  readonly item_idempotency_key: string | null;

  constructor(message: string, input: { item_id?: string | null; item_idempotency_key?: string | null } = {}) {
    super(message);
    this.name = "OutboxReplayError";
    this.item_id = input.item_id ?? null;
    this.item_idempotency_key = input.item_idempotency_key ?? null;
  }
}
