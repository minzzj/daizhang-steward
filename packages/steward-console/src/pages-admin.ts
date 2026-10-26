/**
 * packages/steward-console/src/pages-admin.ts
 *
 * 专业版新增页面：项目列表 / 配置中心 / 智能体中心 / 后台 / 数据管理。
 * 复用 pages.ts 的骨架与格式化工具；数据由 server.ts 从 admin provider 取得后传入。
 */

import {
  escapeHtml,
  formatCny,
  formatDateTime,
  renderShell,
  type PageRenderOptions,
} from "./pages.js";
import {
  AGENT_AUTONOMY_LABELS,
  FEATURE_LABELS,
  FEATURE_ORDER,
  INVOICE_TYPE_LABELS,
  PAYMENT_KIND_LABELS,
  RUN_MODE_LABELS,
  RUN_MODE_SUMMARIES,
  type AdminStatus,
  type AgentAutonomy,
  type ConsoleAgentInfo,
  type DataStats,
  type FeatureName,
  type FlowRun,
  type ModeApplyResult,
  type PaymentsConfig,
  type QueueItem,
  type RunMode,
  type StewardConfig,
  type TokenBudgetConfig,
} from "./admin.js";
import type { ConsoleProject } from "./provider.js";

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

function money(value: number): string {
  return formatCny(value);
}

function featureToggleId(name: FeatureName, part: "enabled" | "approval" | "note"): string {
  return `feature-${name}-${part}`;
}

function isPersonalChannel(kind: string): boolean {
  return kind === "wechat_pay" || kind === "alipay" || kind === "personal_bank_card";
}

// ---------------------------------------------------------------------------
// 项目列表
// ---------------------------------------------------------------------------

export interface ProjectsPageInput {
  projects: ConsoleProject[];
  options: PageRenderOptions;
}

export function renderProjectsPage(input: ProjectsPageInput): string {
  const rows = input.projects
    .map(
      (project) => `<tr data-project-row="${escapeAttr(project.id)}">
          <td><a href="/project/${encodeURIComponent(project.id)}">${escapeHtml(project.name)}</a></td>
          <td>${escapeHtml(project.client)}</td>
          <td><span class="badge status-${escapeAttr(project.status)}">${escapeHtml(project.status)}</span></td>
          <td class="num">${String(project.progress)}%</td>
          <td class="mono small">${escapeHtml(project.id)}</td>
        </tr>`,
    )
    .join("");
  const content = `
${pageHeading("项目", `${String(input.projects.length)} 个项目 · 点击进入项目时间线与证据`)}
<section class="panel">
  <table class="data-table" id="projects-table">
    <thead><tr><th>项目</th><th>客户</th><th>状态</th><th style="text-align:right">进度</th><th>ID</th></tr></thead>
    <tbody>${rows === "" ? '<tr><td colspan="5" class="empty-state">暂无项目</td></tr>' : rows}</tbody>
  </table>
</section>`;
  return renderShell(input.options, "项目", content);
}

function pageHeading(title: string, hint?: string): string {
  const hintText = hint === undefined ? "" : `<span class="muted small">${escapeHtml(hint)}</span>`;
  return `<div class="page-title"><h1>${escapeHtml(title)}</h1>${hintText}</div>`;
}

// ---------------------------------------------------------------------------
// 配置中心 /settings
// ---------------------------------------------------------------------------

export interface SettingsPageInput {
  config: StewardConfig;
  status: AdminStatus;
  modeResult?: ModeApplyResult | null;
  options: PageRenderOptions;
}

function renderModeCards(current: RunMode): string {
  const modes: RunMode[] = ["demo", "personal", "enterprise"];
  return modes
    .map((mode) => {
      const selected = mode === current;
      return `<label class="mode-card${selected ? " selected" : ""}" id="mode-card-${mode}" data-mode="${mode}">
        <input type="radio" name="run-mode" value="${mode}" ${selected ? "checked" : ""} />
        <span class="mode-card-head">
          <span class="mode-card-name">${escapeHtml(RUN_MODE_LABELS[mode])}</span>
          <span class="mode-card-tag">${mode === "demo" ? "免资金 / 可演示" : mode === "personal" ? "个人收款" : "对公 + 双人复核"}</span>
        </span>
        <span class="mode-card-desc">${escapeHtml(RUN_MODE_SUMMARIES[mode])}</span>
        <span class="mode-card-state">${selected ? "✓ 当前模式" : "点击选择"}</span>
      </label>`;
    })
    .join("");
}

function renderModeDiff(result: ModeApplyResult | null | undefined): string {
  if (result === null || result === undefined) return "";
  if (!result.ok) {
    return `<div class="alert alert-error" id="mode-diff">切换失败：${escapeHtml(result.errors.join("；"))}</div>`;
  }
  return `<div class="alert alert-ok" id="mode-diff">已应用「${escapeHtml(RUN_MODE_LABELS[result.mode])}」默认配置：${escapeHtml(result.diff.join("；") || "无差异")}</div>`;
}

function renderFeatureRows(config: StewardConfig): string {
  return FEATURE_ORDER.map((name) => {
    const feature = config.features[name];
    return `<div class="feature-row${feature.enabled ? "" : " off"}" data-feature="${name}" id="feature-row-${name}">
      <div class="feature-name">${escapeHtml(FEATURE_LABELS[name])}<span class="mono small muted">${name}</span></div>
      <label class="switch"><input type="checkbox" id="${featureToggleId(name, "enabled")}" data-feature-enabled="${name}" ${feature.enabled ? "checked" : ""} /><span class="switch-ui"></span></label>
      <label class="checkline"><input type="checkbox" id="${featureToggleId(name, "approval")}" data-feature-approval="${name}" ${feature.requires_approval ? "checked" : ""} />需审批</label>
      <input class="input" type="text" id="${featureToggleId(name, "note")}" data-feature-note="${name}" placeholder="禁用原因 / 备注（可选）" value="${escapeAttr(feature.note ?? "")}" />
      <span class="feature-badge ${feature.enabled ? "on" : "off"}">${feature.enabled ? "已启用" : "已禁用"}</span>
    </div>`;
  }).join("");
}

function renderPaymentChannels(payments: PaymentsConfig): string {
  return payments.providers
    .map((provider) => {
      const personal = isPersonalChannel(provider.kind);
      return `<div class="pay-channel${provider.enabled ? "" : " off"}" data-kind="${escapeAttr(provider.kind)}" id="pay-channel-${escapeAttr(provider.kind)}">
        <div class="pay-channel-main">
          <span class="pay-channel-name">${escapeHtml(PAYMENT_KIND_LABELS[provider.kind] ?? provider.name)}</span>
          <span class="mono small muted">${escapeHtml(provider.name)}</span>
          <div class="pay-channel-account">账户：<span class="mono" id="pay-${escapeAttr(provider.kind)}-account">${escapeHtml(provider.account_masked)}</span></div>
        </div>
        <label class="checkline"><input type="checkbox" id="pay-${escapeAttr(provider.kind)}-enabled" data-pay-enabled="${escapeAttr(provider.kind)}" ${provider.enabled ? "checked" : ""} />启用</label>
        <span class="badge ${provider.mode === "manual_approval" ? "status-approved" : provider.mode === "auto" ? "status-pending" : "status-idle"}" id="pay-${escapeAttr(provider.kind)}-mode">${provider.mode === "manual_approval" ? "仅人工审批" : provider.mode === "auto" ? "自动（不允许）" : "禁用"}</span>
        ${personal ? '<span class="pay-tag">个人渠道</span>' : '<span class="pay-tag pay-tag-corp">企业渠道</span>'}
      </div>`;
    })
    .join("");
}

function renderPayoutAccount(payments: PaymentsConfig): string {
  const account = payments.payout_account;
  return `<div class="payout-grid" id="payout-account">
    <div><span class="muted small">户名</span><strong>${escapeHtml(account.holder)}</strong></div>
    <div><span class="muted small">类型</span><strong>${account.type === "personal" ? "个人账户" : "企业对公账户"}</strong></div>
    <div><span class="muted small">开户行</span><strong>${escapeHtml(account.bank_name)}</strong></div>
    <div><span class="muted small">银行卡号（掩码）</span><strong class="mono">${escapeHtml(account.card_no_masked)}</strong></div>
    <div><span class="muted small">微信 ID（掩码）</span><strong class="mono">${escapeHtml(account.wechat_id_masked ?? "—")}</strong></div>
    <div><span class="muted small">支付宝（掩码）</span><strong class="mono">${escapeHtml(account.alipay_id_masked ?? "—")}</strong></div>
  </div>`;
}

export function renderSettingsPage(input: SettingsPageInput): string {
  const { config } = input;
  const token = config.token_budget;
  const usedPercent = token.limit_tokens > 0 ? Math.min(100, Math.round((token.used_tokens / token.limit_tokens) * 100)) : 0;
  const mode = config.profile.mode;
  const personalApplicable = mode !== "enterprise";
  const enterpriseApplicable = mode === "enterprise";
  const zeroBudget = config.budgets.zero_budget_mode;
  const agentSettings = config.agents
    .map(
      (agent) => `<tr class="agent-setting" data-role="${escapeAttr(agent.role)}" id="agent-setting-${escapeAttr(agent.role)}">
        <td><strong>${escapeHtml(agent.name)}</strong><span class="mono small muted"> ${escapeHtml(agent.role)}</span></td>
        <td><label class="checkline"><input type="checkbox" id="agent-setting-${escapeAttr(agent.role)}-enabled" data-agent-enabled="${escapeAttr(agent.role)}" ${agent.enabled ? "checked" : ""} />启用</label></td>
        <td><select class="input" id="agent-setting-${escapeAttr(agent.role)}-autonomy" data-agent-autonomy="${escapeAttr(agent.role)}">${(
          ["readonly", "draft", "approval_required", "autonomous_limited"] as AgentAutonomy[]
        )
          .map((autonomy) => `<option value="${autonomy}" ${agent.autonomy === autonomy ? "selected" : ""}>${escapeHtml(AGENT_AUTONOMY_LABELS[autonomy])}</option>`)
          .join("")}</select></td>
        <td><input class="input input-num" type="number" min="0" step="1000" id="agent-setting-${escapeAttr(agent.role)}-token-limit" data-agent-token-limits="${escapeAttr(agent.role)}" value="${String(agent.token_limit)}" /></td>
      </tr>`,
    )
    .join("");

  const content = `
${pageHeading("配置中心", "所有参数可配置 · 保存后立即生效并写入 config.json 持久化")}
${renderModeDiff(input.modeResult)}

<section class="panel" id="mode-section">
  <h2>运行模式 <span class="hint">体验 / 个人 / 企业；切换后按该模式应用默认支付、发票、审批与主体字段</span></h2>
  <div class="mode-grid" id="mode-cards">${renderModeCards(mode)}</div>
</section>

<section class="panel" id="feature-section">
  <h2>功能开关 <span class="hint">全部功能可逐项禁用；禁用后内核拒绝执行并给出可读原因</span></h2>
  <div class="feature-table" id="feature-table">${renderFeatureRows(config)}</div>
</section>

<div class="grid grid-2">
  <section class="panel" id="budget-section">
    <h2>预算（人民币） <span class="hint">支持 0 元极限模式</span></h2>
    <div class="form-grid">
      <label>月度预算<input class="input input-num" type="number" min="0" step="100" id="budget-month" value="${String(config.budgets.month_cny)}" /></label>
      <label>项目预算<input class="input input-num" type="number" min="0" step="100" id="budget-project" value="${String(config.budgets.project_cny)}" /></label>
      <label>单笔上限<input class="input input-num" type="number" min="0" step="100" id="budget-txn" value="${String(config.budgets.per_txn_cny)}" /></label>
      <label class="checkline"><input type="checkbox" id="budget-zero" ${zeroBudget ? "checked" : ""} />0 元极限模式</label>
    </div>
    <p class="alert alert-warn" id="zero-budget-hint" ${zeroBudget ? "" : "hidden"}>0 元极限模式：任何支出都会被拒绝，只允许免费本地动作（演示/检索/本地文件）。</p>
  </section>

  <section class="panel" id="token-section">
    <h2>Token 预算 <span class="hint">上限 / 单步 / 超限策略</span></h2>
    <div class="form-grid">
      <label>上限 tokens<input class="input input-num" type="number" min="1" step="100000" id="token-limit" value="${String(token.limit_tokens)}" /></label>
      <label>单步上限<input class="input input-num" type="number" min="1" step="1000" id="token-per-action" value="${String(token.per_action_limit)}" /></label>
      <label>超限策略<select class="input" id="token-on-exceed"><option value="block" ${token.on_exceed === "block" ? "selected" : ""}>阻断（block）</option><option value="notify" ${token.on_exceed === "notify" ? "selected" : ""}>仅通知（notify）</option></select></label>
    </div>
    <div class="token-stat" id="token-stat">已用 <b class="mono">${token.used_tokens.toLocaleString("zh-CN")}</b> / 上限 <b class="mono">${token.limit_tokens.toLocaleString("zh-CN")}</b>（剩余 <span class="mono">${(token.limit_tokens - token.used_tokens).toLocaleString("zh-CN")}</span>）</div>
    <div class="bar ${usedPercent >= 85 ? "danger" : usedPercent >= 65 ? "warn" : ""}" id="token-usage-bar" data-used="${String(token.used_tokens)}" data-limit="${String(token.limit_tokens)}"><span style="width:${String(usedPercent)}%"></span></div>
  </section>
</div>

<section class="panel panel-pay" id="payment-section">
  <h2>支付与银行卡 <span class="hint">用户可见的收款配置位置：个人模式=微信/支付宝/个人银行卡；企业模式=对公 + 专票 + 双人复核</span></h2>
  <div class="pay-mode-note">当前模式：<b>${escapeHtml(RUN_MODE_LABELS[mode])}</b>
    ${personalApplicable ? "" : '<span class="badge status-idle">个人渠道：当前模式不适用</span>'}
    <span class="badge status-approved" id="ai-no-sign">AI 不代签</span>
  </div>

  <div class="pay-group" id="pay-personal" data-applicable="${personalApplicable ? "true" : "false"}">
    <h3>个人模式渠道（微信支付 / 支付宝 / 个人银行卡）</h3>
    <div class="pay-channels" id="pay-channels">${renderPaymentChannels(config.payments)}</div>
    ${renderPayoutAccount(config.payments)}
  </div>

  <div class="pay-group" id="pay-enterprise" data-applicable="${enterpriseApplicable ? "true" : "false"}">
    <h3>企业模式结算（对公账户 / 增值税普票·专票 / 授权书 / 双人复核）</h3>
    <div class="form-grid">
      <label>发票类型<select class="input" id="invoice-type">${(Object.keys(INVOICE_TYPE_LABELS) as Array<keyof typeof INVOICE_TYPE_LABELS>)
        .map((type) => `<option value="${type}" ${config.payments.invoice.default_type === type ? "selected" : ""}>${escapeHtml(INVOICE_TYPE_LABELS[type])}</option>`)
        .join("")}</select></label>
      <label>发票抬头<input class="input" type="text" id="invoice-title" value="${escapeAttr(config.payments.invoice.title)}" /></label>
      <label>税号（掩码）<input class="input" type="text" id="invoice-tax" value="${escapeAttr(config.payments.invoice.tax_no_masked ?? "")}" /></label>
      <label class="checkline"><input type="checkbox" id="pay-dual-review" ${config.payments.require_dual_review ? "checked" : ""} />双人复核</label>
      <label class="checkline"><input type="checkbox" id="pay-sign-contract" ${config.payments.sign_contract ? "checked" : ""} />启用合同/授权书流程</label>
    </div>
    <p class="muted small">合同与用印一律由人类完成：AI 只生成草稿与核对清单，<b>不代签、不盖印</b>。</p>
  </div>
</section>

<section class="panel" id="agents-settings-section">
  <h2>智能体开关 <span class="hint">每个智能体的启用 / 自主等级 / Token 限额</span></h2>
  <table class="data-table" id="agent-settings-table">
    <thead><tr><th>智能体</th><th>启用</th><th>自主等级</th><th>Token 限额</th></tr></thead>
    <tbody>${agentSettings}</tbody>
  </table>
</section>

<section class="panel" id="approval-section">
  <h2>审批与接管 <span class="hint">审批永不自动放行；接管键 ≤10 秒</span></h2>
  <div class="form-grid">
    <label>审批超时（分钟）<input class="input input-num" type="number" min="1" step="1" id="approval-timeout" value="${String(config.approval.timeout_minutes)}" /></label>
    <label>双人复核阈值（元）<input class="input input-num" type="number" min="0" step="100" id="approval-dual-threshold" value="${String(config.approval.dual_review_threshold_cny)}" /></label>
    <label>自动批准<select class="input" id="approval-auto" disabled><option>永不自动放行（固定）</option></select></label>
    <label>接管快捷键<input class="input" type="text" id="approval-takeover" value="${escapeAttr(config.approval.takeover_shortcut)}" /></label>
  </div>
</section>

<div class="settings-actions" id="settings-actions">
  <button class="primary" type="button" id="settings-save">保存配置</button>
  <button type="button" id="settings-reset">恢复默认</button>
  <button type="button" id="settings-export">导出配置 JSON</button>
  <span class="settings-feedback" id="settings-feedback" role="status" aria-live="polite"></span>
</div>
<div class="alert alert-error" id="settings-errors" role="alert" hidden></div>
`;
  return renderShell(input.options, "配置中心", content);
}

// ---------------------------------------------------------------------------
// 智能体中心 /agents
// ---------------------------------------------------------------------------

export interface AgentsPageInput {
  agents: ConsoleAgentInfo[];
  mode: RunMode;
  options: PageRenderOptions;
}

const AGENT_STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  waiting_approval: "等待审批",
  disabled: "已禁用",
  not_applicable: "该模式不适用",
};

function renderAgentCard(agent: ConsoleAgentInfo): string {
  const notApplicable = agent.status === "not_applicable";
  const statusLabel = AGENT_STATUS_LABELS[agent.status] ?? agent.status;
  const logs = agent.logs
    .slice(0, 3)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const toolChips = agent.tools.map((tool) => `<code>${escapeHtml(tool)}</code>`).join(" ");
  return `<article class="agent-card${notApplicable ? " not-applicable" : ""}${agent.enabled ? "" : " disabled"}" id="agent-${escapeAttr(agent.role)}" data-role="${escapeAttr(agent.role)}">
    <header class="agent-head">
      <div>
        <div class="agent-title">${escapeHtml(agent.title)}</div>
        <div class="mono small muted">${escapeHtml(agent.role)} · ${escapeHtml(agent.model_ref)}</div>
      </div>
      <span class="badge status-${escapeAttr(agent.status)}" data-agent-status>${escapeHtml(statusLabel)}</span>
    </header>
    <div class="agent-current">当前任务：${escapeHtml(agent.current_task)}</div>
    <div class="agent-metrics">
      <span>今日动作 <b>${String(agent.today_actions)}</b></span>
      <span>Token <b class="mono">${agent.tokens_used.toLocaleString("zh-CN")}</b></span>
      <span>自主等级 <b>${escapeHtml(AGENT_AUTONOMY_LABELS[agent.autonomy])}</b></span>
    </div>
    <ul class="agent-logs">${logs === "" ? "<li class=\"muted\">暂无日志</li>" : logs}</ul>
    <button class="agent-expand" type="button" data-agent-expand="${escapeAttr(agent.role)}">展开详情</button>
    <div class="agent-detail" id="agent-detail-${escapeAttr(agent.role)}" hidden>
      <div class="agent-detail-row"><span class="muted">Token 限额</span><b class="mono">${agent.token_limit.toLocaleString("zh-CN")}</b></div>
      <div class="agent-detail-row"><span class="muted">工具</span><span>${toolChips === "" ? "—" : toolChips}</span></div>
      <div class="agent-detail-row"><span class="muted">启用</span><b>${agent.enabled ? "是" : "否"}</b></div>
      ${agent.enterprise_only ? '<div class="agent-detail-row"><span class="muted">适用模式</span><b>企业模式专属</b></div>' : ""}
    </div>
  </article>`;
}

export function renderAgentsPage(input: AgentsPageInput): string {
  const content = `
${pageHeading("智能体中心", `共 ${String(input.agents.length)} 个智能体 · 当前模式：${RUN_MODE_LABELS[input.mode]} · 点击卡片可展开详情`)}
<div class="agent-grid" id="agents-grid">${input.agents.map(renderAgentCard).join("")}</div>`;
  return renderShell(input.options, "智能体中心", content);
}

// ---------------------------------------------------------------------------
// 后台 /backend
// ---------------------------------------------------------------------------

export interface BackendPageInput {
  runs: FlowRun[];
  queue: QueueItem[];
  token: TokenBudgetConfig;
  stats: DataStats;
  halted: boolean;
  /** 当前配置的月预算（展示用）。 */
  monthBudgetCny: number;
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

function renderFlowRuns(runs: FlowRun[]): string {
  return runs
    .map((run) => {
      const events = run.events
        .map(
          (event) => `<li class="flow-item" data-phase="${escapeAttr(event.phase)}" data-seq="${String(event.seq)}">
            <span class="flow-seq mono">#${String(event.seq)}</span>
            <span class="flow-phase phase-${escapeAttr(event.phase)}">${escapeHtml(PHASE_LABELS[event.phase] ?? event.phase)}</span>
            <span class="flow-ts mono small muted">${escapeHtml(formatDateTime(event.ts))}</span>
            <span class="flow-summary">${escapeHtml(event.summary)}</span>
            <span class="flow-actor mono small">${escapeHtml(event.actor)}</span>
            ${event.evidence_ref === undefined ? "" : `<button class="evidence-link" type="button" data-evidence-ref="${escapeAttr(event.evidence_ref)}">证据 ${escapeHtml(event.evidence_ref)}</button>`}
          </li>`,
        )
        .join("");
      return `<section class="flow-run" data-run-id="${escapeAttr(run.run_id)}">
        <header class="flow-run-head">
          <span class="flow-run-id mono">${escapeHtml(run.run_id)}</span>
          <span class="badge status-${run.status === "done" ? "approved" : run.status === "running" ? "running" : run.status === "halted" ? "rejected" : "pending"}">${escapeHtml(run.status)}</span>
          <span class="flow-run-goal">${escapeHtml(run.goal)}</span>
          <span class="mono small muted">${escapeHtml(formatDateTime(run.started_at))}</span>
        </header>
        <ul class="flow-events">${events}</ul>
      </section>`;
    })
    .join("");
}

export function renderBackendPage(input: BackendPageInput): string {
  const token = input.token;
  const percent = token.limit_tokens > 0 ? Math.min(100, Math.round((token.used_tokens / token.limit_tokens) * 100)) : 0;
  const queue = input.queue
    .map(
      (item) => `<li class="queue-item" data-status="${escapeAttr(item.status)}">
        <span class="badge status-${item.status === "running" ? "running" : item.status === "blocked" ? "pending" : "idle"}">${escapeHtml(item.status)}</span>
        <span class="queue-goal">${escapeHtml(item.goal)}</span>
        <span class="mono small muted">${escapeHtml(item.agent_role)} · ${escapeHtml(item.eta)}</span>
      </li>`,
    )
    .join("");
  const abnormal = input.halted
    ? '<div class="alert alert-error" id="anomaly-panel">存在接管记录：外部平台风控命中（验证码）→ 已停止并交人；接管包 6 类见接管页。</div>'
    : '<div class="alert alert-ok" id="anomaly-panel">今日无未处理异常；风控拦截 1 次已停止交人（不绕过）。</div>';

  const content = `
${pageHeading("后台", "全流程时间线（计划 → 行动 → 观察 → 验证 → 留证）· 运行队列 · Token/预算消耗 · 异常与接管")}
<div class="backend-layout">
  <section class="panel backend-main" id="flow-panel">
    <h2>全流程时间线 <span class="hint" id="flow-count">${String(input.runs.reduce((sum, run) => sum + run.events.length, 0))} 条事件 / ${String(input.runs.length)} 个 run</span>
      <label class="flow-filter-label">过滤 <select class="input" id="flow-filter">
        <option value="all">全部</option>
        ${Object.keys(PHASE_LABELS).map((phase) => `<option value="${phase}">${escapeHtml(PHASE_LABELS[phase] ?? phase)}</option>`).join("")}
      </select></label>
    </h2>
    <div id="flow-timeline">${renderFlowRuns(input.runs) === "" ? '<p class="empty-state" id="flow-empty">暂无流程事件（数据已被清空，可到「数据」页重置为演示数据）</p>' : renderFlowRuns(input.runs)}</div>
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

  <aside class="backend-side">
    <section class="panel" id="queue-panel">
      <h2>运行队列 <span class="hint">${String(input.queue.length)} 项</span></h2>
      <ul class="queue-list">${queue === "" ? '<li class="empty-state">队列为空</li>' : queue}</ul>
    </section>
    <section class="panel" id="consume-panel">
      <h2>Token / 预算消耗</h2>
      <div class="token-stat">已用 <b class="mono">${token.used_tokens.toLocaleString("zh-CN")}</b> / 上限 <b class="mono">${token.limit_tokens.toLocaleString("zh-CN")}</b></div>
      <div class="bar ${percent >= 85 ? "danger" : percent >= 65 ? "warn" : ""}"><span style="width:${String(percent)}%"></span></div>
      <div class="muted small" style="margin-top:8px">月预算：<b>${money(input.monthBudgetCny)}</b>（配置中心可调，支持 0 元极限模式）· 数据统计：runs ${String(input.stats.runs)} / 证据 ${String(input.stats.evidence_files)}</div>
    </section>
    <section class="panel" id="anomaly">
      <h2>异常 / 接管记录</h2>
      ${abnormal}
    </section>
  </aside>
</div>`;
  return renderShell(input.options, "后台", content);
}

// ---------------------------------------------------------------------------
// 数据管理 /data
// ---------------------------------------------------------------------------

export interface DataPageInput {
  stats: DataStats;
  config: StewardConfig;
  agents: ConsoleAgentInfo[];
  options: PageRenderOptions;
}

export function renderDataPage(input: DataPageInput): string {
  const stats = input.stats;
  const statCards = `<div class="stat-grid" id="data-stats">
    <div class="stat-card"><div class="stat-label">运行记录（runs）</div><div class="stat-value mono" id="data-runs">${String(stats.runs)}</div></div>
    <div class="stat-card"><div class="stat-label">证据文件</div><div class="stat-value mono" id="data-evidence-files">${String(stats.evidence_files)}</div></div>
    <div class="stat-card"><div class="stat-label">账本项目</div><div class="stat-value mono" id="data-ledger-projects">${String(stats.ledger_projects)}</div></div>
    <div class="stat-card"><div class="stat-label">磁盘占用（MB）</div><div class="stat-value mono" id="data-disk">${stats.disk_usage_mb.toFixed(1)}</div></div>
  </div>
  <p class="muted small">配置更新时间：<span class="mono" id="data-config-updated">${escapeHtml(formatDateTime(stats.config_updated_at))}</span> · 数据根目录：<span class="mono">${escapeHtml(stats.data_root)}</span></p>`;

  const empty = stats.cleared
    ? `<div class="empty-archive" id="data-empty">
        <div class="empty-archive-title">📂 空档案</div>
        <p>运行数据已清空（配置保留）。你可以：重置为演示数据继续体验，或接入真实业务后开始新的运行。</p>
        <button class="primary" type="button" id="data-reset-demo-empty">重置为演示数据</button>
      </div>`
    : "";

  const agents = input.agents
    .slice(0, 4)
    .map((agent) => `<li><span class="mono small">${escapeHtml(agent.role)}</span> · ${escapeHtml(agent.title)} · ${String(agent.today_actions)} 次动作</li>`)
    .join("");

  const content = `
${pageHeading("数据管理", "数据统计 / 清空（二次确认）/ 重置为演示数据 / 导出配置")}
<section class="panel" id="data-overview">
  <h2>数据统计 <span class="hint">${stats.cleared ? "当前：已清空" : "当前：运行数据"}</span></h2>
  ${statCards}
  ${empty}
</section>

<div class="grid grid-2">
  <section class="panel" id="data-actions">
    <h2>数据操作</h2>
    <p class="muted small">清空只影响运行数据（runs / 证据 / 账本 / 流程 / 队列），<b>保留配置</b>；清空后可在本页重置为演示数据，或直接开始新的项目运行。</p>
    <div class="data-actions">
      <button class="danger" type="button" id="data-clear">清空数据</button>
      <button type="button" id="data-reset-demo">重置为演示数据</button>
      <button type="button" id="data-export">导出配置 JSON</button>
    </div>
    <div class="alert alert-warn" id="data-export-note" hidden>配置 JSON 已生成（浏览器下载）</div>
  </section>
  <section class="panel" id="data-config-summary">
    <h2>当前配置摘要</h2>
    <ul class="list-clean">
      <li>运行模式：<b>${escapeHtml(RUN_MODE_LABELS[input.config.profile.mode])}</b></li>
      <li>月预算 / 单笔：<b>${escapeHtml(formatCny(input.config.budgets.month_cny))}</b> / <b>${escapeHtml(formatCny(input.config.budgets.per_txn_cny))}</b>${input.config.budgets.zero_budget_mode ? "（0 元极限模式）" : ""}</li>
      <li>Token 上限：<b class="mono">${input.config.token_budget.limit_tokens.toLocaleString("zh-CN")}</b></li>
      <li>支付渠道：<b>${escapeHtml(
        input.config.payments.providers
          .filter((provider) => provider.enabled)
          .map((provider) => PAYMENT_KIND_LABELS[provider.kind] ?? provider.name)
          .join(" / ") || "无",
      )}</b></li>
      <li>配置版本：v${String(input.config.version)} · 更新于 ${escapeHtml(formatDateTime(input.config.updated_at))}</li>
    </ul>
    <h2 style="margin-top:14px">智能体今日动作</h2>
    <ul class="list-clean">${agents === "" ? "<li class=\"muted\">暂无</li>" : agents}</ul>
  </section>
</div>

<div class="modal-backdrop" id="data-confirm-modal" hidden>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="data-confirm-title">
    <h2 id="data-confirm-title">确认清空运行数据？</h2>
    <p class="muted">将删除 runs / 证据 / 账本 / 流程 / 队列等运行数据（配置保留）。此操作不可撤销，二次确认后执行。</p>
    <div class="modal-actions">
      <button type="button" id="data-confirm-cancel">取消</button>
      <button class="danger" type="button" id="data-confirm-yes">确认清空</button>
    </div>
  </div>
</div>`;
  return renderShell(input.options, "数据管理", content);
}
