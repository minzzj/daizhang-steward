/**
 * 把「配置中心」适配成编排内核的 `ModelResolver`（结构适配，零 import 依赖）。
 *
 * 适配对象（`packages/steward-config` v1.2-A 的 ConfigEngine 即可直接传入）：
 * - `resolveAgentModel(role)` → `{ provider, model, has_key?, key_source? }`
 * - `getApiKeyForProvider(id)` 或 `getApiKey(id)` → 运行时密钥（**只读出、不落日志/会话文件**）
 * - `getConductorPrompt()` / `getSystemPrompt(role)` → 专业系统提示词
 * - `consumeTokens(amount, {agentRole, action})` → Token 预算（超限 ok:false）
 * - `remainingTokens()` 或 `tokenBudget.remaining()` → 剩余 Token
 *
 * 注意：provider 对象可以携带 api_key_ref 等额外字段，本适配只取 ModelProviderView 需要的字段，
 * 且**绝不**把密钥写入任何返回值/日志。
 */

import { OrchestratorValidationError } from "./errors.js";
import type {
  KeySource,
  ModelProviderKind,
  ModelProviderView,
  ModelResolution,
  ModelResolver,
  TokenConsumeMeta,
  TokenConsumeResult,
} from "./types.js";

const PROVIDER_KINDS: readonly ModelProviderKind[] = ["deepseek", "openai_compatible", "anthropic", "local"];

/** 配置中心里可被结构适配的最小形状（其余字段忽略）。 */
export interface ConfigResolverSource {
  resolveAgentModel(role: string): {
    provider: ModelProviderView & { api_key_ref?: string; enabled?: boolean };
    model: string;
    /** 配置中心推荐直接给出 has_key；缺失时用 getApiKey 探测。 */
    has_key?: boolean;
    key_source?: KeySource;
    binding?: unknown;
  };
  getApiKeyForProvider?(providerId: string): string | { ok?: boolean; key?: string | null } | null;
  getApiKey?(providerId: string): string | { ok?: boolean; key?: string | null } | null;
  getConductorPrompt(): string;
  getSystemPrompt(role: string): string;
  consumeTokens(amount: number, meta: TokenConsumeMeta): {
    ok: boolean;
    used_tokens?: number;
    limit_tokens?: number;
    remaining_tokens?: number;
    reason?: string;
  };
  remainingTokens?(): number;
  tokenBudget?: { remaining(): number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderKind(value: unknown): ModelProviderKind {
  return typeof value === "string" && (PROVIDER_KINDS as readonly string[]).includes(value)
    ? (value as ModelProviderKind)
    : "local";
}

/** 由配置中心构建 ModelResolver（模型/密钥/提示词/Token 预算；密钥不落日志）。 */
export function createModelResolverFromConfig(source: ConfigResolverSource): ModelResolver {
  if (!isRecord(source)) {
    throw new OrchestratorValidationError("createModelResolverFromConfig 需要配置中心对象", "INVALID_INPUT", "source");
  }
  /** 兼容 ConfigEngine.getApiKeyForProvider 的 { ok, key } 返回结构与纯字符串。 */
  const coerceKey = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (value !== null && typeof value === "object") {
      const record = value as { ok?: unknown; key?: unknown; value?: unknown };
      const raw = typeof record.key === "string" ? record.key : typeof record.value === "string" ? record.value : null;
      if (record.ok !== false && raw !== null && raw.trim().length > 0) return raw.trim();
    }
    return null;
  };
  const readKey = (providerId: string): string | null => {
    try {
      if (typeof source.getApiKeyForProvider === "function") {
        const value = coerceKey(source.getApiKeyForProvider(providerId));
        if (value !== null) return value;
      }
      if (typeof source.getApiKey === "function") {
        const value = coerceKey(source.getApiKey(providerId));
        if (value !== null) return value;
      }
    } catch {
      return null;
    }
    return null;
  };

  let lastRemaining: number | null = null;

  const resolver: ModelResolver = {
    resolveAgentModel(role: string): ModelResolution {
      const raw = source.resolveAgentModel(role);
      if (!isRecord(raw) || !isRecord(raw.provider)) {
        throw new OrchestratorValidationError(`配置中心 resolveAgentModel(${role}) 返回非法`, "INVALID_INPUT", "resolver");
      }
      const provider: ModelProviderView = {
        id: typeof raw.provider.id === "string" ? raw.provider.id : "local",
        name: typeof raw.provider.name === "string" ? raw.provider.name : "本地模型",
        kind: normalizeProviderKind(raw.provider.kind),
        base_url: typeof raw.provider.base_url === "string" ? raw.provider.base_url : "",
        default_model: typeof raw.provider.default_model === "string" ? raw.provider.default_model : "local-rules",
        models: Array.isArray(raw.provider.models) ? raw.provider.models.filter((item): item is string => typeof item === "string") : [],
      };
      const model = typeof raw.model === "string" && raw.model.trim().length > 0 ? raw.model.trim() : provider.default_model;
      const hasKeyResolved = typeof raw.has_key === "boolean" ? raw.has_key : readKey(provider.id) !== null;
      const keySource: KeySource =
        raw.key_source === "env" || raw.key_source === "file" || raw.key_source === "missing"
          ? raw.key_source
          : hasKeyResolved
            ? "env"
            : "missing";
      const resolution: ModelResolution = { provider, model, has_key: hasKeyResolved, key_source: keySource };
      return resolution;
    },
    getApiKey(providerId: string): string | null {
      return readKey(providerId);
    },
    getConductorPrompt(): string {
      try {
        const prompt = source.getConductorPrompt();
        return typeof prompt === "string" ? prompt : "";
      } catch {
        return "";
      }
    },
    getSystemPrompt(role: string): string {
      try {
        const prompt = source.getSystemPrompt(role);
        return typeof prompt === "string" ? prompt : "";
      } catch {
        return "";
      }
    },
    consumeTokens(amount: number, meta: TokenConsumeMeta): TokenConsumeResult {
      const result = source.consumeTokens(amount, meta);
      const used = typeof result.used_tokens === "number" ? result.used_tokens : 0;
      const limit = typeof result.limit_tokens === "number" ? result.limit_tokens : 0;
      const remaining =
        typeof result.remaining_tokens === "number" ? result.remaining_tokens : Math.max(0, limit - used);
      lastRemaining = remaining;
      const normalized: TokenConsumeResult = {
        ok: result.ok === true,
        used_tokens: used,
        limit_tokens: limit,
        remaining_tokens: remaining,
      };
      if (typeof result.reason === "string") normalized.reason = result.reason;
      return normalized;
    },
    remainingTokens(): number {
      if (typeof source.remainingTokens === "function") {
        try {
          const value = source.remainingTokens();
          if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
        } catch {
          /* fallthrough */
        }
      }
      if (isRecord(source.tokenBudget) && typeof source.tokenBudget.remaining === "function") {
        try {
          const value = source.tokenBudget.remaining();
          if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
        } catch {
          /* fallthrough */
        }
      }
      return lastRemaining ?? 0;
    },
  };
  return resolver;
}
