/**
 * packages/steward-console/src/conversations.ts
 *
 * v1.5.1 ChatGPT 式对话总控契约：多会话 / 消息 parts / 记忆 / 状态 + 演示实现。
 * 真实实现由 Lead 注入 `ConsoleChatEngineProvider`（ChatEngine 适配器）。
 */

import type { MaybePromise } from "./provider.js";

export interface ConsoleChatPart {
  type: "text" | "markdown" | "thinking" | "tool_call" | "tool_result" | "artifact" | "report" | "data" | "approval" | "error" | string;
  [key: string]: unknown;
}

export interface ConsoleChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  at: string;
  parts: ConsoleChatPart[];
  summary?: string;
  status?: string;
}

export interface ConsoleChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
}

export interface ConsoleChatMemory {
  id: string;
  kind: string;
  content: string;
  tags: string[];
  importance: number;
  created_at: string;
}

export interface ConsoleChatStatus {
  runs_active: number;
  awaiting_approval: number;
  conversations: number;
  memories: number;
  data_source: "real" | "demo" | "mixed";
}

export interface ConsoleChatProvider {
  listConversations(): MaybePromise<ConsoleChatConversation[]>;
  createConversation(title?: string): MaybePromise<ConsoleChatConversation>;
  getConversation(id: string): MaybePromise<{ conversation: ConsoleChatConversation; messages: ConsoleChatMessage[] } | null>;
  renameConversation(id: string, title: string): MaybePromise<ConsoleChatConversation | null>;
  deleteConversation(id: string): MaybePromise<boolean>;
  sendMessage(conversationId: string, text: string): MaybePromise<{ user: ConsoleChatMessage; assistant: ConsoleChatMessage }>;
  streamMessage(
    conversationId: string,
    text: string,
    onPart: (part: ConsoleChatPart, message: ConsoleChatMessage) => void,
    sinceSeq?: number,
  ): () => void;
  listMemory(query?: string): MaybePromise<ConsoleChatMemory[]>;
  deleteMemory(id: string): MaybePromise<boolean>;
  status(): MaybePromise<ConsoleChatStatus>;
  /** 可选：内联审批（高风险卡批准/驳回；演示实现会继续或结束该条流）。 */
  decideApproval?(conversationId: string, approvalId: string, decision: "approve" | "reject"): MaybePromise<boolean>;
}

/** 别名（Lead 真实适配器注入时的类型名）。 */
export type ConsoleChatEngineProvider = ConsoleChatProvider;

export interface DemoChatEngineOptions {
  now?: () => Date;
  partDelayMs?: number;
}

const HIGH_RISK = /付款|支付|对外|发送给|发给|发布|上线|部署|签约|合同|用印|删除|授权|转账|审批/;
const TASK = /帮我|做|查|执行|跑|生成|整理|汇总|项目|页面|代码|修复|调研|竞品/;

const ARTIFACT_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>报价单（演示产物）</title><style>body{font-family:system-ui,sans-serif;margin:28px;color:#1d2738}h1{font-size:20px}table{border-collapse:collapse;width:100%;max-width:520px}td,th{border:1px solid #dde3ef;padding:8px 10px;text-align:left}th{background:#f1f4fa}.total{font-weight:800;color:#0f7a45}</style></head><body><h1>报价单（演示产物 · HTML 内联预览）</h1><table><tr><th>项目</th><th>数量</th><th>单价</th><th>小计</th></tr><tr><td>官网改版首期</td><td>1</td><td>2,400.00</td><td>2,400.00</td></tr><tr><td>移动端适配</td><td>1</td><td>400.00</td><td>400.00</td></tr><tr><td colspan="3">合计</td><td class="total">2,800.00</td></tr></table></body></html>`;

const ARTIFACT_MD = "# 执行计划（演示产物）\n\n- 目标：构建报价单页面并留证\n- 执行：真实浏览器 / 编码回路\n- 验收：金额合计 2,800.00\n";
const ARTIFACT_JSON = JSON.stringify({ client: "杭州示例科技有限公司", items: [{ name: "官网改版首期", amount: 2400 }, { name: "移动端适配", amount: 400 }], total: 2800 }, null, 2);
const SVG_IMG = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="180" viewBox="0 0 380 180"><rect width="380" height="180" fill="#fff"/><text x="14" y="24" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#1d2738">金额分布（演示）</text><rect x="30" y="50" width="250" height="22" rx="5" fill="#3b5bfd"/><text x="288" y="67" font-family="system-ui" font-size="11" fill="#47536b">2,400</text><rect x="30" y="86" width="42" height="22" rx="5" fill="#66e3d2"/><text x="80" y="103" font-family="system-ui" font-size="11" fill="#47536b">400</text></svg>`;

const CONV_SEED: Array<{ id: string; title: string; last: string }> = [
  { id: "conv-001", title: "系统现在怎么样", last: "系统运行正常：程序 4/5 运行，1 个等待审批…" },
  { id: "conv-002", title: "帮我查一下产物并汇总", last: "已汇总 6 个产物、3 份报告…" },
];

export function createDemoChatEngineProvider(options: DemoChatEngineOptions = {}): ConsoleChatProvider {
  const now = options.now ?? (() => new Date());
  const partDelay = options.partDelayMs ?? 120;
  const iso = (offset = 0): string => new Date(now().getTime() + offset).toISOString();
  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(3, "0")}`;
  };

  const conversations = new Map<string, { meta: ConsoleChatConversation; messages: ConsoleChatMessage[] }>();
  const memory: ConsoleChatMemory[] = [
    { id: "mem-001", kind: "preference", content: "用户偏好中文回复，交付物需附证据与验收标准", tags: ["偏好", "交付"], importance: 5, created_at: iso(-3 * 86_400_000) },
    { id: "mem-002", kind: "rule", content: "高风险动作（付款/对外/删除）必须人工审批，AI 不绕过风控/验证码", tags: ["安全", "审批"], importance: 5, created_at: iso(-2 * 86_400_000) },
    { id: "mem-003", kind: "client", content: "示例客户：杭州示例科技有限公司，首期预算 2,800 元", tags: ["客户", "报价"], importance: 4, created_at: iso(-86_400_000) },
    { id: "mem-004", kind: "process", content: "编码回路：单轮最多 2 次补丁；失败两轮升级交人", tags: ["harness", "编码"], importance: 3, created_at: iso(-12 * 3_600_000) },
    { id: "mem-005", kind: "note", content: "产物存放：runs/<sessionId>/harness/（含 screenshot/report/metrics）", tags: ["产物", "路径"], importance: 3, created_at: iso(-3 * 3_600_000) },
  ];

  const emptyConv = (title: string): ConsoleChatConversation => {
    const id = nextId("conv");
    const meta: ConsoleChatConversation = { id, title, created_at: iso(0), updated_at: iso(0), message_count: 0 };
    return meta;
  };
  const touch = (meta: ConsoleChatConversation, lastMessage?: string): void => {
    meta.updated_at = iso(0);
    if (lastMessage !== undefined) meta.last_message = lastMessage;
  };
  const store = (): void => {
    for (const item of conversations.values()) item.meta.message_count = item.messages.length;
  };

  // 预置会话（含多卡片助手消息）
  const seedAssistant = (id: string): ConsoleChatMessage => ({
    id,
    role: "assistant",
    at: iso(-60_000),
    status: "done",
    parts: [
      { type: "thinking", text: "先摸清系统状态：程序、审批、最近 run 与产物。" },
      { type: "text", markdown: "**系统运行正常。** 受管程序 4/5 运行，1 个 run 等待审批。\n\n- 运行中：本地控制台 / 编排器 / 浏览器执行器\n- 等待审批：对外交付步骤\n- 最近产物：`site/quote.html`、`data/quote.json`" },
      { type: "tool_call", tool: "system.status", input: "{}", callId: "seed-1", status: "running" },
      { type: "tool_result", tool: "system.status", callId: "seed-1", status: "ok", duration_ms: 42, result_preview: "apps=5 running=4 pending_approvals=1" },
      { type: "artifact", artifact: { id: "art-seed-1", title: "系统状态快照（演示）", kind: "json", size: 236, agent_role: "backend", demo: true, preview_text: '{\n  "apps_total": 5,\n  "running": 4,\n  "pending_approvals": 1\n}' } },
      { type: "report", report: { title: "系统巡检报告（演示）", agent_role: "backend", markdown: "## 系统巡检\n\n- 程序 4/5 运行\n- 等待审批 1 项\n- 交付前需人工确认" } },
      { type: "data", data: { token_total: 5_800, duration_ms: 2_420, tool_calls: 2, steps: 5 } },
    ],
  });
  for (const seed of CONV_SEED) {
    const meta: ConsoleChatConversation = { id: seed.id, title: seed.title, created_at: iso(-120_000), updated_at: iso(-60_000), message_count: 2, last_message: seed.last };
    conversations.set(seed.id, {
      meta,
      messages: [
        { id: nextId("msg"), role: "user", at: iso(-120_000), status: "done", parts: [{ type: "text", text: seed.title }] },
        seedAssistant(nextId("msg")),
      ],
    });
  }
  store();

  const buildParts = (text: string): ConsoleChatPart[] => {
    const highRisk = HIGH_RISK.test(text);
    const task = TASK.test(text);
    const parts: ConsoleChatPart[] = [
      { type: "thinking", text: `理解目标「${text.slice(0, 60)}」：确认意图、约束与风险…` },
      { type: "thinking", text: "拆解执行步骤：查询数据 → 调用工具 → 生成产物/报告 → 汇总数据。" },
      { type: "text", markdown: `收到：**${text}**。我来执行并实时展示过程。` },
      { type: "artifact", artifact: { id: "art-chat-md", title: "执行计划 plan.md", kind: "markdown", size: ARTIFACT_MD.length, agent_role: "conductor", demo: true, preview_text: ARTIFACT_MD } },
      { type: "report", report: { title: "步骤执行报告（演示）", agent_role: "reviewer", markdown: "## 步骤报告\n\n- 已执行并留证\n- 结论：**通过**（演示数据）" } },
    ];
    if (/系统|状态/.test(text)) {
      parts.push({ type: "tool_call", tool: "system.status", input: "{}", callId: nextId("call"), status: "running" });
      parts.push({ type: "tool_result", tool: "system.status", callId: nextId("call"), status: "ok", duration_ms: 38, result_preview: "apps=5 running=4 awaiting_approval=1" });
      parts.push({ type: "data", data: { runs_active: 1, awaiting_approval: 1, conversations: conversations.size, token_total: 3_240, duration_ms: 1_180, tool_calls: 1, steps: 1 } });
    }
    if (/运行列表|运行/.test(text)) {
      parts.push({ type: "data", kind: "runs", data: { rows: [{ run_id: "run-live-001", status: "running", steps: "3/5" }, { run_id: "run-live-002", status: "done", steps: "5/5" }] } });
    }
    if (/产物|查一下/.test(text) || task) {
      parts.push({ type: "tool_call", tool: "artifacts.list", input: '{"limit":10}', callId: nextId("call"), status: "running" });
      parts.push({ type: "tool_result", tool: "artifacts.list", callId: nextId("call"), status: "ok", duration_ms: 64, result_preview: "6 artifacts (html/markdown/json/svg/text/code)" });
      parts.push({ type: "artifact", artifact: { id: "art-demo-md", title: "执行计划 plan.md", kind: "markdown", size: ARTIFACT_MD.length, agent_role: "conductor", demo: true, preview_text: ARTIFACT_MD } });
      parts.push({ type: "artifact", artifact: { id: "art-demo-html", title: "报价单页面 quote.html", kind: "html", size: ARTIFACT_HTML.length, agent_role: "operator", demo: true, preview_text: ARTIFACT_HTML } });
      parts.push({ type: "artifact", artifact: { id: "art-demo-json", title: "报价数据 quote.json", kind: "json", size: ARTIFACT_JSON.length, agent_role: "operator", demo: true, preview_text: ARTIFACT_JSON } });
      parts.push({ type: "artifact", artifact: { id: "art-demo-img", title: "金额分布图.svg", kind: "image", size: SVG_IMG.length, agent_role: "operator", demo: true, preview_text: SVG_IMG } });
    }
    if (/报告|汇总|查一下/.test(text) || task) {
      parts.push({ type: "report", report: { title: "步骤执行报告（演示）", agent_role: "reviewer", markdown: "## 步骤报告\n\n- 真实浏览器执行完成并留证\n- 证据：截图 2 张 + 日志\n- 结论：**通过**（演示数据）" } });
    }
    if (/账本|收入|钱/.test(text)) {
      parts.push({ type: "data", kind: "ledger", data: { rows: [{ id: "led-led-002", amount: "¥2,800.00", client: "杭州示例科技有限公司" }, { id: "led-income-001", amount: "¥1,288.00", client: "易支付客户" }] } });
    }
    if (/配置/.test(text)) {
      parts.push({ type: "data", kind: "config", data: { rows: [{ key: "运行模式", value: "个人模式" }, { key: "月预算", value: "¥5,000.00" }, { key: "Token 上限", value: "2,000,000" }] } });
    }
    if (/智能体/.test(text)) {
      parts.push({ type: "data", kind: "agents", data: { rows: [{ id: "conductor", value: "项目总调度 · 运行中" }, { id: "harness", value: "写代码 Harness · 运行中" }, { id: "reviewer", value: "核查复核 · 空闲" }] } });
    }
    if (/日志/.test(text)) {
      parts.push({ type: "report", report: { title: "系统日志（最近，演示）", agent_role: "backend", markdown: "```text\n[info] supervisor: 巡检完成\n[warn] llm-gateway: 延迟升高，已降级\n[info] epay: demo 模式，未真实扣款\n```" } });
    }
    if (highRisk) {
      parts.push({ type: "approval", approval_id: nextId("appr"), step: 5, risk: "高风险：对外发送/付款类动作必须人工批准，AI 不绕过", summary: "对外交付与收款动作等待人工审批" });
    }
    parts.push({ type: "tool_call", tool: task ? "harness.run_step" : "chat.intent", input: `{"text":"${text.slice(0, 40)}"}`, callId: nextId("call"), status: "running" });
    parts.push({ type: "tool_result", tool: task ? "harness.run_step" : "chat.intent", callId: nextId("call"), status: "ok", duration_ms: 96, result_preview: "ok (demo)" });
    parts.push({ type: "data", data: { token_total: 2_400 + Math.min(3_600, text.length * 40), duration_ms: 1_680, tool_calls: task ? 5 : 2, steps: task ? 5 : 1 } });
    parts.push({ type: "text", markdown: highRisk ? "已准备好，等待你**批准**高风险步骤后继续。" : "完成 ✅ 以上为执行过程与结果；可继续追问，或点左侧「产物 / 报告 / 运行列表」查看详情。" });
    return parts;
  };

  const pending = new Map<string, { conversationId: string; text: string; parts: ConsoleChatPart[]; index: number; timer: ReturnType<typeof setTimeout> | null; onPart: (part: ConsoleChatPart, message: ConsoleChatMessage) => void; message: ConsoleChatMessage; stopped: boolean }>();

  const emitNext = (state: { conversationId: string; text: string; parts: ConsoleChatPart[]; index: number; timer: ReturnType<typeof setTimeout> | null; onPart: (part: ConsoleChatPart, message: ConsoleChatMessage) => void; message: ConsoleChatMessage; stopped: boolean }, approvalId: string | null): void => {
    if (state.stopped) return;
    const conv = conversations.get(state.conversationId);
    if (conv === undefined) return;
    if (state.index >= state.parts.length) {
      state.message.status = "done";
      touch(conv.meta, state.message.parts.filter((part) => part.type === "text" || part.type === "report").map((part) => String(part.markdown ?? part.text ?? "")).join(" ").slice(0, 80));
      store();
      state.onPart({ type: "_done" } as ConsoleChatPart, state.message);
      return;
    }
    const part = state.parts[state.index];
    state.index += 1;
    if (part === undefined) return;
    if (part.type === "approval" && approvalId !== null) {
      // 保留审批 part，暂停；由 decideApproval 恢复后重发并继续
      state.index -= 1;
      state.message.parts.push(part);
      state.onPart(part, state.message);
      return;
    }
    state.message.parts.push(part);
    state.onPart(part, state.message);
    state.timer = setTimeout(() => emitNext(state, approvalId), partDelay);
  };

  const provider: ConsoleChatProvider = {
    listConversations: () => [...conversations.values()].map((item) => ({ ...item.meta })).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    createConversation: (title) => {
      const meta = emptyConv(title === undefined || title.trim() === "" ? "新对话" : title.trim());
      meta.title = meta.title.slice(0, 40);
      conversations.set(meta.id, { meta, messages: [] });
      return { ...meta };
    },
    getConversation: (id) => {
      const item = conversations.get(id);
      return item === undefined ? null : { conversation: { ...item.meta }, messages: JSON.parse(JSON.stringify(item.messages)) as ConsoleChatMessage[] };
    },
    renameConversation: (id, title) => {
      const item = conversations.get(id);
      if (item === undefined || title.trim() === "") return null;
      item.meta.title = title.trim().slice(0, 60);
      touch(item.meta);
      return { ...item.meta };
    },
    deleteConversation: (id) => {
      const deleted = conversations.delete(id);
      for (const [key, state] of [...pending.entries()]) {
        if (state.conversationId === id) {
          state.stopped = true;
          if (state.timer !== null) clearTimeout(state.timer);
          pending.delete(key);
        }
      }
      return deleted;
    },
    sendMessage: (conversationId, text) => {
      const item = conversations.get(conversationId);
      if (item === undefined) throw new Error(`conversation not found: ${conversationId}`);
      const user: ConsoleChatMessage = { id: nextId("msg"), role: "user", at: iso(0), status: "done", parts: [{ type: "text", text }] };
      const assistant: ConsoleChatMessage = { id: nextId("msg"), role: "assistant", at: iso(0), status: "done", parts: buildParts(text) };
      item.messages.push(user, assistant);
      touch(item.meta, text);
      store();
      return { user, assistant };
    },
    streamMessage: (conversationId, text, onPart) => {
      const item = conversations.get(conversationId);
      if (item === undefined) {
        const failure: ConsoleChatMessage = { id: nextId("msg"), role: "assistant", at: iso(0), status: "error", parts: [{ type: "error", message: `conversation not found: ${conversationId}` }] };
        onPart({ type: "error", message: failure.parts[0]?.message }, failure);
        return () => {};
      }
      const user: ConsoleChatMessage = { id: nextId("msg"), role: "user", at: iso(0), status: "done", parts: [{ type: "text", text }] };
      const message: ConsoleChatMessage = { id: nextId("msg"), role: "assistant", at: iso(0), status: "streaming", parts: [] };
      item.messages.push(user, message);
      touch(item.meta, text);
      store();
      const state = { conversationId, text, parts: buildParts(text), index: 0, timer: null as ReturnType<typeof setTimeout> | null, onPart, message, stopped: false };
      pending.set(message.id, state);
      state.timer = setTimeout(() => emitNext(state, null), 80);
      return () => {
        state.stopped = true;
        if (state.timer !== null) clearTimeout(state.timer);
        pending.delete(message.id);
      };
    },
    listMemory: (query) => {
      const keyword = String(query ?? "").trim().toLowerCase();
      return memory
        .filter((item) => keyword === "" || item.content.toLowerCase().includes(keyword) || item.tags.some((tag) => tag.toLowerCase().includes(keyword)) || item.kind.includes(keyword))
        .map((item) => ({ ...item }));
    },
    deleteMemory: (id) => {
      const index = memory.findIndex((item) => item.id === id);
      if (index < 0) return false;
      memory.splice(index, 1);
      return true;
    },
    status: () => ({
      runs_active: 1,
      awaiting_approval: 1,
      conversations: conversations.size,
      memories: memory.length,
      data_source: "demo",
    }),
    decideApproval: (conversationId, approvalId, decision) => {
      const item = conversations.get(conversationId);
      if (item === undefined) return false;
      const state = [...pending.values()].find((candidate) => candidate.conversationId === conversationId);
      if (state === undefined) return false;
      state.parts.push({ type: "text", markdown: decision === "approve" ? "✅ 已批准高风险步骤，继续执行…" : "⛔ 已驳回，run 阻塞（可稍后重试）。" });
      state.message.parts.push(state.parts[state.parts.length - 1] as ConsoleChatPart);
      state.onPart(state.parts[state.parts.length - 1] as ConsoleChatPart, state.message);
      if (decision === "approve") {
        state.timer = setTimeout(() => emitNext(state, null), partDelay);
      } else {
        state.stopped = true;
        state.message.status = "blocked";
        if (state.timer !== null) clearTimeout(state.timer);
        state.onPart({ type: "_done" } as ConsoleChatPart, state.message);
      }
      return true;
    },
  };
  return provider;
}
