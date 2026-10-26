/**
 * TokenBudget：可配置的 Token 消耗上限（本次测试值 10,000,000）。
 *
 * - `consume(amount, {agentRole, action})`：累计消耗并写用量历史/审计；
 *   超单步上限（per_action_limit）或总上限（limit_tokens）→ `{ok:false, reason}`，不扣减；
 *   `on_exceed="block"` 时标记 blocked（并可用 `consumeOrThrow` 抛 TokenLimitError）；
 * - `remaining()` / `usageByAgent()` / `history()` 供控制台/CLI 展示；
 * - `used_tokens` 持久化在 `config.json`（TokenUsage 历史另存 `<root>/token-usage.jsonl`）。
 */

import { ConfigValidationError, TokenLimitError } from "./errors.js";
import type {
  AgentConfig,
  AuditResult,
  TokenBudgetConfig,
  TokenConsumeMeta,
  TokenConsumeResult,
  TokenUsageByAgent,
  TokenUsageEntry,
} from "./types.js";

/** TokenBudget 依赖的宿主动作（由 ConfigEngine 提供，保证持久化与审计）。 */
export interface TokenBudgetHost {
  getTokenBudget(): TokenBudgetConfig;
  applyTokenBudget(patch: Partial<TokenBudgetConfig>): void;
  recordTokenUsage(entry: TokenUsageEntry): void;
  getTokenUsageHistory(): TokenUsageEntry[];
  recordAudit(action: string, object: string, result: AuditResult, reason: string): void;
  nowIso(): string;
  getAgents(): AgentConfig[];
  getAgent(role: string): AgentConfig | null;
}

function requireNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigValidationError(`${field} 必须是非负数字：${String(value)}`, "INVALID_INPUT", field);
  }
  return Math.floor(value);
}

export class TokenBudget {
  private readonly host: TokenBudgetHost;

  constructor(host: TokenBudgetHost) {
    this.host = host;
  }

  /** 当前配置快照。 */
  config(): TokenBudgetConfig {
    return { ...this.host.getTokenBudget() };
  }

  /** 剩余 token（不小于 0）。 */
  remaining(): number {
    const config = this.host.getTokenBudget();
    return Math.max(0, config.limit_tokens - config.used_tokens);
  }

  /**
   * 消耗 token（超限不扣减、不抛错；返回 ok:false + 可读原因）。
   * 额外：单步默认上限 `per_action_limit`；amount=0 视为免费动作直接放行。
   */
  consume(amount: number, meta: TokenConsumeMeta): TokenConsumeResult {
    const requested = requireNonNegativeInt(amount, "amount");
    const agentRole = typeof meta === "object" && meta !== null ? meta.agentRole : "";
    const action = typeof meta === "object" && meta !== null ? meta.action : "";
    if (typeof agentRole !== "string" || agentRole.trim() === "") {
      throw new ConfigValidationError("consume 需要 agentRole", "INVALID_INPUT", "agentRole");
    }
    if (typeof action !== "string" || action.trim() === "") {
      throw new ConfigValidationError("consume 需要 action", "INVALID_INPUT", "action");
    }
    const config = this.host.getTokenBudget();
    const base: Omit<TokenConsumeResult, "ok" | "reason" | "blocked" | "per_action_exceeded"> = {
      consumed: requested,
      used_tokens: config.used_tokens,
      limit_tokens: config.limit_tokens,
      remaining_tokens: Math.max(0, config.limit_tokens - config.used_tokens),
      on_exceed: config.on_exceed,
    };

    if (requested === 0) {
      return { ok: true, ...base, blocked: false, per_action_exceeded: false };
    }

    const perActionExceeded = requested > config.per_action_limit;
    const totalExceeded = config.used_tokens + requested > config.limit_tokens;
    const blocked = config.on_exceed === "block";

    if (perActionExceeded || totalExceeded) {
      const reason = perActionExceeded
        ? `Token 单步上限超限：本次 ${requested} > 单步上限 ${config.per_action_limit}（累计 ${config.used_tokens}/${config.limit_tokens}）`
        : `Token 总量超限：累计 ${config.used_tokens} + 本次 ${requested} > 上限 ${config.limit_tokens}`;
      this.host.recordTokenUsage({
        at: this.host.nowIso(),
        agent_role: agentRole.trim(),
        action: action.trim(),
        amount: requested,
        ok: false,
        reason,
        used_after: config.used_tokens,
      });
      this.host.recordAudit("token.exceed", `${agentRole.trim()}/${action.trim()}`, "blocked", reason);
      return { ok: false, reason, ...base, blocked, per_action_exceeded: perActionExceeded };
    }

    const usedAfter = config.used_tokens + requested;
    this.host.applyTokenBudget({ used_tokens: usedAfter });
    this.host.recordTokenUsage({
      at: this.host.nowIso(),
      agent_role: agentRole.trim(),
      action: action.trim(),
      amount: requested,
      ok: true,
      used_after: usedAfter,
    });
    return {
      ok: true,
      consumed: requested,
      used_tokens: usedAfter,
      limit_tokens: config.limit_tokens,
      remaining_tokens: Math.max(0, config.limit_tokens - usedAfter),
      on_exceed: config.on_exceed,
      blocked: false,
      per_action_exceeded: false,
    };
  }

  /** 严格模式：超限直接抛 TokenLimitError（CLI 可用于非零退出码）。 */
  consumeOrThrow(amount: number, meta: TokenConsumeMeta): TokenConsumeResult {
    const result = this.consume(amount, meta);
    if (result.ok) return result;
    const config = this.host.getTokenBudget();
    throw new TokenLimitError(result.reason ?? "Token 超限", {
      agentRole: typeof meta === "object" && meta !== null ? meta.agentRole : "",
      limit_tokens: config.limit_tokens,
      used_tokens: config.used_tokens,
      requested_tokens: Math.max(0, Math.floor(Number(amount) || 0)),
      layer: result.per_action_exceeded ? "per_action" : "total",
    });
  }

  /** 按代理角色汇总消耗（calls/tokens 来自历史）。 */
  usageByAgent(): TokenUsageByAgent[] {
    const config = this.host.getTokenBudget();
    const history = this.history();
    return this.host
      .getAgents()
      .map((agent) => {
        const entries = history.filter((entry) => entry.agent_role === agent.role && entry.ok);
        const tokens = entries.reduce((sum, entry) => sum + entry.amount, 0);
        const limit = agent.token_limit > 0 ? Math.min(agent.token_limit, config.limit_tokens) : config.limit_tokens;
        return {
          role: agent.role,
          calls: entries.length,
          tokens,
          token_limit: limit,
          remaining_tokens: Math.max(0, limit - tokens),
        };
      })
      .sort((a, b) => b.tokens - a.tokens || a.role.localeCompare(b.role));
  }

  /** 单个角色的用量。 */
  agentUsage(role: string): TokenUsageByAgent | null {
    return this.usageByAgent().find((item) => item.role === role) ?? null;
  }

  /** 用量历史（只读副本）。 */
  history(): TokenUsageEntry[] {
    return this.host.getTokenUsageHistory().map((entry) => ({ ...entry }));
  }

  /** 重置已用 token（保留上限配置；审计留痕）。 */
  resetUsage(reason = "用户手动重置 Token 用量"): TokenBudgetConfig {
    this.host.applyTokenBudget({ used_tokens: 0 });
    this.host.recordAudit("token.reset", "token_budget", "ok", reason);
    return this.host.getTokenBudget();
  }
}

/** 扩展宿主接口（history 读取；与 TokenBudgetHost 分离便于 engine 实现）。 */
export interface TokenBudgetHistoryHost extends TokenBudgetHost {
  getTokenUsageHistory(): TokenUsageEntry[];
}

export { requireNonNegativeInt };