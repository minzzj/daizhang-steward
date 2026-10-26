/**
 * packages/steward-console/src/pages-chat.ts
 *
 * v1.2 页面：总调度对话（/chat、/chat/:id）、智能体对话记录（/agents/:role）、
 * run 详情与证据（/runs/:id）、变现收款（/money、/money/request/:id），
 * 以及 /settings 的「模型与 API 密钥」「系统提示词」分组。
 */

import {
  escapeHtml,
  formatCny,
  formatDateTime,
  renderShell,
  type PageRenderOptions,
} from "./pages.js";
import type { FlowEvent } from "./admin.js";
import { AGENT_AUTONOMY_LABELS, type ConsoleAgentInfo } from "./admin.js";
import {
  MONEY_METHODS,
  MONEY_METHOD_LABELS,
  MODEL_PROVIDER_LABELS,
  chatAgentTitle,
  type AgentTranscript,
  type ChatMessage,
  type ChatPlanStep,
  type ChatSession,
  type EvidenceItem,
  type ModelSettings,
  type MoneyRequest,
  type RunDetail,
  type RunSummary,
} from "./chat.js";
import type { ConsoleLedgerEntry } from "./provider.js";
import { renderEpaySettingsSection } from "./pages-system.js";
import type { EpayConfig } from "./system.js";

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  planning: "计划中",
  running: "执行中",
  paused: "已打断（暂停）",
  done: "已完成",
  blocked: "已阻塞",
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  done: "已完成",
  blocked: "已暂停",
};

const MONEY_STATUS_LABELS: Record<string, string> = {
  pending: "待收款",
  paid: "已到账",
  cancelled: "已取消",
};

const ROLE_ICONS: Record<string, string> = {
  conductor: "◈",
  operator: "▶",
  harness: "⌘",
  customer: "☎",
  finance: "￥",
  reviewer: "◎",
  backend: "▣",
  scout: "◎",
  content: "✎",
  research: "⌕",
  enterprise_admin: "▤",
  user: "我",
};

function pageHeading(title: string, hint?: string): string {
  const hintText = hint === undefined ? "" : `<span class="muted small">${escapeHtml(hint)}</span>`;
  return `<div class="page-title"><h1>${escapeHtml(title)}</h1>${hintText}</div>`;
}

function sessionStatusBadge(status: string): string {
  return `<span class="chat-status" data-status="${escapeAttr(status)}" id="chat-status">${escapeHtml(SESSION_STATUS_LABELS[status] ?? status)}</span>`;
}

// ---------------------------------------------------------------------------
// Markdown 渲染（内置极简实现：标题/列表/代码块/引用/粗体/行内代码；不做外链）
// ---------------------------------------------------------------------------

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderMarkdown(markdown: string): string {
  const lines = String(markdown ?? "").replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  let listTag = "ul";
  const closeList = (): void => {
    if (inList) {
      html.push(`</${listTag}>`);
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        html.push('<pre class="md-code"><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (line.trim() === "") {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading !== null) {
      closeList();
      const level = Math.min(4, (heading[1] ?? "#").length);
      html.push(`<h${String(level)}>${renderInline(heading[2] ?? "")}</h${String(level)}>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    if (unordered !== null) {
      if (!inList || listTag !== "ul") {
        closeList();
        html.push("<ul>");
        inList = true;
        listTag = "ul";
      }
      const checked = /^\[([ xX])\]\s*(.*)$/.exec(unordered[1] ?? "");
      if (checked !== null) {
        const mark = checked[1] === " " ? "☐" : "☑";
        html.push(`<li class="md-check">${mark} ${renderInline(checked[2] ?? "")}</li>`);
      } else {
        html.push(`<li>${renderInline(unordered[1] ?? "")}</li>`);
      }
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ordered !== null) {
      if (!inList || listTag !== "ol") {
        closeList();
        html.push("<ol>");
        inList = true;
        listTag = "ol";
      }
      html.push(`<li>${renderInline(ordered[1] ?? "")}</li>`);
      continue;
    }
    closeList();
    const quote = /^>\s*(.*)$/.exec(line);
    if (quote !== null) {
      html.push(`<blockquote>${renderInline(quote[1] ?? "")}</blockquote>`);
      continue;
    }
    html.push(`<p>${renderInline(line)}</p>`);
  }
  if (inCode) html.push("</code></pre>");
  closeList();
  return `<div class="md-body">${html.join("\n")}</div>`;
}

// ---------------------------------------------------------------------------
// /chat — 会话列表 + 新建项目
// ---------------------------------------------------------------------------

export interface ChatPageInput {
  sessions: ChatSession[];
  options: PageRenderOptions;
}

export function renderChatPage(input: ChatPageInput): string {
  const sessions = input.sessions
    .map((session) => {
      const last = session.messages[session.messages.length - 1];
      const summary = last?.summary ?? last?.text.slice(0, 60) ?? "暂无消息";
      return `<a class="chat-session" id="chat-session-${escapeAttr(session.id)}" data-session-id="${escapeAttr(session.id)}" href="/chat/${encodeURIComponent(session.id)}">
        <span class="chat-session-title">${escapeHtml(session.title)}</span>
        ${sessionStatusBadge(session.status)}
        <span class="chat-session-goal">${escapeHtml(session.goal)}</span>
        <span class="chat-session-summary">${escapeHtml(summary)}</span>
        <span class="chat-session-meta muted small">预算 ${escapeHtml(formatCny(session.budget_cny))} · Token ${session.token_limit.toLocaleString("zh-CN")} · ${escapeHtml(formatDateTime(session.updated_at))}</span>
      </a>`;
    })
    .join("");
  const content = `
${pageHeading("对话", "告诉总调度你要做什么：它会拆解计划并开始执行；每一轮都有摘要，执行留证可追溯")}
<div class="chat-layout">
  <section class="panel chat-list-panel">
    <h2>会话记录 <span class="hint">${String(input.sessions.length)} 个会话</span></h2>
    <div class="chat-sessions" id="chat-sessions">${sessions === "" ? '<p class="empty-state" id="chat-empty">还没有会话：在右侧新建项目开始</p>' : sessions}</div>
  </section>
  <section class="panel" id="chat-create-panel">
    <h2>新建项目 <span class="hint">目标 / 预算 / Token 上限 / 模式</span></h2>
    <form class="chat-create-form" id="chat-create-form" onsubmit="return false">
      <label>我要做什么<textarea class="input" id="chat-goal" rows="4" placeholder="例如：帮我做一个报价单页面（含客户信息与金额明细）；或：帮我查一下竞品定价">帮我做一个报价单页面（含客户信息与金额明细）</textarea></label>
      <div class="form-grid">
        <label>预算上限（元）<input class="input input-num" type="number" min="0" step="100" id="chat-budget" value="3000" /></label>
        <label>Token 上限<input class="input input-num" type="number" min="1000" step="10000" id="chat-token" value="200000" /></label>
        <label>运行模式<select class="input" id="chat-mode"><option value="demo">体验模式</option><option value="personal" selected>个人模式</option><option value="enterprise">企业模式</option></select></label>
      </div>
      <button class="primary" type="submit" id="chat-create-submit">创建项目并让总调度拆解计划</button>
      <p class="chat-tip muted small" id="chat-tip">总调度会先生成计划（步骤/负责智能体/验收标准），再开始执行；付款/外发等关键步骤会出审批卡。</p>
      <p class="alert alert-error" id="chat-create-error" hidden></p>
    </form>
  </section>
</div>`;
  return renderShell(input.options, "对话", content);
}

// ---------------------------------------------------------------------------
// /chat/:id — 会话详情
// ---------------------------------------------------------------------------

export interface ChatSessionPageInput {
  session: ChatSession;
  options: PageRenderOptions;
}

function renderMessage(item: ChatMessage): string {
  const role = item.role === "user" ? "user" : item.role === "conductor" ? "conductor" : "agent";
  const who = item.role === "user" ? "我" : item.role === "conductor" ? "总调度" : chatAgentTitle(item.agent_role ?? "agent");
  const kindClass = item.kind === undefined ? "" : ` kind-${item.kind}`;
  const summary = item.summary === undefined ? "" : `<div class="chat-summary muted small">摘要：${escapeHtml(item.summary)}</div>`;
  return `<div class="chat-message" data-role="${escapeAttr(role)}" data-kind="${escapeAttr(item.kind ?? "")}" id="msg-${escapeAttr(item.id)}">
    <span class="chat-avatar" aria-hidden="true">${escapeHtml(ROLE_ICONS[role === "conductor" ? "conductor" : item.agent_role ?? role] ?? "•")}</span>
    <div class="chat-bubble${kindClass}">
      <div class="chat-meta"><b>${escapeHtml(who)}</b><span class="muted small">${escapeHtml(formatDateTime(item.at))}</span></div>
      <div class="chat-text">${escapeHtml(item.text).replaceAll("\n", "<br />")}</div>
      ${summary}
    </div>
  </div>`;
}

function renderPlan(plan: ChatPlanStep[] | undefined): string {
  if (plan === undefined || plan.length === 0) return '<p class="empty-state" id="chat-plan-empty">尚未生成计划</p>';
  const rows = plan
    .map(
      (step) => `<li class="plan-step" data-step="${String(step.step)}" data-status="${escapeAttr(step.status)}">
        <span class="plan-seq mono">${String(step.step)}</span>
        <span class="plan-agent">${escapeHtml(chatAgentTitle(step.agent_role))}</span>
        <span class="plan-action">${escapeHtml(step.action)}${step.requires_approval === true ? ' <span class="badge status-pending" data-needs-approval="true">需审批</span>' : ""}</span>
        <span class="plan-summary muted small">${escapeHtml(step.summary)}</span>
        <span class="plan-status" data-plan-status>${escapeHtml(PLAN_STATUS_LABELS[step.status] ?? step.status)}</span>
      </li>`,
    )
    .join("");
  return `<ol class="chat-plan" id="chat-plan">${rows}</ol>`;
}

export function renderChatSessionPage(input: ChatSessionPageInput): string {
  const session = input.session;
  const approvalStep = (session.plan ?? []).find((step) => step.requires_approval === true && step.status === "pending");
  const approvalPanel =
    approvalStep === undefined
      ? ""
      : `<div class="approval-panel" id="chat-approval" data-step="${String(approvalStep.step)}">
          <div class="approval-panel-title">⚠ 关键步骤需人工审批：步骤 ${String(approvalStep.step)}「${escapeHtml(approvalStep.action)}」</div>
          <p class="muted small">${escapeHtml(approvalStep.summary)}。批准后继续执行；驳回则暂停项目。</p>
          <div class="approval-panel-actions">
            <button class="primary" type="button" id="chat-approve">批准</button>
            <button class="danger" type="button" id="chat-reject">驳回</button>
          </div>
        </div>`;
  const runLink =
    session.run_id === undefined
      ? '<span class="muted small" id="chat-run-link-empty">开始执行后生成 run 与证据</span>'
      : `<a class="run-link" id="chat-run-link" href="/runs/${encodeURIComponent(session.run_id)}">查看 run 详情与证据 →</a>`;
  const actions: string[] = [];
  if (session.status === "planning" || session.status === "active") actions.push('<button class="primary" type="button" id="chat-start">开始执行</button>');
  if (session.status === "running" || session.status === "planning") actions.push('<button class="danger" type="button" id="chat-interrupt">打断（暂停）</button>');
  if (session.status === "paused") actions.push('<button class="primary" type="button" id="chat-resume">恢复执行</button>');
  const transcriptsLink = `<a class="run-link" href="/agents/conductor" id="chat-conductor-link">查看总调度对话记录 →</a>`;
  const content = `
${pageHeading("会话", session.title)}
<div class="chat-session-page" id="chat-session-page">
  <div class="chat-session-head">
    <div class="chat-session-headline">
      ${sessionStatusBadge(session.status)}
      <span class="chat-session-id mono small muted">${escapeHtml(session.id)}</span>
      <span class="badge status-idle">模式：${escapeHtml(session.mode)}</span>
    </div>
    <div class="chat-session-actions">${actions.join("")}<a class="btn-link" href="/chat" id="chat-new-link">＋ 新建项目</a></div>
  </div>
  <div class="chat-session-params" id="chat-session-params">
    <div><span class="muted small">目标</span><b id="chat-goal-text">${escapeHtml(session.goal)}</b></div>
    <div><span class="muted small">预算上限</span><b id="chat-budget-text">${escapeHtml(formatCny(session.budget_cny))}</b></div>
    <div><span class="muted small">Token 上限</span><b id="chat-token-text">${escapeHtml(session.token_limit.toLocaleString("zh-CN"))}</b></div>
    <div><span class="muted small">项目 / Run</span><b class="mono small">${escapeHtml(session.project_id ?? "（未创建）")}</b> ${runLink}</div>
  </div>
  <div class="chat-main-grid">
    <section class="panel chat-flow-panel">
      <h2>与总调度的对话 <span class="hint">每轮含简略摘要；${String(session.messages.length)} 条消息</span></h2>
      <div class="chat-messages" id="chat-messages">${session.messages.map(renderMessage).join("")}</div>
      <form class="chat-composer" id="chat-composer" onsubmit="return false">
        <input class="input" id="chat-input" type="text" placeholder="继续告诉总调度：调整约束 / 追问进度 / 审批说明…" />
        <button class="primary" type="submit" id="chat-send">发送</button>
      </form>
      ${approvalPanel}
      <p class="alert alert-error" id="chat-error" hidden></p>
    </section>
    <aside class="chat-plan-panel">
      <section class="panel">
        <h2>总调度计划 <span class="hint">${String(session.plan?.length ?? 0)} 步</span></h2>
        ${renderPlan(session.plan)}
        ${transcriptsLink}
      </section>
      <section class="panel">
        <h2>能做什么</h2>
        <ul class="list-clean muted small">
          <li>新建项目：目标 / 预算 / Token 上限 / 模式</li>
          <li>中途打断 → 记录断点 → 恢复后不重复执行</li>
          <li>关键步骤审批/驳回后继续</li>
          <li>每个 run 的截图 / report.md / 日志 / JSON 都可追溯</li>
        </ul>
      </section>
    </aside>
  </div>
</div>`;
  return renderShell(input.options, "会话", content);
}

// ---------------------------------------------------------------------------
// /agents/:role — 智能体对话记录
// ---------------------------------------------------------------------------

export interface AgentRolePageInput {
  role: string;
  title: string;
  transcripts: AgentTranscript[];
  agentInfo?: ConsoleAgentInfo | null;
  runs: RunSummary[];
  options: PageRenderOptions;
}

export function renderAgentRolePage(input: AgentRolePageInput): string {
  const turns = input.transcripts.flatMap((transcript) => transcript.turns);
  const totalTokens = turns.reduce((sum, turn) => sum + turn.tokens, 0);
  const turnRows = turns
    .map(
      (turn, index) => `<li class="agent-turn" data-seq="${String(turn.seq)}" id="agent-turn-${String(index + 1)}">
        <div class="agent-turn-head">
          <span class="mono small muted">#${String(turn.seq)}</span>
          <span class="agent-turn-at muted small">${escapeHtml(formatDateTime(turn.at))}</span>
          <span class="badge status-${turn.status === "ok" ? "approved" : turn.status === "waiting" ? "pending" : "idle"}">${escapeHtml(turn.status)}</span>
          <span class="agent-turn-tokens mono small">Token ${turn.tokens.toLocaleString("zh-CN")}</span>
        </div>
        <div class="agent-turn-grid">
          <div><span class="muted small">输入摘要</span><div class="turn-input">${escapeHtml(turn.input_summary)}</div></div>
          <div><span class="muted small">输出摘要</span><div class="turn-output">${escapeHtml(turn.output_summary)}</div></div>
        </div>
        ${turn.evidence_ref === undefined ? "" : `<a class="run-link" href="/runs/${encodeURIComponent(input.runs[0]?.run_id ?? "")}" data-evidence-ref="${escapeAttr(turn.evidence_ref)}">证据：${escapeHtml(turn.evidence_ref)}</a>`}
      </li>`,
    )
    .join("");
  const info = input.agentInfo;
  const infoCard =
    info === undefined || info === null
      ? ""
      : `<div class="agent-role-info" id="agent-role-info">
          <span>状态：<b>${escapeHtml(info.status)}</b></span>
          <span>自主等级：<b>${escapeHtml(AGENT_AUTONOMY_LABELS[info.autonomy])}</b></span>
          <span>今日动作：<b>${String(info.today_actions)}</b></span>
          <span>启用：<b>${info.enabled ? "是" : "否"}</b></span>
          <span>模型：<b class="mono">${escapeHtml(info.model_ref)}</b></span>
        </div>`;
  const runLinks = input.runs
    .slice(0, 3)
    .map((run) => `<li><a href="/runs/${encodeURIComponent(run.run_id)}" class="run-link">${escapeHtml(run.run_id)}</a> · ${escapeHtml(run.goal.slice(0, 40))}</li>`)
    .join("");
  const content = `
${pageHeading(chatAgentTitle(input.role), `每个智能体、每一轮的详细内容与简略摘要 · ${input.role}`)}
<div class="agent-role-page" id="agent-role-page">
  <div class="agent-role-head">
    <span class="agent-avatar">${escapeHtml(ROLE_ICONS[input.role] ?? "◈")}</span>
    <div class="agent-role-headline">
      <h2 id="agent-role-title">${escapeHtml(input.title)}</h2>
      <span class="mono small muted">${escapeHtml(input.role)}</span>
      ${infoCard}
    </div>
  </div>
  <div class="agent-role-stats" id="agent-role-summary">
    <span>轮次 <b id="agent-role-turn-count">${String(turns.length)}</b></span>
    <span>Token 合计 <b class="mono">${totalTokens.toLocaleString("zh-CN")}</b></span>
    <span>最近 run：${input.runs.length === 0 ? "—" : `<a href="/runs/${encodeURIComponent(input.runs[0]?.run_id ?? "")}" id="agent-role-run-link">${escapeHtml(input.runs[0]?.run_id ?? "")}</a>`}</span>
  </div>
  <section class="panel">
    <h2>对话轮次（输入/输出摘要 + Token + 证据）</h2>
    <ul class="agent-turns" id="agent-role-turns">${turnRows === "" ? '<li class="empty-state" id="agent-role-empty">暂无对话记录</li>' : turnRows}</ul>
  </section>
  <div class="grid grid-2">
    <section class="panel">
      <h2>相关 run</h2>
      <ul class="list-clean">${runLinks === "" ? '<li class="muted">暂无</li>' : runLinks}</ul>
    </section>
    <section class="panel">
      <h2>智能体中心</h2>
      <p class="muted small">查看全部智能体与状态：<a href="/agents" id="agent-role-back">智能体中心</a> · 配置模型与提示词：<a href="/settings#models-section">配置中心 → 模型与提示词</a></p>
    </section>
  </div>
</div>`;
  return renderShell(input.options, chatAgentTitle(input.role), content);
}

// ---------------------------------------------------------------------------
// /runs/:id — run 详情：时间线 + 证据 + report.md + 日志/JSON + agent 记录
// ---------------------------------------------------------------------------

export interface RunDetailPageInput {
  run: RunDetail;
  options: PageRenderOptions;
}

const PHASE_LABELS: Record<string, string> = {
  plan: "计划",
  action: "行动",
  observe: "观察",
  verify: "验证",
  evidence: "留证",
  error: "异常",
  takeover: "接管",
};

function renderTimeline(events: FlowEvent[]): string {
  const rows = events
    .map(
      (event) => `<li class="flow-item" data-phase="${escapeAttr(event.phase)}" data-seq="${String(event.seq)}">
        <span class="flow-seq mono">#${String(event.seq)}</span>
        <span class="flow-phase phase-${escapeAttr(event.phase)}">${escapeHtml(PHASE_LABELS[event.phase] ?? event.phase)}</span>
        <span class="flow-ts mono small muted">${escapeHtml(formatDateTime(event.ts))}</span>
        <span class="flow-summary">${escapeHtml(event.summary)}</span>
        <span class="flow-actor mono small">${escapeHtml(event.actor)}</span>
        ${event.evidence_ref === undefined ? "" : `<span class="mono small muted">证据 ${escapeHtml(event.evidence_ref)}</span>`}
      </li>`,
    )
    .join("");
  return `<ul class="flow-events" id="run-timeline">${rows === "" ? '<li class="empty-state">暂无事件</li>' : rows}</ul>`;
}

function evidenceKindLabel(kind: string): string {
  switch (kind) {
    case "screenshot":
      return "截图";
    case "report":
      return "报告";
    case "log":
      return "日志";
    case "json":
      return "JSON";
    case "html":
      return "HTML";
    default:
      return kind;
  }
}

function renderEvidence(evidence: EvidenceItem[]): string {
  const cards = evidence
    .map((item, index) => {
      if (item.kind === "screenshot") {
        const thumb = item.thumb_url ?? "";
        const full = item.full_url ?? thumb;
        return `<figure class="evidence-card evidence-screenshot" data-kind="${escapeAttr(item.kind)}" data-evidence-path="${escapeAttr(item.path)}">
          <button class="evidence-thumb" type="button" data-full-url="${escapeAttr(full)}" data-title="${escapeAttr(item.title)}" id="evidence-thumb-${String(index + 1)}" aria-label="查看大图：${escapeAttr(item.title)}">
            <img src="${escapeAttr(thumb)}" alt="${escapeAttr(item.title)}" width="400" height="250" loading="lazy" />
            <span class="evidence-zoom">点击查看大图</span>
          </button>
          <figcaption><b>${escapeHtml(item.title)}</b><span class="muted small">${escapeHtml(item.description ?? "")}</span><span class="mono small muted">${escapeHtml(item.path)}</span></figcaption>
        </figure>`;
      }
      return `<article class="evidence-card evidence-${escapeAttr(item.kind)}" data-kind="${escapeAttr(item.kind)}" data-evidence-path="${escapeAttr(item.path)}">
        <header><b>${escapeHtml(item.title)}</b><span class="badge status-idle">${escapeHtml(evidenceKindLabel(item.kind))}</span></header>
        <p class="muted small">${escapeHtml(item.description ?? "")}</p>
        <p class="mono small muted">${escapeHtml(item.path)}</p>
      </article>`;
    })
    .join("");
  return `<div class="evidence-grid" id="run-evidence">${cards === "" ? '<p class="empty-state" id="run-evidence-empty">暂无证据</p>' : cards}</div>`;
}

export function renderRunDetailPage(input: RunDetailPageInput): string {
  const run = input.run;
  const logs = run.evidence.filter((item) => item.kind === "log" || item.kind === "json");
  const payloads = logs
    .map(
      (item) => `<details class="payload-item" data-kind="${escapeAttr(item.kind)}" id="payload-${escapeAttr(item.kind)}">
        <summary><b>${escapeHtml(item.title)}</b> <span class="mono small muted">${escapeHtml(item.path)}</span></summary>
        <pre class="mono">${escapeHtml(item.preview_text ?? "（空）")}</pre>
      </details>`,
    )
    .join("");
  const agents = run.agents
    .map(
      (agent) => `<article class="run-agent" data-role="${escapeAttr(agent.agent_role)}" id="run-agent-${escapeAttr(agent.agent_role)}">
        <header><b>${escapeHtml(agent.title)}</b><span class="mono small muted">${escapeHtml(agent.agent_role)}</span><a class="run-link" href="/agents/${encodeURIComponent(agent.agent_role)}">对话记录 →</a></header>
        <ul class="run-agent-turns">${agent.turns
          .map(
            (turn) => `<li><span class="mono small muted">#${String(turn.seq)}</span> <span>${escapeHtml(turn.input_summary)}</span> → <span>${escapeHtml(turn.output_summary)}</span> <span class="mono small muted">${turn.tokens.toLocaleString("zh-CN")} tok</span></li>`,
          )
          .join("")}</ul>
      </article>`,
    )
    .join("");
  const content = `
${pageHeading("Run 详情", run.run_id)}
<div class="run-page" id="run-page">
  <div class="run-head">
    <span class="badge status-${run.status === "done" ? "approved" : run.status === "paused" ? "pending" : "running"}" id="run-status">${escapeHtml(run.status)}</span>
    <h2 id="run-goal">${escapeHtml(run.goal)}</h2>
    <span class="muted small">开始 ${escapeHtml(formatDateTime(run.started_at))}${run.finished_at === undefined ? "" : ` · 结束 ${escapeHtml(formatDateTime(run.finished_at))}`}</span>
    ${run.session_id === undefined ? "" : `<a class="run-link" href="/chat/${encodeURIComponent(run.session_id)}" id="run-session-link">返回会话 →</a>`}
  </div>
  <div class="run-stats" id="run-stats">
    <span>Token 已用 <b class="mono">${run.token_used.toLocaleString("zh-CN")}</b></span>
    <span>预算已用 <b>${escapeHtml(formatCny(run.budget_used_cny))}</b></span>
    <span>事件 <b>${String(run.events.length)}</b></span>
    <span>证据 <b>${String(run.evidence.length)}</b></span>
  </div>
  <div class="run-grid">
    <section class="panel">
      <h2>全流程时间线 <span class="hint">计划 → 行动 → 观察 → 验证 → 留证</span></h2>
      ${renderTimeline(run.events)}
    </section>
    <section class="panel">
      <h2>运行报告 report.md <span class="hint">渲染视图</span></h2>
      <div id="run-report">${renderMarkdown(run.report_md ?? "（无报告）")}</div>
    </section>
  </div>
  <section class="panel">
    <h2>证据 <span class="hint">截图缩略图可点开大图 · 报告 · 日志 / JSON</span></h2>
    ${renderEvidence(run.evidence)}
    ${payloads === "" ? "" : `<div class="payloads" id="run-payloads">${payloads}</div>`}
  </section>
  <section class="panel">
    <h2>各智能体对话摘要</h2>
    <div class="run-agents" id="run-agents">${agents === "" ? '<p class="empty-state">暂无</p>' : agents}</div>
  </section>
</div>
<div class="lightbox" id="evidence-lightbox" role="dialog" aria-modal="true" aria-label="证据大图" hidden>
  <button class="lightbox-close" type="button" id="lightbox-close" aria-label="关闭">✕</button>
  <div class="lightbox-body">
    <img id="lightbox-img" src="" alt="" />
    <div class="lightbox-title" id="lightbox-title"></div>
  </div>
</div>`;
  return renderShell(input.options, "Run 详情", content);
}

// ---------------------------------------------------------------------------
// /money — 变现收款
// ---------------------------------------------------------------------------

export interface MoneyPageInput {
  requests: MoneyRequest[];
  /** v1.3：易支付配置（system provider 提供；缺省时不渲染 epay 分组）。 */
  epayConfig?: EpayConfig;
  ledgerIncome: ConsoleLedgerEntry[];
  channels: Array<{ kind: string; label: string; enabled: boolean; account_masked?: string }>;
  mode: string;
  options: PageRenderOptions;
}

export function renderMoneyPage(input: MoneyPageInput): string {
  const channels = input.channels
    .map(
      (channel) => `<div class="money-channel" data-kind="${escapeAttr(channel.kind)}">
        <span class="money-channel-name">${escapeHtml(channel.label)}</span>
        <span class="badge ${channel.enabled ? "status-approved" : "status-idle"}">${channel.enabled ? "已启用" : "未启用"}</span>
        <span class="mono small muted">${escapeHtml(channel.account_masked ?? "—")}</span>
      </div>`,
    )
    .join("");
  const requestRows = input.requests
    .map(
      (request) => `<article class="money-request" data-request-id="${escapeAttr(request.id)}" data-status="${escapeAttr(request.status)}" id="money-request-${escapeAttr(request.id)}">
        <div class="money-request-main">
          <div class="money-request-amount">${escapeHtml(formatCny(request.amount_cny))}</div>
          <div class="money-request-info">
            <b>${escapeHtml(request.client)}</b>
            <span class="muted small">${escapeHtml(request.purpose)} · ${escapeHtml(MONEY_METHOD_LABELS[request.payment_method] ?? request.payment_method)}</span>
            <span class="mono small muted">${escapeHtml(request.id)} · ${escapeHtml(formatDateTime(request.created_at))}${request.paid_at === undefined ? "" : ` · 到账 ${escapeHtml(formatDateTime(request.paid_at))}`}</span>
          </div>
          <span class="money-status" data-status="${escapeAttr(request.status)}">${escapeHtml(MONEY_STATUS_LABELS[request.status] ?? request.status)}</span>
        </div>
        <div class="money-request-side">
          ${request.qr_url === undefined ? "" : `<img class="money-qr" id="money-qr-${escapeAttr(request.id)}" src="${escapeAttr(request.qr_url)}" alt="收款二维码占位（演示）" width="132" height="166" />`}
          <div class="money-request-actions">
            ${request.pay_url === undefined ? "" : `<a class="run-link" href="${escapeAttr(request.pay_url)}" id="money-link-${escapeAttr(request.id)}">${request.payment_method === "epay" ? "易支付跳转链接（demo）" : "收款链接（演示占位）"}</a>`}
            ${
              request.status === "pending"
                ? `<button class="primary" type="button" id="money-confirm-${escapeAttr(request.id)}" data-confirm-id="${escapeAttr(request.id)}">人工确认到账</button>`
                : ""
            }
            ${
              request.ledger_entry_id === undefined
                ? ""
                : `<span class="money-ledger" id="money-paid-ledger-${escapeAttr(request.id)}">已记入账本：<a href="/ledger" class="mono">${escapeHtml(request.ledger_entry_id)}</a></span>`
            }
            ${request.invoice_draft === undefined ? "" : `<span class="muted small" id="money-invoice-${escapeAttr(request.id)}">发票草稿：${escapeHtml(request.invoice_draft.type)}（${escapeHtml(request.invoice_draft.status)}，待人工开票）</span>`}
          </div>
        </div>
        ${request.note === undefined ? "" : `<p class="money-note muted small">${escapeHtml(request.note)}</p>`}
      </article>`,
    )
    .join("");
  const ledgerRows = input.ledgerIncome
    .slice(0, 5)
    .map(
      (entry) => `<li data-entry-id="${escapeAttr(entry.id)}"><span class="mono small">${escapeHtml(entry.id)}</span> · ${escapeHtml(entry.payee_or_payer)} · <b>${escapeHtml(formatCny(entry.amount_cny))}</b> · ${escapeHtml(entry.basis)}</li>`,
    )
    .join("");
  const methodOptions = MONEY_METHODS.map(
    (method) => `<option value="${method}" ${method === "personal_bank_card" ? "selected" : ""}>${escapeHtml(MONEY_METHOD_LABELS[method])}</option>`,
  ).join("");
  const content = `
${pageHeading("变现 / 收款", "收款账户与渠道 → 创建收款请求 → 收款链接/二维码 → 人工确认到账 → 账本收入")}
<div class="money-page" id="money-page">
<div class="alert alert-warn money-disclaimer" id="money-disclaimer">
  <b>为什么现在收不到钱？</b> 当前是<b>演示资金渠道</b>：未接真实支付（微信/支付宝/对公需商户号与回调），页面里的收款码/链接只是<b>占位</b>，不会真实扣款。
  之前的 <b>¥10 只是测试金额</b>，不是定价；金额可以自定（例如 ¥2,800 首期款）。三步走：① 配置收款账户/渠道 → ② 创建收款请求并让客户扫码/打开链接 → ③ 收到款后<b>人工确认到账</b>，系统再记入账本收入（接入真实支付后可自动确认）。
</div>
${input.epayConfig === undefined ? "" : renderEpaySettingsSection({ epay: input.epayConfig, scope: "money" })}
<div class="grid grid-2">
  <section class="panel" id="money-channels-panel">
    <h2>收款账户 / 渠道 <span class="hint">当前模式：${escapeHtml(input.mode)}</span></h2>
    <div class="money-channels" id="money-channels">${channels}</div>
    <p class="muted small">修改账户与渠道：<a href="/settings#payment-section" id="money-settings-link">配置中心 → 支付与银行卡</a>（只显示掩码，不存明文）。</p>
  </section>
  <section class="panel" id="money-create-panel">
    <h2>创建收款请求</h2>
    <form class="money-form" id="money-form" onsubmit="return false">
      <div class="form-grid">
        <label>金额（元）<input class="input input-num" type="number" min="0.01" step="0.01" id="money-amount" value="2800" /></label>
        <label>客户<input class="input" type="text" id="money-client" value="杭州示例科技有限公司" /></label>
        <label>渠道<select class="input" id="money-method">${methodOptions}</select></label>
      </div>
      <label>用途<input class="input" type="text" id="money-purpose" value="官网改版首期款" /></label>
      <button class="primary" type="submit" id="money-create">生成收款请求（含链接/二维码占位）</button>
      <p class="alert alert-error" id="money-error" hidden></p>
    </form>
  </section>
</div>
<section class="panel" id="money-requests-panel">
  <h2>收款请求 <span class="hint" id="money-requests-count">${String(input.requests.length)} 条</span></h2>
  <div class="money-requests" id="money-requests">${requestRows === "" ? '<p class="empty-state" id="money-empty">还没有收款请求</p>' : requestRows}</div>
</section>
<section class="panel" id="money-ledger-panel">
  <h2>最近入账（账本）<span class="hint">确认到账后写入收入</span></h2>
  <ul class="list-clean" id="money-ledger">${ledgerRows === "" ? '<li class="muted">暂无入账</li>' : ledgerRows}</ul>
</section>
</div>`;
  return renderShell(input.options, "变现", content);
}

export interface MoneyRequestPageInput {
  request: MoneyRequest;
  options: PageRenderOptions;
}

export function renderMoneyRequestPage(input: MoneyRequestPageInput): string {
  const request = input.request;
  const content = `
${pageHeading("收款请求", request.id)}
<div class="money-request-page" id="money-request-page">
  <section class="panel">
    <div class="money-request-page-head">
      <div>
        <div class="money-request-amount" id="money-request-amount">${escapeHtml(formatCny(request.amount_cny))}</div>
        <p><b>${escapeHtml(request.client)}</b> · ${escapeHtml(request.purpose)}</p>
        <p class="muted small">渠道：${escapeHtml(MONEY_METHOD_LABELS[request.payment_method] ?? request.payment_method)} · 状态：<span class="money-status" data-status="${escapeAttr(request.status)}" id="money-request-status">${escapeHtml(MONEY_STATUS_LABELS[request.status] ?? request.status)}</span></p>
      </div>
      ${request.qr_url === undefined ? "" : `<img class="money-qr-large" id="money-request-qr" src="${escapeAttr(request.qr_url)}" alt="收款二维码占位" width="220" height="254" />`}
    </div>
    <p class="alert alert-warn">这是<b>演示收款页</b>：二维码/链接为占位，未接真实支付，不会产生真实扣款。真实场景由商户渠道生成动态收款码与回调。</p>
    <p class="muted small">收款链接（演示占位）：<span class="mono">${escapeHtml(request.pay_url ?? "—")}</span> · 参考号：<span class="mono">${escapeHtml(request.payment_ref ?? "—")}</span></p>
    <p><a href="/money" class="run-link">← 返回变现页</a></p>
  </section>
</div>`;
  return renderShell(input.options, "收款请求", content);
}

// ---------------------------------------------------------------------------
// /settings 扩展：模型与 API 密钥 / 系统提示词
// ---------------------------------------------------------------------------

export interface ModelSettingsSectionInput {
  settings: ModelSettings;
  agentRoles: Array<{ role: string; title: string }>;
  mode: string;
}

export function renderModelSettingsSection(input: ModelSettingsSectionInput): string {
  const bindingMap = new Map(input.settings.agent_bindings.map((binding) => [binding.agent_role, binding]));
  const providerRows = input.settings.providers
    .map(
      (provider) => `<div class="model-provider" data-provider-id="${escapeAttr(provider.id)}" data-provider-kind="${escapeAttr(provider.kind)}" id="model-provider-${escapeAttr(provider.id)}">
        <div class="model-provider-main">
          <b>${escapeHtml(provider.name)}</b>
          <span class="badge status-idle">${escapeHtml(MODEL_PROVIDER_LABELS[provider.kind] ?? provider.kind)}</span>
          <label class="checkline"><input type="checkbox" id="model-${escapeAttr(provider.id)}-enabled" data-provider-enabled="${escapeAttr(provider.id)}" ${provider.enabled ? "checked" : ""} />启用</label>
        </div>
        <div class="model-provider-grid">
          <label>base_url<input class="input mono" type="text" id="model-${escapeAttr(provider.id)}-base-url" data-provider-base-url="${escapeAttr(provider.id)}" value="${escapeAttr(provider.base_url)}" /></label>
          <label>模型<input class="input mono" type="text" id="model-${escapeAttr(provider.id)}-model" data-provider-model="${escapeAttr(provider.id)}" value="${escapeAttr(provider.model)}" /></label>
          <label>密钥引用<input class="input mono" type="text" id="model-${escapeAttr(provider.id)}-key-ref" data-provider-key-ref="${escapeAttr(provider.id)}" value="${escapeAttr(provider.api_key_ref)}" placeholder="env:DEEPSEEK_API_KEY / keychain:name" /></label>
          <label>当前密钥<span class="model-key-masked mono" id="model-${escapeAttr(provider.id)}-key-masked" data-key-masked="${escapeAttr(provider.id)}">${escapeHtml(provider.api_key_masked)}</span></label>
        </div>
        ${provider.note === undefined ? "" : `<p class="muted small">${escapeHtml(provider.note)}</p>`}
      </div>`,
    )
    .join("");
  const bindingRows = input.agentRoles
    .map((agent) => {
      const binding = bindingMap.get(agent.role);
      const selected = binding?.provider_id ?? input.settings.default_provider_id;
      const options = input.settings.providers
        .map((provider) => `<option value="${escapeAttr(provider.id)}" ${provider.id === selected ? "selected" : ""}>${escapeHtml(provider.name)}</option>`)
        .join("");
      return `<tr class="model-binding" data-role="${escapeAttr(agent.role)}">
        <td><b>${escapeHtml(agent.title)}</b><span class="mono small muted"> ${escapeHtml(agent.role)}</span></td>
        <td><select class="input" id="model-bind-${escapeAttr(agent.role)}" data-agent-binding="${escapeAttr(agent.role)}">${options}</select></td>
        <td><input class="input mono" type="text" id="model-bind-${escapeAttr(agent.role)}-model" data-agent-model="${escapeAttr(agent.role)}" value="${escapeAttr(binding?.model ?? input.settings.providers[0]?.model ?? "")}" /></td>
      </tr>`;
    })
    .join("");
  const promptRows = input.settings.prompts
    .map(
      (prompt) => `<div class="prompt-editor${prompt.role === "conductor" ? " prompt-conductor" : ""}" data-prompt-id="${escapeAttr(prompt.id)}" id="prompt-editor-${escapeAttr(prompt.id)}">
        <div class="prompt-editor-head">
          <b>${escapeHtml(prompt.title)}</b>
          <span class="mono small muted">${escapeHtml(prompt.role)} · v${String(prompt.version)} · 更新 ${escapeHtml(formatDateTime(prompt.updated_at))}</span>
        </div>
        <textarea class="input prompt-textarea" id="prompt-${escapeAttr(prompt.role)}" data-prompt-editor="${escapeAttr(prompt.id)}" rows="${prompt.role === "conductor" ? "10" : "6"}">${escapeHtml(prompt.content)}</textarea>
      </div>`,
    )
    .join("");
  return `<section class="panel panel-models" id="models-section">
  <h2>模型与 API 密钥 <span class="hint">多 provider（DeepSeek / OpenAI 兼容 / 本地）；密钥只显示引用与掩码，不存明文</span></h2>
  <p class="alert alert-warn" id="models-mode-hint">当前模式：<b>${escapeHtml(input.mode)}</b>。个人/企业模式建议使用官方或自有网关；本地模型仅建议低风险任务。密钥从 <code>env:</code> 环境变量或 <code>keychain:</code> 读取，控制台只保存引用。</p>
  <div class="model-providers" id="model-providers">${providerRows}</div>
  <div class="models-actions">
    <button class="primary" type="button" id="models-save">保存模型配置</button>
    <button type="button" id="models-sync">一键同步密钥到所有功能</button>
    <span class="settings-feedback" id="models-feedback" role="status"></span>
    <span class="mono small muted" id="models-sync-status">同步状态：${input.settings.sync_status === "synced" ? `已同步（${escapeHtml(formatDateTime(input.settings.synced_at ?? ""))}）` : "未同步"}</span>
  </div>
  <h3>每个智能体的模型</h3>
  <table class="data-table" id="model-bindings">
    <thead><tr><th>智能体</th><th>Provider</th><th>模型</th></tr></thead>
    <tbody>${bindingRows}</tbody>
  </table>
  <p class="alert alert-error" id="models-error" hidden></p>
</section>

<section class="panel panel-prompts" id="prompts-section">
  <h2>系统提示词 <span class="hint">总调度可管理核心提示词；保存时校验长度与安全条款</span></h2>
  <p class="muted small" id="prompts-hint">总调度提示词必须包含安全条款「不绕过」；所有角色提示词至少 30 字符。保存会升版本号并写入配置审计。</p>
  <div class="prompt-editors" id="prompt-editors">${promptRows}</div>
  <div class="models-actions">
    <button class="primary" type="button" id="prompts-save">保存系统提示词</button>
    <span class="settings-feedback" id="prompts-feedback" role="status"></span>
  </div>
  <p class="alert alert-error" id="prompts-error" hidden></p>
</section>`;
}

/** 导入占位：避免未使用类型报错（noUnusedLocals 未开启，但保留说明）。 */
export type { ConsoleChatProvider } from "./chat.js";
