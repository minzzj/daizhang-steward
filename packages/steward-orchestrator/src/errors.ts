/**
 * 编排内核错误类型：把「入参/状态非法」「找不到会话」「持久化失败」分开，
 * 便于 CLI/控制台映射退出码与用户可见提示（错误码只增不减）。
 */

export type OrchestratorErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "TOKEN_LIMIT"
  | "MISSING_PLAN"
  | "PERSISTENCE";

/** 入参/状态非法：调用方需要修正输入或先补齐前置状态。 */
export class OrchestratorValidationError extends Error {
  readonly code: OrchestratorErrorCode;
  readonly field: string | null;

  constructor(message: string, code: OrchestratorErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "OrchestratorValidationError";
    this.code = code;
    this.field = field;
  }
}

/** 找不到会话/步骤。 */
export class OrchestratorNotFoundError extends OrchestratorValidationError {
  readonly session_id: string | null;

  constructor(message: string, session_id: string | null = null) {
    super(message, "NOT_FOUND", session_id === null ? null : "session_id");
    this.name = "OrchestratorNotFoundError";
    this.session_id = session_id;
  }
}

/** 会话持久化失败（磁盘/权限/JSON 损坏）。 */
export class OrchestratorPersistenceError extends OrchestratorValidationError {
  readonly path: string | null;

  constructor(message: string, path: string | null = null) {
    super(message, "PERSISTENCE", path === null ? null : "path");
    this.name = "OrchestratorPersistenceError";
    this.path = path;
  }
}
