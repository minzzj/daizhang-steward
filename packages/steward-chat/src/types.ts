/**
 * v1.5.1-A「对话式 AI 总控」核心包 steward-chat 数据契约。
 *
 * 用户诉求：像 ChatGPT 一样和 AI 总控对话，一个入口控制全部——
 * AI 自己查系统（系统/运行/产物/报告/日志/配置/账本/智能体/metrics）、
 * 小任务用 DSH harness 自己干、项目类交项目执行器、危险动作只返回审批卡；
 * 长期记忆 + 多会话；简单查询走规则回答（0 token），任务才用 harness。
 *
 * 零第三方依赖；数据工具（ChatTools）由控制台/CLI 注入，测试用 fake。
 */

// ---------------------------------------------------------------------------
// 消息 / 内嵌卡片
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant" | "system";

export interface ChatArtifactCard {
  id: string;
  title: string;
  kind: "html" | "markdown" | "json" | "text" | "image" | "code" | "data" | "other";
  size: number;
  agent_role?: string;
  step?: number;
  run_id?: string;
  session_id?: string;
  preview_url?: string;
  download_url?: string;
  preview_text?: string;
}

export interface ChatReportCard {
  id: string;
  title: string;
  agent_role?: string;
  step?: number;
  run_id?: string;
  session_id?: string;
  markdown: string;
  created_at: string;
}

export interface ChatDataCard {
  title: string;
  items: Array<{ label: string; value: string }>;
}

export interface ChatApprovalCard {
  run_id: string;
  step: number;
  risk: string;
  summary: string;
  reason?: string;
  expires_at?: string;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "markdown"; markdown: string; title?: string }
  | { type: "thinking"; text: string; collapsed?: boolean }
  | { type: "tool_call"; tool: string; input: Record<string, unknown>; status?: string }
  | { type: "tool_result"; tool: string; ok: boolean; summary: string; data?: unknown }
  | { type: "artifact"; artifact: ChatArtifactCard }
  | { type: "report"; report: ChatReportCard }
  | { type: "data"; data: ChatDataCard }
  | { type: "approval"; approval: ChatApprovalCard }
  | { type: "error"; message: string };

export type ChatModelMode = "remote" | "local_fallback" | "harness" | "rule";

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: ChatRole;
  at: string;
  parts: ChatPart[];
  summary?: string;
  status?: "streaming" | "done" | "error";
  model_mode?: ChatModelMode;
}

// ---------------------------------------------------------------------------
// 会话 / 记忆
// ---------------------------------------------------------------------------

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
  status?: string;
}

export type MemoryKind = "preference" | "project" | "decision" | "run" | "artifact" | "report" | "note";

export interface ChatMemoryEntry {
  id: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: 1 | 2 | 3;
  created_at: string;
  source?: string;
}

export interface ChatMemoryFilter {
  query?: string;
  kind?: MemoryKind;
  limit?: number;
}

// ---------------------------------------------------------------------------
// 意图
// ---------------------------------------------------------------------------

export type ChatIntent =
  | "system"
  | "runs"
  | "run_detail"
  | "artifacts"
  | "artifact_preview"
  | "reports"
  | "report_content"
  | "metrics"
  | "logs"
  | "config"
  | "ledger"
  | "agents"
  | "execute_goal"
  | "harness_task"
  | "approve"
  | "danger_action"
  | "chat"
  | "memory";

export interface ChatClassification {
  intent: ChatIntent;
  confidence: number;
}

/** 分类器内部使用的实体（不在公开契约中要求，供 ChatEngine 路由参数）。 */
export interface ChatEntities {
  run_id?: string;
  step?: number;
  artifact_id?: string;
  report_id?: string;
  decision?: "approve" | "reject";
  action?: string;
  target?: string;
  query?: string;
}

// ---------------------------------------------------------------------------
// 注入的数据工具 / 查询结果 / 选项
// ---------------------------------------------------------------------------

export interface ChatQueryResult {
  tool: string;
  ok: boolean;
  summary: string;
  parts: ChatPart[];
}

export interface ChatGoalResult {
  ok: boolean;
  run_id?: string;
  session_id?: string;
  summary: string;
}

export interface ChatHarnessResult {
  ok: boolean;
  summary: string;
}

/** 由 Lead 注入的真实数据工具（控制台/CLI 提供实现；测试用 fake）。 */
export interface ChatTools {
  systemSummary(): Promise<ChatQueryResult>;
  listRuns(limit?: number): Promise<ChatQueryResult>;
  runDetail(runId?: string): Promise<ChatQueryResult>;
  listArtifacts(query?: { run_id?: string; agent_role?: string; kind?: string; limit?: number }): Promise<ChatQueryResult>;
  artifactPreview(id: string): Promise<ChatQueryResult>;
  listReports(query?: { run_id?: string; agent_role?: string; limit?: number }): Promise<ChatQueryResult>;
  reportContent(id: string): Promise<ChatQueryResult>;
  runMetrics(runId?: string): Promise<ChatQueryResult>;
  readLogs(limit?: number): Promise<ChatQueryResult>;
  configSummary(): Promise<ChatQueryResult>;
  ledgerSummary(): Promise<ChatQueryResult>;
  agentsSummary(): Promise<ChatQueryResult>;
  /** 任务类：交给项目执行器（RunManager）自动执行；onPart 实时回报思考/步骤/产物/报告/数据。 */
  executeGoal(goal: string, onPart: (part: ChatPart) => void): Promise<ChatGoalResult>;
  /** 小任务/代码类：真实 DSH harness 跑一次（受 token/超时限制），onPart 实时回报。 */
  harnessTask(task: string, onPart: (part: ChatPart) => void): Promise<ChatHarnessResult>;
  /** 审批：批准/驳回（run 的步骤）。 */
  approve(runId: string, step: number, decision: "approve" | "reject"): Promise<ChatQueryResult>;
  /** 已知危险动作（删程序/插件、付款）→ 返回审批卡而不是执行。 */
  systemActionPreview(action: string, target?: string): Promise<ChatQueryResult>;
}

export interface ChatEngineOptions {
  tools: ChatTools;
  /** 数据根目录：`<root>/conversations/<id>.json`、`<root>/memory.json`、`<root>/index.json`。 */
  root: string;
  now?: () => Date;
  /** 上下文最多带多少条历史消息（默认 20）。 */
  maxContextMessages?: number;
  /** 长期记忆上限（默认 200；超出丢弃低重要度最旧条目）。 */
  maxMemoryEntries?: number;
  /** DSH harness 是否启用（默认 true；false 时任务类提示不可用，不调用模型）。 */
  dshEnabled?: boolean;
  /** 可选润色（默认无 → 简单查询 0 token；只有配置了才会调用）。 */
  polish?: (text: string) => Promise<string>;
}

export interface ChatSendResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface ChatConversationView {
  conversation: ChatConversation;
  messages: ChatMessage[];
  memories: ChatMemoryEntry[];
}

export const CHAT_DEFAULT_CONVERSATION_TITLE = "新对话";
export const CHAT_DEFAULT_MAX_CONTEXT_MESSAGES = 20;
export const CHAT_DEFAULT_MAX_MEMORY_ENTRIES = 200;
export const CHAT_MAX_TITLE_CHARS = 20;
