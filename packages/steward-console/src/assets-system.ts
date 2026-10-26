/**
 * packages/steward-console/src/assets-system.ts
 *
 * v1.3 静态资源：系统总控（/system）样式与交互 + 易支付设置保存。
 * - 危险动作：发起 → 弹窗展示风险/备份路径/确认令牌 → 输入令牌与「确认删除」→ 执行；
 * - 快捷命令、程序启停/重启、插件启停、supervisor 对话、易支付保存。
 */

export const SYSTEM_CSS = `/* ===== v1.3：系统总控 ===== */
.system-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.5fr); gap: 16px; align-items: start; }
.system-chat .chat-messages { max-height: 560px; }
.quick-commands { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.quick-cmd { font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 999px; border: 1px solid #cfd9ff; background: #f4f6ff; color: #3b5bfd; cursor: pointer; }
.quick-cmd:hover { background: #e9edff; }
.layer-block { margin-bottom: 12px; }
.layer-diagram { display: flex; flex-direction: column; gap: 4px; }
.layer-node { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; font-size: 13px; }
.layer-top { border-color: #c9d4ff; background: #fbfcff; }
.layer-index { font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; background: #0c1322; color: #9df3e5; }
.layer-note { margin-left: auto; font-size: 11px; color: var(--muted); }
.layer-arrow { text-align: center; font-size: 14px; color: #8fa3bd; line-height: 1; }
.layer-agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; padding: 10px 12px; border: 1px dashed #cfd9ff; border-radius: 10px; background: #fbfcff; }
.layer-agents-title { grid-column: 1 / -1; font-size: 11px; font-weight: 800; color: var(--muted); }
.layer-agent { display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: #fff; text-decoration: none; color: inherit; font-size: 12px; }
.layer-agent:hover { border-color: #c4d0f8; text-decoration: none; }
.system-status h3 { margin: 16px 0 6px; font-size: 13px; color: #47536b; }
.system-table { font-size: 12px; }
.system-table td { vertical-align: top; }
.program-status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; background: #eef1f8; color: #47536b; }
.program-status[data-status="running"] { background: #e8f7ee; color: #0f7a45; }
.program-status[data-status="stopped"] { background: var(--danger-soft); color: var(--danger); }
.program-actions, .plugin-actions { display: flex; gap: 5px; flex-wrap: wrap; }
.program-actions button, .plugin-actions button { font-size: 11px; padding: 3px 8px; }
button.danger-ghost { color: var(--danger); border-color: #f5c2bf; background: #fff; }
button.danger-ghost:hover { background: var(--danger-soft); }
.system-logs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; }
.log-item { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 5px 8px; border-radius: 7px; font-size: 12px; background: #fbfcff; border: 1px solid #eef1f7; }
.log-level { font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 1px 6px; border-radius: 999px; background: #eef1f8; }
.level-warn { background: var(--warn-soft); color: #7a4a00; }
.level-error { background: var(--danger-soft); color: var(--danger); }
.level-info { background: var(--ok-soft); color: var(--ok); }
.danger-modal-body { width: min(560px, 100%); }
.danger-modal-body h2 { color: var(--danger); }
.danger-block { display: flex; flex-direction: column; gap: 2px; margin: 8px 0; font-size: 12px; }
.danger-label { font-size: 10px; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
.danger-risk { padding: 8px 10px; border-radius: 8px; background: var(--danger-soft); border: 1px solid #f5c2bf; }
.danger-input-label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; font-size: 12px; font-weight: 700; color: #7a4a00; }
/* ===== v1.3：易支付分组 ===== */
.panel-epay { border: 2px solid #cfd9ff; }
.panel-epay h2 { color: #3b5bfd; }
.epay-methods { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; min-height: 34px; }
@media (max-width: 1100px) { .system-layout { grid-template-columns: 1fr; } }
`;

export const SYSTEM_JS = `(function () {
  'use strict';

  var TOKEN = readMeta('steward-token');

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

  function showError(id, message) {
    var element = byId(id);
    if (element === null) { return; }
    if (message === undefined || message === null || message === '') {
      element.hidden = true;
      element.textContent = '';
    } else {
      element.hidden = false;
      element.textContent = String(message);
    }
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

  function reloadSoon(delay) {
    window.setTimeout(function () { window.location.reload(); }, delay === undefined ? 500 : delay);
  }

  function errorsOf(error) {
    var payload = error.payload;
    if (payload !== null && payload !== undefined && payload.data !== undefined && payload.data.errors !== undefined) {
      return payload.data.errors;
    }
    return [error.message];
  }

  // ---- 与超级总调度对话 / 快捷命令 --------------------------------------
  function sendSupervisorMessage(text) {
    if (String(text || '').trim() === '') { return; }
    api('POST', '/api/system/supervisor/messages', { text: String(text).trim() }).then(function () {
      reloadSoon(350);
    }).catch(function (error) {
      showError('system-feedback', '发送失败：' + errorsOf(error).join('；'));
    });
  }

  function initSupervisor() {
    var send = byId('supervisor-send');
    var input = byId('supervisor-input');
    if (send !== null && input !== null) {
      send.addEventListener('click', function () { sendSupervisorMessage(input.value); });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); sendSupervisorMessage(input.value); }
      });
    }
    var quick = document.querySelectorAll('.quick-cmd[data-command]');
    for (var index = 0; index < quick.length; index++) {
      (function (button) {
        button.addEventListener('click', function () {
          button.disabled = true;
          api('POST', '/api/system/command', { command: button.getAttribute('data-command') }).then(function (payload) {
            toast('命令已执行：' + payload.data.message, 'ok');
            reloadSoon(600);
          }).catch(function (error) {
            button.disabled = false;
            showError('system-feedback', '命令失败：' + errorsOf(error).join('；'));
          });
        });
      })(quick[index]);
    }
  }

  // ---- 程序 / 插件操作 ---------------------------------------------------
  function initPrograms() {
    var buttons = document.querySelectorAll('[data-program-action]');
    for (var index = 0; index < buttons.length; index++) {
      (function (button) {
        button.addEventListener('click', function () {
          var programId = button.getAttribute('data-program-id');
          var action = button.getAttribute('data-program-action');
          button.disabled = true;
          api('POST', '/api/system/programs/' + encodeURIComponent(programId) + '/action', { action: action }).then(function (payload) {
            toast(payload.data.message, 'ok');
            reloadSoon(500);
          }).catch(function (error) {
            button.disabled = false;
            showError('system-feedback', '操作失败：' + errorsOf(error).join('；'));
          });
        });
      })(buttons[index]);
    }
    var toggles = document.querySelectorAll('[data-plugin-toggle]');
    for (var t = 0; t < toggles.length; t++) {
      (function (button) {
        button.addEventListener('click', function () {
          var pluginId = button.getAttribute('data-plugin-id');
          var row = byId('plugin-' + pluginId);
          var enabled = row !== null && row.getAttribute('data-plugin-enabled') === 'true';
          button.disabled = true;
          api('POST', '/api/system/plugins/' + encodeURIComponent(pluginId) + '/action', { enabled: !enabled }).then(function (payload) {
            toast(payload.data.message, 'ok');
            reloadSoon(500);
          }).catch(function (error) {
            button.disabled = false;
            showError('system-feedback', '插件操作失败：' + errorsOf(error).join('；'));
          });
        });
      })(toggles[t]);
    }
  }

  // ---- 危险动作二次确认 --------------------------------------------------
  function initDanger() {
    var modal = byId('system-danger-modal');
    if (modal === null) { return; }
    var pending = null;
    function close() { modal.hidden = true; pending = null; showError('danger-error', ''); }
    function open(confirm) {
      pending = confirm;
      setText('danger-action', confirm.request.action === 'delete_program' ? '删除受管程序（不可撤销）' : '删除插件（不可撤销）');
      setText('danger-target', confirm.request.target_name + '（' + confirm.request.target_id + '）');
      setText('danger-risk', confirm.risk || '—');
      setText('danger-backup', confirm.backup_path || '—');
      setText('danger-token-display', confirm.confirm_token || '—');
      var tokenInput = byId('danger-token-input');
      var textInput = byId('danger-text-input');
      if (tokenInput !== null) { tokenInput.value = ''; }
      if (textInput !== null) { textInput.value = ''; }
      showError('danger-error', '');
      modal.hidden = false;
    }
    var deleteButtons = document.querySelectorAll('[data-danger-delete]');
    for (var index = 0; index < deleteButtons.length; index++) {
      (function (button) {
        button.addEventListener('click', function () {
          var targetId = button.getAttribute('data-target-id');
          var action = button.getAttribute('data-danger-delete');
          api('POST', '/api/system/danger/prepare', { action: action, target_id: targetId }).then(function (payload) {
            open(payload.data);
          }).catch(function (error) {
            showError('system-feedback', '无法发起删除：' + errorsOf(error).join('；'));
          });
        });
      })(deleteButtons[index]);
    }
    var cancel = byId('danger-cancel');
    if (cancel !== null) { cancel.addEventListener('click', close); }
    modal.addEventListener('click', function (event) { if (event.target === modal) { close(); } });
    var confirmButton = byId('danger-confirm');
    if (confirmButton !== null) {
      confirmButton.addEventListener('click', function () {
        if (pending === null) { return; }
        var tokenInput = byId('danger-token-input');
        var textInput = byId('danger-text-input');
        confirmButton.disabled = true;
        api('POST', '/api/system/danger/execute', {
          action: pending.request.action,
          target_id: pending.request.target_id,
          confirm_token: tokenInput === null ? '' : tokenInput.value.trim(),
          confirm_text: textInput === null ? '' : textInput.value.trim()
        }).then(function (payload) {
          close();
          toast(payload.data.message, 'warn');
          reloadSoon(600);
        }).catch(function (error) {
          confirmButton.disabled = false;
          showError('danger-error', '执行被拒绝：' + errorsOf(error).join('；'));
        });
      });
    }
  }

  // ---- 易支付设置保存（/system 无、/money 与 /settings 有） -----------------
  function initEpay() {
    var saveButton = byId('epay-save');
    if (saveButton === null) { return; }
    saveButton.addEventListener('click', function () {
      var enabled = byId('epay-enabled');
      var mode = byId('epay-mode');
      var gateway = byId('epay-gateway');
      var merchant = byId('epay-merchant');
      var keyRef = byId('epay-key-ref');
      var notify = byId('epay-notify');
      var returnUrl = byId('epay-return');
      var methods = [];
      var alipay = byId('epay-method-alipay');
      var wxpay = byId('epay-method-wxpay');
      if (alipay !== null && alipay.checked) { methods.push('alipay'); }
      if (wxpay !== null && wxpay.checked) { methods.push('wxpay'); }
      saveButton.disabled = true;
      setText('epay-feedback', '保存中…');
      api('PUT', '/api/system/epay', {
        enabled: enabled !== null && enabled.checked,
        mode: mode === null ? 'demo' : mode.value,
        gateway_url: gateway === null ? '' : gateway.value,
        merchant_id: merchant === null ? '' : merchant.value,
        api_key_ref: keyRef === null ? '' : keyRef.value,
        methods: methods,
        notify_url: notify === null ? '' : notify.value,
        return_url: returnUrl === null ? '' : returnUrl.value
      }).then(function (payload) {
        saveButton.disabled = false;
        showError('epay-error', '');
        setText('epay-feedback', '已保存易支付设置（' + new Date().toLocaleTimeString('zh-CN') + '）');
        setText('epay-key-masked', payload.data.config.api_key_masked);
        setText('epay-updated', new Date().toLocaleString('zh-CN'));
        toast('易支付设置已保存' + (payload.data.config.mode === 'demo' ? '（demo 模式不真实扣款）' : ''), 'ok');
      }).catch(function (error) {
        saveButton.disabled = false;
        setText('epay-feedback', '保存失败');
        showError('epay-error', '保存失败：' + errorsOf(error).join('；'));
      });
    });
  }

  function init() {
    initSupervisor();
    initPrograms();
    initDanger();
    initEpay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
