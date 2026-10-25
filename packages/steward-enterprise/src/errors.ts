/**
 * 企业版错误类型：把「输入/状态非法」「模式冲突」「双人复核未满足」「开票校验失败」分开，
 * 便于 CLI 映射退出码与用户可见提示（错误码只增不减）。
 */

import type { ModeConflict } from "./types.js";

export type EnterpriseErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "MODE_CONFLICT"
  | "DUAL_REVIEW_REQUIRED"
  | "INVALID_INVOICE";

/** 入参/状态非法：调用方需要修正输入或先补齐前置状态。 */
export class EnterpriseValidationError extends Error {
  readonly code: EnterpriseErrorCode;
  readonly field: string | null;

  constructor(message: string, code: EnterpriseErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "EnterpriseValidationError";
    this.code = code;
    this.field = field;
  }
}

/** 模式一致性校验存在 block 级冲突（B8：不一致必须阻断）。 */
export class ModeConflictError extends EnterpriseValidationError {
  readonly conflicts: ModeConflict[];

  constructor(message: string, conflicts: ModeConflict[]) {
    super(message, "MODE_CONFLICT");
    this.name = "ModeConflictError";
    this.conflicts = conflicts.map((conflict) => ({ ...conflict }));
  }
}

/** 双人复核未满足/重复复核/已决请求继续复核。 */
export class DualReviewRequiredError extends EnterpriseValidationError {
  readonly request_id: string | null;

  constructor(message: string, request_id: string | null = null) {
    super(message, "DUAL_REVIEW_REQUIRED");
    this.name = "DualReviewRequiredError";
    this.request_id = request_id;
  }
}

/** 开票校验不通过（抬头/税号/合同不一致，或个人模式开专票）。 */
export class InvalidInvoiceError extends EnterpriseValidationError {
  override readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message, "INVALID_INVOICE", field);
    this.name = "InvalidInvoiceError";
    this.field = field;
  }
}
