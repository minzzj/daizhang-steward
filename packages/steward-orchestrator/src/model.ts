/**
 * 模型适配层：真实 OpenAI 兼容调用（DeepSeek 等）+ 确定性本地规则回退。
 *
 * - `OpenAICompatibleAdapter`：`POST ${base_url}/chat/completions`，`Authorization: Bearer <key>`，
 *   解析 `choices[0].message.content` 与 `usage.total_tokens`；超时/中断/4xx/5xx/网络错误分类返回
 *   `{ok:false, mode:"local_fallback", error}`（不抛异常，由引擎决定回退并留痕）。
 * - `LocalPlannerAdapter`：无密钥/模型失败时的确定性回退；产出固定 JSON 计划或模板摘要，
 *   `mode` 恒为 `"local_fallback"` 且文案明确标注「本地规则模式·未调用远程模型」。
 * - `parseConductorPlan`：解析并校验模型返回的计划 JSON（非法 → 引擎回退本地计划）。
 *
 * 零第三方依赖；只有 OpenAICompatibleAdapter 会发起网络请求（fetch 可注入便于测试）。
 */

import type {
  ActionRisk,
  ConductorPlan,
  ConductorPlanStep,
  ModelAdapter,
  ModelChatInput,
  ModelChatMessage,
  ModelChatResult,
  ModelProviderView,
  SystemActionName,
} from "./types.js";

/** 计划请求标记：引擎在 conductor 消息中加入，LocalPlannerAdapter 据此产出 JSON 计划。 */
export const PLAN_MARKER = "PLAN_JSON_REQUIRED";
/** 单轮总结请求标记（每个 agent 每轮回复/摘要）。 */
export const AGENT_SUMMARY_MARKER = "AGENT_SUMMARY";
/** supervisor 系统计划请求标记（与 conductor 项目计划区分）。 */
export const SUPERVISOR_PLAN_MARKER = "SYSTEM_PLAN_JSON_REQUIRED";

/** 允许派发的专项智能体角色（conductor 由编排内核自身承担，不在计划步骤里）。 */
export const ALLOWED_AGENT_ROLES: readonly string[] = [
  "operator",
  "harness",
  "reviewer",
  "finance",
  "backend",
  "scout",
  "customer",
  "content",
  "research",
];

const ROLE_DEFAULT_ACTIONS: Readonly<Record<string, string>> = {
  operator: "operator.build_deliverable",
  harness: "harness.quality_check",
  reviewer: "reviewer.review_evidence",
  finance: "finance.collect_payment",
  backend: "backend.write_events",
  scout: "scout.research_brief",
  customer: "customer.reply_draft",
  content: "content.draft",
  research: "scout.research_brief",
};

/** 角色的默认动作（计划里 action 缺失时使用）。 */
export function defaultActionForRole(role: string): string {
  return ROLE_DEFAULT_ACTIONS[role] ?? "operator.build_deliverable";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 按字符数截断（不破坏 Unicode 码点）。 */
export function truncate(text: string, maxChars: number): string {
  const chars = Array.from(typeof text === "string" ? text : "");
  if (chars.length <= maxChars) return chars.join("");
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/** 粗略估算 Token（4 字符 ≈ 1 token；用于调用前预扣）。 */
export function estimateTokens(input: string | ModelChatMessage[]): number {
  const text = typeof input === "string" ? input : input.map((message) => message.content).join("\n");
  return Math.max(1, Math.ceil(Array.from(text).length / 4));
}

function matchFirst(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match?.[1] === undefined ? null : match[1].trim();
}

/** 从模型输出中提取 JSON 对象文本（容忍 ```json 代码块/前后说明）。 */
function extractJsonText(content: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(content);
  if (fenced?.[1] !== undefined) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{") && inner.endsWith("}")) return inner;
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return content.slice(start, end + 1);
}

/** 解析/校验模型生成的计划 JSON；非法返回 null（引擎回退本地规则计划）。 */
export function parseConductorPlan(content: string, maxSteps = 8): ConductorPlan | null {
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length === 0) return null;
  const jsonText = extractJsonText(text);
  if (jsonText === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const rawSteps = Array.isArray(raw.steps)
    ? raw.steps
    : Array.isArray(raw.plan)
      ? raw.plan
      : null;
  if (rawSteps === null) return null;

  const steps: ConductorPlanStep[] = [];
  for (const item of rawSteps) {
    if (steps.length >= maxSteps) break;
    if (!isRecord(item)) continue;
    const roleCandidate =
      typeof item.agent_role === "string"
        ? item.agent_role
        : typeof item.role === "string"
          ? item.role
          : "";
    const role = roleCandidate.trim().toLowerCase();
    if (!ALLOWED_AGENT_ROLES.includes(role)) continue;
    const action =
      typeof item.action === "string" && item.action.trim().length > 0
        ? item.action.trim()
        : defaultActionForRole(role);
    const summary =
      typeof item.summary === "string" && item.summary.trim().length > 0
        ? truncate(item.summary.trim(), 160)
        : `${role}：${action}`;
    steps.push({ agent_role: role, action, summary });
  }
  if (steps.length === 0) return null;
  const title =
    typeof raw.title === "string" && raw.title.trim().length > 0
      ? truncate(raw.title.trim(), 60)
      : undefined;
  return title === undefined ? { steps } : { title, steps };
}

/**
 * 本地规则计划（确定性）：根据目标关键词选择专项智能体步骤。
 * 固定包含：operator 交付物 →（scout/customer/content 可选）→ harness 质检 → reviewer 核查 →
 * backend 事件/证据索引 → finance 收款请求（需人工确认）。
 */
export function buildLocalPlan(goal: string, maxSteps = 8): ConductorPlan {
  const text = typeof goal === "string" ? goal.trim() : "";
  const steps: ConductorPlanStep[] = [];
  const push = (agent_role: string, action: string, summary: string): void => {
    steps.push({ agent_role, action, summary });
  };

  push("operator", "operator.build_deliverable", `依据目标生成交付物（页面 + 报告）：${truncate(text, 40)}`);
  if (/(?:调研|研究|查|竞品|竞对|市场|线索|资料|对比|分析)/u.test(text)) {
    push("scout", "scout.research_brief", "整理调研要点与线索草稿（只起草，不自动外发）");
  }
  if (/(?:客户|回复|邮件|沟通|跟进|售后)/u.test(text)) {
    push("customer", "customer.reply_draft", "生成客户沟通回复草稿（人工确认后再发送）");
  }
  if (/(?:内容|文案|文章|短视频|宣传|海报)/u.test(text)) {
    push("content", "content.draft", "生成内容/文案草稿");
  }
  push("harness", "harness.quality_check", "本地质检交付物结构（文件存在/标题/正文）");
  push("reviewer", "reviewer.review_evidence", "核查证据是否支撑结论");
  push("backend", "backend.write_events", "写事件日志与证据索引");
  push("finance", "finance.collect_payment", "生成收款请求（演示渠道，需人工确认到账）");

  const limit = Math.max(2, Math.floor(Number.isFinite(maxSteps) ? maxSteps : 8));
  let kept = steps;
  if (steps.length > limit) {
    const head = steps[0];
    const tail = steps[steps.length - 1];
    if (head !== undefined && tail !== undefined) {
      kept = [head, ...steps.slice(1, limit - 1), tail];
    }
  }
  return { title: `本地规则计划：${truncate(text, 24)}`, steps: kept };
}

/** 本地回退适配器：无密钥/远程失败时的确定性输出（明确标注 local_fallback）。 */
export class LocalPlannerAdapter implements ModelAdapter {
  async chat(input: ModelChatInput): Promise<ModelChatResult> {
    const joined = input.messages.map((message) => message.content).join("\n");
    const tokens = estimateTokens(input.messages);
    if (joined.includes(SUPERVISOR_PLAN_MARKER)) {
      const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
      const goalLine = (lastUser?.content ?? "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.includes(SUPERVISOR_PLAN_MARKER));
      const plan = buildLocalSystemPlan(goalLine ?? "完成系统管理目标");
      return { ok: true, content: JSON.stringify(plan), tokens_used: tokens, mode: "local_fallback" };
    }
    const wantsPlan = joined.includes(PLAN_MARKER) || /输出计划|生成计划/u.test(joined.slice(-400));
    if (wantsPlan) {
      const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
      const goalLine = (lastUser?.content ?? "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.includes(PLAN_MARKER));
      const plan = buildLocalPlan(goalLine ?? "完成用户目标");
      return { ok: true, content: JSON.stringify(plan), tokens_used: tokens, mode: "local_fallback" };
    }
    const role = matchFirst(joined, /角色[:：]\s*([a-z_]+)/u) ?? "agent";
    const action = matchFirst(joined, /动作[:：]\s*([a-z0-9_.]+)/u) ?? "local.action";
    const summary = matchFirst(joined, /步骤[:：]\s*(.+)/u) ?? "完成本轮任务";
    const content = `【本地规则模式·未调用远程模型】${role} 已完成 ${action}：${truncate(summary, 60)}。动作全部在本地执行，未连接网络，结果已写入证据目录。`;
    return { ok: true, content, tokens_used: tokens, mode: "local_fallback" };
  }
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface OpenAICompatibleAdapterOptions {
  /** 注入 fetch（测试用）；默认全局 fetch。 */
  fetchImpl?: typeof fetch | undefined;
  /** 超时（毫秒，默认 20000）。 */
  timeoutMs?: number | undefined;
  /** 显式密钥（测试/一次性场景；生产请用 getApiKey 从配置中心运行时解析）。 */
  apiKey?: string | undefined;
  /** 运行时密钥解析（推荐接 ConfigEngine.getApiKeyForProvider）。 */
  getApiKey?: ((providerId: string) => string | null) | undefined;
}

function envKeyForProvider(provider: ModelProviderView): string | null {
  const envNames: string[] = [];
  if (provider.kind === "deepseek") envNames.push("DEEPSEEK_API_KEY");
  if (provider.kind === "anthropic") envNames.push("ANTHROPIC_API_KEY");
  const idEnv = provider.id.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
  envNames.push(`${idEnv}_API_KEY`, "OPENAI_API_KEY");
  for (const name of envNames) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
  } catch {
    return "";
  }
}

function extractMessageContent(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const message = first.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  // 兼容 content 为 [{type:"text",text:"..."}] 的 OpenAI 兼容变体
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text.length > 0) return text;
  }
  return null;
}

function extractTotalTokens(payload: unknown): number | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null;
  const total = payload.usage.total_tokens;
  if (typeof total === "number" && Number.isFinite(total) && total >= 0) return Math.floor(total);
  return null;
}

/** 真实 OpenAI 兼容 / DeepSeek 适配器（失败返回 local_fallback 结果，不抛异常）。 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  private readonly options: OpenAICompatibleAdapterOptions;

  constructor(options: OpenAICompatibleAdapterOptions = {}) {
    this.options = isRecord(options) ? options : {};
  }

  private resolveKey(provider: ModelProviderView): string | null {
    const explicit = typeof this.options.apiKey === "string" ? this.options.apiKey.trim() : "";
    if (explicit.length > 0) return explicit;
    if (typeof this.options.getApiKey === "function") {
      const resolved = this.options.getApiKey(provider.id);
      if (typeof resolved === "string" && resolved.trim().length > 0) return resolved.trim();
    }
    return envKeyForProvider(provider);
  }

  async chat(input: ModelChatInput): Promise<ModelChatResult> {
    const provider = input.resolution.provider;
    const key = this.resolveKey(provider);
    if (key === null) {
      return {
        ok: false,
        content: "",
        tokens_used: 0,
        mode: "local_fallback",
        error: "未配置 API 密钥：已回退本地规则模式（未发起网络请求）",
      };
    }
    if (isSignalAborted(input.signal)) {
      return { ok: false, content: "", tokens_used: 0, mode: "local_fallback", error: "请求已被中断" };
    }

    const url = `${provider.base_url.replace(/\/+$/u, "")}/chat/completions`;
    const timeoutMs =
      typeof this.options.timeoutMs === "number" && this.options.timeoutMs > 0
        ? this.options.timeoutMs
        : 20_000;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const body: Record<string, unknown> = {
        model: input.resolution.model,
        messages: input.messages,
        stream: false,
      };
      if (typeof input.temperature === "number") body.temperature = input.temperature;
      if (typeof input.max_tokens === "number") body.max_tokens = input.max_tokens;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const snippet = await safeResponseText(response);
        const status = `${response.status}${response.statusText.length > 0 ? ` ${response.statusText}` : ""}`;
        return {
          ok: false,
          content: "",
          tokens_used: 0,
          mode: "local_fallback",
          error: `HTTP ${status}${snippet.length > 0 ? `：${truncate(snippet, 120)}` : ""}`,
        };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, content: "", tokens_used: 0, mode: "local_fallback", error: "模型响应不是合法 JSON" };
      }
      const content = extractMessageContent(payload);
      if (content === null) {
        return {
          ok: false,
          content: "",
          tokens_used: 0,
          mode: "local_fallback",
          error: "模型响应缺少 choices[0].message.content",
        };
      }
      const tokens =
        extractTotalTokens(payload) ?? estimateTokens(input.messages) + estimateTokens(content);
      return { ok: true, content, tokens_used: tokens, mode: "remote" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = timedOut
        ? `请求超时（${timeoutMs}ms）`
        : isSignalAborted(input.signal)
          ? `请求被中断：${message}`
          : `网络错误：${message}`;
      return { ok: false, content: "", tokens_used: 0, mode: "local_fallback", error: reason };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// v1.3：supervisor 受管系统动作（计划/风险/解析）
// ---------------------------------------------------------------------------

/** supervisor 可计划/执行的受管系统动作全集。 */
export const SYSTEM_ACTIONS: readonly SystemActionName[] = [
  "listApps",
  "startApp",
  "stopApp",
  "restartApp",
  "removeApp",
  "listPlugins",
  "enablePlugin",
  "disablePlugin",
  "removePlugin",
  "changeAgentModel",
  "setPrompt",
  "delegateProject",
  "readLogs",
];

const SYSTEM_ACTION_SET = new Set<string>(SYSTEM_ACTIONS);

/** 动作风险分级：删除类 = high（必须确认）；启停/切换/委派 = medium；只读 = low。 */
export function riskForSystemAction(action: string): ActionRisk {
  if (action === "removeApp" || action === "removePlugin") return "high";
  if (action === "readLogs" || action === "listApps" || action === "listPlugins") return "low";
  return "medium";
}

/** 是否需要人工确认：高危动作永远需要；其余在 autoApprove=false 时需要。 */
export function requiresConfirmationFor(action: string, autoApprove: boolean): boolean {
  const risk = riskForSystemAction(action);
  if (risk === "high" || risk === "critical") return true;
  return autoApprove !== true;
}

function pickTarget(text: string, fallback: string): string {
  const quoted = /[「"']([^」"']{1,40})[」"']/u.exec(text);
  if (quoted?.[1] !== undefined && quoted[1].trim().length > 0) return quoted[1].trim();
  const id = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/iu.exec(text);
  if (id?.[1] !== undefined && id[1].length >= 3) return id[1];
  return fallback;
}

/**
 * 本地规则 supervisor 计划（确定性）：按目标关键词识别受管系统动作。
 * 无命中时兜底 [listApps, delegateProject]，保证系统会话仍有可执行计划。
 */
export function buildLocalSystemPlan(goal: string, maxSteps = 8): ConductorPlan {
  const text = typeof goal === "string" ? goal.trim() : "";
  const steps: ConductorPlanStep[] = [];
  const push = (
    action: SystemActionName,
    target: string,
    summary: string,
    args: Record<string, unknown> = {},
  ): void => {
    steps.push({ agent_role: "supervisor", action, summary, target, args });
  };

  if (/(?:删除|卸载).{0,10}(?:程序|应用|app)/iu.test(text)) {
    push("removeApp", pickTarget(text, "demo-app"), "删除受管程序（高风险，需二次确认）");
  }
  if (/(?:打开|启动|开启).{0,10}(?:程序|应用|app)/iu.test(text)) {
    push("startApp", pickTarget(text, "demo-app"), "启动受管程序");
  }
  if (/(?:关闭|停止|退出).{0,10}(?:程序|应用|app)/iu.test(text)) {
    push("stopApp", pickTarget(text, "demo-app"), "停止受管程序");
  }
  if (/重启/u.test(text)) {
    push("restartApp", pickTarget(text, "demo-app"), "重启受管程序");
  }
  if (/(?:列出|查看).{0,8}(?:程序|应用|app)/iu.test(text)) {
    push("listApps", "apps", "列出受管程序");
  }
  if (/插件/u.test(text)) {
    if (/(?:删除|卸载)/u.test(text)) {
      push("removePlugin", pickTarget(text, "demo-plugin"), "删除插件（先备份，高风险，需二次确认）");
    } else if (/禁用/u.test(text)) {
      push("disablePlugin", pickTarget(text, "demo-plugin"), "禁用插件");
    } else if (/启用/u.test(text)) {
      push("enablePlugin", pickTarget(text, "demo-plugin"), "启用插件");
    } else {
      push("listPlugins", "plugins", "列出受管插件");
    }
  }
  if (/(?:模型|model)/iu.test(text)) {
    const role =
      /(?:给|为|把)?\s*(operator|harness|reviewer|finance|backend|scout|customer|content|research|conductor)\s*(?:的)?\s*(?:模型|model)/iu.exec(
        text,
      )?.[1] ?? "operator";
    const model =
      /\b([a-z][a-z0-9._-]*(?:chat|model|v\d)[a-z0-9._-]*)\b/iu.exec(text)?.[1] ?? "deepseek-chat";
    const provider = /\b(deepseek|openai|anthropic)\b/iu.exec(text)?.[1]?.toLowerCase() ?? "deepseek";
    push("changeAgentModel", role, `切换 ${role} 的模型为 ${provider}/${model}`, {
      role,
      provider_id: provider,
      model,
    });
  }
  if (/(?:提示词|prompt)/iu.test(text)) {
    const role =
      /(operator|harness|reviewer|finance|backend|scout|customer|content|research|conductor|supervisor)\s*(?:的)?\s*(?:提示词|prompt)/iu.exec(
        text,
      )?.[1] ?? "conductor";
    push("setPrompt", role, `更新 ${role} 的系统提示词`, {
      role,
      prompt: `# ${role} 专业系统提示词（由 supervisor 更新）\n必须真实执行并留证、遵守审批边界、失败升级人工、不冒充人类。`,
    });
  }
  if (/(?:日志|记录|审计)/u.test(text)) {
    push("readLogs", "records", "读取全部会话日志/审计记录");
  }
  if (/(?:项目|做一个|实现|开发|交付|帮我)/u.test(text)) {
    push("delegateProject", text, "把目标委派给 conductor 项目会话", { project_goal: text });
  }
  if (steps.length === 0) {
    push("listApps", "apps", "列出受管程序");
    push("delegateProject", text, "把目标委派给 conductor 项目会话", { project_goal: text });
  }

  const limit = Math.max(1, Math.floor(Number.isFinite(maxSteps) ? maxSteps : 8));
  let kept = steps;
  if (steps.length > limit) {
    const head = steps.slice(0, Math.max(1, limit - 1));
    const tail = steps[steps.length - 1];
    kept = tail === undefined ? head : [...head, tail];
  }
  return { title: `supervisor 系统计划：${truncate(text, 24)}`, steps: kept };
}

/** 解析/校验模型返回的 supervisor 系统计划 JSON；非法返回 null（引擎回退本地系统计划）。 */
export function parseSystemPlan(content: string, maxSteps = 8): ConductorPlan | null {
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length === 0) return null;
  const jsonText = extractJsonText(text);
  if (jsonText === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : Array.isArray(raw.plan) ? raw.plan : null;
  if (rawSteps === null) return null;

  const steps: ConductorPlanStep[] = [];
  for (const item of rawSteps) {
    if (steps.length >= maxSteps) break;
    if (!isRecord(item)) continue;
    const actionCandidate =
      typeof item.action === "string" ? item.action.trim() : typeof item.system_action === "string" ? item.system_action.trim() : "";
    if (!SYSTEM_ACTION_SET.has(actionCandidate)) continue;
    const action = actionCandidate as SystemActionName;
    const args = isRecord(item.args) ? { ...item.args } : {};
    const target =
      typeof item.target === "string" && item.target.trim().length > 0
        ? item.target.trim()
        : typeof args.target === "string"
          ? args.target
          : action;
    const risk: ActionRisk =
      item.risk === "low" || item.risk === "medium" || item.risk === "high" || item.risk === "critical"
        ? item.risk
        : riskForSystemAction(action);
    const summary =
      typeof item.summary === "string" && item.summary.trim().length > 0
        ? truncate(item.summary.trim(), 160)
        : `${action}：${target}`;
    steps.push({ agent_role: "supervisor", action, summary, target, args, risk });
  }
  if (steps.length === 0) return null;
  const title =
    typeof raw.title === "string" && raw.title.trim().length > 0 ? truncate(raw.title.trim(), 60) : undefined;
  return title === undefined ? { steps } : { title, steps };
}
