/**
 * ChatEngine：对话式 AI 总控。
 *
 * 一句用户消息 → 规则意图路由（0 token）：
 * - 查询类：调用注入的 ChatTools 只读工具（系统/run/产物/报告/metrics/日志/配置/账本/智能体），
 *   回复 = text 摘要 + 内嵌 data/artifact/report 卡片；
 * - 任务类：execute_goal → 项目执行器（实时 thinking/step/产物/报告卡片）；
 *   harness_task → 真实 DSH harness（dshEnabled 时；实时 thinking/tool/artifact）；
 * - 危险动作：只调 systemActionPreview 返回审批卡，**绝不执行**；
 * - 审批：批准/驳回 run 步骤；
 * - 记忆：每轮自动抽取偏好/项目/决策/run/产物/报告引用，去重并限 maxMemoryEntries；
 *   回复前 memoryRecall 召回相关记忆（最多 5 条）注入；
 * - 闲聊兜底：不调模型，给建议。
 *
 * 消息/会话/记忆持久化由 ChatStore 负责；所有依赖注入，测试可用 fake tools。
 */

import { randomBytes } from "node:crypto";

import { ChatError } from "./errors.js";
import { applyMessagePhases } from "./phase.js";
import { analyzeIntent, classifyIntent } from "./intent.js";
import { extractMemoryCandidates, recallMemories } from "./memory.js";
import { ChatStore, summarizeMessage } from "./store.js";
import {
  CHAT_DEFAULT_CONVERSATION_TITLE,
  CHAT_DEFAULT_MAX_CONTEXT_MESSAGES,
  CHAT_DEFAULT_MAX_MEMORY_ENTRIES,
  type ChatClassification,
  type ChatConversation,
  type ChatConversationView,
  type ChatDataCard,
  type ChatEngineOptions,
  type ChatGoalResult,
  type ChatIntent,
  type ChatMemoryEntry,
  type ChatMemoryFilter,
  type ChatMessage,
  type ChatModelMode,
  type ChatPart,
  type ChatQueryResult,
  type ChatSendResult,
  type ChatTools,
} from "./types.js";

const QUERY_INTENTS: ReadonlySet<ChatIntent> = new Set<ChatIntent>([
  "system",
  "runs",
  "run_detail",
  "artifacts",
  "artifact_preview",
  "reports",
  "report_content",
  "metrics",
  "logs",
  "config",
  "ledger",
  "agents",
]);

const SUGGESTIONS_MARKDOWN = [
  "你可以直接这样问我：",
  "",
  "- 查系统状态 / 列出最近运行",
  "- 看看产物和报告（可以直接打开某份报告）",
  "- 写个 plan.md 文件（真实 DSH harness 执行）",
  "- 帮我做一个报价页面项目（项目执行器自动执行）",
  "- 批准 run-xxx 第 2 步 / 驳回 run-xxx 第 2 步",
  "- 记住我的偏好：回复用简洁中文",
].join("\n");

const CHAT_TOOL_METHODS: readonly (keyof ChatTools)[] = [
  "systemSummary",
  "listRuns",
  "runDetail",
  "listArtifacts",
  "artifactPreview",
  "listReports",
  "reportContent",
  "runMetrics",
  "readLogs",
  "configSummary",
  "ledgerSummary",
  "agentsSummary",
  "executeGoal",
  "harnessTask",
  "approve",
  "systemActionPreview",
];

interface TaskOutcome {
  runId?: string;
  sessionId?: string;
  taskSummary?: string;
}

type PushPart = (part: ChatPart, mode?: ChatModelMode) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clampChars(text: string, maxChars: number): string {
  return Array.from(String(text ?? "")).slice(0, maxChars).join("");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ChatEngine {
  private readonly tools: ChatTools;
  private readonly store: ChatStore;
  private readonly clock: () => Date;
  private readonly maxContextMessages: number;
  private readonly maxMemoryEntries: number;
  private readonly dshEnabled: boolean;
  private readonly polish: ((text: string) => Promise<string>) | undefined;
  private idSeq = 0;
  private toolCallSeq = 0;

  constructor(options: ChatEngineOptions) {
    if (!isRecord(options)) throw new ChatError("ChatEngine 需要 options 对象", "CONFIG", "options");
    if (!isRecord(options.tools)) throw new ChatError("ChatEngine 需要注入 tools", "CONFIG", "tools");
    for (const method of CHAT_TOOL_METHODS) {
      if (typeof (options.tools as unknown as Record<string, unknown>)[method] !== "function") {
        throw new ChatError(`tools 缺少方法 ${method}`, "CONFIG", "tools");
      }
    }
    if (typeof options.root !== "string" || options.root.trim().length === 0) {
      throw new ChatError("ChatEngine 需要非空 root", "CONFIG", "root");
    }
    this.tools = options.tools;
    this.clock = typeof options.now === "function" ? options.now : () => new Date();
    this.maxContextMessages =
      typeof options.maxContextMessages === "number" &&
      Number.isInteger(options.maxContextMessages) &&
      options.maxContextMessages > 0
        ? options.maxContextMessages
        : CHAT_DEFAULT_MAX_CONTEXT_MESSAGES;
    this.maxMemoryEntries =
      typeof options.maxMemoryEntries === "number" &&
      Number.isInteger(options.maxMemoryEntries) &&
      options.maxMemoryEntries > 0
        ? options.maxMemoryEntries
        : CHAT_DEFAULT_MAX_MEMORY_ENTRIES;
    this.dshEnabled = options.dshEnabled !== false;
    this.polish = typeof options.polish === "function" ? options.polish : undefined;
    this.store = new ChatStore(options.root, { now: this.clock });
  }

  // -------------------------------------------------------------------------
  // 会话 / 记忆 API（委托 ChatStore）
  // -------------------------------------------------------------------------

  listConversations(): ChatConversation[] {
    return this.store.listConversations();
  }

  createConversation(title?: string): ChatConversation {
    return this.store.createConversation(title);
  }

  getConversation(id: string): ChatConversationView | null {
    const conversation = this.store.getConversation(id);
    if (conversation === null) return null;
    const messages = this.store.listMessages(conversation.id);
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const query = lastUser?.parts.find((part) => part.type === "text")?.text ?? "";
    let memories = recallMemories(this.store.listMemory({ limit: Math.max(this.maxMemoryEntries, 200) }), query, 10);
    if (memories.length === 0) memories = this.store.listMemory({ limit: 10 });
    return { conversation, messages, memories };
  }

  renameConversation(id: string, title: string): ChatConversation {
    return this.store.renameConversation(id, title);
  }

  deleteConversation(id: string): boolean {
    return this.store.deleteConversation(id);
  }

  listMemory(filter: ChatMemoryFilter = {}): ChatMemoryEntry[] {
    return this.store.listMemory(filter);
  }

  addMemory(entry: Omit<ChatMemoryEntry, "id" | "created_at">): ChatMemoryEntry {
    const created = this.store.addMemory(entry);
    this.trimMemories();
    return created;
  }

  deleteMemory(id: string): boolean {
    return this.store.deleteMemory(id);
  }

  /** v1.5.2：追加一条 assistant 消息（审批后续/后台通知用），自动分相并持久化。 */
  appendAssistantMessage(conversationId: string, parts: ChatPart[], options: { model_mode?: ChatModelMode } = {}): ChatMessage {
    const conversation = this.store.getConversation(conversationId);
    if (conversation === null) throw new ChatError(`会话不存在：${String(conversationId)}`, "NOT_FOUND", "conversationId");
    const message: ChatMessage = {
      id: this.nextMessageId("assistant"),
      conversation_id: conversationId,
      role: "assistant",
      at: this.nowIso(),
      parts: parts.map((part) => clone(part)),
      status: "done",
      ...(options.model_mode !== undefined ? { model_mode: options.model_mode } : {}),
    };
    applyMessagePhases(message);
    message.summary = summarizeMessage(message);
    this.store.appendMessage(conversationId, message);
    return clone(message);
  }

  private nextToolCallId(): string {
    this.toolCallSeq += 1;
    return `call-${String(this.toolCallSeq).padStart(4, "0")}`;
  }

  private queryThinkingLabel(intent: ChatIntent): string {
    const labels: Record<string, string> = {
      system: "正在查询系统状态（程序/插件/审批/Token）…",
      runs: "正在查询最近的运行记录…",
      run_detail: "正在查询运行详情与证据…",
      artifacts: "正在查询产物文件…",
      artifact_preview: "正在读取产物内容…",
      reports: "正在查询报告…",
      report_content: "正在读取报告内容…",
      metrics: "正在查询 Token/用量数据…",
      logs: "正在读取日志与审计…",
      config: "正在读取配置摘要（密钥已脱敏）…",
      ledger: "正在查询收款/账本…",
      agents: "正在查询智能体与模型状态…",
      memory: "正在检索长期记忆…",
    };
    return labels[intent] ?? "正在查询…";
  }

  /** 记忆召回（相关度 → 重要度 → 时间，最多 limit 条；默认 5）。 */
  memoryRecall(query: string, limit = 5): ChatMemoryEntry[] {
    const all = this.store.listMemory({ limit: Math.max(this.maxMemoryEntries, 200) });
    return recallMemories(all, query, limit);
  }

  /** 意图分类（规则，0 token）。 */
  classify(text: string): ChatClassification {
    return classifyIntent(text);
  }

  // -------------------------------------------------------------------------
  // 发送消息
  // -------------------------------------------------------------------------

  async send(
    conversationId: string,
    text: string,
    onPart?: (part: ChatPart, message: ChatMessage) => void,
  ): Promise<ChatSendResult> {
    const conversation = this.store.getConversation(conversationId);
    if (conversation === null) throw new ChatError(`会话不存在：${String(conversationId)}`, "NOT_FOUND", "conversationId");
    const raw = typeof text === "string" ? text.trim() : "";
    if (raw.length === 0) throw new ChatError("消息不能为空", "INVALID_INPUT", "text");

    const at = this.nowIso();
    const userMessage: ChatMessage = {
      id: this.nextMessageId("user"),
      conversation_id: conversation.id,
      role: "user",
      at,
      parts: [{ type: "text", text: raw }],
      summary: clampChars(raw, 60),
      status: "done",
      model_mode: "rule",
    };
    this.store.appendMessage(conversation.id, userMessage);
    const afterUser = this.store.getConversation(conversation.id);
    if (afterUser !== null && afterUser.message_count === 1 && afterUser.title === CHAT_DEFAULT_CONVERSATION_TITLE) {
      this.store.renameConversation(conversation.id, clampChars(raw, 20));
    }

    const assistant: ChatMessage = {
      id: this.nextMessageId("assistant"),
      conversation_id: conversation.id,
      role: "assistant",
      at: this.nowIso(),
      parts: [],
      status: "streaming",
      model_mode: "rule",
    };
    const pushPart: PushPart = (part, mode) => {
      assistant.parts.push(part);
      if (mode !== undefined) assistant.model_mode = mode;
      if (typeof onPart === "function") {
        try {
          onPart(clone(part), clone(assistant));
        } catch {
          /* 订阅方异常不影响对话 */
        }
      }
      this.store.updateMessage(conversation.id, assistant);
    };
    this.store.appendMessage(conversation.id, assistant);

    const analysis = analyzeIntent(raw);
    const memories = this.memoryRecall(raw, 5);
    let outcome: TaskOutcome = {};
    try {
      outcome = await this.dispatch({ assistant, analysis, raw, memories, pushPart });
      assistant.status = "done";
    } catch (error) {
      pushPart({ type: "error", message: `处理消息失败：${errorMessage(error)}` });
      assistant.status = "error";
    }
    applyMessagePhases(assistant);
    assistant.summary = summarizeMessage(assistant);
    this.store.updateMessage(conversation.id, assistant);
    this.rememberFromTurn({ userText: raw, analysis, assistant, outcome });
    return { userMessage: clone(userMessage), assistantMessage: clone(assistant) };
  }

  // -------------------------------------------------------------------------
  // 路由
  // -------------------------------------------------------------------------

  private async dispatch(input: {
    assistant: ChatMessage;
    analysis: ReturnType<typeof analyzeIntent>;
    raw: string;
    memories: ChatMemoryEntry[];
    pushPart: PushPart;
  }): Promise<TaskOutcome> {
    const { analysis, raw, memories, pushPart } = input;
    const intent = analysis.intent;
    if (QUERY_INTENTS.has(intent)) {
      await this.handleQuery(intent, analysis, pushPart);
      this.pushMemoryCard(memories, pushPart);
      return {};
    }
    if (intent === "memory") {
      await this.handleMemory(raw, memories, pushPart);
      return {};
    }
    if (intent === "danger_action") {
      await this.handleDanger(raw, analysis, pushPart);
      return {};
    }
    if (intent === "approve") {
      await this.handleApprove(raw, analysis, pushPart);
      return {};
    }
    if (intent === "execute_goal") {
      const outcome = await this.handleExecuteGoal(raw, memories, pushPart);
      return outcome;
    }
    if (intent === "harness_task") {
      const outcome = await this.handleHarnessTask(raw, memories, pushPart);
      return outcome;
    }
    await this.handleChat(raw, memories, pushPart);
    return {};
  }

  // -------------------------------------------------------------------------
  // 查询类（0 token：直接调用只读数据工具）
  // -------------------------------------------------------------------------

  private async handleQuery(
    intent: ChatIntent,
    analysis: ReturnType<typeof analyzeIntent>,
    pushPart: PushPart,
  ): Promise<void> {
    const entities = analysis.entities;
    const plan = this.buildQueryPlan(intent, entities);
    const callId = this.nextToolCallId();
    pushPart({ type: "thinking", text: this.queryThinkingLabel(intent), collapsed: true });
    pushPart({ type: "tool_call", tool: plan.method, input: plan.input, callId, status: "running" });
    let result: ChatQueryResult;
    try {
      result = await plan.invoke();
    } catch (error) {
      const message = errorMessage(error);
      pushPart({ type: "tool_result", tool: plan.method, ok: false, summary: message, callId });
      pushPart({ type: "error", message: `查询失败：${message}` });
      return;
    }
    pushPart({ type: "tool_result", tool: plan.method, ok: result.ok, summary: result.summary, callId });
    if (result.summary.trim().length > 0) pushPart({ type: "text", text: result.summary });
    if (plan.note !== undefined) pushPart({ type: "text", text: plan.note });
    for (const part of Array.isArray(result.parts) ? result.parts : []) pushPart(part);
    if (!result.ok) pushPart({ type: "error", message: `查询返回失败：${result.summary}` });
  }

  private buildQueryPlan(
    intent: ChatIntent,
    entities: ReturnType<typeof analyzeIntent>["entities"],
  ): { method: keyof ChatTools; input: Record<string, unknown>; note?: string; invoke: () => Promise<ChatQueryResult> } {
    const runId = entities.run_id;
    switch (intent) {
      case "system":
        return { method: "systemSummary", input: {}, invoke: () => this.tools.systemSummary() };
      case "runs":
        return { method: "listRuns", input: { limit: 10 }, invoke: () => this.tools.listRuns(10) };
      case "run_detail":
        return {
          method: "runDetail",
          input: { run_id: runId ?? null },
          invoke: () => this.tools.runDetail(runId),
        };
      case "artifacts":
        return {
          method: "listArtifacts",
          input: { ...(runId === undefined ? {} : { run_id: runId }), limit: 20 },
          invoke: () => this.tools.listArtifacts({ ...(runId === undefined ? {} : { run_id: runId }), limit: 20 }),
        };
      case "artifact_preview": {
        const artifactId = entities.artifact_id;
        if (artifactId === undefined) {
          return {
            method: "listArtifacts",
            input: { limit: 5 },
            note: "你还没有指定产物 id；先列出最近 5 个产物，点开卡片可预览。",
            invoke: () => this.tools.listArtifacts({ limit: 5 }),
          };
        }
        return {
          method: "artifactPreview",
          input: { id: artifactId },
          invoke: () => this.tools.artifactPreview(artifactId),
        };
      }
      case "reports":
        return {
          method: "listReports",
          input: { ...(runId === undefined ? {} : { run_id: runId }), limit: 20 },
          invoke: () => this.tools.listReports({ ...(runId === undefined ? {} : { run_id: runId }), limit: 20 }),
        };
      case "report_content": {
        const reportId = entities.report_id;
        if (reportId === undefined) {
          return {
            method: "listReports",
            input: { limit: 5 },
            note: "你还没有指定报告 id；先列出最近 5 份报告，点开卡片可看全文。",
            invoke: () => this.tools.listReports({ limit: 5 }),
          };
        }
        return { method: "reportContent", input: { id: reportId }, invoke: () => this.tools.reportContent(reportId) };
      }
      case "metrics":
        return {
          method: "runMetrics",
          input: { run_id: runId ?? null },
          invoke: () => this.tools.runMetrics(runId),
        };
      case "logs":
        return { method: "readLogs", input: { limit: 20 }, invoke: () => this.tools.readLogs(20) };
      case "config":
        return { method: "configSummary", input: {}, invoke: () => this.tools.configSummary() };
      case "ledger":
        return { method: "ledgerSummary", input: {}, invoke: () => this.tools.ledgerSummary() };
      case "agents":
        return { method: "agentsSummary", input: {}, invoke: () => this.tools.agentsSummary() };
      default:
        return { method: "systemSummary", input: {}, invoke: () => this.tools.systemSummary() };
    }
  }

  // -------------------------------------------------------------------------
  // 记忆类
  // -------------------------------------------------------------------------

  private async handleMemory(raw: string, memories: ChatMemoryEntry[], pushPart: PushPart): Promise<void> {
    const explicit = /(?:记住|记一下|记下|请记住)/u.test(raw);
    if (explicit) {
      const candidates = extractMemoryCandidates({ userText: raw, intent: "memory", parts: [] });
      const saved: ChatMemoryEntry[] = [];
      for (const candidate of candidates) saved.push(this.addMemory(candidate));
      if (saved.length === 0) {
        pushPart({ type: "text", text: "请告诉我需要记住什么，例如：「记住我的偏好是回复简洁中文」。" });
        return;
      }
      pushPart({ type: "text", text: `好的，已写入长期记忆（${saved.length} 条）：` });
      for (const entry of saved) {
        pushPart({ type: "data", data: memoryCard("已保存记忆", [entry]) });
      }
      return;
    }
    const found = memories.length > 0 ? memories : this.memoryRecall(raw, 8);
    if (found.length === 0) {
      pushPart({
        type: "text",
        text: "我还没有相关记忆。你可以说「记住我的偏好是…」「记住这个项目叫…」，之后我会在对话里引用。",
      });
      pushPart({ type: "markdown", title: "你可以这样建立记忆", markdown: SUGGESTIONS_MARKDOWN });
      return;
    }
    pushPart({ type: "text", text: `我找到 ${found.length} 条相关记忆：` });
    pushPart({ type: "data", data: memoryCard("相关记忆", found) });
  }

  private pushMemoryCard(memories: ChatMemoryEntry[], pushPart: PushPart): void {
    if (memories.length === 0) return;
    pushPart({ type: "data", data: memoryCard("参考的记忆", memories.slice(0, 5)) });
  }

  // -------------------------------------------------------------------------
  // 危险动作：只返回审批卡，绝不执行
  // -------------------------------------------------------------------------

  private async handleDanger(
    raw: string,
    analysis: ReturnType<typeof analyzeIntent>,
    pushPart: PushPart,
  ): Promise<void> {
    const action = analysis.entities.action ?? "危险动作";
    const target = analysis.entities.target;
    pushPart({
      type: "text",
      text: "⚠️ 这是高风险/不可逆操作，我不会直接执行。已生成审批卡，需要你确认后才会交给执行器。",
    });
    pushPart({
      type: "tool_call",
      tool: "systemActionPreview",
      input: { action, ...(target === undefined ? {} : { target }) },
    });
    let result: ChatQueryResult;
    try {
      result = await this.tools.systemActionPreview(action, target);
    } catch (error) {
      pushPart({ type: "error", message: `生成审批卡失败：${errorMessage(error)}` });
      return;
    }
    pushPart({ type: "tool_result", tool: "systemActionPreview", ok: result.ok, summary: result.summary });
    pushPart({ type: "text", text: result.summary });
    let hasApproval = false;
    for (const part of Array.isArray(result.parts) ? result.parts : []) {
      if (part.type === "approval") hasApproval = true;
      pushPart(part);
    }
    if (!hasApproval) {
      if (!result.ok) {
        pushPart({ type: "error", message: `该动作无法执行：${result.summary}` });
        return;
      }
      const fallback: ChatDataCard = {
        title: "待人工确认（审批卡）",
        items: [
          { label: "动作", value: action },
          { label: "目标", value: target ?? "（未指定）" },
          { label: "说明", value: result.summary },
        ],
      };
      pushPart({ type: "data", data: fallback });
      pushPart({ type: "text", text: "请回复「批准 run-xxx 第 N 步」或「驳回 run-xxx 第 N 步」完成确认。" });
    }
  }

  // -------------------------------------------------------------------------
  // 审批
  // -------------------------------------------------------------------------

  private async handleApprove(
    raw: string,
    analysis: ReturnType<typeof analyzeIntent>,
    pushPart: PushPart,
  ): Promise<void> {
    const runId = analysis.entities.run_id;
    const step = analysis.entities.step;
    const decision = analysis.entities.decision === "reject" ? "reject" : "approve";
    if (runId === undefined || step === undefined) {
      pushPart({
        type: "text",
        text: "请告诉我要审批的 run 和步骤号，例如：「批准 run-20261030-0001 第 2 步」或「驳回 run-20261030-0001 第 2 步」。",
      });
      return;
    }
    if (runId.startsWith("system:") && typeof this.tools.confirmSystemAction === "function") {
      const callId = this.nextToolCallId();
      pushPart({ type: "tool_call", tool: "confirmSystemAction", input: { approval_id: runId, decision }, callId, status: "running" });
      let outcome: ChatQueryResult;
      try {
        outcome = await this.tools.confirmSystemAction(runId, decision);
      } catch (error) {
        pushPart({ type: "tool_result", tool: "confirmSystemAction", ok: false, summary: errorMessage(error), callId });
        pushPart({ type: "error", message: `系统动作审批失败：${errorMessage(error)}` });
        return;
      }
      pushPart({ type: "tool_result", tool: "confirmSystemAction", ok: outcome.ok, summary: outcome.summary, callId });
      pushPart({ type: "text", text: outcome.summary });
      for (const part of Array.isArray(outcome.parts) ? outcome.parts : []) pushPart(part);
      if (!outcome.ok) pushPart({ type: "error", message: `审批未完成：${outcome.summary}` });
      return;
    }
    pushPart({ type: "tool_call", tool: "approve", input: { run_id: runId, step, decision } });
    let result: ChatQueryResult;
    try {
      result = await this.tools.approve(runId, step, decision);
    } catch (error) {
      pushPart({ type: "error", message: `提交审批失败：${errorMessage(error)}` });
      return;
    }
    pushPart({ type: "tool_result", tool: "approve", ok: result.ok, summary: result.summary });
    pushPart({ type: "text", text: result.summary });
    for (const part of Array.isArray(result.parts) ? result.parts : []) pushPart(part);
    if (!result.ok) pushPart({ type: "error", message: `审批未成功：${result.summary}` });
    void raw;
  }

  // -------------------------------------------------------------------------
  // 任务类：项目执行器 / DSH harness
  // -------------------------------------------------------------------------

  private async handleExecuteGoal(
    raw: string,
    memories: ChatMemoryEntry[],
    pushPart: PushPart,
  ): Promise<TaskOutcome> {
    const memoryHint = memories.length > 0 ? `（已参考 ${memories.length} 条长期记忆）` : "";
    pushPart({
      type: "text",
      text: `好的，我开始做：${clampChars(raw, 120)}。我会交给项目执行器自动执行，思考/步骤/产物/报告会实时出现在这条对话里${memoryHint}。`,
    });
    pushPart({ type: "tool_call", tool: "executeGoal", input: { goal: raw } });
    let result: ChatGoalResult;
    try {
      result = await this.tools.executeGoal(raw, (part) => pushPart(part, "local_fallback"));
    } catch (error) {
      pushPart({ type: "tool_result", tool: "executeGoal", ok: false, summary: errorMessage(error) });
      pushPart({ type: "error", message: `项目执行器调用失败：${errorMessage(error)}` });
      return {};
    }
    if (result.pending_approval !== undefined) {
      pushPart({ type: "tool_result", tool: "executeGoal", ok: true, summary: "Run 已暂停，等待人工审批" });
      pushPart({ type: "approval", approval: result.pending_approval });
      pushPart({ type: "text", text: `已暂停，等待你审批第 ${result.pending_approval.step} 步：${result.pending_approval.summary}。批准后 Run 会继续执行。` });
      this.pushMemoryCard(memories, pushPart);
      return { ...(result.run_id === undefined ? {} : { runId: result.run_id }), ...(result.session_id === undefined ? {} : { sessionId: result.session_id }), taskSummary: result.summary };
    }
    pushPart({ type: "tool_result", tool: "executeGoal", ok: result.ok, summary: result.summary });
    if (!result.ok) {
      pushPart({ type: "error", message: `项目执行失败：${result.summary}` });
      return {};
    }
    const items = [
      { label: "状态", value: "已完成" },
      ...(result.run_id === undefined ? [] : [{ label: "run_id", value: result.run_id }]),
      ...(result.session_id === undefined ? [] : [{ label: "session_id", value: result.session_id }]),
    ];
    pushPart({ type: "data", data: { title: "项目执行结果", items } });
    pushPart({ type: "text", text: result.summary });
    this.pushMemoryCard(memories, pushPart);
    return {
      ...(result.run_id === undefined ? {} : { runId: result.run_id }),
      ...(result.session_id === undefined ? {} : { sessionId: result.session_id }),
      taskSummary: result.summary,
    };
  }

  private async handleHarnessTask(
    raw: string,
    memories: ChatMemoryEntry[],
    pushPart: PushPart,
  ): Promise<TaskOutcome> {
    if (!this.dshEnabled) {
      pushPart({
        type: "text",
        text: "当前未启用真实 DSH harness（dshEnabled=false），所以不能执行小任务。可以改成项目类请求（项目执行器），或让管理员在设置里启用 DSH harness。",
      });
      return {};
    }
    const memoryHint = memories.length > 0 ? `（已参考 ${memories.length} 条长期记忆）` : "";
    pushPart({
      type: "text",
      text: `好的，我用真实 DSH harness 执行：${clampChars(raw, 120)}。思考/工具调用/产物/报告会实时出现在这条对话里${memoryHint}。`,
    });
    pushPart({ type: "tool_call", tool: "harnessTask", input: { task: raw } });
    let result: { ok: boolean; summary: string };
    try {
      result = await this.tools.harnessTask(raw, (part) => pushPart(part, "harness"));
    } catch (error) {
      pushPart({ type: "tool_result", tool: "harnessTask", ok: false, summary: errorMessage(error) });
      pushPart({ type: "error", message: `DSH harness 调用失败：${errorMessage(error)}` });
      return {};
    }
    pushPart({ type: "tool_result", tool: "harnessTask", ok: result.ok, summary: result.summary });
    if (!result.ok) {
      pushPart({ type: "error", message: `DSH harness 执行失败：${result.summary}` });
      return {};
    }
    pushPart({ type: "text", text: result.summary });
    this.pushMemoryCard(memories, pushPart);
    return { taskSummary: result.summary };
  }

  // -------------------------------------------------------------------------
  // 闲聊兜底（0 token）
  // -------------------------------------------------------------------------

  private async handleChat(raw: string, memories: ChatMemoryEntry[], pushPart: PushPart): Promise<void> {
    const greeting = /^(你好|您好|hi|hello|嗨|在吗|早上好|晚上好)/iu.test(raw);
    let reply = greeting
      ? "你好，我是代掌 AI 总控。一个对话框就能控制全部：查系统、看产物/报告、执行任务、审批危险动作。"
      : "我暂时没有完全理解这句话，但我可以直接帮你查系统或执行任务。";
    if (this.polish !== undefined) {
      try {
        const polished = await this.polish(reply);
        if (typeof polished === "string" && polished.trim().length > 0) reply = polished.trim();
      } catch {
        /* 润色失败用原文 */
      }
    }
    pushPart({ type: "text", text: reply });
    pushPart({ type: "markdown", title: "你可以这样问我", markdown: SUGGESTIONS_MARKDOWN });
    if (memories.length > 0) {
      pushPart({ type: "text", text: `我记得你之前提到过（${memories.length} 条相关记忆）：` });
      pushPart({ type: "data", data: memoryCard("相关记忆", memories.slice(0, 5)) });
    }
  }

  // -------------------------------------------------------------------------
  // 记忆抽取
  // -------------------------------------------------------------------------

  private rememberFromTurn(input: {
    userText: string;
    analysis: ReturnType<typeof analyzeIntent>;
    assistant: ChatMessage;
    outcome: TaskOutcome;
  }): void {
    try {
      const candidates = extractMemoryCandidates({
        userText: input.userText,
        intent: input.analysis.intent,
        ...(input.outcome.taskSummary === undefined ? {} : { taskSummary: input.outcome.taskSummary }),
        ...(input.outcome.runId === undefined ? {} : { runId: input.outcome.runId }),
        ...(input.outcome.sessionId === undefined ? {} : { sessionId: input.outcome.sessionId }),
        parts: input.assistant.parts,
      });
      // v1.5.2：纯查询不产生「产物/报告」级记忆（避免记忆噪音）；只保留偏好/项目/决策等。
      const queryIntent = QUERY_INTENTS.has(input.analysis.intent);
      const filtered = queryIntent ? candidates.filter((candidate) => candidate.kind !== "artifact" && candidate.kind !== "report" && candidate.kind !== "run") : candidates;
      for (const candidate of filtered) this.addMemory(candidate);
    } catch {
      /* 记忆抽取失败不影响对话 */
    }
  }

  private trimMemories(): void {
    const all = this.store.listMemory({ limit: Math.max(this.maxMemoryEntries * 4, 1_000) });
    if (all.length <= this.maxMemoryEntries) return;
    const overflow = all.length - this.maxMemoryEntries;
    const victims = [...all].sort((left, right) => {
      if (left.importance !== right.importance) return left.importance - right.importance;
      return left.created_at.localeCompare(right.created_at);
    });
    for (let index = 0; index < overflow; index += 1) {
      const victim = victims[index];
      if (victim !== undefined) this.store.deleteMemory(victim.id);
    }
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private nextMessageId(role: "user" | "assistant"): string {
    this.idSeq += 1;
    const stamp = this.nowIso().replace(/[-:TZ.]/gu, "").slice(0, 14);
    return `msg-${role}-${stamp}-${String(this.idSeq).padStart(4, "0")}-${randomBytes(2).toString("hex")}`;
  }
}

function memoryCard(title: string, entries: ChatMemoryEntry[]): ChatDataCard {
  return {
    title,
    items: entries.map((entry) => ({
      label: `${entry.kind} · ${entry.created_at.slice(0, 10)}`,
      value: entry.content,
    })),
  };
}
