/**
 * AgentRegistry：10 个智能体（代理角色）的注册与开关。
 *
 * 角色：conductor（总调度）/ operator（办公执行）/ harness（写代码）/ customer（客户沟通）/
 *       finance（财务）/ reviewer（核查）/ backend（后台运维）/ scout（线索）/
 *       content（内容）/ research（调研）。
 * 每个角色可配置 enabled / autonomy / tools / token_limit / model_ref；默认值按运行模式生成。
 */

import { defaultAgents, isAgentRole } from "./defaults.js";
import { ConfigValidationError } from "./errors.js";
import type {
  AgentConfig,
  AgentUpdate,
  AuditResult,
  Autonomy,
  RunMode,
  TokenUsageByAgent,
  TokenUsageEntry,
} from "./types.js";

const AUTONOMY_VALUES: readonly Autonomy[] = ["readonly", "draft", "approval_required", "autonomous_limited"];

export interface AgentRegistryHost {
  getAgents(): AgentConfig[];
  applyAgents(agents: AgentConfig[]): void;
  getTokenUsageHistory(): TokenUsageEntry[];
  getTokenBudget(): { limit_tokens: number };
  recordAudit(action: string, object: string, result: AuditResult, reason: string): void;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigValidationError(`${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigValidationError(`${field} 必须是非负数字：${String(value)}`, "INVALID_INPUT", field);
  }
  return value;
}

export function isAutonomy(value: unknown): value is Autonomy {
  return typeof value === "string" && (AUTONOMY_VALUES as readonly string[]).includes(value);
}

function cloneAgent(agent: AgentConfig): AgentConfig {
  return { ...agent, tools: [...agent.tools] };
}

export class AgentRegistry {
  private readonly host: AgentRegistryHost;

  constructor(host: AgentRegistryHost) {
    this.host = host;
  }

  /** 某模式的默认代理列表（10 个，含工具与自主度）。 */
  defaultAgents(mode: RunMode): AgentConfig[] {
    return defaultAgents(mode);
  }

  /** 当前注册表（只读副本）。 */
  listAgents(): AgentConfig[] {
    return this.host.getAgents().map((agent) => cloneAgent(agent));
  }

  getAgent(role: string): AgentConfig | null {
    const found = this.host.getAgents().find((agent) => agent.role === role);
    return found === undefined ? null : cloneAgent(found);
  }

  /** 逐项启用/禁用代理（禁用后不参与调度；审计留痕）。 */
  setAgentEnabled(role: string, enabled: boolean): AgentConfig {
    if (!isAgentRole(role) && this.getAgent(role) === null) {
      throw new ConfigValidationError(`未知代理角色：${String(role)}`, "INVALID_INPUT", "role");
    }
    if (typeof enabled !== "boolean") {
      throw new ConfigValidationError("enabled 必须是布尔值", "INVALID_INPUT", "enabled");
    }
    const agents = this.host.getAgents();
    const target = agents.find((agent) => agent.role === role);
    if (target === undefined) throw new ConfigValidationError(`未知代理角色：${role}`, "INVALID_INPUT", "role");
    target.enabled = enabled;
    this.host.applyAgents(agents);
    this.host.recordAudit("agent.toggle", role, "ok", enabled ? "启用" : "禁用");
    return cloneAgent(target);
  }

  /** 配置代理参数（名称/自主度/工具/token 上限/模型引用）。 */
  setAgentConfig(role: string, update: AgentUpdate): AgentConfig {
    const agents = this.host.getAgents();
    const target = agents.find((agent) => agent.role === role);
    if (target === undefined) throw new ConfigValidationError(`未知代理角色：${String(role)}`, "INVALID_INPUT", "role");
    if (typeof update !== "object" || update === null) {
      throw new ConfigValidationError("setAgentConfig 需要 AgentUpdate 对象", "INVALID_INPUT", "update");
    }
    if (update.name !== undefined) target.name = requireString(update.name, "name");
    if (update.enabled !== undefined) {
      if (typeof update.enabled !== "boolean") throw new ConfigValidationError("enabled 必须是布尔值", "INVALID_INPUT", "enabled");
      target.enabled = update.enabled;
    }
    if (update.autonomy !== undefined) {
      if (!isAutonomy(update.autonomy)) {
        throw new ConfigValidationError(`autonomy 非法：${String(update.autonomy)}`, "INVALID_INPUT", "autonomy");
      }
      target.autonomy = update.autonomy;
    }
    if (update.tools !== undefined) {
      if (!Array.isArray(update.tools)) throw new ConfigValidationError("tools 必须是字符串数组", "INVALID_INPUT", "tools");
      target.tools = update.tools.map((tool) => requireString(tool, "tools[]"));
    }
    if (update.token_limit !== undefined) target.token_limit = requireNonNegativeNumber(update.token_limit, "token_limit");
    if (update.model_ref !== undefined) target.model_ref = requireString(update.model_ref, "model_ref");
    this.host.applyAgents(agents);
    this.host.recordAudit("agent.update", role, "ok", `autonomy=${target.autonomy}; enabled=${target.enabled}`);
    return cloneAgent(target);
  }

  /** 某角色 token 用量（calls/tokens/剩余）。 */
  agentUsage(role: string): TokenUsageByAgent | null {
    const agent = this.host.getAgents().find((item) => item.role === role);
    if (agent === undefined) return null;
    const config = this.host.getTokenBudget();
    const entries = this.host.getTokenUsageHistory().filter((entry) => entry.agent_role === role && entry.ok);
    const tokens = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const limit = agent.token_limit > 0 ? Math.min(agent.token_limit, config.limit_tokens) : config.limit_tokens;
    return { role, calls: entries.length, tokens, token_limit: limit, remaining_tokens: Math.max(0, limit - tokens) };
  }

  /** 全角色用量（按 tokens 降序）。 */
  usageAll(): TokenUsageByAgent[] {
    return this.listAgents()
      .map((agent) => this.agentUsage(agent.role))
      .filter((usage): usage is TokenUsageByAgent => usage !== null)
      .sort((a, b) => b.tokens - a.tokens || a.role.localeCompare(b.role));
  }
}
