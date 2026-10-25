/**
 * packages/steward-console/src/assets.ts
 *
 * 控制台前端静态资源（CSS + 原生 JS）以字符串常量内联在包内：
 * - 零第三方依赖、无 CDN / 外链 / 外网字体（系统字体）；
 * - 由 server.ts 通过 `/assets/app.css`、`/assets/app.js` 同源提供；
 * - 客户端脚本从 `<meta name="steward-token">` 读取写操作 token（不写死在 JS 里，
 *   也不进 URL/日志），所有写请求带 `X-Steward-Token`。
 *
 * 注意：本文件用模板字符串保存前端代码，因此前端代码内**不得**出现反引号或 `${`。
 */

export const BASE_CSS = `:root {
  --bg: #f4f6fb;
  --panel: #ffffff;
  --ink: #1e2433;
  --muted: #67708a;
  --line: #e3e7f2;
  --brand: #3b5bfd;
  --brand-soft: #eef1ff;
  --ok: #0f9d58;
  --ok-soft: #e8f7ee;
  --warn: #b26a00;
  --warn-soft: #fff4e2;
  --danger: #d93025;
  --danger-soft: #fdebea;
  --radius: 12px;
  --shadow: 0 1px 2px rgba(20, 30, 60, 0.06), 0 8px 24px rgba(20, 30, 60, 0.06);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 14px;
  line-height: 1.6;
}

a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}

.header-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.brand { font-size: 17px; font-weight: 700; letter-spacing: 0.2px; }
.brand small { color: var(--muted); font-weight: 400; margin-left: 8px; font-size: 12px; }

.local-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 12px;
  font-weight: 600;
}
.local-badge::before { content: "●"; color: var(--ok); font-size: 10px; }

nav.main-nav { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }

nav.main-nav a {
  padding: 6px 12px;
  border-radius: 999px;
  color: var(--muted);
  font-weight: 600;
  border: 1px solid transparent;
}
nav.main-nav a:hover { background: var(--brand-soft); color: var(--brand); text-decoration: none; }
nav.main-nav a.active { background: var(--brand); color: #fff; }

.halt-banner {
  max-width: 1180px;
  margin: 12px auto 0;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--danger-soft);
  border: 1px solid #f5c2bf;
  color: #8f1d18;
  font-weight: 600;
}

main { max-width: 1180px; margin: 0 auto; padding: 20px; }

.page-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin: 4px 0 16px; }
.page-title h1 { font-size: 22px; margin: 0; }
.page-title .as-of { color: var(--muted); font-size: 12px; margin-left: auto; }

.grid { display: grid; gap: 16px; }
.grid-2 { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px;
}
.panel h2 { font-size: 15px; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
.panel h2 .hint { color: var(--muted); font-size: 12px; font-weight: 400; }

.budget-card { margin-bottom: 12px; }
.budget-card:last-child { margin-bottom: 0; }
.budget-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.budget-head strong { font-variant-numeric: tabular-nums; }
.bar { height: 10px; background: #edf0f9; border-radius: 999px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: linear-gradient(90deg, #5b7cff, #3b5bfd); border-radius: 999px; }
.bar.warn > span { background: linear-gradient(90deg, #ffb54d, #e08b00); }
.bar.danger > span { background: linear-gradient(90deg, #ff7b72, #d93025); }

.project-card { display: flex; flex-direction: column; gap: 8px; }
.project-card .project-top { display: flex; align-items: baseline; gap: 8px; }
.project-card .project-name { font-weight: 700; font-size: 15px; }
.project-card .project-client { color: var(--muted); font-size: 12px; }
.project-card .project-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.project-card .project-link { margin-left: auto; font-size: 13px; }

.badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: var(--brand-soft);
  color: var(--brand);
}
.badge.status-active { background: var(--ok-soft); color: var(--ok); }
.badge.status-at_risk { background: var(--warn-soft); color: var(--warn); }
.badge.status-done { background: #eef1f5; color: #5b6478; }
.badge.status-paused { background: var(--danger-soft); color: var(--danger); }
.badge.status-pending { background: var(--warn-soft); color: var(--warn); }
.badge.status-approved { background: var(--ok-soft); color: var(--ok); }
.badge.status-rejected { background: var(--danger-soft); color: var(--danger); }
.badge.status-running { background: var(--brand-soft); color: var(--brand); }
.badge.status-idle { background: #eef1f5; color: #5b6478; }
.badge.status-awaiting_approval { background: var(--warn-soft); color: var(--warn); }

.task-group { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 10px; }
.task-group:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.task-group h3 { margin: 0 0 6px; font-size: 13px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.task-row { display: flex; gap: 10px; align-items: baseline; padding: 4px 0; border-bottom: 1px solid #f1f3fa; font-size: 13px; }
.task-row:last-child { border-bottom: none; }
.task-row .task-goal { flex: 1; }
.task-row code { font-size: 11px; color: var(--muted); background: #f5f7fc; padding: 1px 6px; border-radius: 6px; }

.agent-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f1f3fa; }
.agent-row:last-child { border-bottom: none; }
.agent-row .agent-role { font-weight: 600; min-width: 90px; }

.summary-line { font-size: 15px; font-weight: 600; }

.timeline { list-style: none; margin: 0; padding: 0; }
.timeline-item { position: relative; padding: 0 0 16px 22px; border-left: 2px solid var(--line); margin-left: 6px; }
.timeline-item:last-child { padding-bottom: 0; }
.timeline-item::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 6px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--brand);
}
.timeline-item .timeline-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.timeline-item .timeline-kind { padding: 0 7px; border-radius: 999px; background: #eef1f8; color: #5b6478; font-size: 11px; }
.timeline-item .timeline-text { font-size: 14px; }
.timeline-item .evidence-link { margin-top: 4px; }

.evidence-detail { margin-top: 10px; border: 1px dashed var(--brand); background: var(--brand-soft); border-radius: var(--radius); padding: 12px; }
.evidence-detail dl { display: grid; grid-template-columns: 90px 1fr; gap: 6px 12px; margin: 0; }
.evidence-detail dt { color: var(--muted); }
.evidence-detail dd { margin: 0; word-break: break-all; font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 13px; }

table.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.data-table th, table.data-table td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
table.data-table th { color: var(--muted); font-size: 12px; font-weight: 600; background: #fafbff; }
table.data-table tbody tr { cursor: pointer; }
table.data-table tbody tr:hover { background: #f7f9ff; }
table.data-table .amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
table.data-table .amount.income { color: var(--ok); }
table.data-table .amount.cost { color: var(--danger); }

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 100%);
  background: #fff;
  border-left: 1px solid var(--line);
  box-shadow: -12px 0 40px rgba(20, 30, 60, 0.16);
  z-index: 40;
  padding: 20px;
  overflow-y: auto;
}
.drawer[hidden] { display: none; }
.drawer-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.drawer-head h2 { margin: 0; font-size: 16px; }
.drawer-head button { margin-left: auto; }
.drawer dl { display: grid; grid-template-columns: 96px 1fr; gap: 10px 14px; margin: 0; }
.drawer dt { color: var(--muted); }
.drawer dd { margin: 0; word-break: break-all; }
.drawer dd.strong { font-weight: 700; font-variant-numeric: tabular-nums; }
.drawer-hint { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--line); color: var(--muted); font-size: 12px; }

button {
  font: inherit;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 7px 14px;
  cursor: pointer;
  font-weight: 600;
}
button:hover { border-color: var(--brand); color: var(--brand); }
button:disabled { opacity: 0.55; cursor: not-allowed; }
button.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
button.primary:hover { filter: brightness(1.06); color: #fff; }
button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
button.danger:hover { filter: brightness(1.06); color: #fff; }
button.ghost { background: #fff; }
button.big {
  font-size: 20px;
  padding: 18px 34px;
  border-radius: 16px;
  letter-spacing: 1px;
}

.approval-card { display: flex; flex-direction: column; gap: 8px; }
.approval-card .approval-head { display: flex; align-items: center; gap: 8px; }
.approval-card .approval-kind { font-size: 12px; color: var(--muted); font-weight: 600; }
.approval-card .approval-summary { font-size: 14px; font-weight: 600; }
.approval-card .approval-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); }
.approval-card .approval-evidence { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--muted); }
.approval-card .approval-actions { display: flex; gap: 8px; margin-top: 4px; }
.approval-card[data-approval-status="approved"] { border-color: #bfe6d0; background: #f7fdf9; }
.approval-card[data-approval-status="rejected"] { border-color: #f5c2bf; background: #fff9f9; }

.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.metric { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
.metric .metric-label { color: var(--muted); font-size: 12px; }
.metric .metric-value { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
.metric .metric-note { color: var(--muted); font-size: 11px; }
.metric.income .metric-value { color: var(--ok); }
.metric.cost .metric-value { color: var(--danger); }
.metric.margin .metric-value { color: var(--brand); }

.list-clean { margin: 0; padding-left: 18px; }
.list-clean li { margin: 4px 0; }

.takeover-idle { text-align: center; padding: 26px 16px; }
.takeover-idle h2 { justify-content: center; font-size: 18px; }
.takeover-idle p { color: var(--muted); max-width: 560px; margin: 8px auto 20px; }

.takeover-state { border-radius: var(--radius); border: 1px solid var(--line); background: #fff; padding: 16px; }
.takeover-state[data-halted="true"] { border-color: #f5c2bf; background: #fffafa; }
.takeover-state .state-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 12px; }
.takeover-state .state-head h2 { margin: 0; font-size: 18px; }
.timer {
  margin-left: auto;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 16px;
  font-weight: 700;
  color: var(--danger);
  background: var(--danger-soft);
  padding: 4px 12px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.pack-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 14px; }
.pack { border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; background: #fff; }
.pack h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
.pack ul { margin: 0; padding-left: 18px; font-size: 13px; }
.pack li { margin: 3px 0; }
.pack.coverage { display: flex; flex-direction: column; justify-content: center; }
.coverage-value { font-size: 24px; font-weight: 700; color: var(--warn); }

.toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 999px;
  background: #222941;
  color: #fff;
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
  z-index: 60;
  max-width: 92vw;
}
.toast.toast-show { opacity: 1; }
.toast.toast-ok { background: #107d47; }
.toast.toast-error { background: #b3261e; }

.site-footer {
  max-width: 1180px;
  margin: 20px auto 0;
  padding: 16px 20px 40px;
  color: var(--muted);
  font-size: 12px;
  border-top: 1px solid var(--line);
}
.site-footer code { background: #eef1f8; padding: 1px 6px; border-radius: 6px; }

.empty-state { color: var(--muted); padding: 18px; text-align: center; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, Consolas, "Courier New", monospace; }
.error-page { text-align: center; padding: 60px 20px; }
.error-page h1 { font-size: 40px; margin: 0; color: var(--muted); }
`;

/**
 * 前端脚本（原生 JS，同源加载）。
 * 交互：账本详情抽屉（B2 6 要素）、证据详情、审批批准/驳回、接管键/恢复、到期倒计时。
 */
export const CLIENT_JS = `(function () {
  'use strict';

  var TOKEN = readMeta('steward-token');
  var toastTimer = null;
  var takeoverTimer = null;

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

  function formatDateTime(iso) {
    if (!iso) { return '—'; }
    var date = new Date(iso);
    if (isNaN(date.getTime())) { return String(iso); }
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function formatElapsed(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    return pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
  }

  function approvalLabel(status) {
    if (status === 'approved') { return '已批准'; }
    if (status === 'rejected') { return '已驳回'; }
    return '待批准';
  }

  function showToast(message, kind) {
    var toast = byId('toast');
    if (toast === null) { return; }
    toast.textContent = message;
    toast.className = 'toast toast-show toast-' + (kind || 'info');
    if (toastTimer !== null) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () {
      toast.className = 'toast';
    }, 4000);
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
        try {
          payload = text === '' ? null : JSON.parse(text);
        } catch (error) {
          payload = null;
        }
        if (!response.ok) {
          var message = payload !== null && payload.message ? payload.message : 'HTTP ' + String(response.status);
          throw new Error(message);
        }
        return payload;
      });
    });
  }

  // ---- 账本：点击一笔 → 详情抽屉显示 6 要素（B2 验收点） ----------------
  function initLedger() {
    var table = byId('ledger-table');
    var drawer = byId('ledger-drawer');
    if (table === null || drawer === null) { return; }

    var rows = table.querySelectorAll('tbody tr[data-entry-id]');
    for (var index = 0; index < rows.length; index++) {
      (function (row) {
        var open = function () {
          openFacts(row.getAttribute('data-entry-id'), row.getAttribute('data-project-name') || '');
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { open(); }
        });
      })(rows[index]);
    }

    function openFacts(entryId, projectName) {
      api('GET', '/api/ledger/' + encodeURIComponent(entryId) + '/facts').then(function (payload) {
        var facts = payload.data;
        setText('facts-amount', cny(facts.amount_cny));
        setText('facts-payee', facts.payee_or_payer);
        setText('facts-basis', facts.basis);
        setText('facts-approver', facts.approved_by);
        setText('facts-receipt', facts.receipt_ref);
        setText('facts-project', (projectName === '' ? '' : projectName + ' · ') + facts.project_id);
        drawer.setAttribute('data-entry-id', entryId);
        drawer.setAttribute('data-facts-ready', 'true');
        drawer.hidden = false;
      }).catch(function (error) {
        showToast('读取账本详情失败：' + error.message, 'error');
      });
    }

    var close = byId('drawer-close');
    if (close !== null) {
      close.addEventListener('click', function () {
        drawer.hidden = true;
        drawer.removeAttribute('data-facts-ready');
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { drawer.hidden = true; }
    });
  }

  // ---- 项目时间线：点开证据 → 路径/类型/置信度 ---------------------------
  function initEvidence() {
    var links = document.querySelectorAll('[data-evidence-ref]');
    var panel = byId('evidence-detail');
    if (links.length === 0 || panel === null) { return; }
    for (var index = 0; index < links.length; index++) {
      (function (link) {
        link.addEventListener('click', function () {
          var ref = link.getAttribute('data-evidence-ref');
          api('GET', '/api/evidence/' + encodeURIComponent(ref)).then(function (payload) {
            var evidence = payload.data;
            setText('evidence-ref', evidence.id);
            setText('evidence-path', evidence.path);
            setText('evidence-type', evidence.kind);
            setText('evidence-confidence', evidence.confidence);
            setText('evidence-captured-at', formatDateTime(evidence.captured_at));
            panel.hidden = false;
            panel.setAttribute('data-evidence-ready', 'true');
          }).catch(function (error) {
            showToast('读取证据失败：' + error.message, 'error');
          });
        });
      })(links[index]);
    }
  }

  // ---- 审批卡：批准 / 驳回 → 状态即时更新 -------------------------------
  function initApprovals() {
    var cards = document.querySelectorAll('.approval-card');
    if (cards.length === 0) { return; }
    for (var index = 0; index < cards.length; index++) {
      (function (card) {
        var approvalId = card.getAttribute('data-approval-id');
        var buttons = card.querySelectorAll('button[data-decision]');
        for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
          (function (button) {
            button.addEventListener('click', function () {
              var decision = button.getAttribute('data-decision');
              for (var i = 0; i < buttons.length; i++) { buttons[i].disabled = true; }
              api('POST', '/api/approvals/' + encodeURIComponent(approvalId) + '/decide', { decision: decision, by: 'web-console' })
                .then(function (payload) {
                  applyApprovalStatus(card, payload.data.status);
                  showToast('审批已处理：' + approvalId + ' → ' + approvalLabel(payload.data.status), 'ok');
                })
                .catch(function (error) {
                  for (var j = 0; j < buttons.length; j++) { buttons[j].disabled = false; }
                  showToast('审批失败：' + error.message, 'error');
                });
            });
          })(buttons[buttonIndex]);
        }
      })(cards[index]);
    }
    tickCountdowns();
    setInterval(tickCountdowns, 1000);
  }

  function applyApprovalStatus(card, status) {
    card.setAttribute('data-approval-status', status);
    var badge = card.querySelector('[data-status]');
    if (badge !== null) {
      badge.setAttribute('data-status', status);
      badge.className = 'badge status-' + status;
      badge.textContent = approvalLabel(status);
    }
    var buttons = card.querySelectorAll('button[data-decision]');
    for (var i = 0; i < buttons.length; i++) { buttons[i].disabled = true; }
  }

  function tickCountdowns() {
    var nodes = document.querySelectorAll('[data-expires-at]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var expiresAt = node.getAttribute('data-expires-at');
      var remaining = new Date(expiresAt).getTime() - Date.now();
      node.textContent = remaining > 0 ? ('剩余 ' + formatElapsed(remaining)) : String('已过期');
    }
  }

  // ---- 接管键：停止 + 6 类接管包 + 计时；支持恢复 ------------------------
  function initTakeover() {
    var state = byId('takeover-state');
    if (state === null) { return; }

    var trigger = byId('takeover-trigger');
    if (trigger !== null) {
      trigger.addEventListener('click', function () {
        trigger.disabled = true;
        var startedAt = Date.now();
        api('POST', '/api/takeover', { reason: '人工接管（Web 控制台）', by: 'web-console' }).then(function (payload) {
          var measured = Date.now() - startedAt;
          renderTakeover(payload.data, measured);
          showToast('已接管停止（实测 ' + String(measured) + ' ms）', 'ok');
        }).catch(function (error) {
          trigger.disabled = false;
          showToast('接管失败：' + error.message, 'error');
        });
      });
    }

    var resumeButton = byId('takeover-resume');
    if (resumeButton !== null) {
      resumeButton.addEventListener('click', function () {
        resumeButton.disabled = true;
        api('POST', '/api/takeover/resume', { by: 'web-console' }).then(function (payload) {
          renderResume(payload.data);
          showToast('已恢复运行（resumed_at=' + formatDateTime(payload.data.resumed_at) + '）', 'ok');
        }).catch(function (error) {
          resumeButton.disabled = false;
          showToast('恢复失败：' + error.message, 'error');
        });
      });
    }

    // 刷新后仍处于 halted：继续显示接管包与计时
    if (state.getAttribute('data-halted') === 'true') {
      var stoppedAt = state.getAttribute('data-stopped-at');
      if (stoppedAt) { startTimer(stoppedAt); }
    }
  }

  function renderTakeover(result, measuredMs) {
    var state = byId('takeover-state');
    var haltedPanel = byId('takeover-halted');
    var idlePanel = byId('takeover-idle');
    if (state === null || haltedPanel === null || idlePanel === null) { return; }
    state.setAttribute('data-halted', 'true');
    state.setAttribute('data-stopped-at', result.stopped_at);
    state.setAttribute('data-measured-stop-ms', String(measuredMs));
    setText('takeover-stopped-at', formatDateTime(result.stopped_at));
    setText('takeover-measured', '实测停止耗时 ' + String(measuredMs) + ' ms（要求 ≤10000 ms）');
    syncHaltBanner(true);
    var idleHint = byId('takeover-idle-hint');
    if (idleHint !== null) { idleHint.hidden = true; }

    var pack = result.pack || {};
    fillList('pack-open_orders', pack.open_orders);
    fillList('pack-pending_threads', pack.pending_threads);
    fillList('pack-payables', pack.payables);
    fillList('pack-credentials', pack.credentials);
    fillList('pack-risks', pack.risks);
    var coverage = byId('pack-coverage');
    if (coverage !== null) { coverage.textContent = coverageLabel(pack.coverage); }

    haltedPanel.hidden = false;
    idlePanel.hidden = true;
    startTimer(result.stopped_at);
  }

  function renderResume(result) {
    var state = byId('takeover-state');
    var haltedPanel = byId('takeover-halted');
    var idlePanel = byId('takeover-idle');
    if (state === null || haltedPanel === null || idlePanel === null) { return; }
    stopTimer();
    state.setAttribute('data-halted', 'false');
    haltedPanel.hidden = true;
    idlePanel.hidden = false;
    syncHaltBanner(false);
    var hint = byId('takeover-idle-hint');
    if (hint !== null) { hint.hidden = false; }
    setText('takeover-resumed-note', '已于 ' + formatDateTime(result.resumed_at) + ' 恢复运行（halted=false）');
  }

  function syncHaltBanner(halted) {
    var existing = byId('halt-banner');
    if (halted && existing === null) {
      var banner = document.createElement('div');
      banner.className = 'halt-banner';
      banner.id = 'halt-banner';
      banner.setAttribute('role', 'alert');
      banner.textContent = '⚠ 已接管停止（halted=true）：新动作已冻结，等待人工处理。';
      var header = document.querySelector('.site-header');
      if (header !== null && header.parentNode !== null) {
        header.parentNode.insertBefore(banner, header.nextSibling);
      }
    } else if (!halted && existing !== null && existing.parentNode !== null) {
      existing.parentNode.removeChild(existing);
    }
  }

  function fillList(id, items) {
    var list = byId(id);
    if (list === null) { return; }
    while (list.firstChild !== null) { list.removeChild(list.firstChild); }
    var values = items || [];
    for (var i = 0; i < values.length; i++) {
      var item = document.createElement('li');
      item.textContent = String(values[i]);
      list.appendChild(item);
    }
  }

  function coverageLabel(coverage) {
    if (coverage === 'complete') { return '完整（complete）'; }
    if (coverage === 'not_covered') { return '未覆盖（not_covered）'; }
    return '部分覆盖（partial）';
  }

  function startTimer(stoppedAtIso) {
    stopTimer();
    var stoppedMs = new Date(stoppedAtIso).getTime();
    var timer = byId('takeover-timer');
    var tick = function () {
      if (timer === null) { return; }
      var elapsed = Date.now() - stoppedMs;
      timer.textContent = '已停止 ' + formatElapsed(elapsed);
      timer.setAttribute('data-elapsed-ms', String(Math.max(0, Math.floor(elapsed))));
    };
    tick();
    takeoverTimer = setInterval(tick, 250);
  }

  function stopTimer() {
    if (takeoverTimer !== null) {
      clearInterval(takeoverTimer);
      takeoverTimer = null;
    }
  }

  function init() {
    initLedger();
    initEvidence();
    initApprovals();
    initTakeover();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
