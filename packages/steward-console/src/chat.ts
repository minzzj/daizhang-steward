/**
 * packages/steward-console/src/chat.ts
 *
 * v1.2 控制台扩展契约：**总调度对话 / 项目会话 / 智能体对话记录 / 证据 / 变现收款 / 模型与提示词配置**。
 *
 * 设计要点：
 * 1. 与 `ConsoleDataProvider`（经营数据）、`ConsoleAdminProvider`（配置中心）分离；
 *    `createConsoleServer({ provider, adminProvider, chatProvider })` 三者可独立替换，向后兼容；
 * 2. 内置 `createDemoChatProvider()` 为**可交互的演示实现**（纯内存）：对话生成计划 → 创建项目 →
 *    模拟执行（每 agent 轮次摘要/日志/证据，截图用内联 SVG 占位）→ 打断/恢复/审批；
 *    变现收款请求创建 → 显示收款链接/二维码占位 → 人工确认到账 → 经回调写入账本收入；
 *    模型 provider / API 密钥掩码 / 一键同步 / 每 agent 模型选择 / 系统提示词编辑；
 * 3. 契约字段与 task-30 对齐；`MaybePromise` 允许同步/异步实现，Lead 后续用真实
 *    Orchestrator / MoneyEngine / ConfigEngine 适配器替换；
 * 4. 敏感信息：API 密钥只存引用（`env:*` / `keychain:*`）与掩码，**不存明文、不写日志**。
 */

import type { MaybePromise } from "./provider.js";
import type { FlowEvent } from "./admin.js";

// ---------------------------------------------------------------------------
// 对话 / 会话 / 计划
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "conductor" | "agent";
export type ChatMessageKind = "plan" | "approval" | "result" | "error";
export type ChatSessionStatus = "active" | "planning" | "running" | "paused" | "done" | "blocked";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  agent_role?: string;
  text: string;
  /** 每轮简略摘要（列表/记录用）。 */
  summary?: string;
  at: string;
  kind?: ChatMessageKind;
}

export interface ChatPlanStep {
  step: number;
  agent_role: string;
  action: string;
  summary: string;
  status: "pending" | "running" | "done" | "blocked";
  requires_approval?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  goal: string;
  mode: string;
  status: ChatSessionStatus;
  created_at: string;
  updated_at: string;
  project_id?: string;
  /** 关联 run（执行后可跳转 /runs/:id 看证据）。 */
  run_id?: string;
  messages: ChatMessage[];
  plan?: ChatPlanStep[];
  budget_cny: number;
  token_limit: number;
  interruptible: boolean;
}

export interface ChatSessionCreateInput {
  goal: string;
  budget_cny?: number;
  token_limit?: number;
  mode?: string;
}

// ---------------------------------------------------------------------------
// 智能体对话记录 / 证据 / run 详情
// ---------------------------------------------------------------------------

export interface AgentTurn {
  seq: number;
  at: string;
  input_summary: string;
  output_summary: string;
  tokens: number;
  status: string;
  evidence_ref?: string;
}

export interface AgentTranscript {
  agent_role: string;
  title: string;
  turns: AgentTurn[];
}

export type EvidenceKind = "screenshot" | "report" | "log" | "json" | "html";

export interface EvidenceItem {
  path: string;
  kind: EvidenceKind;
  title: string;
  description?: string;
  /** 缩略图（演示为内联 data:image/svg+xml，无外网请求）。 */
  thumb_url?: string;
  /** 大图（点击缩略图后显示）。 */
  full_url?: string;
  /** 文本预览（log/json 内联展示；不落大文件）。 */
  preview_text?: string;
}

export interface RunDetail {
  run_id: string;
  goal: string;
  status: string;
  started_at: string;
  finished_at?: string;
  events: FlowEvent[];
  evidence: EvidenceItem[];
  report_md?: string;
  agents: AgentTranscript[];
  token_used: number;
  budget_used_cny: number;
  session_id?: string;
}

export interface RunSummary {
  run_id: string;
  goal: string;
  status: string;
  started_at: string;
  agent_count: number;
  evidence_count: number;
  session_id?: string;
}

// ---------------------------------------------------------------------------
// 变现收款
// ---------------------------------------------------------------------------

export type MoneyRequestStatus = "pending" | "paid" | "cancelled";
export type MoneyMethod = "wechat_pay" | "alipay" | "personal_bank_card" | "corporate_account" | "manual" | "epay";

export const MONEY_METHOD_LABELS: Record<MoneyMethod, string> = {
  wechat_pay: "微信支付",
  alipay: "支付宝",
  personal_bank_card: "个人银行卡",
  corporate_account: "企业对公账户",
  manual: "人工记账",
  epay: "易支付（epay）",
};

export interface MoneyRequest {
  id: string;
  amount_cny: number;
  client: string;
  purpose: string;
  status: MoneyRequestStatus;
  created_at: string;
  paid_at?: string;
  payment_method: MoneyMethod;
  payment_ref?: string;
  /** 收款链接（演示为本地相对链接；真实渠道替换为商户收款 URL）。 */
  pay_url?: string;
  /** 二维码占位（内联 SVG data-uri）。 */
  qr_url?: string;
  ledger_entry_id?: string;
  invoice_draft?: { type: string; title: string; status: string };
  note?: string;
}

export interface MoneyCreateInput {
  amount_cny: number;
  client: string;
  purpose: string;
  payment_method: MoneyMethod;
}

export interface MoneyCreateResult {
  ok: boolean;
  request?: MoneyRequest;
  errors: string[];
}

export interface MoneyConfirmResult {
  ok: boolean;
  request?: MoneyRequest;
  ledger_entry_id?: string;
  errors: string[];
}

/** 确认到账后写账本的回调（由 server.ts 组合 ConsoleDataProvider.recordIncome 实现）。 */
export interface MoneyIncomeInput {
  amount_cny: number;
  client: string;
  purpose: string;
  occurred_at: string;
  source_ref: string;
}

export interface MoneyIncomeResult {
  entry_id: string;
}

// ---------------------------------------------------------------------------
// 模型 / API 密钥 / 系统提示词
// ---------------------------------------------------------------------------

export type ModelProviderKind = "deepseek" | "openai_compatible" | "local";

export const MODEL_PROVIDER_LABELS: Record<ModelProviderKind, string> = {
  deepseek: "DeepSeek",
  openai_compatible: "OpenAI 兼容",
  local: "本地模型",
};

export interface ModelProviderConfig {
  id: string;
  name: string;
  kind: ModelProviderKind;
  base_url: string;
  model: string;
  /** 密钥引用（env:VAR / keychain:name），不存明文。 */
  api_key_ref: string;
  /** 展示用掩码，如 sk-****9f2a。 */
  api_key_masked: string;
  enabled: boolean;
  note?: string;
}

export interface AgentModelBinding {
  agent_role: string;
  provider_id: string;
  model: string;
}

export interface PromptTemplate {
  id: string;
  /** conductor / operator / harness / reviewer / scout / finance / customer / backend */
  role: string;
  title: string;
  content: string;
  updated_at: string;
  version: number;
}

export interface ModelSettings {
  providers: ModelProviderConfig[];
  agent_bindings: AgentModelBinding[];
  prompts: PromptTemplate[];
  sync_status: "not_synced" | "synced";
  synced_at?: string;
  default_provider_id: string;
}

export interface ModelSettingsSaveResult {
  ok: boolean;
  settings: ModelSettings;
  errors: string[];
}

export interface SyncKeysResult {
  ok: boolean;
  settings: ModelSettings;
  synced_at: string;
  targets: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Provider 契约
// ---------------------------------------------------------------------------

export interface ConsoleChatProvider {
  // 会话 / 对话
  listSessions(): MaybePromise<ChatSession[]>;
  createSession(input: ChatSessionCreateInput): MaybePromise<ChatSession>;
  getSession(id: string): MaybePromise<ChatSession | null>;
  sendMessage(sessionId: string, text: string): MaybePromise<ChatSession | null>;
  startProject(sessionId: string): MaybePromise<ChatSession | null>;
  interrupt(sessionId: string): MaybePromise<ChatSession | null>;
  resume(sessionId: string): MaybePromise<ChatSession | null>;
  decideApproval(sessionId: string, step: number, decision: "approve" | "reject"): MaybePromise<ChatSession | null>;
  // run / 证据 / 智能体记录
  listRuns(): MaybePromise<RunSummary[]>;
  getRunDetail(runId: string): MaybePromise<RunDetail | null>;
  getAgentTranscripts(runIdOrRole?: string): MaybePromise<AgentTranscript[]>;
  listEvidence(runId: string): MaybePromise<EvidenceItem[]>;
  // 变现
  listMoneyRequests(): MaybePromise<MoneyRequest[]>;
  createMoneyRequest(input: MoneyCreateInput): MaybePromise<MoneyCreateResult>;
  confirmMoneyReceived(id: string, by?: string): MaybePromise<MoneyConfirmResult>;
  // 模型 / 密钥 / 提示词（v1.2 设置页扩展）
  getModelSettings(): MaybePromise<ModelSettings>;
  saveModelSettings(partial: {
    providers?: ModelProviderConfig[];
    agent_bindings?: AgentModelBinding[];
    default_provider_id?: string;
  }): MaybePromise<ModelSettingsSaveResult>;
  syncKeysToAll(): MaybePromise<SyncKeysResult>;
  savePrompts(patches: Array<{ id: string; content: string }>): MaybePromise<ModelSettingsSaveResult>;
}

// ---------------------------------------------------------------------------
// 工具：内联 SVG（缩略图/二维码占位；无外网请求）
// ---------------------------------------------------------------------------

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function screenshotPlaceholder(label: string, sub: string, accent: string): { thumb: string; full: string } {
  const escape = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const svg = (width: number, height: number, fontSize: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 800 500">` +
    `<rect width="800" height="500" fill="#070b14"/>` +
    `<rect x="24" y="24" width="752" height="452" rx="12" fill="#0d1526" stroke="${accent}" stroke-width="2"/>` +
    `<rect x="24" y="24" width="752" height="56" rx="12" fill="#111c33"/>` +
    `<circle cx="58" cy="52" r="7" fill="#ff5f57"/><circle cx="84" cy="52" r="7" fill="#febc2e"/><circle cx="110" cy="52" r="7" fill="#28c840"/>` +
    `<text x="180" y="58" font-family="system-ui,sans-serif" font-size="20" fill="#8fa3bd">${escape(sub)}</text>` +
    `<text x="400" y="240" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${String(fontSize)}" font-weight="700" fill="#e9f1fa">${escape(label)}</text>` +
    `<text x="400" y="292" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" fill="#66e3d2">REAL RUN EVIDENCE（演示占位图）</text>` +
    `<rect x="300" y="330" width="200" height="8" rx="4" fill="#1b2a44"/><rect x="300" y="330" width="140" height="8" rx="4" fill="${accent}"/>` +
    `<text x="400" y="430" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#5f7288">真实截图由 Orchestrator/浏览器适配器提供；此处为演示占位</text>` +
    `</svg>`;
  return { thumb: svgDataUri(svg(400, 250, 30)), full: svgDataUri(svg(800, 500, 44)) };
}

function qrPlaceholder(requestId: string, amount: number): string {
  const cells: string[] = [];
  let seed = 0;
  for (let i = 0; i < requestId.length; i++) seed = (seed * 31 + requestId.charCodeAt(i)) % 9973;
  const size = 11;
  const cell = 12;
  const offset = 24;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const on = seed % 3 !== 0 || (x < 3 && y < 3) || (x > size - 4 && y < 3) || (x < 3 && y > size - 4);
      if (on) cells.push(`<rect x="${String(offset + x * cell)}" y="${String(offset + y * cell)}" width="${String(cell)}" height="${String(cell)}" fill="#0c1322"/>`);
    }
  }
  const px = offset * 2 + size * cell;
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(px)}" height="${String(px + 34)}" viewBox="0 0 ${String(px)} ${String(px + 34)}">` +
      `<rect width="${String(px)}" height="${String(px + 34)}" rx="10" fill="#ffffff"/>` +
      `${cells.join("")}` +
      `<text x="${String(px / 2)}" y="${String(px + 22)}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#47536b">演示收款码 · ¥${amount.toFixed(2)}</text>` +
      `</svg>`,
  );
}

// ---------------------------------------------------------------------------
// 演示数据
// ---------------------------------------------------------------------------

const AGENT_TITLES: Record<string, string> = {
  supervisor: "超级总调度",
  conductor: "项目总调度",
  operator: "执行（浏览器/桌面）",
  harness: "写代码 Harness",
  customer: "客户对接",
  finance: "财务记账",
  reviewer: "核查复核",
  backend: "后台值守",
  scout: "找客户",
  content: "内容创作",
  research: "调研检索",
  enterprise_admin: "企业合规/用印",
};

export interface DemoChatProviderOptions {
  now?: () => Date;
  /** 确认到账后写账本（server 传 ConsoleDataProvider.recordIncome）。 */
  onIncome?: (input: MoneyIncomeInput) => MaybePromise<MoneyIncomeResult | null>;
  /** 当前运行模式（控制金额/渠道提示）。 */
  mode?: string;
  /** 易支付渠道：生成跳转链接/二维码占位（server 接 ConsoleSystemProvider.buildEpayPayLink）。 */
  epayLinkBuilder?: (input: {
    amount_cny: number;
    client: string;
    purpose: string;
    out_trade_no: string;
  }) => MaybePromise<{ ok: boolean; pay_url?: string; qr_url?: string; errors: string[] }>;
}

export function createDemoChatProvider(options: DemoChatProviderOptions = {}): ConsoleChatProvider {
  const now = options.now ?? (() => new Date());
  const iso = (offsetMs = 0): string => new Date(now().getTime() + offsetMs).toISOString();
  const MINUTE = 60_000;
  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(3, "0")}`;
  };

  const sessions: ChatSession[] = [];
  const runs: RunDetail[] = [];
  const moneyRequests: MoneyRequest[] = [];

  const prompts: PromptTemplate[] = [
    {
      id: "prompt-conductor",
      role: "conductor",
      title: "总调度（conductor）",
      version: 3,
      updated_at: iso(-2 * 24 * 60 * MINUTE),
      content:
        "你是「代掌 Steward」的总调度智能体。职责：把用户目标拆解为可验收的项目与任务，分派给执行/写代码 Harness/客户/财务/核查/后台/找客户等智能体，并对结果负责。\n" +
        "铁律：\n1. 高风险动作（付款/外发/用印/权限）一律走审批卡，未批准不得执行；\n2. 风控/验证码/2FA 一律停止并交人，**不绕过**；\n3. 没有证据的“成功”视为失败——每个动作必须留证（截图/日志/report）；\n4. 失败两轮必须升级，不无限重试；\n5. 未知 ≠ 成功：不确定时暂停并请求人工核对。\n" +
        "输出格式：先给一句话判断，再给计划（步骤/负责智能体/验收标准/预算与 Token 预估），最后列出需要人类决定的事项。",
    },
    {
      id: "prompt-supervisor",
      role: "supervisor",
      title: "超级总调度（supervisor）",
      version: 1,
      updated_at: iso(-24 * 60 * MINUTE),
      content:
        "你是「代掌 Steward」的超级总调度（系统级）。你管理：受管程序（打开/关闭/重启）、插件（启用/禁用/删除）、模型与密钥、系统提示词、以及把项目委派给项目总调度。\n" +
        "铁律：\n1. 删除程序/插件属于危险动作：必须先展示风险与备份路径，并要求人工输入确认 token，**不得自行执行**；\n2. 停止控制台自身等会丢失管理入口的操作一律拒绝；\n3. 模型/密钥只保存引用，不显示明文；一键同步后记录审计日志；\n4. 任何绕过风控/验证码/2FA 的请求一律拒绝（不绕过），发现异常立即停止并交人。\n" +
        "输出格式：一句话结论 → 影响与风险 → 建议动作（危险动作要说明备份路径与确认方式）。",
    },
    {
      id: "prompt-operator",
      role: "operator",
      title: "执行智能体（operator）",
      version: 2,
      updated_at: iso(-3 * 24 * 60 * MINUTE),
      content:
        "你是执行智能体：使用真实浏览器/真实桌面完成操作，每个动作都要留证（截图 + DOM/窗口快照 + 日志）。\n" +
        "遇到验证码/2FA/人脸/风控页面立即停止并交人（不绕过）；遇到权限拒绝记录原因；不确定的操作先问总调度。\n" +
        "验收：UI 操作必须真实有头浏览器/真实窗口，禁止 mock DOM/API 代替。",
    },
    {
      id: "prompt-harness",
      role: "harness",
      title: "写代码 Harness（harness）",
      version: 2,
      updated_at: iso(-5 * 24 * 60 * MINUTE),
      content:
        "你是编码回路：接收 CodeTask（复现步骤/期望/实际/验收命令/约束/禁止项），在隔离 worktree 生成统一补丁，再由真实浏览器跑验收测试。\n" +
        "只改允许的文件；不得删测试或改验收标准；失败两轮升级交人；补丁必须附测试证据。",
    },
    {
      id: "prompt-reviewer",
      role: "reviewer",
      title: "核查复核（reviewer）",
      version: 1,
      updated_at: iso(-6 * 24 * 60 * MINUTE),
      content:
        "你是核查复核智能体：只读复核证据链（截图/日志/report/账本 6 要素/流程事件），检查是否满足验收标准。\n" +
        "必须给出：结论（通过/不通过/证据不足）、缺失证据清单、风险点；不得代替执行智能体修改产物。",
    },
    {
      id: "prompt-scout",
      role: "scout",
      title: "找客户（scout）",
      version: 1,
      updated_at: iso(-7 * 24 * 60 * MINUTE),
      content:
        "你是客户分支：从合规 fixture 评分线索、生成 ICP 与外联草稿；**只起草、不发送**，所有外联必须人工审批后由人发送。\n" +
        "不得使用真实个人信息/爬虫抓取；每条草稿必须引用具体来源信号并控制在 150 字内。",
    },
    {
      id: "prompt-finance",
      role: "finance",
      title: "财务记账（finance）",
      version: 1,
      updated_at: iso(-7 * 24 * 60 * MINUTE),
      content:
        "你是财务智能体：记录账本（金额/收付方/依据/审批人/回执/所属项目 6 要素）、生成发票草稿（不自动开票）。\n" +
        "任何付款/退款需审批卡批准；人工确认到账后才记收入；不得伪造回执或审批人。",
    },
    {
      id: "prompt-customer",
      role: "customer",
      title: "客户对接（customer）",
      version: 1,
      updated_at: iso(-8 * 24 * 60 * MINUTE),
      content: "你是客户对接智能体：整理客户需求、生成交付摘要与催办草稿；外发消息必须人工审批后发送；不承诺未授权范围。",
    },
    {
      id: "prompt-backend",
      role: "backend",
      title: "后台值守（backend）",
      version: 1,
      updated_at: iso(-8 * 24 * 60 * MINUTE),
      content: "你是后台值守智能体：巡检运行队列与事件流，发现风控/异常/接管请求立即停止并交人；输出可读巡检摘要与证据链接。",
    },
  ];

  const modelSettings: ModelSettings = {
    providers: [
      {
        id: "provider-deepseek",
        name: "DeepSeek（官方）",
        kind: "deepseek",
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        api_key_ref: "env:DEEPSEEK_API_KEY",
        api_key_masked: "sk-****9f2a",
        enabled: true,
        note: "推荐：编码/推理；密钥只从环境变量读取",
      },
      {
        id: "provider-openai-compatible",
        name: "OpenAI 兼容网关",
        kind: "openai_compatible",
        base_url: "https://api.example-gateway.com/v1",
        model: "gpt-4o-mini（示例）",
        api_key_ref: "keychain:openai-compatible",
        api_key_masked: "sk-****c71d",
        enabled: false,
        note: "示例配置：任何 OpenAI 兼容网关都可接入",
      },
      {
        id: "provider-local",
        name: "本地模型（llama.cpp / Ollama）",
        kind: "local",
        base_url: "http://127.0.0.1:11434/v1",
        model: "qwen2.5:14b（示例）",
        api_key_ref: "none",
        api_key_masked: "（本地无需密钥）",
        enabled: false,
        note: "离线可用；能力有限，仅建议低风险任务",
      },
    ],
    agent_bindings: [
      { agent_role: "supervisor", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "conductor", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "operator", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "harness", provider_id: "provider-deepseek", model: "deepseek-reasoner（示例）" },
      { agent_role: "reviewer", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "scout", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "finance", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "customer", provider_id: "provider-deepseek", model: "deepseek-chat" },
      { agent_role: "backend", provider_id: "provider-deepseek", model: "deepseek-chat" },
    ],
    prompts,
    sync_status: "synced",
    synced_at: iso(-24 * 60 * MINUTE),
    default_provider_id: "provider-deepseek",
  };

  const findSession = (id: string): ChatSession | undefined => sessions.find((item) => item.id === id);
  const findRun = (id: string): RunDetail | undefined => runs.find((item) => item.run_id === id);

  const message = (session: ChatSession, role: ChatRole, text: string, summary: string, kind?: ChatMessageKind, agentRole?: string): ChatMessage => {
    const item: ChatMessage = { id: nextId("msg"), role, text, summary, at: iso(0) };
    if (kind !== undefined) item.kind = kind;
    if (agentRole !== undefined) item.agent_role = agentRole;
    session.messages.push(item);
    session.updated_at = item.at;
    return item;
  };

  const buildPlan = (goal: string, mode: string): ChatPlanStep[] => {
    const coding = /页面|代码|网站|报价单|表单|接口|修复|bug/i.test(goal);
    const research = /竞品|调研|查一下|检索|资料/i.test(goal);
    const steps: ChatPlanStep[] = [
      { step: 1, agent_role: "conductor", action: "确认目标与验收标准", summary: "澄清范围/预算/Token 上限与交付标准", status: "done" },
      {
        step: 2,
        agent_role: research ? "research" : "operator",
        action: research ? "检索竞品资料并标注来源" : "真实浏览器/桌面执行任务",
        summary: research ? "只读检索公开资料，引用来源" : "有头真实浏览器或真实窗口操作，每步截图留证",
        status: "running",
      },
    ];
    if (coding) {
      steps.push({ step: 3, agent_role: "harness", action: "写代码并跑测试", summary: "隔离 worktree 生成补丁，真实浏览器验收", status: "pending" });
    } else {
      steps.push({ step: 3, agent_role: "content", action: "产出交付稿（草稿）", summary: "只起草，外发前需人工审批", status: "pending" });
    }
    steps.push({
      step: 4,
      agent_role: "reviewer",
      action: "核查证据链并出结论",
      summary: "只读复核截图/日志/report，必要时打回",
      status: "pending",
    });
    steps.push({
      step: 5,
      agent_role: "conductor",
      action: "对外交付确认（需审批）",
      summary: "人工审批后交付客户；预算与 Token 控制在设定范围内",
      status: "pending",
      requires_approval: true,
    });
    if (mode === "enterprise") {
      steps.push({ step: 6, agent_role: "enterprise_admin", action: "合同/用印核对（人工签署）", summary: "AI 只生成草稿与核对清单，不代签", status: "pending", requires_approval: true });
    }
    return steps;
  };

  const createSession = (input: ChatSessionCreateInput): ChatSession => {
    const mode = input.mode === "personal" || input.mode === "enterprise" ? input.mode : "demo";
    const budget = Number.isFinite(input.budget_cny) ? Math.max(0, Number(input.budget_cny)) : 3000;
    const tokenLimit = Number.isFinite(input.token_limit) ? Math.max(1000, Number(input.token_limit)) : 200_000;
    const session: ChatSession = {
      id: nextId("chat"),
      title: input.goal.slice(0, 24) + (input.goal.length > 24 ? "…" : ""),
      goal: input.goal,
      mode,
      status: "planning",
      created_at: iso(0),
      updated_at: iso(0),
      messages: [],
      plan: buildPlan(input.goal, mode),
      budget_cny: budget,
      token_limit: tokenLimit,
      interruptible: true,
    };
    message(session, "user", input.goal, `用户目标：${input.goal.slice(0, 40)}`);
    const stepLines = (session.plan ?? [])
      .map((step) => `- 步骤 ${String(step.step)}｜${step.agent_role}｜${step.action}（${step.summary}）`)
      .join("\n");
    message(
      session,
      "conductor",
      `收到目标：「${input.goal}」。已拆解为 ${String(session.plan?.length ?? 0)} 个步骤，预算上限 ¥${budget.toFixed(2)}、Token 上限 ${tokenLimit.toLocaleString("zh-CN")}，运行模式=${mode}。\n\n计划：\n${stepLines}\n\n涉及付款/外发/用印的关键步骤会先给你审批卡；需要我现在开始执行，请点「开始执行」。`,
      `总调度已拆解 ${String(session.plan?.length ?? 0)} 步计划，等待开始执行`,
      "plan",
    );
    sessions.unshift(session);
    return session;
  };

  const makeRun = (session: ChatSession): RunDetail => {
    const step2 = session.plan?.find((step) => step.step === 2);
    const agent = step2?.agent_role ?? "operator";
    const runId = `run-chat-${session.id}`;
    const thumb = screenshotPlaceholder(`${AGENT_TITLES[agent] ?? agent} 执行截图`, "真实浏览器 / 真实窗口（演示占位）", "#66e3d2");
    const evidence: EvidenceItem[] = [
      { path: `runs/${runId}/screenshots/001-open.png`, kind: "screenshot", title: "步骤 2 执行截图（缩略图可点开大图）", description: "真实浏览器有头截图；演示环境用内联 SVG 占位", thumb_url: thumb.thumb, full_url: thumb.full },
      { path: `runs/${runId}/screenshots/002-result.png`, kind: "screenshot", title: "结果页截图", description: "验收动作完成后的页面状态", thumb_url: screenshotPlaceholder("结果页", "验收通过截图（演示占位）", "#ffb45c").thumb, full_url: screenshotPlaceholder("结果页", "验收通过截图（演示占位）", "#ffb45c").full },
      {
        path: `runs/${runId}/report.md`,
        kind: "report",
        title: "运行报告 report.md",
        description: "目标 / 步骤 / 证据 / 结论 / 待人工事项",
        preview_text: `# 运行报告 — ${runId}\n\n## 目标\n${session.goal}\n\n## 结论\n- 步骤 1 已完成；步骤 2 执行中\n- 证据 3 份（截图 2 / 报告 1）\n- 待人工事项：对外交付前审批\n`,
      },
      {
        path: `runs/${runId}/console.log`,
        kind: "log",
        title: "执行日志 console.log",
        description: "浏览器/工具日志（最近 20 行）",
        preview_text: `[info] run ${runId} started\n[info] ${agent}: 打开真实浏览器（有头）\n[info] ${agent}: 执行步骤 2 并截图\n[warn] 风控检测：未命中\n[info] 证据写入 runs/${runId}/\n`,
      },
      {
        path: `runs/${runId}/events.jsonl`,
        kind: "json",
        title: "事件流 events.jsonl",
        description: "哈希链事件（节选）",
        preview_text: JSON.stringify(
          [
            { seq: 1, tool: "conductor.plan", result: "success" },
            { seq: 2, tool: `${agent}.act`, result: "success" },
            { seq: 3, tool: "reviewer.check", result: "pending" },
          ],
          null,
          2,
        ),
      },
    ];
    const events: FlowEvent[] = [
      { seq: 1, phase: "plan", ts: iso(-8 * MINUTE), actor: "conductor", summary: `确认目标并生成 ${String(session.plan?.length ?? 0)} 步计划` },
      { seq: 2, phase: "action", ts: iso(-6 * MINUTE), actor: agent, summary: `${AGENT_TITLES[agent] ?? agent} 开始执行步骤 2` },
      { seq: 3, phase: "observe", ts: iso(-5 * MINUTE), actor: agent, summary: "观察结果：页面/窗口状态符合预期" },
      { seq: 4, phase: "evidence", ts: iso(-4 * MINUTE), actor: agent, summary: "留存截图 + 日志 + 事件", ...(evidence[0] === undefined ? {} : { evidence_ref: evidence[0].path }) },
      { seq: 5, phase: "verify", ts: iso(-3 * MINUTE), actor: "reviewer", summary: "复核证据链：待步骤 2 完成后出结论" },
      { seq: 6, phase: "action", ts: iso(-2 * MINUTE), actor: "backend", summary: "后台值守：队列正常，无风控拦截" },
    ];
    const agents: AgentTranscript[] = [
      {
        agent_role: "conductor",
        title: "总调度",
        turns: session.messages
          .filter((item) => item.role === "conductor" || item.role === "user")
          .slice(-6)
          .map((item, index) => ({
            seq: index + 1,
            at: item.at,
            input_summary: item.role === "user" ? `用户：${item.summary ?? item.text.slice(0, 40)}` : "系统事件",
            output_summary: item.role === "conductor" ? item.summary ?? item.text.slice(0, 60) : "已接收并纳入计划",
            tokens: item.role === "conductor" ? 820 + index * 140 : 0,
            status: "ok",
            evidence_ref: `runs/${runId}/report.md`,
          })),
      },
      {
        agent_role: agent,
        title: AGENT_TITLES[agent] ?? agent,
        turns: [
          { seq: 1, at: iso(-6 * MINUTE), input_summary: "总调度派发：执行步骤 2", output_summary: "打开真实浏览器/窗口并执行，每步截图", tokens: 2380, status: "ok", ...(evidence[0] === undefined ? {} : { evidence_ref: evidence[0].path }) },
          { seq: 2, at: iso(-5 * MINUTE), input_summary: "继续执行并校验结果", output_summary: "结果符合预期，留存证据", tokens: 1960, status: "ok", ...(evidence[1] === undefined ? {} : { evidence_ref: evidence[1].path }) },
        ],
      },
      {
        agent_role: "reviewer",
        title: "核查复核",
        turns: [{ seq: 1, at: iso(-3 * MINUTE), input_summary: "复核步骤 1/2 证据", output_summary: "证据齐全；等待后续步骤完成后给最终结论", tokens: 1120, status: "waiting", ...(evidence[0] === undefined ? {} : { evidence_ref: evidence[0].path }) }],
      },
    ];
    if (/页面|代码|网站|报价单|表单|接口|修复|bug/i.test(session.goal)) {
      agents.push({
        agent_role: "harness",
        title: "写代码 Harness",
        turns: [
          { seq: 1, at: iso(-4 * MINUTE), input_summary: "CodeTask：页面骨架 + 金额计算 + 验收命令", output_summary: "生成统一补丁并在隔离 worktree 应用", tokens: 3120, status: "ok", ...(evidence[2] === undefined ? {} : { evidence_ref: evidence[2].path }) },
          { seq: 2, at: iso(-3 * MINUTE), input_summary: "真实浏览器验收（第 1 轮）", output_summary: "断言通过（金额合计/按钮/提交），测试转绿", tokens: 2680, status: "ok", ...(evidence[1] === undefined ? {} : { evidence_ref: evidence[1].path }) },
        ],
      });
    }
    const run: RunDetail = {
      run_id: runId,
      goal: session.goal,
      status: session.status === "paused" ? "paused" : "running",
      started_at: iso(-8 * MINUTE),
      events,
      evidence,
      report_md: `# 运行报告 — ${runId}\n\n## 目标\n\n${session.goal}\n\n## 计划与进度\n\n${(session.plan ?? [])
        .map((step) => `- [${step.status === "done" ? "x" : " "}] 步骤 ${String(step.step)}｜${step.agent_role}｜${step.action} — ${step.summary}`)
        .join("\n")}\n\n## 证据\n\n- 截图 2 张（缩略图可点开大图）\n- 日志 console.log\n- 事件流 events.jsonl\n\n## 结论\n\n- 当前状态：**${session.status}**\n- 待人工事项：对外交付前审批（步骤 5）\n\n> 演示环境：截图/日志为内置占位；真实运行时由浏览器/桌面适配器写入真实证据。\n`,
      agents,
      token_used: 12_480,
      budget_used_cny: Math.min(session.budget_cny, 420),
      session_id: session.id,
    };
    runs.unshift(run);
    session.run_id = runId;
    session.project_id = session.project_id ?? `prj-chat-${session.id}`;
    return run;
  };

  const advanceAfterApproval = (session: ChatSession): void => {
    const plan = session.plan ?? [];
    const step5 = plan.find((step) => step.requires_approval === true);
    if (step5 !== undefined && step5.status === "pending") step5.status = "done";
    for (const step of plan) {
      if (step.step < 4) step.status = "done";
    }
    session.status = "done";
    message(session, "conductor", "审批已通过：关键步骤执行完成，已生成交付摘要与证据清单（可在 run 详情查看证据）。", "审批通过，项目完成并留证", "result");
  };

  // 预置演示会话：一个进行中（可见总调度对话记录/计划/证据），一个已完成
  const seedActive = createSession({ goal: "帮我做一个报价单页面（含客户信息与金额明细）", budget_cny: 3000, token_limit: 200_000, mode: "personal" });
  seedActive.status = "running";
  seedActive.plan = seedActive.plan?.map((step) => (step.step <= 2 ? { ...step, status: step.step === 1 ? "done" : "running" } : step)) ?? [];
  seedActive.messages.splice(seedActive.messages.length - 1, 1);
  {
    const last = seedActive.messages[seedActive.messages.length - 1];
    if (last !== undefined) last.kind = "plan";
  }
  message(seedActive, "conductor", "已开始执行：operator 正在真实浏览器中搭建报价单页面骨架，完成后由 harness 补代码、reviewer 核查。", "开始执行：operator 执行中", "result");
  makeRun(seedActive);
  message(seedActive, "conductor", "预算剩余 ¥2,580.00 · Token 剩余 187,520；对外交付前会给你审批卡。", "预算/Token 余量提醒", "result");

  const seedDone = createSession({ goal: "帮我查一下竞品定价并整理成一页对比", budget_cny: 1500, token_limit: 100_000, mode: "personal" });
  seedDone.status = "done";
  seedDone.plan = seedDone.plan?.map((step) => ({ ...step, status: step.requires_approval ? "pending" : "done" })) ?? [];
  seedDone.messages.pop();
  message(seedDone, "conductor", "已完成：research 检索到 6 条公开来源，content 整理出竞品定价对比（草稿未外发）。", "竞品对比草稿完成（未外发）", "result");
  {
    const run = makeRun(seedDone);
    run.status = "done";
    run.finished_at = iso(-20 * MINUTE);
  }

  const seedMoney: MoneyRequest[] = [
    {
      id: "money-001",
      amount_cny: 10,
      client: "示例客户（虚构）",
      purpose: "测试金额：验证收款流程（此前 ¥10 只是测试值）",
      status: "paid",
      created_at: iso(-2 * 24 * 60 * MINUTE),
      paid_at: iso(-2 * 24 * 60 * MINUTE + 10 * MINUTE),
      payment_method: "wechat_pay",
      payment_ref: "DEMO-20261024-001",
      pay_url: "/money/request/money-001",
      qr_url: qrPlaceholder("money-001", 10),
      ledger_entry_id: "led-002",
      invoice_draft: { type: "personal_receipt", title: "示例客户（虚构）", status: "draft_pending_human" },
      note: "演示渠道：收款码为占位，实际未扣款",
    },
    {
      id: "money-002",
      amount_cny: 2800,
      client: "杭州示例科技有限公司",
      purpose: "官网改版首期款",
      status: "pending",
      created_at: iso(-3 * 60 * MINUTE),
      payment_method: "alipay",
      payment_ref: "DEMO-20261026-002",
      pay_url: "/money/request/money-002",
      qr_url: qrPlaceholder("money-002", 2800),
      note: "等待客户扫码；到账后需人工确认",
    },
  ];
  moneyRequests.push(...seedMoney);

  const cloneSession = (session: ChatSession): ChatSession => JSON.parse(JSON.stringify(session)) as ChatSession;
  const cloneRun = (run: RunDetail): RunDetail => JSON.parse(JSON.stringify(run)) as RunDetail;
  const cloneMoney = (request: MoneyRequest): MoneyRequest => ({ ...request });
  const cloneSettings = (): ModelSettings => JSON.parse(JSON.stringify(modelSettings)) as ModelSettings;

  const income = async (request: MoneyRequest): Promise<string | null> => {
    if (options.onIncome === undefined) return null;
    try {
      const result = await options.onIncome({
        amount_cny: request.amount_cny,
        client: request.client,
        purpose: request.purpose,
        occurred_at: request.paid_at ?? iso(0),
        source_ref: request.payment_ref ?? request.id,
      });
      return result === null ? null : result.entry_id;
    } catch {
      return null;
    }
  };

  const findTranscripts = (key: string | undefined): AgentTranscript[] => {
    if (key === undefined || key === "") {
      return runs.slice(0, 2).flatMap((run) => run.agents.map((agent) => ({ ...agent, turns: [...agent.turns] })));
    }
    const byRole = AGENT_TITLES[key] === undefined ? undefined : key;
    if (byRole !== undefined) {
      const turns: AgentTurn[] = [];
      for (const run of runs) {
        const agent = run.agents.find((item) => item.agent_role === byRole);
        if (agent !== undefined) turns.push(...agent.turns);
      }
      return [{ agent_role: byRole, title: AGENT_TITLES[byRole] ?? byRole, turns }];
    }
    const run = findRun(key);
    return run === undefined ? [] : run.agents.map((agent) => ({ ...agent, turns: [...agent.turns] }));
  };

  return {
    listSessions: () => sessions.map(cloneSession),
    createSession: (input) => {
      const goal = String(input.goal ?? "").trim();
      if (goal.length < 4) throw new Error("目标至少 4 个字（告诉总调度你要做什么）");
      return cloneSession(createSession({ ...input, goal }));
    },
    getSession: (id) => {
      const session = findSession(id);
      return session === undefined ? null : cloneSession(session);
    },
    sendMessage: (sessionId, text) => {
      const session = findSession(sessionId);
      if (session === undefined) return null;
      const content = String(text ?? "").trim();
      if (content === "") throw new Error("消息不能为空");
      message(session, "user", content, `用户：${content.slice(0, 40)}`);
      const lower = content.toLowerCase();
      let reply: string;
      if (/预算|钱|费用|价格/.test(lower)) {
        reply = `收到预算约束：「${content}」。我会把它写入本会话的执行约束（预算上限 ¥${session.budget_cny.toFixed(2)}），并在每步执行前做预算校验；超出单笔/月度上限会暂停并给你审批卡。`;
      } else if (/竞品|调研|查|资料/.test(lower)) {
        reply = "收到调研需求：我会派 research 只读检索公开资料并标注来源，content 整理成对比草稿；外发前会给你审批。";
      } else if (/停|暂停|等/.test(lower)) {
        reply = "收到暂停意图：你可以直接点「打断」，当前步骤会记录到断点；恢复后从断点继续（不重复已完成动作）。";
      } else {
        reply = `收到：「${content}」。我已记录到本会话上下文，会纳入下一步计划；如需调整预算/Token 上限，请在新建会话时设置，或直接告诉我新的约束。`;
      }
      message(session, "conductor", reply, `总调度回复：${reply.slice(0, 40)}`);
      return cloneSession(session);
    },
    startProject: (sessionId) => {
      const session = findSession(sessionId);
      if (session === undefined) return null;
      if (session.status === "planning" || session.status === "active") {
        session.status = "running";
        const plan = session.plan ?? [];
        for (const step of plan) {
          if (step.status === "running") step.status = "done";
          if (step.step === 2) step.status = "running";
        }
        makeRun(session);
        message(session, "conductor", "已开始执行：operator 已打开真实浏览器；每步会留证（截图/日志），对外交付前会给你审批卡。", "项目已开始执行", "result");
      }
      return cloneSession(session);
    },
    interrupt: (sessionId) => {
      const session = findSession(sessionId);
      if (session === undefined) return null;
      if (session.status === "running" || session.status === "planning") {
        session.status = "paused";
        const plan = session.plan ?? [];
        for (const step of plan) {
          if (step.status === "running") step.status = "blocked";
        }
        const run = session.run_id === undefined ? undefined : findRun(session.run_id);
        if (run !== undefined) run.status = "paused";
        message(session, "conductor", "已打断（暂停）：当前步骤已记录断点，不会重复执行；你可以点「恢复」从断点继续，或直接取消本次会话。", "已打断并记录断点", "error");
      }
      return cloneSession(session);
    },
    resume: (sessionId) => {
      const session = findSession(sessionId);
      if (session === undefined) return null;
      if (session.status === "paused") {
        session.status = "running";
        const plan = session.plan ?? [];
        for (const step of plan) {
          if (step.status === "blocked") step.status = "running";
        }
        const run = session.run_id === undefined ? undefined : findRun(session.run_id);
        if (run !== undefined) run.status = "running";
        message(session, "conductor", "已恢复：从断点继续执行（未重复已完成动作）。关键交付步骤会先给你审批卡。", "已从断点恢复执行", "result");
        if (session.messages.some((item) => item.kind === "approval") === false) {
          message(session, "conductor", "步骤 5「对外交付确认」需要人工审批：请批准或驳回。", "等待人工审批：对外交付确认", "approval");
        }
      }
      return cloneSession(session);
    },
    decideApproval: (sessionId, step, decision) => {
      const session = findSession(sessionId);
      if (session === undefined) return null;
      const plan = session.plan ?? [];
      const target = plan.find((item) => item.step === step) ?? plan.find((item) => item.requires_approval === true);
      if (target === undefined) throw new Error(`计划步骤不存在：${String(step)}`);
      if (decision === "approve") {
        target.status = "done";
        message(session, "conductor", `已批准步骤 ${String(target.step)}（${target.action}）：继续执行并留证。`, `已批准步骤 ${String(target.step)}`, "result");
        advanceAfterApproval(session);
      } else {
        target.status = "blocked";
        session.status = "blocked";
        message(session, "conductor", `已驳回步骤 ${String(target.step)}（${target.action}）：项目暂停，等待你调整目标或取消。`, `已驳回步骤 ${String(target.step)}，项目暂停`, "error");
      }
      return cloneSession(session);
    },
    listRuns: () =>
      runs.map((run) => ({
        run_id: run.run_id,
        goal: run.goal,
        status: run.status,
        started_at: run.started_at,
        agent_count: run.agents.length,
        evidence_count: run.evidence.length,
        ...(run.session_id === undefined ? {} : { session_id: run.session_id }),
      })),
    getRunDetail: (runId) => {
      const run = findRun(runId);
      return run === undefined ? null : cloneRun(run);
    },
    getAgentTranscripts: (runIdOrRole) => findTranscripts(runIdOrRole).map((agent) => ({ ...agent, turns: agent.turns.map((turn) => ({ ...turn })) })),
    listEvidence: (runId) => {
      const run = findRun(runId);
      return run === undefined ? [] : run.evidence.map((item) => ({ ...item }));
    },
    listMoneyRequests: () => moneyRequests.map(cloneMoney),
    createMoneyRequest: async (input) => {
      const errors: string[] = [];
      const amount = Number(input.amount_cny);
      if (!Number.isFinite(amount) || amount <= 0) errors.push("金额必须大于 0（此前 ¥10 只是测试值，可自定金额）");
      if (String(input.client ?? "").trim() === "") errors.push("客户不能为空");
      if (String(input.purpose ?? "").trim() === "") errors.push("用途不能为空");
      if (errors.length > 0) return { ok: false, errors };
      const id = nextId("money");
      const method = input.payment_method;
      const request: MoneyRequest = {
        id,
        amount_cny: amount,
        client: String(input.client).trim(),
        purpose: String(input.purpose).trim(),
        status: "pending",
        created_at: iso(0),
        payment_method: method,
        payment_ref: `${method === "epay" ? "EPAY" : "DEMO"}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(-3)}`,
        pay_url: `/money/request/${id}`,
        qr_url: qrPlaceholder(id, amount),
        note: "演示资金渠道：二维码/链接为占位，未接真实支付；收到款后请人工确认到账",
      };
      if (method === "epay") {
        const link =
          options.epayLinkBuilder === undefined
            ? { ok: false, errors: ["易支付未启用：缺少 epay 网关配置（请在 /money 或 /settings 配置）"] }
            : await options.epayLinkBuilder({ amount_cny: amount, client: request.client, purpose: request.purpose, out_trade_no: request.payment_ref ?? id });
        if (!link.ok) return { ok: false, errors: link.errors };
        if (link.pay_url !== undefined) request.pay_url = link.pay_url;
        if (link.qr_url !== undefined) request.qr_url = link.qr_url;
        request.note = "易支付渠道：demo 模式不真实扣款；到账后仍需人工确认（live 需商户配置 + 真实回调）";
      }
      moneyRequests.unshift(request);
      return { ok: true, request: cloneMoney(request), errors: [] };
    },
    confirmMoneyReceived: async (id, by) => {
      const request = moneyRequests.find((item) => item.id === id);
      if (request === undefined) return { ok: false, errors: [`收款请求不存在：${id}`] };
      if (request.status !== "pending") return { ok: false, request: cloneMoney(request), errors: [`该请求已处理：${request.status}`] };
      request.status = "paid";
      request.paid_at = iso(0);
      request.invoice_draft = { type: "personal_receipt", title: request.client, status: "draft_pending_human" };
      request.note = `人工确认到账（${by ?? "web-console"}）；演示渠道未接真实支付`;
      const entryId = await income(request);
      if (entryId !== null) request.ledger_entry_id = entryId;
      return { ok: true, request: cloneMoney(request), ...(request.ledger_entry_id === undefined ? {} : { ledger_entry_id: request.ledger_entry_id }), errors: [] };
    },
    getModelSettings: () => cloneSettings(),
    saveModelSettings: (partial) => {
      const errors: string[] = [];
      if (partial.providers !== undefined) {
        if (partial.providers.length === 0) errors.push("至少保留一个模型 provider");
        for (const provider of partial.providers) {
          if (String(provider.id ?? "") === "") errors.push("provider id 不能为空");
          if (String(provider.model ?? "").trim() === "") errors.push(`provider ${provider.name} 的模型不能为空`);
          if (provider.enabled && String(provider.api_key_ref ?? "").trim() === "") errors.push(`provider ${provider.name} 启用时必须提供密钥引用（env:/keychain:）`);
        }
        if (errors.length === 0) modelSettings.providers = partial.providers.map((provider) => ({ ...provider, api_key_masked: provider.api_key_masked || "sk-****" }));
      }
      if (partial.agent_bindings !== undefined && errors.length === 0) {
        const known = new Set(modelSettings.providers.map((provider) => provider.id));
        for (const binding of partial.agent_bindings) {
          if (!known.has(binding.provider_id)) errors.push(`智能体 ${binding.agent_role} 引用了未知 provider：${binding.provider_id}`);
        }
        if (errors.length === 0) modelSettings.agent_bindings = partial.agent_bindings.map((binding) => ({ ...binding }));
      }
      if (partial.default_provider_id !== undefined && errors.length === 0) modelSettings.default_provider_id = partial.default_provider_id;
      if (errors.length === 0) {
        modelSettings.sync_status = "not_synced";
        delete modelSettings.synced_at;
      }
      return { ok: errors.length === 0, settings: cloneSettings(), errors };
    },
    syncKeysToAll: () => {
      const enabledProviders = modelSettings.providers.filter((provider) => provider.enabled);
      const targets = enabledProviders.length + modelSettings.agent_bindings.length;
      modelSettings.sync_status = "synced";
      modelSettings.synced_at = iso(0);
      return { ok: true, settings: cloneSettings(), synced_at: modelSettings.synced_at, targets, errors: [] };
    },
    savePrompts: (patches) => {
      const errors: string[] = [];
      for (const patch of patches) {
        const target = modelSettings.prompts.find((prompt) => prompt.id === patch.id);
        if (target === undefined) {
          errors.push(`提示词不存在：${patch.id}`);
          continue;
        }
        const content = String(patch.content ?? "").trim();
        if (content.length < 30) errors.push(`提示词「${target.title}」至少 30 个字符（当前 ${String(content.length)}）`);
        if (target.role === "conductor" && !content.includes("不绕过")) errors.push("总调度提示词必须包含安全条款「不绕过」（风控/验证码一律停止交人）");
      }
      if (errors.length === 0) {
        for (const patch of patches) {
          const target = modelSettings.prompts.find((prompt) => prompt.id === patch.id);
          if (target !== undefined) {
            target.content = String(patch.content).trim();
            target.updated_at = iso(0);
            target.version += 1;
          }
        }
      }
      return { ok: errors.length === 0, settings: cloneSettings(), errors };
    },
  };
}

/** 智能体标题（供页面展示）。 */
export function chatAgentTitle(role: string): string {
  return AGENT_TITLES[role] ?? role;
}

/** 生成演示截图占位（页面/测试可直接用；真实运行时由浏览器适配器提供真实截图）。 */
export function demoEvidenceThumb(label: string, sub = "演示占位"): { thumb: string; full: string } {
  return screenshotPlaceholder(label, sub, "#66e3d2");
}

/** 生成演示收款二维码占位（内联 SVG，无外网请求）。 */
export function demoQrPlaceholder(requestId: string, amount: number): string {
  return qrPlaceholder(requestId, amount);
}

/** 支持的真实资金渠道（接入真实支付时按此枚举回调 confirmMoneyReceived）。 */
export const MONEY_METHODS: readonly MoneyMethod[] = [
  "wechat_pay",
  "alipay",
  "personal_bank_card",
  "corporate_account",
  "epay",
  "manual",
];
