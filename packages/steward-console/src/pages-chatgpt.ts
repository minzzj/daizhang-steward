/**
 * packages/steward-console/src/pages-chatgpt.ts
 * v1.5.1 ChatGPT 式对话总控页面（/chat）：多会话 + 消息流 + 内嵌卡片 + 记忆面板 + 快捷 chips。
 */
import { escapeHtml, formatCny, formatDateTime, renderShell, type PageRenderOptions } from "./pages.js";
import { renderMarkdown } from "./pages-chat.js";
import type {
  ConsoleChatConversation,
  ConsoleChatMemory,
  ConsoleChatMessage,
  ConsoleChatPart,
  ConsoleChatStatus,
} from "./conversations.js";

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}
function formatBytes(size: number): string {
  const value = Number(size) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export const QUICK_CHIPS: ReadonlyArray<{ query: string; label: string }> = [
  { query: "系统现在怎么样", label: "系统状态" },
  { query: "运行列表", label: "运行列表" },
  { query: "帮我查一下产物并汇总", label: "产物" },
  { query: "查看报告汇总", label: "报告" },
  { query: "查看日志", label: "日志" },
  { query: "查看配置", label: "配置" },
  { query: "查看账本", label: "账本" },
  { query: "查看智能体", label: "智能体" },
  { query: "查看记忆", label: "记忆" },
];

const DATA_SOURCE_LABELS: Record<string, string> = { real: "真实", demo: "演示", mixed: "混合" };

function partArtifact(part: ConsoleChatPart): string {
  const artifact = (part.artifact ?? part) as Record<string, unknown>;
  const kind = String(artifact.kind ?? "text");
  const title = String(artifact.title ?? "产物");
  const content = String(artifact.preview_text ?? "");
  const size = Number(artifact.size ?? content.length);
  const demo = artifact.demo === true;
  let preview: string;
  if (kind === "html") {
    preview = `<iframe class="gpt-artifact-iframe" sandbox="" srcdoc="${escapeAttr(content)}" title="${escapeAttr(title)}（沙箱预览）"></iframe>`;
  } else if (kind === "markdown") {
    preview = `<div class="gpt-artifact-md">${renderMarkdown(content)}</div>`;
  } else if (kind === "image") {
    preview = `<div class="gpt-artifact-img">${content.startsWith("<svg") ? content : `<img alt="${escapeAttr(title)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}" />`}</div>`;
  } else {
    preview = `<pre class="gpt-artifact-pre">${escapeHtml(content.slice(0, 6000))}</pre>`;
  }
  const fileName = String(artifact.rel_path ?? title).replace(/[^\w.-]+/g, "_");
  const downloadHref = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(content)}`;
  return `<div class="gpt-card gpt-artifact" data-card="artifact" data-kind="${escapeAttr(kind)}">
    <header><span class="gpt-card-kind">📄 产物 · ${escapeHtml(kind)}</span><b>${escapeHtml(title)}</b><span class="gpt-meta">${escapeHtml(formatBytes(size))}${artifact.agent_role === undefined ? "" : ` · ${escapeHtml(String(artifact.agent_role))}`}</span>${demo ? '<span class="gpt-demo">演示</span>' : ""}<a class="gpt-download" download="${escapeAttr(fileName)}" href="${escapeAttr(downloadHref)}">下载</a></header>
    <details class="gpt-artifact-preview" open><summary>预览</summary>${preview}</details>
  </div>`;
}

function partReport(part: ConsoleChatPart): string {
  const report = (part.report ?? part) as Record<string, unknown>;
  return `<div class="gpt-card gpt-report" data-card="report">
    <header><span class="gpt-card-kind">🧾 报告</span><b>${escapeHtml(String(report.title ?? "报告"))}</b><span class="gpt-meta">${escapeHtml(String(report.agent_role ?? ""))}</span></header>
    <details class="gpt-report-preview"><summary>展开报告（Markdown）</summary><div class="gpt-md">${renderMarkdown(String(report.markdown ?? ""))}</div></details>
  </div>`;
}

function partData(part: ConsoleChatPart): string {
  const data = (part.data ?? part) as Record<string, unknown>;
  const rows = Array.isArray(data.rows) ? (data.rows as Array<Record<string, unknown>>) : null;
  const keyValues: Array<[string, string]> = [];
  if (rows === null) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "object" && value !== null) continue;
      keyValues.push([key, String(value)]);
    }
  }
  const body = rows === null
    ? keyValues.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td class="mono">${escapeHtml(value)}</td></tr>`).join("")
    : rows.map((row) => `<tr>${Object.values(row).map((value, index) => (index === 0 ? `<th class="mono">${escapeHtml(String(value))}</th>` : `<td class="mono">${escapeHtml(String(value))}</td>`)).join("")}</tr>`).join("");
  const title = String(part.kind ?? data.kind ?? "数据");
  return `<div class="gpt-card gpt-data" data-card="data" data-kind="${escapeAttr(title)}">
    <header><span class="gpt-card-kind">📊 数据</span><b>${escapeHtml(title)}</b></header>
    <table class="gpt-data-table"><tbody>${body === "" ? '<tr><td class="muted">（无数据）</td></tr>' : body}</tbody></table>
  </div>`;
}

export function renderChatPart(part: ConsoleChatPart): string {
  const type = String(part.type ?? "text");
  switch (type) {
    case "text":
    case "markdown": {
      const markdown = String(part.markdown ?? part.text ?? "");
      const runLink = part.run_link as Record<string, unknown> | undefined;
      const link = runLink === undefined
        ? ""
        : `<p class="gpt-run-link-wrap"><a class="gpt-run-link" id="${escapeAttr(String(runLink.id ?? "chat-run-link"))}" href="${escapeAttr(String(runLink.href ?? "#"))}">${escapeHtml(String(runLink.text ?? "查看运行过程 →"))}</a></p>`;
      if (markdown.includes("\n") || /[*#`|]/.test(markdown)) {
        return `<div class="gpt-part gpt-part-text gpt-md" data-part="text">${renderMarkdown(markdown)}${link}</div>`;
      }
      return `<div class="gpt-part gpt-part-text" data-part="text"><p>${escapeHtml(markdown)}</p>${link}</div>`;
    }
    case "thinking":
      return `<details class="gpt-card gpt-thinking" data-card="thinking"><summary>💭 思考过程（点击展开）</summary><div class="gpt-thinking-text">${escapeHtml(String(part.text ?? part.chunk ?? ""))}</div></details>`;
    case "tool_call":
      const toolStatus = String(part.status ?? "running");
      const toolOk = toolStatus === "ok" || toolStatus === "done" || toolStatus === "completed";
      const preview = String(part.result_preview ?? part.result_summary ?? "");
      return `<div class="gpt-card gpt-tool" data-card="tool" data-call-id="${escapeAttr(String(part.callId ?? part.call_id ?? ""))}" data-status="${escapeAttr(toolStatus)}"><span class="gpt-tool-name">${toolOk ? "✅" : "🔧"} ${escapeHtml(String(part.tool ?? "tool"))}</span><span class="gpt-tool-args mono">${escapeHtml(String(part.input ?? part.args_summary ?? ""))}</span><span class="gpt-tool-status">${toolOk ? "完成" : "调用中…"}${part.duration_ms === undefined ? "" : ` · ${String(part.duration_ms)}ms`}</span>${preview === "" ? "" : `<details class="gpt-tool-detail"><summary>结果</summary><div class="gpt-tool-result-text">${escapeHtml(preview.slice(0, 1200))}</div></details>`}</div>`;
    case "tool_result":
      return `<div class="gpt-card gpt-tool-result" data-card="tool-result" data-call-id="${escapeAttr(String(part.callId ?? part.call_id ?? ""))}" data-status="${escapeAttr(String(part.status ?? "ok"))}"><span class="gpt-tool-name">✅ ${escapeHtml(String(part.tool ?? "tool"))}</span><span class="gpt-tool-args mono">${escapeHtml(String(part.result_preview ?? part.result_summary ?? ""))}</span><span class="gpt-tool-status">${escapeHtml(String(part.status ?? "ok"))}${part.duration_ms === undefined ? "" : ` · ${String(part.duration_ms)}ms`}</span></div>`;
    case "artifact":
      return partArtifact(part);
    case "report":
      return partReport(part);
    case "data":
      return partData(part);
    case "approval":
      return `<div class="gpt-card gpt-approval" data-card="approval" data-approval-id="${escapeAttr(String(part.approval_id ?? ""))}" data-step="${escapeAttr(String(part.step ?? ""))}" data-status="pending">
        <header><span class="gpt-card-kind">⚠️ 审批</span><b>需要你确认后才会继续</b>${part.demo === true ? '<span class="gpt-demo">演示</span>' : ""}</header>
        <p class="gpt-approval-risk">${escapeHtml(String(part.risk ?? "高风险动作必须人工批准，AI 不绕过"))}</p>
        <p class="gpt-meta">${escapeHtml(String(part.summary ?? ""))}</p>
        <div class="gpt-approval-actions"><button class="primary" type="button" data-approve>批准</button><button class="danger" type="button" data-reject>驳回</button></div>
      </div>`;
    case "error":
      return `<div class="gpt-card gpt-error" data-card="error"><b>执行失败：</b>${escapeHtml(String(part.message ?? ""))}</div>`;
    default:
      return `<div class="gpt-part" data-part="${escapeAttr(type)}"><pre class="mono">${escapeHtml(JSON.stringify(part).slice(0, 2000))}</pre></div>`;
  }
}

type DisplayPhase = "thinking" | "result";
interface NormalizedDisplay {
  thinking: ConsoleChatPart[];
  deliverables: ConsoleChatPart[];
  results: ConsoleChatPart[];
  approvals: ConsoleChatPart[];
  errors: ConsoleChatPart[];
  summary: { steps: number; tool_calls: number; artifacts: number; reports: number };
}

/** v1.5.2：默认视图 = 用户消息 + 思考过程（折叠）+ 最终结果；旧消息自动分类。 */
function normalizeDisplayParts(parts: ConsoleChatPart[], streaming = false): NormalizedDisplay {
  const merged: ConsoleChatPart[] = [];
  for (const part of parts) {
    if (part.type === "tool_result") {
      const callId = String(part.callId ?? part.call_id ?? "");
      const call = [...merged].reverse().find((item) => item.type === "tool_call" && ((callId !== "" && String(item.callId ?? item.call_id ?? "") === callId) || (callId === "" && String(item.tool ?? "") === String(part.tool ?? ""))));
      if (call !== undefined) {
        call.status = part.status === "error" ? "error" : "ok";
        call.result_preview = part.result_preview ?? part.result_summary;
        if (part.duration_ms !== undefined) call.duration_ms = part.duration_ms;
        continue;
      }
    }
    merged.push({ ...part });
  }
  const textIndexes = merged.map((part, index) => (part.type === "text" ? index : -1)).filter((index) => index >= 0);
  const lastText = textIndexes.length > 0 ? (textIndexes[textIndexes.length - 1] as number) : -1;
  const thinking: ConsoleChatPart[] = [];
  const deliverables: ConsoleChatPart[] = [];
  const results: ConsoleChatPart[] = [];
  const approvals: ConsoleChatPart[] = [];
  const errors: ConsoleChatPart[] = [];
  for (let index = 0; index < merged.length; index += 1) {
    const part = merged[index] as ConsoleChatPart;
    if (part.type === "approval") { approvals.push(part); continue; }
    if (part.type === "error") { errors.push(part); continue; }
    if (part.type === "artifact" || part.type === "report") { deliverables.push(part); continue; }
    const explicitResult = part.phase === "result" || part.run_link !== undefined;
    const inferredResult = !streaming && ((part.type === "text" && index === lastText) || (part.type === "markdown" && lastText < 0 && index === merged.length - 1));
    if (explicitResult || inferredResult) results.push(part);
    else thinking.push(part);
  }
  return {
    thinking,
    deliverables,
    results,
    approvals,
    errors,
    summary: {
      steps: thinking.length,
      tool_calls: thinking.filter((part) => part.type === "tool_call").length,
      artifacts: deliverables.filter((part) => part.type === "artifact").length,
      reports: deliverables.filter((part) => part.type === "report").length,
    },
  };
}

function renderThinkingBlock(display: NormalizedDisplay, streaming: boolean): string {
  if (display.thinking.length === 0 && !streaming) return "";
  const summary = display.summary;
  const bits = [
    summary.steps > 0 ? String(summary.steps) + " 步" : "",
    summary.tool_calls > 0 ? "工具 " + String(summary.tool_calls) : "",
    summary.artifacts > 0 ? "产物 " + String(summary.artifacts) : "",
    summary.reports > 0 ? "报告 " + String(summary.reports) : "",
  ].filter((bit) => bit !== "").join(" · ");
  const body = display.thinking.map((part) => part.type === "thinking" ? `<div class="gpt-thinking-line">💭 ${escapeHtml(String(part.text ?? ""))}</div>` : renderChatPart(part)).join("");
  const title = streaming ? "正在思考…" : "思考过程" + (bits === "" ? "" : " · " + bits);
  const empty = body === "" ? '<p class="muted">正在收集过程…</p>' : body;
  return `<details class="gpt-thinking-group" data-thinking-group><summary>💭 ${escapeHtml(title)}（点击展开）</summary><div class="gpt-thinking-body">${empty}</div></details>`;
}

function renderAssistantBody(message: ConsoleChatMessage): string {
  const streaming = message.status === "streaming";
  const display = normalizeDisplayParts(message.parts, streaming);
  const thinking = renderThinkingBlock(display, streaming);
  const results = display.results.map(renderChatPart).join("");
  const resultText = results === "" && message.result_text !== undefined ? `<div class="gpt-part gpt-part-text gpt-md gpt-result-text" data-result-text>${renderMarkdown(message.result_text)}</div>` : "";
  const deliverables = display.deliverables.slice(0, 3).map(renderChatPart).join("");
  const extra = display.deliverables.length > 3 ? `<p class="muted small">另有 ${String(display.deliverables.length - 3)} 个交付物，已收起在思考过程中。</p>` : "";
  const approvals = display.approvals.map(renderChatPart).join("");
  const errors = display.errors.map(renderChatPart).join("");
  const hasResult = results !== "" || resultText !== "" || approvals !== "" || errors !== "";
  const resultBlock = hasResult ? `<div class="gpt-result" data-final-result><div class="gpt-result-label">✅ 最终结果</div>${results}${resultText}</div>` : "";
  const deliverableBlock = deliverables === "" ? "" : `<div class="gpt-deliverables" data-deliverables>${deliverables}${extra}</div>`;
  return thinking + resultBlock + deliverableBlock + approvals + errors;
}

export function renderChatMessage(message: ConsoleChatMessage): string {
  const role = message.role === "user" ? "user" : message.role === "system" ? "system" : "assistant";
  const avatar = role === "user" ? "你" : "◈";
  return `<article class="gpt-msg" data-role="${escapeAttr(role)}" data-message-id="${escapeAttr(message.id)}" data-status="${escapeAttr(message.status ?? "done")}">
    <span class="gpt-avatar">${avatar}</span>
    <div class="gpt-bubble">
      <div class="gpt-msg-meta"><b>${role === "user" ? "你" : "总调度助手"}</b><span class="muted small">${escapeHtml(formatDateTime(message.at))}</span>${message.status === "streaming" ? '<span class="gpt-streaming" data-streaming>思考中…</span>' : ""}</div>
      ${role === "user" ? message.parts.map(renderChatPart).join("") : renderAssistantBody(message)}
    </div>
  </article>`;
}

export interface ChatHomePageInput {
  conversations: ConsoleChatConversation[];
  active: { conversation: ConsoleChatConversation; messages: ConsoleChatMessage[] } | null;
  memory: ConsoleChatMemory[];
  status: ConsoleChatStatus;
  options: PageRenderOptions;
}

export function renderChatHomePage(input: ChatHomePageInput): string {
  const convItems = input.conversations
    .map(
      (conv) => `<div class="gpt-conv-item${input.active !== null && conv.id === input.active.conversation.id ? " active" : ""}" data-conv-id="${escapeAttr(conv.id)}" id="conv-${escapeAttr(conv.id)}">
        <a class="gpt-conv-open" data-conv-open href="/chat?conversation=${encodeURIComponent(conv.id)}" title="${escapeAttr(conv.title)}">${escapeHtml(conv.title)}</a>
        <span class="gpt-conv-meta muted small">${String(conv.message_count)} 条 · ${escapeHtml(formatDateTime(conv.updated_at))}</span>
        <button class="gpt-conv-rename" type="button" data-conv-rename="${escapeAttr(conv.id)}" title="重命名">✎</button>
        <button class="gpt-conv-delete" type="button" data-conv-delete="${escapeAttr(conv.id)}" title="删除">🗑</button>
      </div>`,
    )
    .join("");
  const memoryItems = input.memory
    .map(
      (mem) => `<article class="gpt-memory-item" data-memory-id="${escapeAttr(mem.id)}" data-kind="${escapeAttr(mem.kind)}">
        <div class="gpt-memory-head"><span class="badge status-idle">${escapeHtml(mem.kind)}</span><b>重要度 ${String(mem.importance)}</b><button type="button" data-memory-delete="${escapeAttr(mem.id)}" title="删除记忆">🗑</button></div>
        <p class="gpt-memory-content">${escapeHtml(mem.content)}</p>
        <div class="gpt-memory-tags">${mem.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join(" ")}<span class="muted small">${escapeHtml(formatDateTime(mem.created_at))}</span></div>
      </article>`,
    )
    .join("");
  const messages = input.active === null ? "" : input.active.messages.map(renderChatMessage).join("");
  const chips = QUICK_CHIPS.map(
    (chip) => `<button class="gpt-chip" type="button" data-query="${escapeAttr(chip.query)}" id="chip-${escapeAttr(chip.label)}">${escapeHtml(chip.label)}</button>`,
  ).join("");
  const content = `
<div class="gpt-page" id="gpt-page" data-conv-id="${escapeAttr(input.active?.conversation.id ?? "")}" data-source="${escapeAttr(input.status.data_source)}">
  <aside class="gpt-sidebar" id="gpt-sidebar">
    <button class="gpt-new" type="button" id="conv-new">＋ 新对话</button>
    <a class="gpt-memory-link" id="memory-toggle" href="#gpt-memory-panel">🧠 记忆（${String(input.memory.length)}）</a>
    <div class="gpt-conv-list" id="conv-list">${convItems === "" ? '<p class="empty-state">暂无对话</p>' : convItems}</div>
  </aside>
  <section class="gpt-main">
    <header class="gpt-topbar">
      <span class="gpt-source" id="data-source" data-source="${escapeAttr(input.status.data_source)}">数据源：${escapeHtml(DATA_SOURCE_LABELS[input.status.data_source] ?? input.status.data_source)}</span>
      <span class="gpt-runtime-status" id="chat-status-badge">运行中 ${String(input.status.runs_active)} · 待审批 ${String(input.status.awaiting_approval)}</span>
      <div class="gpt-chips" id="quick-chips">${chips}</div>
    </header>
    <div class="gpt-messages" id="gpt-messages">
      ${messages === "" ? '<div class="gpt-empty" id="gpt-empty"><div class="gpt-empty-title">开始新的对话</div><p class="muted">告诉我你要做什么：查系统状态、看产物/报告、跑任务…<br/>也可以点上方快捷按钮（一个入口控制全部）。</p></div>' : messages}
    </div>
    <form class="gpt-composer" id="gpt-composer">
      <textarea id="composer-input" rows="2" placeholder="给总调度发消息…（Enter 发送；可先选智能体点名发送，独立上下文）"></textarea>
      <div class="gpt-composer-side">
          <select class="input" id="composer-agent" title="点名发送：选择智能体后，消息会交给它的独立会话/工作区处理">
          <option value="">自动调度（推荐）</option>
          <option value="supervisor">系统总控</option>
          <option value="conductor">项目总调度</option>
          <option value="operator">办公执行</option>
          <option value="harness">编码代理</option>
          <option value="customer">客户沟通</option>
          <option value="finance">财务</option>
          <option value="reviewer">核查复核</option>
          <option value="backend">后台运维</option>
          <option value="scout">线索发现</option>
          <option value="content">内容创作</option>
          <option value="research">调研分析</option>
          </select>
        <button class="primary" type="submit" id="composer-send">发送</button>
        <span class="gpt-typing" id="typing-indicator" hidden>思考中…</span>
      </div>
      <p class="alert alert-error" id="gpt-error" hidden></p>
    </form>
  </section>
  <aside class="gpt-memory-drawer" id="gpt-memory-panel">
    <header><h2>长期记忆 <span class="muted small">${String(input.memory.length)}</span></h2><a class="run-link" href="/artifacts" id="memory-artifacts-link">产物中心 →</a></header>
    <input class="input" type="search" id="memory-search" placeholder="搜索记忆（kind/内容/标签）" />
    <div class="gpt-memory-list" id="memory-list">${memoryItems === "" ? '<p class="empty-state" id="memory-empty">暂无记忆；对话中产生的长期事实会出现在这里。</p>' : memoryItems}</div>
    <p class="muted small">当前对话召回的记忆会用于后续回复（演示：显示在记忆面板中）。</p>
  </aside>
</div>`;
  return renderShell(input.options, "对话", content);
}
