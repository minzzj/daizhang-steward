/**
 * steward-runtime 错误类型：入参/找不到 Run/等待超时分开，便于 CLI 映射退出码。
 */

export type RuntimeErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "TIMEOUT" | "CONFIG";

export class RuntimeValidationError extends Error {
  readonly code: RuntimeErrorCode;
  readonly field: string | null;

  constructor(message: string, code: RuntimeErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "RuntimeValidationError";
    this.code = code;
    this.field = field;
  }
}

export class RuntimeNotFoundError extends RuntimeValidationError {
  readonly run_id: string | null;

  constructor(message: string, run_id: string | null = null) {
    super(message, "NOT_FOUND", run_id === null ? null : "runId");
    this.name = "RuntimeNotFoundError";
    this.run_id = run_id;
  }
}

export class RuntimeTimeoutError extends RuntimeValidationError {
  readonly run_id: string | null;
  readonly waited_ms: number;

  constructor(message: string, run_id: string | null = null, waited_ms = 0) {
    super(message, "TIMEOUT", run_id === null ? null : "runId");
    this.name = "RuntimeTimeoutError";
    this.run_id = run_id;
    this.waited_ms = waited_ms;
  }
}
