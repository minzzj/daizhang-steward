/**
 * packages/steward-console/src/assets-admin.ts
 *
 * 专业版静态资源（内联字符串，同源提供、无 CDN/外链）：
 * - PRO_CSS：左侧固定导航 + 顶部状态栏 + 配置中心/智能体中心/后台/数据管理组件样式，
 *            同时覆盖 BASE_CSS 的旧顶栏布局（旧页面自动升级为专业版布局）。
 * - ADMIN_JS：配置中心保存/切换模式/校验错误、数据清空二次确认、智能体详情、后台过滤等。
 */

export const PRO_CSS = `/* ===== 专业版布局：左导航 + 顶部状态栏 ===== */
[hidden] { display: none !important; }
body { background: var(--bg); }
.app-shell { display: flex; min-height: 100vh; align-items: stretch; }
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 232px;
  background: linear-gradient(180deg, #0c1322 0%, #0a101c 100%);
  color: #dce6f5;
  display: flex;
  flex-direction: column;
  z-index: 30;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.sidebar-brand { padding: 18px 18px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.sidebar-brand .brand-name { font-size: 17px; font-weight: 800; letter-spacing: 0.02em; color: #f2f7ff; }
.sidebar-brand .brand-sub { display: block; margin-top: 3px; font-size: 10px; letter-spacing: 0.14em; color: #7f93ad; }
.sidebar-nav { flex: 1; overflow-y: auto; padding: 10px 10px 16px; }
.nav-group { margin-top: 12px; }
.nav-group:first-child { margin-top: 0; }
.nav-group-title { padding: 4px 10px 6px; font-size: 10px; letter-spacing: 0.16em; color: #5f7288; font-weight: 700; }
.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin: 2px 0;
  border-radius: 8px;
  color: #c3d1e4;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  border-left: 2px solid transparent;
}
.nav-link:hover { background: rgba(102, 227, 210, 0.08); color: #eaf4ff; text-decoration: none; }
.nav-link.active { background: rgba(102, 227, 210, 0.14); color: #9df3e5; border-left-color: #66e3d2; }
.nav-icon { width: 16px; text-align: center; font-size: 13px; opacity: 0.9; }
.sidebar-footer { padding: 12px 16px 16px; border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; flex-direction: column; gap: 8px; }
.sidebar-footer .local-badge {
  margin-left: 0;
  align-self: flex-start;
  background: rgba(102, 227, 210, 0.12);
  color: #86ead9;
  border: 1px solid rgba(102, 227, 210, 0.25);
}
.sidebar-footer .safety-note { font-size: 10px; line-height: 1.5; color: #6b7e96; }
.app-main { flex: 1; min-width: 0; margin-left: 232px; display: flex; flex-direction: column; min-height: 100vh; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 24px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.topbar-title { font-size: 14px; font-weight: 800; letter-spacing: 0.01em; }
.topbar-context { font-size: 12px; color: var(--muted); }
.topbar-status { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.status-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: #f1f4fa; border: 1px solid var(--line); font-size: 11px; color: #47536b; white-space: nowrap; }
.status-chip b { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.status-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); display: inline-block; }
.status-chip.halted { background: var(--danger-soft); border-color: #f5c2bf; color: #8f1d18; }
.status-chip.halted .dot { background: var(--danger); }
.mode-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; background: var(--brand-soft); color: var(--brand); border: 1px solid #cfd9ff; }
.mode-badge.mode-demo { background: #eef1f8; color: #4a5670; border-color: #dde3ef; }
.mode-badge.mode-personal { background: var(--brand-soft); color: var(--brand); }
.mode-badge.mode-enterprise { background: #f3edff; color: #6b3fd0; border-color: #ddd0fa; }
.app-main main { max-width: none; margin: 0; padding: 22px 26px 40px; flex: 1; }
.app-main .site-footer { max-width: none; margin: 0; padding: 0 26px 26px; border-top: none; }
.app-main .halt-banner { max-width: none; margin: 12px 26px 0; }

/* ===== 通用表单 / 开关 / 提示 ===== */
.input {
  font: inherit;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--ink);
  min-width: 0;
}
.input:focus, button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid rgba(59, 91, 253, 0.35); outline-offset: 1px; }
.input-num { font-variant-numeric: tabular-nums; text-align: right; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px 16px; }
.form-grid > label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); font-weight: 600; }
.checkline { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #47536b; font-weight: 600; cursor: pointer; }
.checkline input { width: 15px; height: 15px; accent-color: var(--brand); }
.alert { margin-top: 12px; padding: 10px 14px; border-radius: 10px; font-size: 12px; line-height: 1.6; border: 1px solid transparent; }
.alert[hidden] { display: none; }
.alert-ok { background: var(--ok-soft); border-color: #bfe6d0; color: #0b6b3a; }
.alert-warn { background: var(--warn-soft); border-color: #f3d6a4; color: #7a4a00; }
.alert-error { background: var(--danger-soft); border-color: #f5c2bf; color: #8f1d18; }
.alert ul { margin: 6px 0 0; padding-left: 18px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

/* ===== 配置中心 ===== */
.mode-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.mode-card { position: relative; display: flex; flex-direction: column; gap: 7px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: #fff; cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.mode-card:hover { border-color: #c4d0f8; }
.mode-card.selected { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(59, 91, 253, 0.12); background: #fbfcff; }
.mode-card input { position: absolute; opacity: 0; pointer-events: none; }
.mode-card-head { display: flex; align-items: center; gap: 8px; }
.mode-card-name { font-size: 16px; font-weight: 800; }
.mode-card-tag { font-size: 10px; padding: 2px 8px; border-radius: 999px; background: #f1f4fa; color: #47536b; font-weight: 700; }
.mode-card-desc { font-size: 12px; line-height: 1.6; color: var(--muted); min-height: 58px; }
.mode-card-state { font-size: 11px; font-weight: 700; color: var(--brand); }
.feature-table { display: flex; flex-direction: column; gap: 6px; }
.feature-row { display: grid; grid-template-columns: 1.25fr 54px 92px minmax(180px, 1fr) 62px; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; }
.feature-row.off { background: #fafbfe; }
.feature-name { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 700; }
.feature-name .mono { font-size: 10px; }
.feature-badge { justify-self: end; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 999px; }
.feature-badge.on { background: var(--ok-soft); color: var(--ok); }
.feature-badge.off { background: #eef1f5; color: #5b6478; }
.switch { position: relative; display: inline-flex; width: 38px; height: 21px; }
.switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch-ui { width: 100%; height: 100%; border-radius: 999px; background: #cfd7e6; transition: background 0.15s ease; }
.switch-ui::before { content: ""; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }
.switch input:checked + .switch-ui { background: var(--brand); }
.switch input:checked + .switch-ui::before { transform: translateX(17px); }
.token-stat { margin-top: 10px; font-size: 12px; color: var(--muted); }
.token-stat b { color: var(--ink); }
.panel-pay { border: 2px solid #f0d5a8; background: linear-gradient(180deg, #fffdf8 0%, #ffffff 46%); }
.panel-pay h2 { color: #7a4a00; }
.pay-mode-note { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; font-size: 12px; color: var(--muted); }
.pay-group { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); }
.pay-group h3 { margin: 0 0 10px; font-size: 13px; color: #47536b; }
.pay-group[data-applicable="false"] { opacity: 0.62; }
.pay-channels { display: flex; flex-direction: column; gap: 8px; }
.pay-channel { display: flex; align-items: center; gap: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; flex-wrap: wrap; }
.pay-channel.off { background: #fafbfe; }
.pay-channel-main { flex: 1; min-width: 240px; }
.pay-channel-name { font-size: 14px; font-weight: 800; margin-right: 8px; }
.pay-channel-account { margin-top: 3px; font-size: 11px; color: var(--muted); }
.pay-tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--brand-soft); color: var(--brand); }
.pay-tag-corp { background: #f3edff; color: #6b3fd0; }
.payout-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px 16px; margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.payout-grid > div { display: flex; flex-direction: column; gap: 2px; }
.payout-grid strong { font-size: 13px; }
.settings-actions { position: sticky; bottom: 0; z-index: 15; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; padding: 12px 16px; background: rgba(255, 255, 255, 0.96); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 -6px 24px rgba(20, 30, 60, 0.06); }
.settings-feedback { font-size: 12px; font-weight: 700; color: var(--ok); }
.settings-feedback.error { color: var(--danger); }

/* ===== 智能体中心 ===== */
.agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.agent-card { display: flex; flex-direction: column; gap: 8px; padding: 15px; border: 1px solid var(--line); border-radius: 12px; background: #fff; box-shadow: var(--shadow); }
.agent-card.not-applicable { opacity: 0.66; border-style: dashed; }
.agent-card.disabled { background: #fafbfe; }
.agent-head { display: flex; align-items: flex-start; gap: 10px; }
.agent-head > div:first-child { flex: 1; }
.agent-title { font-size: 15px; font-weight: 800; }
.agent-current { font-size: 12px; line-height: 1.55; color: #47536b; padding: 7px 10px; background: #f7f9fd; border-radius: 8px; }
.agent-metrics { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--muted); }
.agent-metrics b { color: var(--ink); }
.agent-logs { margin: 0; padding-left: 16px; font-size: 11px; line-height: 1.65; color: #5b6478; }
.agent-expand { align-self: flex-start; font-size: 11px; padding: 4px 10px; }
.agent-detail { margin-top: 4px; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 9px; background: #fbfcff; display: flex; flex-direction: column; gap: 7px; font-size: 12px; }
.agent-detail[hidden] { display: none; }
.agent-detail-row { display: flex; gap: 10px; }
.agent-detail-row > span:first-child { width: 64px; flex: 0 0 auto; }
.agent-detail code { font-size: 10px; background: #eef1f8; padding: 1px 6px; border-radius: 5px; }

/* ===== 后台 ===== */
.backend-layout { display: grid; grid-template-columns: minmax(0, 1.64fr) minmax(300px, 0.9fr); gap: 16px; align-items: start; }
.backend-side { display: flex; flex-direction: column; gap: 16px; }
.flow-filter-label { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); font-weight: 600; }
.flow-filter-label .input { padding: 4px 8px; font-size: 11px; }
.flow-run { margin-bottom: 16px; border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; }
.flow-run:last-child { margin-bottom: 0; }
.flow-run-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 12px; background: #f7f9fd; border-bottom: 1px solid var(--line); font-size: 12px; }
.flow-run-id { font-size: 11px; color: var(--muted); }
.flow-run-goal { font-weight: 700; flex: 1; min-width: 180px; }
.flow-events { list-style: none; margin: 0; padding: 6px 12px 10px; }
.flow-item { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px dashed #eef1f7; font-size: 12px; }
.flow-item:last-child { border-bottom: none; }
.flow-seq { color: var(--muted); font-size: 10px; }
.flow-phase { padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; background: #eef1f8; color: #47536b; }
.phase-plan { background: #eef1ff; color: #3b5bfd; }
.phase-action { background: #e8f7ee; color: #0f7a45; }
.phase-observe { background: #eef7ff; color: #1c6aa8; }
.phase-verify { background: #f3edff; color: #6b3fd0; }
.phase-evidence { background: #fff4e2; color: #8a5a00; }
.phase-error { background: var(--danger-soft); color: var(--danger); }
.phase-takeover { background: #fde8e6; color: #9b1c14; }
.flow-summary { flex: 1; min-width: 220px; line-height: 1.5; }
.flow-actor { color: var(--muted); }
.queue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.queue-item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; font-size: 12px; }
.queue-goal { flex: 1; min-width: 160px; }

/* ===== 数据管理 ===== */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.stat-card { padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
.stat-label { font-size: 11px; letter-spacing: 0.04em; color: var(--muted); }
.stat-value { font-size: 26px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
.empty-archive { margin-top: 14px; padding: 22px; border: 1px dashed #c9d4ea; border-radius: 12px; background: #fbfcff; text-align: center; }
.empty-archive-title { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
.empty-archive p { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
.data-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.modal-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(10, 16, 28, 0.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal-backdrop[hidden] { display: none; }
.modal { width: min(460px, 100%); padding: 22px; border-radius: 14px; background: #fff; box-shadow: 0 24px 80px rgba(10, 16, 28, 0.35); }
.modal h2 { margin: 0 0 10px; font-size: 18px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

@media (max-width: 1100px) {
  .sidebar { width: 196px; }
  .app-main { margin-left: 196px; }
  .backend-layout { grid-template-columns: 1fr; }
  .feature-row { grid-template-columns: 1fr 54px 92px 1fr; }
  .feature-badge { display: none; }
}
`;

export const ADMIN_JS = `(function () {
  'use strict';

  var TOKEN = readMeta('steward-token');
  var currentConfig = null;

  function readMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta === null ? '' : (meta.getAttribute('content') || '');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var element = byId(id);
    if (element !== null) { element.textContent = text; }
  }

  function cny(value) {
    return '¥' + Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pad2(value) {
    return value < 10 ? '0' + String(value) : String(value);
  }

  function nowText() {
    var date = new Date();
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function toast(message, kind) {
    var element = byId('toast');
    if (element === null) { return; }
    element.textContent = message;
    element.className = 'toast toast-show toast-' + (kind || 'info');
    window.setTimeout(function () { element.className = 'toast'; }, 3200);
  }

  function api(method, path, body) {
    var headers = {};
    var options = { method: method, headers: headers };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-Steward-Token'] = TOKEN;
      if (body !== undefined) { options.body = JSON.stringify(body); }
    }
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = text === '' ? null : JSON.parse(text); } catch (error) { payload = null; }
        if (!response.ok) {
          var message = payload !== null && payload.message ? payload.message : 'HTTP ' + String(response.status);
          var failure = new Error(message);
          failure.payload = payload;
          throw failure;
        }
        return payload;
      });
    });
  }

  // ---- 顶部状态栏刷新 --------------------------------------------------
  function refreshStatus() {
    if (byId('status-mode') === null) { return; }
    api('GET', '/api/admin/status').then(function (payload) {
      var status = payload.data;
      var mode = byId('status-mode');
      if (mode !== null) {
        mode.textContent = status.mode_label;
        mode.className = 'mode-badge mode-' + status.mode;
      }
      setText('status-budget', cny(status.budget_left_cny));
      setText('status-token', formatTokens(status.token_remaining));
      setText('status-halted', status.halted ? '已接管停止' : '运行中');
      setText('status-last-event', status.last_event_at === null ? '—' : formatTime(status.last_event_at));
    }).catch(function () {});
  }

  function formatTokens(value) {
    var number = Number(value || 0);
    if (number >= 1000000) { return (number / 1000000).toFixed(2) + 'M'; }
    if (number >= 1000) { return (number / 1000).toFixed(1) + 'K'; }
    return String(number);
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) { return String(iso); }
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  // ---- 配置中心 ---------------------------------------------------------
  function collectFeatures() {
    var features = {};
    var rows = document.querySelectorAll('[data-feature]');
    for (var index = 0; index < rows.length; index++) {
      var row = rows[index];
      var name = row.getAttribute('data-feature');
      var enabled = byId('feature-' + name + '-enabled');
      var approval = byId('feature-' + name + '-approval');
      var note = byId('feature-' + name + '-note');
      features[name] = {
        enabled: enabled !== null ? enabled.checked : false,
        requires_approval: approval !== null ? approval.checked : false,
        note: note !== null ? note.value.trim() : ''
      };
    }
    return features;
  }

  function collectAgents(config) {
    var agents = [];
    for (var index = 0; index < config.agents.length; index++) {
      var agent = config.agents[index];
      var enabled = byId('agent-setting-' + agent.role + '-enabled');
      var autonomy = byId('agent-setting-' + agent.role + '-autonomy');
      var tokenLimit = byId('agent-setting-' + agent.role + '-token-limit');
      agents.push({
        role: agent.role,
        name: agent.name,
        enabled: enabled !== null ? enabled.checked : agent.enabled,
        autonomy: autonomy !== null ? autonomy.value : agent.autonomy,
        tools: agent.tools,
        token_limit: tokenLimit !== null ? Number(tokenLimit.value) : agent.token_limit,
        model_ref: agent.model_ref
      });
    }
    return agents;
  }

  function collectPayments(config) {
    var payments = JSON.parse(JSON.stringify(config.payments));
    for (var index = 0; index < payments.providers.length; index++) {
      var provider = payments.providers[index];
      var enabled = byId('pay-' + provider.kind + '-enabled');
      if (enabled !== null) { provider.enabled = enabled.checked; }
    }
    var invoiceType = byId('invoice-type');
    if (invoiceType !== null) { payments.invoice.default_type = invoiceType.value; }
    var invoiceTitle = byId('invoice-title');
    if (invoiceTitle !== null) { payments.invoice.title = invoiceTitle.value.trim(); }
    var invoiceTax = byId('invoice-tax');
    if (invoiceTax !== null) { payments.invoice.tax_no_masked = invoiceTax.value.trim(); }
    var dual = byId('pay-dual-review');
    if (dual !== null) { payments.require_dual_review = dual.checked; }
    var signContract = byId('pay-sign-contract');
    if (signContract !== null) { payments.sign_contract = signContract.checked; }
    payments.ai_may_sign = false;
    return payments;
  }

  function selectedMode() {
    var checked = document.querySelector('input[name="run-mode"]:checked');
    return checked === null ? null : checked.value;
  }

  function buildPatch(config) {
    var mode = selectedMode();
    var patch = {
      features: collectFeatures(),
      budgets: {
        month_cny: Number((byId('budget-month') || {}).value || 0),
        project_cny: Number((byId('budget-project') || {}).value || 0),
        per_txn_cny: Number((byId('budget-txn') || {}).value || 0),
        zero_budget_mode: byId('budget-zero') !== null ? byId('budget-zero').checked : config.budgets.zero_budget_mode,
        allow_free_local_actions: config.budgets.allow_free_local_actions
      },
      token_budget: {
        limit_tokens: Number((byId('token-limit') || {}).value || 0),
        per_action_limit: Number((byId('token-per-action') || {}).value || 0),
        used_tokens: config.token_budget.used_tokens,
        on_exceed: (byId('token-on-exceed') || {}).value || 'block'
      },
      payments: collectPayments(config),
      agents: collectAgents(config),
      approval: {
        timeout_minutes: Number((byId('approval-timeout') || {}).value || 0),
        auto_approve: false,
        dual_review_threshold_cny: Number((byId('approval-dual-threshold') || {}).value || 0),
        takeover_shortcut: (byId('approval-takeover') || {}).value || ''
      }
    };
    if (mode !== null) { patch.profile = { mode: mode }; }
    return patch;
  }

  function showSettingsResult(ok, message, errors) {
    var feedback = byId('settings-feedback');
    var errorBox = byId('settings-errors');
    if (feedback !== null) {
      feedback.textContent = message;
      feedback.className = 'settings-feedback' + (ok ? '' : ' error');
    }
    if (errorBox !== null) {
      if (errors !== undefined && errors.length > 0) {
        errorBox.hidden = false;
        errorBox.textContent = '保存失败：' + errors.join('；');
      } else {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
    }
  }

  function saveSettings() {
    var saveButton = byId('settings-save');
    if (saveButton !== null) { saveButton.disabled = true; }
    showSettingsResult(true, '保存中…', []);
    api('GET', '/api/config').then(function (payload) {
      var config = payload.data;
      var mode = selectedMode();
      if (mode !== null && mode !== config.profile.mode) {
        return api('POST', '/api/config/apply-mode', { mode: mode }).then(function (applied) {
          return { modeChanged: true, applied: applied, config: config };
        });
      }
      return api('PUT', '/api/config', buildPatch(config)).then(function (result) {
        return { modeChanged: false, applied: null, result: result, config: config };
      });
    }).then(function (outcome) {
      if (outcome.modeChanged === true) {
        var diff = outcome.applied !== null && outcome.applied.data !== undefined && outcome.applied.data.diff !== undefined ? outcome.applied.data.diff : [];
        showSettingsResult(true, '已切换运行模式并应用默认配置（' + nowText() + '）' + (diff.length > 0 ? '：' + diff.join('；') : ''), []);
        refreshStatus();
        toast('运行模式已切换，正在刷新页面…', 'ok');
        window.setTimeout(function () { window.location.reload(); }, 900);
        return;
      }
      showSettingsResult(true, '已保存配置（' + nowText() + '）', []);
      refreshStatus();
      toast('配置已保存并立即生效', 'ok');
      if (saveButton !== null) { saveButton.disabled = false; }
    }).catch(function (error) {
      var payload = error.payload;
      var errors = payload !== null && payload !== undefined && payload.data !== undefined && payload.data.errors !== undefined ? payload.data.errors : [error.message];
      showSettingsResult(false, '保存失败', errors);
      if (saveButton !== null) { saveButton.disabled = false; }
    });
  }

  function initSettings() {
    var page = byId('settings-page') !== null || byId('settings-save') !== null;
    if (!page) { return; }

    var cards = document.querySelectorAll('.mode-card');
    for (var index = 0; index < cards.length; index++) {
      (function (card) {
        card.addEventListener('click', function () {
          var input = card.querySelector('input[name="run-mode"]');
          if (input !== null) { input.checked = true; }
          for (var i = 0; i < cards.length; i++) { cards[i].classList.remove('selected'); }
          card.classList.add('selected');
          var states = document.querySelectorAll('.mode-card-state');
          for (var j = 0; j < states.length; j++) { states[j].textContent = '点击选择'; }
          var state = card.querySelector('.mode-card-state');
          if (state !== null) { state.textContent = '✓ 已选择（保存后生效）'; }
        });
      })(cards[index]);
    }

    var zero = byId('budget-zero');
    if (zero !== null) {
      zero.addEventListener('change', function () {
        var hint = byId('zero-budget-hint');
        if (hint !== null) { hint.hidden = !zero.checked; }
      });
    }

    var saveButton = byId('settings-save');
    if (saveButton !== null) { saveButton.addEventListener('click', saveSettings); }
    var resetButton = byId('settings-reset');
    if (resetButton !== null) {
      resetButton.addEventListener('click', function () {
        api('POST', '/api/config/reset', {}).then(function () {
          toast('已恢复该模式默认配置', 'ok');
          window.setTimeout(function () { window.location.reload(); }, 500);
        }).catch(function (error) { showSettingsResult(false, '恢复默认失败', [error.message]); });
      });
    }
    var exportButton = byId('settings-export');
    if (exportButton !== null) { exportButton.addEventListener('click', downloadConfig); }
    refreshStatus();
  }

  function downloadConfig() {
    api('GET', '/api/config/export').then(function (payload) {
      var text = payload.data.json;
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'steward-config.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast('配置 JSON 已导出', 'ok');
      var note = byId('data-export-note');
      if (note !== null) { note.hidden = false; }
    }).catch(function (error) { toast('导出失败：' + error.message, 'error'); });
  }

  // ---- 智能体中心 -------------------------------------------------------
  function initAgents() {
    var grid = byId('agents-grid');
    if (grid === null) { return; }
    var buttons = document.querySelectorAll('[data-agent-expand]');
    for (var index = 0; index < buttons.length; index++) {
      (function (button) {
        button.addEventListener('click', function () {
          var role = button.getAttribute('data-agent-expand');
          var detail = byId('agent-detail-' + role);
          if (detail === null) { return; }
          var open = detail.hidden;
          detail.hidden = !open;
          button.textContent = open ? '收起详情' : '展开详情';
          button.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      })(buttons[index]);
    }
  }

  // ---- 后台 -------------------------------------------------------------
  function initBackend() {
    var filter = byId('flow-filter');
    if (filter === null) { return; }
    filter.addEventListener('change', function () {
      var value = filter.value;
      var items = document.querySelectorAll('#flow-timeline .flow-item');
      var visible = 0;
      for (var index = 0; index < items.length; index++) {
        var item = items[index];
        var show = value === 'all' || item.getAttribute('data-phase') === value;
        item.hidden = !show;
        if (show) { visible += 1; }
      }
      setText('flow-count', visible + ' 条事件（过滤：' + value + '）');
    });
  }

  // ---- 数据管理 ---------------------------------------------------------
  function reloadSoon() {
    window.setTimeout(function () { window.location.reload(); }, 500);
  }

  function initData() {
    var clearButton = byId('data-clear');
    var modal = byId('data-confirm-modal');
    if (clearButton !== null && modal !== null) {
      clearButton.addEventListener('click', function () { modal.hidden = false; });
      var cancel = byId('data-confirm-cancel');
      if (cancel !== null) { cancel.addEventListener('click', function () { modal.hidden = true; }); }
      var confirmButton = byId('data-confirm-yes');
      if (confirmButton !== null) {
        confirmButton.addEventListener('click', function () {
          confirmButton.disabled = true;
          api('POST', '/api/data/reset', { confirm: true }).then(function () {
            toast('运行数据已清空（配置保留）', 'ok');
            reloadSoon();
          }).catch(function (error) {
            confirmButton.disabled = false;
            toast('清空失败：' + error.message, 'error');
          });
        });
      }
      modal.addEventListener('click', function (event) {
        if (event.target === modal) { modal.hidden = true; }
      });
    }
    var resetDemo = byId('data-reset-demo');
    if (resetDemo !== null) {
      resetDemo.addEventListener('click', function () {
        api('POST', '/api/data/reset-demo', {}).then(function () {
          toast('已重置为演示数据', 'ok');
          reloadSoon();
        }).catch(function (error) { toast('重置失败：' + error.message, 'error'); });
      });
    }
    var resetDemoEmpty = byId('data-reset-demo-empty');
    if (resetDemoEmpty !== null) {
      resetDemoEmpty.addEventListener('click', function () {
        api('POST', '/api/data/reset-demo', {}).then(function () { reloadSoon(); });
      });
    }
    var exportButton = byId('data-export');
    if (exportButton !== null) { exportButton.addEventListener('click', downloadConfig); }
  }

  function init() {
    initSettings();
    initAgents();
    initBackend();
    initData();
    refreshStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
