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

/** v1.5.2：呈现分相——思考过程（折叠）/ 最终结果（可见）。 */
export type ChatPhase = "thinking" | "result";

export interface ChatThinkingSummary {
  /** 思考区条目数（思考分块 + 工具 + 中间数据）。 */
  steps: number;
  tool_calls: number;
  artifacts: number;
  reports: number;
}

interface ChatPartBase {
  /** v1.5.2：呈现分相；旧消息可缺省，由 applyMessagePhases 自动分类。 */
  phase?: ChatPhase;
}

export type ChatPart =
  | ({ type: "text"; text: string } & ChatPartBase)
  | ({ type: "markdown"; markdown: string; title?: string } & ChatPartBase)
  | ({ type: "thinking"; text: string; collapsed?: boolean } & ChatPartBase)
  | ({ type: "tool_call"; tool: string; input: Record<string, unknown>; status?: string; callId?: string; result_preview?: string; result_data?: unknown; duration_ms?: number } & ChatPartBase)
  | ({ type: "tool_result"; tool: string; ok: boolean; summary: string; data?: unknown; callId?: string; duration_ms?: number } & ChatPartBase)
  | ({ type: "artifact"; artifact: ChatArtifactCard } & ChatPartBase)
  | ({ type: "report"; report: ChatReportCard } & ChatPartBase)
  | ({ type: "data"; data: ChatDataCard } & ChatPartBase)
  | ({ type: "approval"; approval: ChatApprovalCard } & ChatPartBase)
  | ({ type: "error"; message: string } & ChatPartBase);

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
  /** v1.5.2：最终结果文本（默认可见；包含错误/等待审批时的提示）。 */
  result_text?: string;
  /** v1.5.2：思考过程摘要（折叠标题用）。 */
  thinking_summary?: ChatThinkingSummary;
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
  | "agent_direct"
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
  /** v1.5.4：点名发送的目标智能体角色（@operator / 让财务…）。 */
  agent_role?: string;
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
  /** v1.5.2：Run 在等待人工审批（不是失败；审批后继续）。 */
  pending_approval?: ChatApprovalCard;
}

export interface ChatHarnessResult {
  ok: boolean;
  summary: string;
}

/** v1.5.4：点名发送到独立智能体的执行结果（该智能体有独立上下文/会话）。 */
export interface ChatAgentResult {
  ok: boolean;
  summary: string;
  agent_role: string;
  session_id?: string;
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
  /**
   * v1.5.4：点名发送——把任务交给指定智能体的独立会话/工作区执行。
   * 总控对话上下文不进入该智能体；它的历史只保留在自己目录（避免上下文污染/漂移）。
   */
  runAgentTask?(role: string, task: string, onPart: (part: ChatPart) => void): Promise<ChatAgentResult>;
  /** 审批：批准/驳回（run 的步骤）。 */
  approve(runId: string, step: number, decision: "approve" | "reject"): Promise<ChatQueryResult>;
  /** v1.5.2：系统动作审批（plan → 人工确认 → execute；approvalId 形如 system:<requestId>）。 */
  confirmSystemAction?(approvalId: string, decision: "approve" | "reject"): Promise<ChatQueryResult>;
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
