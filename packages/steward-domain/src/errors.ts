/**
 * 经营域错误类型：把「调用方输入非法 / 预算越界 / 系统已接管 / 边界拒绝」分开，
 * 便于 CLI 映射退出码与用户可见提示（错误码只增不减）。
 */

export type DomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "BUDGET_EXCEEDED"
  | "SYSTEM_HALTED"
  | "BOUNDARY_DENIED";

/** 入参/状态非法：调用方需要修正输入或先补齐前置状态。 */
export class DomainValidationError extends Error {
  readonly code: DomainErrorCode;
  readonly field: string | null;

  constructor(message: string, code: DomainErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "DomainValidationError";
    this.code = code;
    this.field = field;
  }
}

/** 预算三层（月/项目/单笔）任一超限。 */
export class BudgetExceededError extends DomainValidationError {
  readonly layer: "per_txn" | "project" | "month";
  readonly limit_cny: number;
  readonly requested_cny: number;

  constructor(message: string, layer: "per_txn" | "project" | "month", limit_cny: number, requested_cny: number) {
    super(message, "BUDGET_EXCEEDED");
    this.name = "BudgetExceededError";
    this.layer = layer;
    this.limit_cny = limit_cny;
    this.requested_cny = requested_cny;
  }
}

/** 接管键触发后（halted=true）的新动作被拒。 */
export class SystemHaltedError extends DomainValidationError {
  readonly halted_at: string | null;
  readonly halted_reason: string | null;

  constructor(message: string, halted_at: string | null = null, halted_reason: string | null = null) {
    super(message, "SYSTEM_HALTED");
    this.name = "SystemHaltedError";
    this.halted_at = halted_at;
    this.halted_reason = halted_reason;
  }
}

/** 边界规则命中 deny 时的强拒绝（含规则 id 与用户可见理由，便于留痕/UI 展示）。 */
export class BoundaryDeniedError extends DomainValidationError {
  readonly rule_id: string;
  readonly decision: "deny";

  constructor(message: string, rule_id: string) {
    super(message, "BOUNDARY_DENIED");
    this.name = "BoundaryDeniedError";
    this.rule_id = rule_id;
    this.decision = "deny";
  }
}
