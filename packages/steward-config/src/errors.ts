/**
 * 配置中心错误类型（错误码只增不减，便于 CLI 映射退出码/提示）。
 */

export type ConfigErrorCode =
  | "INVALID_INPUT"
  | "FEATURE_DISABLED"
  | "BUDGET_LIMIT"
  | "TOKEN_LIMIT"
  | "IO_ERROR";

/** 入参/配置非法：调用方需要修正输入或先补齐前置字段。 */
export class ConfigValidationError extends Error {
  readonly code: ConfigErrorCode;
  readonly field: string | null;

  constructor(message: string, code: ConfigErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "ConfigValidationError";
    this.code = code;
    this.field = field;
  }
}

/** 功能被用户逐项禁用（或当前模式不可用）。 */
export class FeatureDisabledError extends Error {
  readonly code = "FEATURE_DISABLED" as const;
  readonly feature: string;

  constructor(message: string, feature: string) {
    super(message);
    this.name = "FeatureDisabledError";
    this.feature = feature;
  }
}

/** 预算三层 / 0 元极限模式拒绝。 */
export class BudgetLimitError extends Error {
  readonly code = "BUDGET_LIMIT" as const;
  readonly kind: string;
  readonly limit_cny: number;
  readonly amount_cny: number;
  readonly requires_human = true;

  constructor(message: string, input: { kind: string; limit_cny: number; amount_cny: number }) {
    super(message);
    this.name = "BudgetLimitError";
    this.kind = input.kind;
    this.limit_cny = input.limit_cny;
    this.amount_cny = input.amount_cny;
  }
}

/** Token 预算超限（总上限或单步上限）。 */
export class TokenLimitError extends Error {
  readonly code = "TOKEN_LIMIT" as const;
  readonly agent_role: string;
  readonly limit_tokens: number;
  readonly used_tokens: number;
  readonly requested_tokens: number;
  readonly layer: "total" | "per_action";

  constructor(
    message: string,
    input: { agentRole: string; limit_tokens: number; used_tokens: number; requested_tokens: number; layer: "total" | "per_action" },
  ) {
    super(message);
    this.name = "TokenLimitError";
    this.agent_role = input.agentRole;
    this.limit_tokens = input.limit_tokens;
    this.used_tokens = input.used_tokens;
    this.requested_tokens = input.requested_tokens;
    this.layer = input.layer;
  }
}

/** 配置/审计/Token 用量文件读写失败。 */
export class ConfigIOError extends Error {
  readonly code = "IO_ERROR" as const;
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = "ConfigIOError";
    this.path = path;
  }
}
