/**
 * packages/steward-console/src/pages-system.ts
 *
 * v1.3 页面：`/system` 系统总控（超级总调度对话 + 两层结构 + 程序/插件/模型/日志 + 危险动作二次确认 + 快捷命令），
 * 以及 /money 与 /settings 共用的「易支付（epay）」配置分组。
 */

import { escapeHtml, formatCny, formatDateTime, renderShell, type PageRenderOptions } from "./pages.js";
import type {
  EpayConfig,
  EpayMethod,
  SupervisorMessage,
  SystemProgram,
  SystemStatus,
} from "./system.js";

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

function pageHeading(title: string, hint?: string): string {
  const hintText = hint === undefined ? "" : `<span class="muted small">${escapeHtml(hint)}</span>`;
  return `<div class="page-title"><h1>${escapeHtml(title)}</h1>${hintText}</div>`;
}

const PROGRAM_KIND_LABELS: Record<string, string> = {
  service: "服务",
  worker: "Worker",
  gateway: "网关",
  scheduler: "调度器",
  browser: "浏览器",
};

const PROGRAM_STATUS_LABELS: Record<string, string> = { running: "运行中", stopped: "已停止" };
const PLUGIN_SCOPE_LABELS: Record<string, string> = { supervisor: "第 1 层", project_conductor: "第 2 层", specialist: "第 3 层" };

const QUICK_COMMANDS: Array<{ label: string; command: string }> = [
  { label: "查看系统状态", command: "查看系统状态" },
  { label: "重启模型网关", command: "重启 模型网关 程序" },
  { label: "停止 scout-worker", command: "关闭 scout-worker 程序" },
  { label: "启用易支付插件", command: "启用 易支付 插件" },
  { label: "禁用找客户分支", command: "禁用 找客户分支 插件" },
  { label: "切换 harness 模型", command: "切换 harness 模型到 deepseek-chat" },
  { label: "修改系统提示词", command: "修改系统提示词" },
  { label: "委派项目给总调度", command: "委派项目给项目总调度" },
];

function renderSupervisorMessages(messages: SupervisorMessage[]): string {
  return messages
    .map(
      (item) => `<div class="sup-message" data-role="${escapeAttr(item.role)}" id="sup-${escapeAttr(item.id)}">
        <span class="chat-avatar">${item.role === "supervisor" ? "◈" : "我"}</span>
        <div class="chat-bubble${item.kind === undefined ? "" : ` kind-${item.kind}`}">
          <div class="chat-meta"><b>${item.role === "supervisor" ? "超级总调度（supervisor）" : "我"}</b><span class="muted small">${escapeHtml(formatDateTime(item.at))}</span></div>
          <div class="chat-text">${escapeHtml(item.text).replaceAll("\n", "<br />")}</div>
          ${item.summary === undefined ? "" : `<div class="chat-summary muted small">摘要：${escapeHtml(item.summary)}</div>`}
        </div>
      </div>`,
    )
    .join("");
}

function renderLayers(status: SystemStatus): string {
  const agents = status.agents
    .filter((agent) => agent.layer === "specialist")
    .map(
      (agent) => `<a class="layer-agent" data-role="${escapeAttr(agent.agent_role)}" href="/agents/${encodeURIComponent(agent.agent_role)}">
        <b>${escapeHtml(agent.title)}</b>
        <span class="mono small muted">${escapeHtml(agent.agent_role)}</span>
        <span class="badge status-${agent.status === "running" ? "approved" : agent.status === "not_applicable" ? "idle" : "pending"}">${escapeHtml(agent.status)}</span>
      </a>`,
    )
    .join("");
  return `<div class="layer-diagram" id="system-layers">
    <div class="layer-node layer-top" id="layer-supervisor">
      <span class="layer-index">L1</span>
      <div><b>${escapeHtml(status.supervisor.title)}</b><span class="mono small muted">supervisor · ${escapeHtml(status.supervisor.model)}</span></div>
      <span class="badge status-approved">${escapeHtml(status.supervisor.status)}</span>
      <span class="layer-note">${escapeHtml(status.supervisor.layer_label)}</span>
    </div>
    <div class="layer-arrow" aria-hidden="true">↓</div>
    <div class="layer-node" id="layer-conductor">
      <span class="layer-index">L2</span>
      <div><b>${escapeHtml(status.project_conductor.title)}</b><span class="mono small muted">conductor · ${escapeHtml(status.project_conductor.model)}</span></div>
      <span class="badge status-approved">${escapeHtml(status.project_conductor.status)}</span>
      <span class="layer-note">${escapeHtml(status.project_conductor.layer_label)} · 每个项目一个（可并存）</span>
    </div>
    <div class="layer-arrow" aria-hidden="true">↓</div>
    <div class="layer-agents" id="layer-agents">
      <div class="layer-agents-title">第 3 层：专项智能体（${String(agents === "" ? 0 : agents.split("layer-agent").length - 1)} 个，点击看对话记录）</div>
      ${agents === "" ? '<p class="empty-state">暂无</p>' : agents}
    </div>
  </div>`;
}

function renderPrograms(programs: SystemProgram[]): string {
  return programs
    .map(
      (program) => `<tr class="program-row" data-program-id="${escapeAttr(program.id)}" data-program-status="${escapeAttr(program.status)}" id="program-${escapeAttr(program.id)}">
        <td><b>${escapeHtml(program.name)}</b><div class="muted small">${escapeHtml(program.description)}</div><span class="mono small muted">${escapeHtml(program.id)} · ${escapeHtml(PROGRAM_KIND_LABELS[program.kind] ?? program.kind)}${program.port === undefined ? "" : ` · :${String(program.port)}`}${program.pid === undefined ? "" : ` · pid ${String(program.pid)}`}</span></td>
        <td><span class="program-status" data-status="${escapeAttr(program.status)}">${escapeHtml(PROGRAM_STATUS_LABELS[program.status] ?? program.status)}</span><div class="muted small">health=${escapeHtml(program.health)}</div></td>
        <td class="mono small muted">${escapeHtml(formatDateTime(program.since))}</td>
        <td class="program-actions">
          ${
            program.status === "running"
              ? `<button type="button" data-program-action="stop" data-program-id="${escapeAttr(program.id)}" id="prog-stop-${escapeAttr(program.id)}">停止</button>`
              : `<button class="primary" type="button" data-program-action="start" data-program-id="${escapeAttr(program.id)}" id="prog-start-${escapeAttr(program.id)}">启动</button>`
          }
          <button type="button" data-program-action="restart" data-program-id="${escapeAttr(program.id)}" id="prog-restart-${escapeAttr(program.id)}">重启</button>
          <button class="danger-ghost" type="button" data-danger-delete="delete_program" data-target-id="${escapeAttr(program.id)}" id="prog-delete-${escapeAttr(program.id)}">删除…</button>
        </td>
      </tr>`,
    )
    .join("");
}

function renderPlugins(plugins: SystemStatus["plugins"]): string {
  return plugins
    .map(
      (plugin) => `<tr class="plugin-row" data-plugin-id="${escapeAttr(plugin.id)}" data-plugin-enabled="${plugin.enabled ? "true" : "false"}" id="plugin-${escapeAttr(plugin.id)}">
        <td><b>${escapeHtml(plugin.name)}</b><div class="muted small">${escapeHtml(plugin.description)}</div><span class="mono small muted">${escapeHtml(plugin.id)} · v${escapeHtml(plugin.version)}${plugin.requires_approval ? " · 需审批" : ""}</span></td>
        <td><span class="badge ${plugin.enabled ? "status-approved" : "status-idle"}">${plugin.enabled ? "已启用" : "已禁用"}</span></td>
        <td class="plugin-actions">
          <button type="button" data-plugin-toggle="true" data-plugin-id="${escapeAttr(plugin.id)}" id="plugin-toggle-${escapeAttr(plugin.id)}">${plugin.enabled ? "禁用" : "启用"}</button>
          <button class="danger-ghost" type="button" data-danger-delete="delete_plugin" data-target-id="${escapeAttr(plugin.id)}" id="plugin-delete-${escapeAttr(plugin.id)}">删除…</button>
        </td>
      </tr>`,
    )
    .join("");
}

function renderAgentModels(status: SystemStatus): string {
  return status.agents
    .map(
      (agent) => `<tr class="system-agent" data-role="${escapeAttr(agent.agent_role)}">
        <td><b>${escapeHtml(agent.title)}</b><span class="mono small muted"> ${escapeHtml(agent.agent_role)}</span><span class="badge status-idle">${escapeHtml(PLUGIN_SCOPE_LABELS[agent.layer] ?? agent.layer)}</span></td>
        <td>${escapeHtml(agent.provider)}</td>
        <td class="mono small">${escapeHtml(agent.model)}</td>
        <td class="num mono">${agent.tokens_today.toLocaleString("zh-CN")} / ${agent.token_limit.toLocaleString("zh-CN")}</td>
        <td><a class="run-link" href="/agents/${encodeURIComponent(agent.agent_role)}">对话记录 →</a></td>
      </tr>`,
    )
    .join("");
}

export interface SystemPageInput {
  status: SystemStatus;
  supervisorMessages: SupervisorMessage[];
  epay: EpayConfig;
  options: PageRenderOptions;
}

export function renderSystemPage(input: SystemPageInput): string {
  const logs = input.status.logs
    .map(
      (entry) => `<li class="log-item" data-level="${escapeAttr(entry.level)}"><span class="mono small muted">${escapeHtml(formatDateTime(entry.at))}</span><span class="log-level level-${escapeAttr(entry.level)}">${escapeHtml(entry.level)}</span><span class="mono small">${escapeHtml(entry.source)}</span><span>${escapeHtml(entry.message)}</span></li>`,
    )
    .join("");
  const quickButtons = QUICK_COMMANDS.map(
    (item) => `<button type="button" class="quick-cmd" data-command="${escapeAttr(item.command)}" id="quick-${escapeAttr(item.label)}">${escapeHtml(item.label)}</button>`,
  ).join("");
  const content = `
${pageHeading("系统管理", "统一对话/调度入口在 AI 总控（/chat）· 本页专注系统管理：两层结构、受管程序/插件、各 agent 模型与 Token、全部日志、危险动作二次确认")}
<div class="system-layout">
    <section class="panel system-unified" id="system-unified-panel">
    <h2>AI 总控（统一对话入口）</h2>
    <p class="muted">对话 / 调度已统一到 AI 总控：一个输入框即可查系统、发任务、审批危险动作。本页只负责系统管理（两层结构、程序/插件、模型与 Token、日志、危险动作）。</p>
    <p><a class="primary button" href="/chat" id="system-unified-link">打开 AI 总控对话 →</a></p>
    <div class="quick-commands" id="system-quick-links">
      <a class="quick-cmd" href="/chat?prompt=%E6%9F%A5%E7%9C%8B%E7%B3%BB%E7%BB%9F%E7%8A%B6%E6%80%81" id="quick-link-查看系统状态">查看系统状态</a>
      <a class="quick-cmd" href="/chat?prompt=%E5%88%97%E5%87%BA%E6%9C%80%E8%BF%91%E7%9A%84%E8%BF%90%E8%A1%8C" id="quick-link-列出最近运行">列出最近运行</a>
      <a class="quick-cmd" href="/chat?prompt=%E6%9F%A5%E7%9C%8B%E4%BA%A7%E7%89%A9" id="quick-link-查看产物">查看产物</a>
      <a class="quick-cmd" href="/chat?prompt=%E6%9F%A5%E7%9C%8B%E6%8A%A5%E5%91%8A" id="quick-link-查看报告">查看报告</a>
      <a class="quick-cmd" href="/chat?prompt=%E6%9F%A5%E7%9C%8B%E9%85%8D%E7%BD%AE" id="quick-link-查看配置">查看配置</a>
      <a class="quick-cmd" href="/chat?prompt=%E6%9F%A5%E7%9C%8B%E8%B4%A6%E6%9C%AC" id="quick-link-查看账本">查看账本</a>
    </div>
    <p class="alert alert-error" id="system-feedback" role="alert" hidden></p>
  </section>

  <section class="panel system-status" id="system-status-panel">
    <h2>系统状态 <span class="hint">受管程序 / 插件 / 各 agent 模型与 Token / 全部日志</span></h2>
    <div class="layer-block">
      <h3>两层结构</h3>
      ${renderLayers(input.status)}
    </div>
    <h3>受管程序 <span class="hint">${String(input.status.programs.length)} 个（运行 ${String(input.status.programs.filter((program) => program.status === "running").length)}）</span></h3>
    <table class="data-table system-table" id="system-programs">
      <thead><tr><th>程序</th><th>状态</th><th>启动时间</th><th>操作</th></tr></thead>
      <tbody>${renderPrograms(input.status.programs)}</tbody>
    </table>
    <h3>插件 <span class="hint">${String(input.status.plugins.length)} 个（启用 ${String(input.status.plugins.filter((plugin) => plugin.enabled).length)}）</span></h3>
    <table class="data-table system-table" id="system-plugins">
      <thead><tr><th>插件</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${renderPlugins(input.status.plugins)}</tbody>
    </table>
    <h3>各智能体当前模型 / Token</h3>
    <table class="data-table system-table" id="system-agent-models">
      <thead><tr><th>智能体</th><th>Provider</th><th>模型</th><th style="text-align:right">今日 Token</th><th>对话记录</th></tr></thead>
      <tbody>${renderAgentModels(input.status)}</tbody>
    </table>
    <h3>全部日志 <a class="run-link" id="system-logs-link" href="#system-logs">跳转</a> <span class="hint">最近 ${String(input.status.logs.length)} 条</span></h3>
    <ul class="system-logs" id="system-logs">${logs === "" ? '<li class="muted">暂无日志</li>' : logs}</ul>
  </section>
</div>

<div class="lightbox danger-modal" id="system-danger-modal" role="dialog" aria-modal="true" aria-labelledby="danger-title" hidden>
  <div class="modal danger-modal-body">
    <h2 id="danger-title">危险动作二次确认</h2>
    <div class="danger-block"><span class="danger-label">动作</span><b id="danger-action">—</b></div>
    <div class="danger-block"><span class="danger-label">目标</span><b id="danger-target">—</b></div>
    <div class="danger-block danger-risk"><span class="danger-label">风险说明</span><span id="danger-risk">—</span></div>
    <div class="danger-block"><span class="danger-label">备份路径</span><span class="mono" id="danger-backup">—</span></div>
    <div class="danger-block"><span class="danger-label">确认令牌</span><span class="mono" id="danger-token-display">—</span><span class="muted small">（5 分钟内有效，必须原样输入）</span></div>
    <label class="danger-input-label">输入确认令牌<input class="input mono" type="text" id="danger-token-input" autocomplete="off" /></label>
    <label class="danger-input-label">输入「确认删除」<input class="input" type="text" id="danger-text-input" autocomplete="off" /></label>
    <p class="alert alert-error" id="danger-error" hidden></p>
    <div class="modal-actions">
      <button type="button" id="danger-cancel">取消</button>
      <button class="danger" type="button" id="danger-confirm">确认执行删除</button>
    </div>
  </div>
</div>`;
  return renderShell(input.options, "系统管理", content);
}

// ---------------------------------------------------------------------------
// 易支付配置分组（/money 与 /settings 共用）
// ---------------------------------------------------------------------------

export interface EpaySectionInput {
  epay: EpayConfig;
  /** 展示位置：'money' 或 'settings'（决定 id 前缀，避免同页重复）。 */
  scope?: "money" | "settings";
}

export function renderEpaySettingsSection(input: EpaySectionInput): string {
  const epay = input.epay;
  const methods = (["alipay", "wxpay"] as EpayMethod[])
    .map(
      (method) => `<label class="checkline"><input type="checkbox" id="epay-method-${method}" data-epay-method="${method}" ${epay.methods.includes(method) ? "checked" : ""} />${method === "alipay" ? "支付宝 alipay" : "微信 wxpay"}</label>`,
    )
    .join("");
  const scope = input.scope ?? "money";
  return `<section class="panel panel-epay" id="epay-section">
  <h2>易支付（epay）<span class="hint">第三方聚合支付渠道；demo 模式不会真实扣款，live 需商户配置</span></h2>
  <p class="alert ${epay.mode === "demo" ? "alert-warn" : "alert-ok"}" id="epay-mode-note">
    当前：<b>${epay.enabled ? (epay.mode === "live" ? "已启用 · live（真实商户）" : "已启用 · demo（演示渠道，不真实扣款）") : "未启用"}</b>
    · 密钥只保存引用（<span class="mono">${escapeHtml(epay.api_key_ref || "—")}</span>），明文不入库；收款到账后仍需<b>人工确认</b>。
  </p>
  <div class="form-grid" id="epay-form" data-scope="${escapeAttr(scope)}">
    <label class="checkline"><input type="checkbox" id="epay-enabled" ${epay.enabled ? "checked" : ""} />启用易支付</label>
    <label>模式<select class="input" id="epay-mode"><option value="demo" ${epay.mode === "demo" ? "selected" : ""}>demo（演示，不真实扣款）</option><option value="live" ${epay.mode === "live" ? "selected" : ""}>live（真实商户）</option></select></label>
    <label>网关地址<input class="input mono" type="text" id="epay-gateway" value="${escapeAttr(epay.gateway_url)}" placeholder="https://epay.example.com/submit.php" /></label>
    <label>商户 ID<input class="input mono" type="text" id="epay-merchant" value="${escapeAttr(epay.merchant_id)}" placeholder="1000-XXXX" /></label>
    <label>密钥引用<input class="input mono" type="text" id="epay-key-ref" value="${escapeAttr(epay.api_key_ref)}" placeholder="env:EPAY_MERCHANT_KEY（不存明文）" /></label>
    <label>当前密钥<span class="model-key-masked mono" id="epay-key-masked">${escapeHtml(epay.api_key_masked)}</span></label>
    <label>回调地址 notify_url<input class="input mono" type="text" id="epay-notify" value="${escapeAttr(epay.notify_url)}" /></label>
    <label>返回地址 return_url<input class="input mono" type="text" id="epay-return" value="${escapeAttr(epay.return_url)}" /></label>
    <label>支付方式<span class="epay-methods" id="epay-methods">${methods}</span></label>
  </div>
  <div class="models-actions">
    <button class="primary" type="button" id="epay-save">保存易支付设置</button>
    <span class="settings-feedback" id="epay-feedback" role="status"></span>
    <span class="muted small">最近保存：<span class="mono" id="epay-updated">${escapeHtml(formatDateTime(epay.updated_at))}</span></span>
  </div>
  <p class="alert alert-error" id="epay-error" hidden></p>
</section>`;
}
