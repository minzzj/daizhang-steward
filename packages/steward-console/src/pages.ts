/**
 * packages/steward-console/src/pages.ts
 *
 * 服务端渲染的页面（原生 HTML，中文 UI，无第三方库、无外链资源）。
 * 数据由调用方（server.ts）从 ConsoleDataProvider 取得后传入；本文件不访问 provider，
 * 便于单测/替换。
 *
 * 页面与验收点对应：
 * - `/`            看板：项目卡（状态/进度/客户）、任务（按代理分组）、预算条（月/项目/单笔）、代理状态
 * - `/project/:id` 项目时间线 + 证据详情（路径/类型/置信度）
 * - `/ledger`      账本 + 详情抽屉 6 要素（B2）
 * - `/approvals`   审批卡 + 批准/驳回
 * - `/report`      月报（收入/成本/毛利/预算余量/合规事件/下月提案/as_of/coverage）
 * - `/takeover`    接管键 + halted + 6 类接管包 + 计时 + resume（B6）
 */

import type {
  ConsoleApproval,
  ConsoleBudget,
  ConsoleLedgerEntry,
  ConsoleMonthlyReport,
  ConsoleOverview,
  ConsoleProject,
  ConsoleTakeoverPack,
  ConsoleTakeoverStatus,
  ConsoleTimelineItem,
} from "./provider.js";

export type ConsolePageName =
  | "dashboard"
  | "chat"
  | "projects"
  | "project"
  | "ledger"
  | "approvals"
  | "report"
  | "takeover"
  | "money"
  | "agents"
  | "agent-role"
  | "backend"
  | "run"
  | "system"
  | "settings"
  | "data";

/** 顶部状态栏数据（由 server.ts 从 data + admin provider 汇总）。 */
export interface ShellStatus {
  /** demo / personal / enterprise */
  mode: string;
  modeLabel: string;
  budgetLeftCny: number;
  tokenRemaining: number;
  tokenLimit: number;
  halted: boolean;
  lastEventAt: string | null;
}

export interface PageRenderOptions {
  /** 写操作 token：通过 `<meta name="steward-token">` 注入页面，同源 JS 读取。 */
  token: string;
  active: ConsolePageName;
  halted: boolean;
  /** 顶部状态栏；缺省时降级为演示占位（保持旧调用兼容）。 */
  status?: ShellStatus;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

/** 人民币金额：¥12,345.60（服务端确定性实现，不依赖 Intl 语言包）。 */
export function formatCny(value: number): string {
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(Number(value) || 0).toFixed(2);
  const parts = fixed.split(".");
  const integer = parts[0] ?? "0";
  const decimals = parts[1] ?? "00";
  const withGroup = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}¥${withGroup}.${decimals}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/** ISO → 本地可读时间（YYYY-MM-DD HH:mm）。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return (
    `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function usagePercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return clampPercent((used / total) * 100);
}

function barClass(percent: number): string {
  if (percent >= 85) return "bar danger";
  if (percent >= 65) return "bar warn";
  return "bar";
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  at_risk: "有风险",
  done: "已完成",
  paused: "已暂停",
};

const STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  awaiting_approval: "等待审批",
  pending: "待批准",
  approved: "已批准",
  rejected: "已驳回",
};

const TIMELINE_KIND_LABELS: Record<string, string> = {
  message: "消息",
  task: "任务",
  evidence: "证据",
  delivery: "交付",
  risk: "风险",
};

const APPROVAL_KIND_LABELS: Record<string, string> = {
  purchase: "采购付款",
  outreach: "外发/触达",
  payment: "付款",
  contract: "合同",
  permission: "权限",
};

const COVERAGE_LABELS: Record<string, string> = {
  complete: "完整（complete）",
  partial: "部分覆盖（partial）",
  not_covered: "未覆盖（not_covered）",
};

function projectStatusBadge(status: string): string {
  return `<span class="badge status-${escapeAttr(status)}">${escapeHtml(PROJECT_STATUS_LABELS[status] ?? status)}</span>`;
}

function statusBadge(status: string): string {
  return `<span class="badge status-${escapeAttr(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>`;
}

// ---------------------------------------------------------------------------
// 页面骨架
// ---------------------------------------------------------------------------

interface NavItem {
  page: ConsolePageName;
  href: string;
  label: string;
  icon: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: "运营",
    items: [
      { page: "dashboard", href: "/", label: "总览", icon: "▦" },
      { page: "chat", href: "/chat", label: "对话", icon: "✉" },
      { page: "projects", href: "/projects", label: "项目", icon: "▤" },
      { page: "ledger", href: "/ledger", label: "账本", icon: "≡" },
      { page: "approvals", href: "/approvals", label: "审批", icon: "✓" },
      { page: "report", href: "/report", label: "月报", icon: "▥" },
      { page: "takeover", href: "/takeover", label: "接管", icon: "■" },
      { page: "money", href: "/money", label: "变现", icon: "￥" },
    ],
  },
  {
    title: "管理",
    items: [
      { page: "system", href: "/system", label: "系统", icon: "◉" },
      { page: "agents", href: "/agents", label: "智能体", icon: "◈" },
      { page: "backend", href: "/backend", label: "后台", icon: "▣" },
      { page: "settings", href: "/settings", label: "配置", icon: "⚙" },
      { page: "data", href: "/data", label: "数据", icon: "◫" },
    ],
  },
];

function renderNav(active: ConsolePageName): string {
  return NAV_GROUPS.map((group) => {
    const links = group.items
      .map((item) => {
        const className = item.page === active ? "nav-link active" : "nav-link";
        return `<a id="nav-${item.page}" class="${className}" href="${item.href}" data-nav="${item.page}"><span class="nav-icon" aria-hidden="true">${item.icon}</span>${item.label}</a>`;
      })
      .join("");
    return `<div class="nav-group"><div class="nav-group-title">${group.title}</div>${links}</div>`;
  }).join("");
}

function shortToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatClock(iso: string | null): string {
  if (iso === null || iso === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 专业版页面骨架（导出给 pages-admin.ts 复用）：
 * 左侧固定导航 + 顶部状态栏（运行模式 / 预算余量 / Token 余量 / 接管状态 / 最近事件）+ 内容区。
 */
export function renderShell(options: PageRenderOptions, title: string, content: string): string {
  const status: ShellStatus =
    options.status === undefined
      ? {
          mode: "demo",
          modeLabel: "体验模式",
          budgetLeftCny: 0,
          tokenRemaining: 0,
          tokenLimit: 0,
          halted: options.halted === true,
          lastEventAt: null,
        }
      : options.status;
  const haltedBanner =
    options.halted === true
      ? `<div class="halt-banner" id="halt-banner" role="alert">⚠ 已接管停止（halted=true）：新动作已冻结，等待人工处理。<a href="/takeover">查看接管包</a></div>`
      : "";
  const haltedChipClass = status.halted ? "status-chip halted" : "status-chip";
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="steward-token" content="${escapeAttr(options.token)}" />
    <title>${escapeHtml(title)} · 代掌 Steward 本地控制台</title>
    <link rel="stylesheet" href="/assets/app.css" />
    <link rel="stylesheet" href="/assets/pro.css" />
    <link rel="stylesheet" href="/assets/chat.css" />
    <link rel="stylesheet" href="/assets/system.css" />
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <span class="brand-name">代掌 Steward</span>
          <span class="brand-sub">LOCAL CONSOLE · v1.3</span>
        </div>
        <nav class="sidebar-nav" id="sidebar-nav" aria-label="主导航">${renderNav(options.active)}</nav>
        <div class="sidebar-footer">
          <span class="local-badge" id="local-mode-badge">只监听 127.0.0.1 · 本地模式</span>
          <span class="safety-note">写操作需 X-Steward-Token · 无 CDN/外链 · 数据仅本机</span>
        </div>
      </aside>
      <div class="app-main">
        <header class="topbar" id="topbar">
          <span class="topbar-title">本地控制台</span>
          <span class="topbar-context" id="page-context">${escapeHtml(title)}</span>
          <div class="topbar-status">
            <span class="mode-badge mode-${escapeAttr(status.mode)}" id="status-mode">${escapeHtml(status.modeLabel)}</span>
            <span class="status-chip">预算余量 <b id="status-budget">${escapeHtml(formatCny(status.budgetLeftCny))}</b></span>
            <span class="status-chip">Token <b id="status-token">${escapeHtml(shortToken(status.tokenRemaining))}</b> / ${escapeHtml(shortToken(status.tokenLimit))}</span>
            <span class="${haltedChipClass}" id="status-halted-chip"><span class="dot"></span><b id="status-halted">${status.halted ? "已接管停止" : "运行中"}</b></span>
            <span class="status-chip">最近事件 <b id="status-last-event">${escapeHtml(formatClock(status.lastEventAt))}</b></span>
          </div>
        </header>
        ${haltedBanner}
        <main>
${content}
        </main>
        <footer class="site-footer">
          <p>安全边界：只监听 <code>127.0.0.1</code> · 本地单机 · 写操作需 <code>X-Steward-Token</code> · 无 CDN / 无外链 / 无第三方脚本。</p>
          <p>数据来源：<code>ConsoleDataProvider</code> + <code>ConsoleAdminProvider</code> + <code>ConsoleChatProvider</code> + <code>ConsoleSystemProvider</code>（内置演示实现；真实 ConfigEngine/Orchestrator/MoneyEngine 接入后持久化）。存活探测：<a href="/health">/health</a></p>
        </footer>
      </div>
    </div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <script src="/assets/app.js" defer></script>
    <script src="/assets/admin.js" defer></script>
    <script src="/assets/chat.js" defer></script>
    <script src="/assets/system.js" defer></script>
  </body>
</html>`;
}

function renderPageTitle(title: string, asOf: string | null, hint?: string): string {
  const asOfText = asOf === null ? "" : `<span class="as-of">as_of：${escapeHtml(formatDateTime(asOf))}</span>`;
  const hintText = hint === undefined ? "" : `<span class="muted small">${escapeHtml(hint)}</span>`;
  return `<div class="page-title"><h1>${escapeHtml(title)}</h1>${hintText}${asOfText}</div>`;
}

// ---------------------------------------------------------------------------
// 看板
// ---------------------------------------------------------------------------

function renderBudgetCards(budget: ConsoleBudget, maxSingleCostCny: number): string {
  const monthPercent = usagePercent(budget.spent_cny, budget.month_cny);
  const projectBudget = budget.project_budget;
  const projectPercent =
    projectBudget === undefined ? 0 : usagePercent(projectBudget.spent_cny, projectBudget.month_cny);
  const txnPercent = usagePercent(maxSingleCostCny, budget.per_txn_cny);
  const overTxnLimit = maxSingleCostCny > budget.per_txn_cny;

  const projectCard =
    projectBudget === undefined
      ? `<div class="budget-card" id="budget-project" data-limit-cny="0" data-used-cny="0">
          <div class="budget-head"><span>项目预算</span><strong class="muted">未配置项目级预算</strong></div>
          <div class="bar"><span style="width:0%"></span></div>
        </div>`
      : `<div class="budget-card" id="budget-project" data-limit-cny="${projectBudget.month_cny}" data-used-cny="${projectBudget.spent_cny}">
          <div class="budget-head"><span>项目预算（本月项目支出）</span><strong>已用 ${formatCny(projectBudget.spent_cny)} / ${formatCny(projectBudget.month_cny)}（剩 ${formatCny(projectBudget.left_cny)}）</strong></div>
          <div class="${barClass(projectPercent)}"><span style="width:${String(projectPercent)}%"></span></div>
        </div>`;

  return `<div class="budget-card" id="budget-month" data-limit-cny="${budget.month_cny}" data-used-cny="${budget.spent_cny}">
      <div class="budget-head"><span>月度预算</span><strong>已用 ${formatCny(budget.spent_cny)} / ${formatCny(budget.month_cny)}（剩 ${formatCny(budget.left_cny)}）</strong></div>
      <div class="${barClass(monthPercent)}"><span style="width:${String(monthPercent)}%"></span></div>
    </div>
    ${projectCard}
    <div class="budget-card" id="budget-txn" data-limit-cny="${budget.per_txn_cny}" data-max-single-cny="${maxSingleCostCny}">
      <div class="budget-head"><span>单笔上限</span><strong>上限 ${formatCny(budget.per_txn_cny)} · 本月最大单笔 ${formatCny(maxSingleCostCny)}${overTxnLimit ? "（已超限，需审批）" : ""}</strong></div>
      <div class="${barClass(txnPercent)}"><span style="width:${String(txnPercent)}%"></span></div>
    </div>`;
}

function renderProjectCard(project: ConsoleProject): string {
  return `<article class="panel project-card" data-project-id="${escapeAttr(project.id)}" data-project-status="${escapeAttr(project.status)}">
      <div class="project-top">
        <span class="project-name">${escapeHtml(project.name)}</span>
        ${projectStatusBadge(project.status)}
      </div>
      <div class="project-client">客户：${escapeHtml(project.client)}</div>
      <div class="project-meta"><span>进度 ${String(clampPercent(project.progress))}%</span><span class="mono small">${escapeHtml(project.id)}</span></div>
      <div class="bar"><span style="width:${String(clampPercent(project.progress))}%"></span></div>
      <a class="project-link" href="/project/${encodeURIComponent(project.id)}" data-project-link="${escapeAttr(project.id)}">查看项目时间线 →</a>
    </article>`;
}

function renderTaskGroups(overview: ConsoleOverview): string {
  const roles: string[] = [];
  for (const task of overview.tasks) {
    if (!roles.includes(task.agent_role)) roles.push(task.agent_role);
  }
  if (roles.length === 0) return `<p class="empty-state">暂无任务</p>`;
  const groupHtml = roles
    .map((role) => {
      const tasks = overview.tasks.filter((task) => task.agent_role === role);
      const rows = tasks
        .map(
          (task) => `<div class="task-row" data-task-id="${escapeAttr(task.id)}" data-task-status="${escapeAttr(task.status)}">
              <span class="task-goal">${escapeHtml(task.goal)}</span>
              ${statusBadge(task.status)}
              <code>${escapeHtml(task.project_id)}</code>
            </div>`,
        )
        .join("");
      return `<div class="task-group" data-agent-role="${escapeAttr(role)}">
          <h3>${escapeHtml(role)} <span class="badge status-running">${String(tasks.length)} 项</span></h3>
          ${rows}
        </div>`;
    })
    .join("");
  return groupHtml;
}

function summarizeL0(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const record = value as { one_liner?: unknown; level?: unknown };
    if (typeof record.one_liner === "string") return record.one_liner;
    return JSON.stringify(value);
  }
  return String(value);
}

export interface DashboardPageInput {
  overview: ConsoleOverview;
  summaryL0: unknown;
  ledger: ConsoleLedgerEntry[];
  options: PageRenderOptions;
}

export function renderDashboardPage(input: DashboardPageInput): string {
  const { overview, options } = input;
  const maxSingleCostCny = input.ledger
    .filter((entry) => entry.type === "支出")
    .reduce((max, entry) => Math.max(max, entry.amount_cny), 0);

  const agents = overview.agents
    .map(
      (agent) => `<div class="agent-row" data-agent-role="${escapeAttr(agent.role)}">
          <span class="agent-role">${escapeHtml(agent.role)}</span>
          ${statusBadge(agent.status)}
        </div>`,
    )
    .join("");

  const content = `
${renderPageTitle("看板", overview.asOf, "项目 / 任务 / 预算 / 代理状态（运营页演示数据；真实配置/智能体/后台请用左侧管理导航）")}
<div class="grid grid-2">
  <section class="panel">
    <h2>预算条 <span class="hint">月 / 项目 / 单笔</span></h2>
    ${renderBudgetCards(overview.budget, maxSingleCostCny)}
    <p class="muted small">预算余量 ${formatCny(overview.budget.left_cny)}；超出单笔上限的出款必须走审批卡。</p>
  </section>
  <section class="panel" id="agent-status-panel">
    <h2>代理状态 <span class="hint">按角色</span></h2>
    <div id="agent-status">${agents === "" ? '<p class="empty-state">暂无代理</p>' : agents}</div>
    <h2 style="margin-top:16px">L0 摘要 <span class="hint">provider.summary("L0")</span></h2>
    <p class="summary-line" id="summary-l0">${escapeHtml(summarizeL0(input.summaryL0))}</p>
  </section>
</div>

<div class="page-title" style="margin-top:20px"><h1>项目</h1><span class="muted small">${String(overview.projects.length)} 个项目</span></div>
<section class="grid grid-3" id="project-cards">
  ${overview.projects.map(renderProjectCard).join("")}
</section>

<section class="panel" style="margin-top:16px" id="task-panel">
  <h2>任务列表 <span class="hint" id="task-total">共 ${String(overview.tasks.length)} 个任务</span></h2>
  <div id="task-board">${renderTaskGroups(overview)}</div>
</section>
`;
  return renderShell(options, "看板", content);
}

// ---------------------------------------------------------------------------
// 项目时间线
// ---------------------------------------------------------------------------

export interface ProjectPageInput {
  project: ConsoleProject;
  timeline: ConsoleTimelineItem[];
  options: PageRenderOptions;
}

export function renderProjectPage(input: ProjectPageInput): string {
  const { project, timeline, options } = input;
  const items = timeline
    .map((item) => {
      const evidenceButton =
        item.evidence_ref === undefined
          ? ""
          : `<div><button class="evidence-link" type="button" data-evidence-ref="${escapeAttr(item.evidence_ref)}">查看证据 ${escapeHtml(item.evidence_ref)}</button></div>`;
      return `<li class="timeline-item">
          <div class="timeline-meta">
            <span class="mono">${escapeHtml(formatDateTime(item.ts))}</span>
            <span class="timeline-kind">${escapeHtml(TIMELINE_KIND_LABELS[item.kind] ?? item.kind)}</span>
            <span class="mono small">${escapeHtml(item.kind)}</span>
          </div>
          <div class="timeline-text">${escapeHtml(item.text)}</div>
          ${evidenceButton}
        </li>`;
    })
    .join("");

  const content = `
<div class="page-title">
  <h1 id="project-title">${escapeHtml(project.name)}</h1>
  ${projectStatusBadge(project.status)}
  <span class="muted small">客户：${escapeHtml(project.client)}</span>
  <span class="as-of"><a href="/">← 返回看板</a></span>
</div>
<section class="panel" id="project-progress-panel">
  <h2>进度 <span class="hint">${String(clampPercent(project.progress))}%</span></h2>
  <div class="bar"><span style="width:${String(clampPercent(project.progress))}%"></span></div>
  <p class="muted small">项目 ID：<code>${escapeHtml(project.id)}</code> · 时间线 ${String(timeline.length)} 条</p>
</section>

<section class="panel" style="margin-top:16px" id="timeline-panel">
  <h2>项目时间线 <span class="hint">消息 / 任务 / 交付证据（点开证据查看路径/类型/置信度）</span></h2>
  <ul class="timeline" id="project-timeline">
    ${items === "" ? '<li class="empty-state">暂无时间线</li>' : items}
  </ul>
  <section class="evidence-detail" id="evidence-detail" data-evidence-ready="false" hidden>
    <h2 style="margin:0 0 10px;font-size:14px">证据详情</h2>
    <dl>
      <dt>证据</dt><dd id="evidence-ref">—</dd>
      <dt>路径</dt><dd id="evidence-path">—</dd>
      <dt>类型</dt><dd id="evidence-type">—</dd>
      <dt>置信度</dt><dd id="evidence-confidence">—</dd>
      <dt>采集时间</dt><dd id="evidence-captured-at">—</dd>
    </dl>
  </section>
</section>
`;
  return renderShell(options, project.name, content);
}

// ---------------------------------------------------------------------------
// 账本
// ---------------------------------------------------------------------------

export interface LedgerPageInput {
  entries: ConsoleLedgerEntry[];
  projects: ConsoleProject[];
  options: PageRenderOptions;
}

export function renderLedgerPage(input: LedgerPageInput): string {
  const projectName = (projectId: string): string => {
    const found = input.projects.find((project) => project.id === projectId);
    return found === undefined ? projectId : `${found.name}`;
  };
  const rows = input.entries
    .map((entry) => {
      const amountClass = entry.type === "收入" ? "amount income" : "amount cost";
      const sign = entry.type === "收入" ? "+" : "-";
      return `<tr tabindex="0" data-entry-id="${escapeAttr(entry.id)}" data-project-id="${escapeAttr(entry.project_id)}" data-project-name="${escapeAttr(projectName(entry.project_id))}">
          <td class="mono">${escapeHtml(formatDateTime(entry.occurred_at))}</td>
          <td>${escapeHtml(projectName(entry.project_id))}</td>
          <td><span class="badge">${escapeHtml(entry.type)}</span></td>
          <td class="${amountClass}">${escapeHtml(sign + formatCny(entry.amount_cny))}</td>
          <td>${escapeHtml(entry.payee_or_payer)}</td>
          <td>${escapeHtml(entry.approved_by)}</td>
        </tr>`;
    })
    .join("");

  const content = `
${renderPageTitle("账本", null, `共 ${String(input.entries.length)} 笔；点击任意一笔查看 6 要素（B2 验收点）`)}
<section class="panel">
  <h2>收支明细 <span class="hint">金额 / 收付方 / 依据 / 审批人 / 回执 / 所属项目</span></h2>
  <table class="data-table" id="ledger-table">
    <thead>
      <tr><th>时间</th><th>项目</th><th>类型</th><th style="text-align:right">金额</th><th>收付方</th><th>审批人</th></tr>
    </thead>
    <tbody>${rows === "" ? '<tr><td colspan="6" class="empty-state">暂无账本记录</td></tr>' : rows}</tbody>
  </table>
</section>

<aside class="drawer" id="ledger-drawer" data-facts-ready="false" hidden aria-label="账本详情">
  <div class="drawer-head">
    <h2>账本详情（6 要素）</h2>
    <button type="button" id="drawer-close">关闭</button>
  </div>
  <dl>
    <dt>金额</dt><dd class="strong" id="facts-amount" data-fact="amount_cny">—</dd>
    <dt>收付方</dt><dd id="facts-payee" data-fact="payee_or_payer">—</dd>
    <dt>依据</dt><dd id="facts-basis" data-fact="basis">—</dd>
    <dt>审批人</dt><dd id="facts-approver" data-fact="approved_by">—</dd>
    <dt>回执</dt><dd id="facts-receipt" data-fact="receipt_ref">—</dd>
    <dt>所属项目</dt><dd id="facts-project" data-fact="project_id">—</dd>
  </dl>
  <p class="drawer-hint">B2：一笔支出 30 秒看到 6 要素。字段只读，写操作需走审批卡。</p>
</aside>
`;
  return renderShell(input.options, "账本", content);
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

export interface ApprovalsPageInput {
  approvals: ConsoleApproval[];
  options: PageRenderOptions;
}

function renderApprovalCard(approval: ConsoleApproval): string {
  const pending = approval.status === "pending";
  const amountHtml =
    approval.amount_cny === undefined
      ? `<span class="muted">金额：—（非付款类）</span>`
      : `<span>金额：<strong>${escapeHtml(formatCny(approval.amount_cny))}</strong></span>`;
  const evidence = approval.evidence_ids
    .map((id) => `<code>${escapeHtml(id)}</code>`)
    .join(" ");
  const expires = new Date(approval.expires_at).getTime();
  const remainingMs = Number.isNaN(expires) ? 0 : expires - Date.now();
  const countdownText = remainingMs > 0 ? `剩余 ${formatDurationText(remainingMs)}` : "已过期";
  return `<article class="panel approval-card" data-approval-id="${escapeAttr(approval.id)}" data-approval-status="${escapeAttr(approval.status)}">
      <div class="approval-head">
        <span class="approval-kind">${escapeHtml(APPROVAL_KIND_LABELS[approval.kind] ?? approval.kind)}</span>
        <span class="badge status-${escapeAttr(approval.status)}" data-status="${escapeAttr(approval.status)}">${escapeHtml(STATUS_LABELS[approval.status] ?? approval.status)}</span>
        <span class="mono small muted" style="margin-left:auto">${escapeHtml(approval.id)}</span>
      </div>
      <div class="approval-summary">${escapeHtml(approval.summary)}</div>
      <div class="approval-meta">
        ${amountHtml}
        <span class="muted" data-countdown data-expires-at="${escapeAttr(approval.expires_at)}">到期：${escapeHtml(formatDateTime(approval.expires_at))}（${escapeHtml(countdownText)}）</span>
      </div>
      <div class="approval-evidence">证据：${evidence === "" ? "—" : evidence}</div>
      <div class="approval-actions">
        <button class="primary" type="button" data-decision="approve" ${pending ? "" : "disabled"}>批准</button>
        <button class="danger" type="button" data-decision="reject" ${pending ? "" : "disabled"}>驳回</button>
      </div>
    </article>`;
}

function formatDurationText(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

export function renderApprovalsPage(input: ApprovalsPageInput): string {
  const pending = input.approvals.filter((approval) => approval.status === "pending").length;
  const cards = input.approvals.map(renderApprovalCard).join("");
  const content = `
${renderPageTitle("审批队列", null, `待批准 ${String(pending)} 张；未批准不得自动放行`)}
<section class="grid grid-2" id="approval-cards">
  ${cards === "" ? '<p class="empty-state">暂无审批卡</p>' : cards}
</section>
<p class="muted small" style="margin-top:12px">批准/驳回会写入内存状态（仿真 provider），页面即时更新；真实 domain 接入后由审批队列实体化落库。</p>
`;
  return renderShell(input.options, "审批队列", content);
}

// ---------------------------------------------------------------------------
// 月报
// ---------------------------------------------------------------------------

export interface ReportPageInput {
  report: ConsoleMonthlyReport;
  options: PageRenderOptions;
}

export function renderReportPage(input: ReportPageInput): string {
  const { report } = input;
  const compliance = report.compliance_events.map((event) => `<li>${escapeHtml(event)}</li>`).join("");
  const proposals = report.next_proposals.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const content = `
${renderPageTitle(`月度报告 · ${report.month}`, report.as_of, `覆盖度：${COVERAGE_LABELS[report.coverage] ?? report.coverage}`)}
<section class="metric-grid">
  <div class="metric income"><div class="metric-label">收入（income_cny）</div><div class="metric-value" id="report-income">${escapeHtml(formatCny(report.income_cny))}</div><div class="metric-note">本月已确认收入</div></div>
  <div class="metric cost"><div class="metric-label">成本（cost_cny）</div><div class="metric-value" id="report-cost">${escapeHtml(formatCny(report.cost_cny))}</div><div class="metric-note">本月已发生成本</div></div>
  <div class="metric margin"><div class="metric-label">毛利（gross_margin_cny）</div><div class="metric-value" id="report-margin">${escapeHtml(formatCny(report.gross_margin_cny))}</div><div class="metric-note">收入 - 成本</div></div>
  <div class="metric"><div class="metric-label">预算余量（budget_left_cny）</div><div class="metric-value" id="report-budget-left">${escapeHtml(formatCny(report.budget_left_cny))}</div><div class="metric-note">月度预算剩余</div></div>
</section>

<div class="grid grid-2" style="margin-top:16px">
  <section class="panel" id="compliance-panel">
    <h2>合规事件 <span class="hint">本月</span></h2>
    <ul class="list-clean" id="compliance-events">${compliance === "" ? "<li>无</li>" : compliance}</ul>
  </section>
  <section class="panel" id="proposals-panel">
    <h2>下月提案 <span class="hint">建议，不自动执行</span></h2>
    <ul class="list-clean" id="next-proposals">${proposals === "" ? "<li>无</li>" : proposals}</ul>
  </section>
</div>

<section class="panel" style="margin-top:16px">
  <h2>元信息</h2>
  <p class="muted small">as_of：<span id="report-as-of" class="mono">${escapeHtml(formatDateTime(report.as_of))}</span> · coverage：<span id="report-coverage">${escapeHtml(COVERAGE_LABELS[report.coverage] ?? report.coverage)}</span> · month：<span class="mono" id="report-month">${escapeHtml(report.month)}</span></p>
  <p class="muted small">月报只汇总证据齐全的账本与审批记录；coverage 非 complete 时不得对外作为承诺依据。</p>
</section>
`;
  return renderShell(input.options, `月度报告 ${report.month}`, content);
}

// ---------------------------------------------------------------------------
// 接管
// ---------------------------------------------------------------------------

export interface TakeoverPageInput {
  status: ConsoleTakeoverStatus;
  options: PageRenderOptions;
}

function renderPackSection(title: string, field: string, items: readonly string[]): string {
  const list =
    items.length === 0
      ? '<li class="muted">（空）</li>'
      : items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<div class="pack"><h3>${escapeHtml(title)}</h3><ul id="pack-${field}" data-pack-field="${field}">${list}</ul></div>`;
}

function packValues(pack: ConsoleTakeoverPack | null, field: keyof ConsoleTakeoverPack): string[] {
  if (pack === null) return [];
  const value = pack[field];
  return Array.isArray(value) ? value : [];
}

export function renderTakeoverPage(input: TakeoverPageInput): string {
  const { status, options } = input;
  const halted = status.halted === true;
  const pack = status.pack;
  const stoppedAt = status.stopped_at;
  const elapsedText = formatDurationText(status.elapsed_ms);
  const resumedNote =
    status.resumed_at === null
      ? ""
      : `已于 ${formatDateTime(status.resumed_at)} 恢复运行（halted=false）`;

  const content = `
${renderPageTitle("接管键", null, "≤10 秒停止所有新动作 + 生成 6 类接管包（B6）")}

<section class="panel takeover-idle" id="takeover-idle" ${halted ? "hidden" : ""}>
  <h2>一键接管（停止并交人）</h2>
  <p>点击后立即停止所有分支的新动作，并生成接管包：开放订单 / 待处理对话 / 应付款 / 凭据引用 / 风险 / 覆盖度。停止过程不允许绕过任何风控或审批。</p>
  <button class="big danger" type="button" id="takeover-trigger">立即接管停止</button>
  <p class="muted small" id="takeover-resumed-note">${escapeHtml(resumedNote)}</p>
</section>

<section class="takeover-state" id="takeover-state" data-halted="${halted ? "true" : "false"}" data-stopped-at="${escapeAttr(stoppedAt ?? "")}" data-resumed-at="${escapeAttr(status.resumed_at ?? "")}">
  <div id="takeover-halted" ${halted ? "" : "hidden"}>
    <div class="state-head">
      <h2>已接管停止（halted=true）</h2>
      <span class="badge status-rejected">已冻结新动作</span>
      <span class="timer" id="takeover-timer">已停止 ${escapeHtml(elapsedText)}</span>
    </div>
    <p class="muted small">接管时间：<span class="mono" id="takeover-stopped-at">${escapeHtml(formatDateTime(stoppedAt))}</span> · <span id="takeover-measured">等待实测停止耗时</span></p>
    <div class="pack-grid">
      ${renderPackSection("开放订单（open_orders）", "open_orders", packValues(pack, "open_orders"))}
      ${renderPackSection("待处理对话（pending_threads）", "pending_threads", packValues(pack, "pending_threads"))}
      ${renderPackSection("应付款（payables）", "payables", packValues(pack, "payables"))}
      ${renderPackSection("凭据引用（credentials，禁止明文）", "credentials", packValues(pack, "credentials"))}
      ${renderPackSection("风险（risks）", "risks", packValues(pack, "risks"))}
      <div class="pack coverage">
        <h3>覆盖度（coverage）</h3>
        <div class="coverage-value" id="pack-coverage">${escapeHtml(COVERAGE_LABELS[pack?.coverage ?? "not_covered"] ?? String(pack?.coverage ?? "not_covered"))}</div>
        <p class="muted small">partial 表示接管包未覆盖全部上下文，需人工补齐后再恢复。</p>
      </div>
    </div>
    <p style="margin-top:16px"><button class="primary" type="button" id="takeover-resume">恢复运行（resume）</button></p>
  </div>
  <p class="muted small" id="takeover-idle-hint" ${halted ? "hidden" : ""}>当前未接管（halted=false）。点击上方大按钮触发接管。</p>
</section>
`;
  return renderShell(options, "接管键", content);
}

// ---------------------------------------------------------------------------
// 错误页
// ---------------------------------------------------------------------------

export function renderErrorPage(options: PageRenderOptions, statusCode: number, title: string, message: string): string {
  const content = `
<section class="error-page" id="error-page" data-status-code="${String(statusCode)}">
  <h1>${String(statusCode)}</h1>
  <h2>${escapeHtml(title)}</h2>
  <p class="muted">${escapeHtml(message)}</p>
  <p><a href="/">← 返回看板</a></p>
</section>
`;
  return renderShell(options, `${String(statusCode)} ${title}`, content);
}
