/**
 * Scout 专属错误类型：把“合规拒绝”与“参数/状态非法”分开，便于 CLI 区分
 * 「不可重试的合规拦截」与「调用方需要修正的输入」。
 */

/** 错误码（只增不减，CLI 可据此映射退出码/提示）。 */
export type ScoutErrorCode =
  | "INVALID_INPUT"
  /** 未获人工审批就想发送。 */
  | "NOT_APPROVED"
  /** 已退订仍尝试触达。 */
  | "UNSUBSCRIBED"
  /** 同一条线索重复发送。 */
  | "ALREADY_SENT"
  /** 超过每日每渠道上限。 */
  | "DAILY_LIMIT_EXCEEDED"
  /** 草稿无法满足合规约束（如 signal 含不可引用语义）。 */
  | "DRAFT_LIMIT";

/** 合规拦截：属于产品边界（审批/频控/退订/不冒充人类），不是可重试错误。 */
export class ScoutComplianceError extends Error {
  readonly code: ScoutErrorCode;

  constructor(message: string, code: ScoutErrorCode = "NOT_APPROVED") {
    super(message);
    this.name = "ScoutComplianceError";
    this.code = code;
  }
}

/** 入参/状态非法：调用方需要修正线索、lead_id 或引擎参数。 */
export class ScoutValidationError extends Error {
  readonly code: ScoutErrorCode;

  constructor(message: string, code: ScoutErrorCode = "INVALID_INPUT") {
    super(message);
    this.name = "ScoutValidationError";
    this.code = code;
  }
}
