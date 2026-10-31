/**
 * packages/steward-console/src/assets-chatgpt.ts
 * v1.5.1 ChatGPT 式对话总控样式与交互（/chat）。
 */

export const GPT_CSS = `/* ===== v1.5.1 ChatGPT 式对话 ===== */
.gpt-page { display: grid; grid-template-columns: 236px minmax(0, 1fr) 300px; gap: 0; height: calc(100vh - 150px); min-height: 620px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #fff; }
.gpt-sidebar { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: #f7f9fd; border-right: 1px solid var(--line); min-height: 0; }
.gpt-new { width: 100%; padding: 8px 10px; border-radius: 9px; border: 1px solid #cfd9ff; background: #fff; color: var(--brand); font-weight: 800; cursor: pointer; }
.gpt-new:hover { background: #f1f4ff; }
.gpt-memory-link { font-size: 12px; font-weight: 700; color: #47536b; text-decoration: none; padding: 6px 8px; border-radius: 8px; }
.gpt-memory-link:hover { background: #eef1f8; }
.gpt-conv-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.gpt-conv-item { display: flex; align-items: center; gap: 4px; padding: 7px 8px; border-radius: 9px; border: 1px solid transparent; }
.gpt-conv-item:hover { background: #eef1f8; }
.gpt-conv-item.active { background: #eef1ff; border-color: #cfd9ff; }
.gpt-conv-open { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; color: inherit; text-decoration: none; }
.gpt-conv-meta { display: none; }
.gpt-conv-item:hover .gpt-conv-meta { display: block; font-size: 10px; }
.gpt-conv-rename, .gpt-conv-delete { border: none; background: transparent; cursor: pointer; color: var(--muted); font-size: 11px; padding: 2px 3px; }
.gpt-conv-rename:hover, .gpt-conv-delete:hover { color: var(--danger); }
.gpt-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.gpt-topbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 14px; border-bottom: 1px solid var(--line); background: #fbfcff; }
.gpt-source { font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: var(--warn-soft); color: #7a4a00; }
.gpt-source[data-source="real"] { background: var(--ok-soft); color: var(--ok); }
.gpt-source[data-source="mixed"] { background: #eef1ff; color: #3b5bfd; }
.gpt-runtime-status { font-size: 11px; color: var(--muted); }
.gpt-chips { display: flex; gap: 5px; flex-wrap: wrap; margin-left: auto; }
.gpt-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: 1px solid #cfd9ff; background: #fff; color: #3b5bfd; cursor: pointer; }
.gpt-chip:hover { background: #eef1ff; }
.gpt-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 18px 22px 10px; min-height: 0; }
.gpt-empty { margin: auto; text-align: center; color: var(--muted); max-width: 460px; }
.gpt-empty-title { font-size: 20px; font-weight: 800; color: var(--ink); margin-bottom: 6px; }
.gpt-msg { display: flex; gap: 10px; align-items: flex-start; }
.gpt-msg[data-role="user"] { flex-direction: row-reverse; }
.gpt-avatar { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; background: #eef1f8; color: #47536b; }
.gpt-msg[data-role="user"] .gpt-avatar { background: #0c1322; color: #9df3e5; }
.gpt-msg[data-role="assistant"] .gpt-avatar { background: var(--brand-soft); color: var(--brand); }
.gpt-bubble { max-width: 84%; display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-radius: 12px; background: #f7f9fd; border: 1px solid var(--line); font-size: 13px; line-height: 1.65; }
.gpt-msg[data-role="user"] .gpt-bubble { background: var(--brand); color: #fff; border-color: transparent; }
.gpt-msg[data-role="user"] .gpt-meta, .gpt-msg[data-role="user"] .muted { color: #dbe4ff; }
.gpt-msg-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; }
.gpt-streaming { font-size: 10px; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: var(--warn-soft); color: #7a4a00; }
.gpt-part { min-width: 0; }
.gpt-md h1 { font-size: 18px; margin: 4px 0 8px; }
.gpt-md h2 { font-size: 15px; margin: 10px 0 6px; }
.gpt-md ul, .gpt-md ol { padding-left: 20px; margin: 4px 0; }
.gpt-md pre { background: #0c1322; color: #dce6f5; padding: 8px 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
.gpt-md code { background: #eef1f8; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.gpt-run-link-wrap { margin: 6px 0 0; }
.gpt-run-link { font-size: 12px; font-weight: 800; color: var(--brand); }
.gpt-card { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 9px 11px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.gpt-card > header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gpt-card-kind { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #eef1ff; color: #3b5bfd; }
.gpt-meta { font-size: 10px; color: var(--muted); }
.gpt-demo { font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: var(--warn-soft); color: #7a4a00; }
.gpt-download { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--brand); }
.gpt-thinking summary, .gpt-report-preview summary, .gpt-artifact-preview summary { font-size: 11px; font-weight: 700; color: #47536b; cursor: pointer; padding: 3px 0; }
.gpt-thinking-text { white-space: pre-wrap; padding: 8px 10px; border-radius: 8px; background: #fbfcff; border: 1px dashed #cfd9ff; font-size: 12px; color: #33415c; }
.gpt-artifact-iframe { width: 100%; height: 240px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.gpt-artifact-md { max-height: 260px; overflow: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fbfcff; }
.gpt-artifact-img img, .gpt-artifact-img svg { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.gpt-artifact-pre { max-height: 240px; overflow: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #0c1322; color: #dce6f5; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
.gpt-report-preview .gpt-md { max-height: 300px; overflow: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fbfcff; }
.gpt-tool, .gpt-tool-result { flex-direction: row; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.gpt-tool[data-status="running"] { border-color: #cfd9ff; background: #f4f6ff; }
.gpt-tool-result[data-status="ok"] { border-color: #bfe6d0; background: #f2fbf6; }
.gpt-tool-name { font-family: ui-monospace, monospace; font-weight: 800; }
.gpt-tool-args { flex: 1; min-width: 120px; color: var(--muted); word-break: break-all; }
.gpt-tool-status { font-size: 10px; font-weight: 700; color: #47536b; }
.gpt-data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gpt-data-table th, .gpt-data-table td { border-bottom: 1px solid #eef1f7; padding: 4px 6px; text-align: left; }
.gpt-approval { border: 1px solid #f0d5a8; background: #fffaf1; }
.gpt-approval-risk { margin: 0; color: #7a4a00; font-weight: 700; }
.gpt-approval-actions { display: flex; gap: 8px; }
.gpt-approval-actions button { font-size: 12px; padding: 4px 12px; }
.gpt-approval[data-status="approved"] { border-color: #bfe6d0; background: #f2fbf6; }
.gpt-approval[data-status="rejected"] { border-color: #f5c2bf; background: #fff5f4; }
.gpt-error { border: 1px solid #f5c2bf; background: #fff5f4; color: var(--danger); }
.gpt-composer { display: flex; gap: 10px; align-items: flex-end; padding: 10px 16px 14px; border-top: 1px solid var(--line); background: #fff; position: relative; }
.gpt-composer textarea { flex: 1; resize: none; font: inherit; font-size: 13px; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); min-height: 44px; max-height: 160px; }
.gpt-composer textarea:focus { outline: 2px solid rgba(59,91,253,0.3); }
.gpt-composer-side { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.gpt-typing { font-size: 10px; font-weight: 800; color: #7a4a00; }
.gpt-typing[hidden] { display: none; }
.gpt-memory-drawer { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: #fbfcff; border-left: 1px solid var(--line); min-height: 0; overflow-y: auto; }
.gpt-memory-drawer header { display: flex; align-items: center; gap: 8px; }
.gpt-memory-drawer h2 { margin: 0; font-size: 14px; }
.gpt-memory-list { display: flex; flex-direction: column; gap: 8px; }
.gpt-memory-item { border: 1px solid var(--line); border-radius: 9px; background: #fff; padding: 8px 10px; font-size: 12px; }
.gpt-memory-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.gpt-memory-head button { margin-left: auto; border: none; background: transparent; cursor: pointer; color: var(--muted); }
.gpt-memory-content { margin: 0 0 4px; line-height: 1.55; }
.gpt-memory-tags { display: flex; gap: 6px; flex-wrap: wrap; font-size: 10px; color: var(--brand); }
.gpt-thinking-group { border: 1px solid #dfe6f3; border-radius: 10px; background: #f8fafd; margin: 0 0 10px; padding: 8px 12px; }
.gpt-thinking-group > summary { cursor: pointer; color: var(--muted); font-weight: 700; }
.gpt-thinking-body { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.gpt-thinking-line { white-space: pre-wrap; color: var(--muted); font-size: 12px; line-height: 1.65; }
.gpt-result { margin: 2px 0 10px; }
.gpt-result-label { font-size: 11px; font-weight: 800; color: #0f7a45; letter-spacing: .04em; margin-bottom: 4px; }
.gpt-deliverables { display: flex; flex-direction: column; gap: 8px; margin: 6px 0; }
.gpt-tool-detail { margin-top: 4px; }
.gpt-tool-result-text { white-space: pre-wrap; word-break: break-all; font-size: 11px; color: var(--muted); }
@media (max-width: 1200px) { .gpt-page { grid-template-columns: 200px minmax(0, 1fr); } .gpt-memory-drawer { display: none; } }
`;

export const GPT_JS = `(function () {
  'use strict';
  var TOKEN = readMeta('steward-token');
  function readMeta(name) { var meta = document.querySelector('meta[name="' + name + '"]'); return meta === null ? '' : (meta.getAttribute('content') || ''); }
  function byId(id) { return document.getElementById(id); }
  function esc(value) { return String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function api(method, path, body) {
    var headers = {};
    var options = { method: method, headers: headers };
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-Steward-Token'] = TOKEN; if (body !== undefined) options.body = JSON.stringify(body); }
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = text === '' ? null : JSON.parse(text); } catch (e) { payload = null; }
        if (!response.ok) { var failure = new Error(payload && payload.message ? payload.message : 'HTTP ' + response.status); failure.payload = payload; throw failure; }
        return payload;
      });
    });
  }
  function toast(text, kind) { var el = byId('toast'); if (el === null) return; el.textContent = text; el.className = 'toast toast-show toast-' + (kind || 'info'); window.setTimeout(function () { el.className = 'toast'; }, 3200); }
  function showError(message) { var el = byId('gpt-error'); if (el === null) return; if (!message) { el.hidden = true; el.textContent = ''; } else { el.hidden = false; el.textContent = message; } }
  function md(source) {
    var FENCE = String.fromCharCode(96, 96, 96);
    var escaped = esc(source);
    var lines = escaped.split('\\n');
    var html = [];
    var inCode = false;
    var inList = false;
    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      if (line.indexOf(FENCE) === 0) {
        if (inCode) { html.push('</code></pre>'); inCode = false; } else { html.push('<pre class="md-code"><code>'); inCode = true; }
        continue;
      }
      if (inCode) { html.push(line + '\\n'); continue; }
      if (/^\\s*-\\s+/.test(line)) { if (!inList) { html.push('<ul>'); inList = true; } html.push('<li>' + inline(line.replace(/^\\s*-\\s+/, '')) + '</li>'); continue; }
      if (inList) { html.push('</ul>'); inList = false; }
      if (/^#{1,3}\\s+/.test(line)) { var level = line.match(/^#+/)[0].length; html.push('<h' + level + '>' + inline(line.replace(/^#{1,3}\\s+/, '')) + '</h' + level + '>'); continue; }
      if (line.trim() === '') { continue; }
      html.push('<p>' + inline(line) + '</p>');
    }
    if (inList) html.push('</ul>');
    if (inCode) html.push('</code></pre>');
    return html.join('');
  }
  function inline(text) {
    var FENCE_CHAR = String.fromCharCode(96);
    return text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>').replace(new RegExp(FENCE_CHAR + '([^' + FENCE_CHAR + ']+)' + FENCE_CHAR, 'g'), '<code>$1</code>');
  }
  function fmtBytes(size) { var value = Number(size) || 0; if (value >= 1024 * 1024) return (value / 1048576).toFixed(1) + ' MB'; if (value >= 1024) return (value / 1024).toFixed(1) + ' KB'; return value + ' B'; }
  function normalizeDisplayParts(parts, streaming) {
    var merged = [];
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (part.type === 'tool_result') {
        var callId = String(part.callId || part.call_id || '');
        var match = null;
        for (var j = merged.length - 1; j >= 0; j -= 1) {
          var item = merged[j];
          if (item.type !== 'tool_call') continue;
          var itemId = String(item.callId || item.call_id || '');
          if ((callId !== '' && itemId === callId) || (callId === '' && String(item.tool || '') === String(part.tool || ''))) { match = item; break; }
        }
        if (match) {
          match.status = part.status === 'error' ? 'error' : 'ok';
          match.result_preview = part.result_preview || part.result_summary || '';
          if (part.duration_ms !== undefined) match.duration_ms = part.duration_ms;
          continue;
        }
      }
      merged.push(Object.assign({}, part));
    }
    var textIndexes = [];
    for (var t = 0; t < merged.length; t += 1) if (merged[t].type === 'text') textIndexes.push(t);
    var lastText = textIndexes.length ? textIndexes[textIndexes.length - 1] : -1;
    var display = { thinking: [], deliverables: [], results: [], approvals: [], errors: [], summary: { steps: 0, tool_calls: 0, artifacts: 0, reports: 0 } };
    for (var index = 0; index < merged.length; index += 1) {
      var current = merged[index];
      if (current.type === 'approval') { display.approvals.push(current); continue; }
      if (current.type === 'error') { display.errors.push(current); continue; }
      if (current.type === 'artifact' || current.type === 'report') { display.deliverables.push(current); continue; }
      var explicitResult = current.phase === 'result' || current.run_link !== undefined;
      var inferredResult = !streaming && ((current.type === 'text' && index === lastText) || (current.type === 'markdown' && lastText < 0 && index === merged.length - 1));
      if (explicitResult || inferredResult) display.results.push(current);
      else display.thinking.push(current);
    }
    display.summary.steps = display.thinking.length;
    display.summary.tool_calls = display.thinking.filter(function (item) { return item.type === 'tool_call'; }).length;
    display.summary.artifacts = display.deliverables.filter(function (item) { return item.type === 'artifact'; }).length;
    display.summary.reports = display.deliverables.filter(function (item) { return item.type === 'report'; }).length;
    return display;
  }

  function renderThinkingBlock(display, streaming) {
    if (display.thinking.length === 0 && !streaming) return '';
    var summary = display.summary;
    var bits = [];
    if (summary.steps > 0) bits.push(summary.steps + ' 步');
    if (summary.tool_calls > 0) bits.push('工具 ' + summary.tool_calls);
    if (summary.artifacts > 0) bits.push('产物 ' + summary.artifacts);
    if (summary.reports > 0) bits.push('报告 ' + summary.reports);
    var body = display.thinking.map(function (item) { return item.type === 'thinking' ? '<div class="gpt-thinking-line">💭 ' + esc(String(item.text || '')) + '</div>' : renderPart(item); }).join('');
    var title = streaming ? '正在思考…' : '思考过程' + (bits.length ? ' · ' + bits.join(' · ') : '');
    return '<details class="gpt-thinking-group" data-thinking-group><summary>💭 ' + esc(title) + '（点击展开）</summary><div class="gpt-thinking-body">' + (body || '<p class="muted">正在收集过程…</p>') + '</div></details>';
  }

  function renderAssistantParts(parts, streaming) {
    var display = normalizeDisplayParts(parts, streaming);
    var html = renderThinkingBlock(display, streaming);
    var results = display.results.map(renderPart).join('');
    var hasResult = results !== '' || display.approvals.length > 0 || display.errors.length > 0;
    if (hasResult) html += '<div class="gpt-result" data-final-result><div class="gpt-result-label">✅ 最终结果</div>' + results + '</div>';
    var deliverables = display.deliverables.slice(0, 3).map(renderPart).join('');
    if (deliverables !== '') html += '<div class="gpt-deliverables" data-deliverables>' + deliverables + (display.deliverables.length > 3 ? '<p class="muted small">另有 ' + (display.deliverables.length - 3) + ' 个交付物，已收起在思考过程中。</p>' : '') + '</div>';
    html += display.approvals.map(renderPart).join('');
    html += display.errors.map(renderPart).join('');
    return html;
  }

  function renderPart(part) {
    var type = String(part.type || 'text');
    if (type === 'text' || type === 'markdown') {
      var markdown = String(part.markdown || part.text || '');
      var link = '';
      if (part.run_link) { link = '<p class="gpt-run-link-wrap"><a class="gpt-run-link" id="' + esc(part.run_link.id || 'chat-run-link') + '" href="' + esc(part.run_link.href || '#') + '">' + esc(part.run_link.text || '查看运行过程 →') + '</a></p>'; }
      var looksMd = markdown.indexOf('\\n') >= 0 || /[*#\`|]/.test(markdown);
      return '<div class="gpt-part gpt-part-text' + (looksMd ? ' gpt-md' : '') + '" data-part="text">' + (looksMd ? md(markdown) : '<p>' + esc(markdown) + '</p>') + link + '</div>';
    }
    if (type === 'thinking') { return '<details class="gpt-card gpt-thinking" data-card="thinking"><summary>💭 思考过程（点击展开）</summary><div class="gpt-thinking-text">' + esc(part.text || part.chunk || '') + '</div></details>'; }
    if (type === 'tool_call') {
      var toolStatus = String(part.status || 'running');
      var toolOk = toolStatus === 'ok' || toolStatus === 'done' || toolStatus === 'completed';
      var toolPreview = String(part.result_preview || part.result_summary || '');
      return '<div class="gpt-card gpt-tool" data-card="tool" data-call-id="' + esc(part.callId || part.call_id || '') + '" data-status="' + esc(toolStatus) + '"><span class="gpt-tool-name">' + (toolOk ? '✅' : '🔧') + ' ' + esc(part.tool || 'tool') + '</span><span class="gpt-tool-args mono">' + esc(typeof part.input === 'string' ? part.input : JSON.stringify(part.input || {})) + '</span><span class="gpt-tool-status">' + (toolOk ? '完成' : '调用中…') + (part.duration_ms === undefined ? '' : ' · ' + String(part.duration_ms) + 'ms') + '</span>' + (toolPreview === '' ? '' : '<details class="gpt-tool-detail"><summary>结果</summary><div class="gpt-tool-result-text">' + esc(toolPreview.slice(0, 1200)) + '</div></details>') + '</div>';
    }
    if (type === 'tool_result') { return '<div class="gpt-card gpt-tool-result" data-card="tool-result" data-status="' + esc(part.status || 'ok') + '"><span class="gpt-tool-name">✅ ' + esc(part.tool || 'tool') + '</span><span class="gpt-tool-args mono">' + esc(part.result_preview || part.result_summary || '') + '</span><span class="gpt-tool-status">' + esc(part.status || 'ok') + (part.duration_ms === undefined ? '' : ' · ' + String(part.duration_ms) + 'ms') + '</span></div>'; }
    if (type === 'artifact') {
      var artifact = part.artifact || part;
      var kind = String(artifact.kind || 'text');
      var content = String(artifact.preview_text || '');
      var preview = '';
      if (kind === 'html') preview = '<iframe class="gpt-artifact-iframe" sandbox="" srcdoc="' + esc(content) + '"></iframe>';
      else if (kind === 'markdown') preview = '<div class="gpt-artifact-md gpt-md">' + md(content) + '</div>';
      else if (kind === 'image') preview = '<div class="gpt-artifact-img">' + (content.indexOf('<svg') === 0 ? content : '<img alt="' + esc(artifact.title || '') + '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content) + '" />') + '</div>';
      else preview = '<pre class="gpt-artifact-pre">' + esc(content.slice(0, 6000)) + '</pre>';
      var fileName = String(artifact.rel_path || artifact.title || 'artifact').replace(/[^\\\\w.-]+/g, '_');
      var href = 'data:application/octet-stream;charset=utf-8,' + encodeURIComponent(content);
      return '<div class="gpt-card gpt-artifact" data-card="artifact" data-kind="' + esc(kind) + '"><header><span class="gpt-card-kind">📄 产物 · ' + esc(kind) + '</span><b>' + esc(artifact.title || '产物') + '</b><span class="gpt-meta">' + esc(fmtBytes(artifact.size || content.length)) + (artifact.agent_role ? ' · ' + esc(artifact.agent_role) : '') + '</span>' + (artifact.demo ? '<span class="gpt-demo">演示</span>' : '') + '<a class="gpt-download" download="' + esc(fileName) + '" href="' + esc(href) + '">下载</a></header><details class="gpt-artifact-preview" open><summary>预览</summary>' + preview + '</details></div>';
    }
    if (type === 'report') {
      var report = part.report || part;
      return '<div class="gpt-card gpt-report" data-card="report"><header><span class="gpt-card-kind">🧾 报告</span><b>' + esc(report.title || '报告') + '</b><span class="gpt-meta">' + esc(report.agent_role || '') + '</span></header><details class="gpt-report-preview"><summary>展开报告（Markdown）</summary><div class="gpt-md">' + md(String(report.markdown || '')) + '</div></details></div>';
    }
    if (type === 'data') {
      var data = part.data || part;
      var rows = Array.isArray(data.rows) ? data.rows : null;
      var body = '';
      if (rows) { for (var r = 0; r < rows.length; r += 1) { var row = rows[r]; var cells = Object.keys(row).map(function (key, i) { return i === 0 ? '<th class="mono">' + esc(row[key]) + '</th>' : '<td class="mono">' + esc(row[key]) + '</td>'; }).join(''); body += '<tr>' + cells + '</tr>'; } }
      else { Object.keys(data).forEach(function (key) { if (typeof data[key] === 'object' && data[key] !== null) return; body += '<tr><th>' + esc(key) + '</th><td class="mono">' + esc(data[key]) + '</td></tr>'; }); }
      return '<div class="gpt-card gpt-data" data-card="data" data-kind="' + esc(part.kind || data.kind || 'data') + '"><header><span class="gpt-card-kind">📊 数据</span><b>' + esc(part.kind || data.kind || '数据') + '</b></header><table class="gpt-data-table"><tbody>' + (body || '<tr><td class="muted">（无数据）</td></tr>') + '</tbody></table></div>';
    }
    if (type === 'approval') {
      return '<div class="gpt-card gpt-approval" data-card="approval" data-approval-id="' + esc(part.approval_id || '') + '" data-step="' + esc(part.step || '') + '" data-status="pending"><header><span class="gpt-card-kind">⚠️ 审批</span><b>需要你确认后才会继续</b>' + (part.demo ? '<span class="gpt-demo">演示</span>' : '') + '</header><p class="gpt-approval-risk">' + esc(part.risk || '高风险动作必须人工批准，AI 不绕过') + '</p><p class="gpt-meta">' + esc(part.summary || '') + '</p><div class="gpt-approval-actions"><button class="primary" type="button" data-approve>批准</button><button class="danger" type="button" data-reject>驳回</button></div></div>';
    }
    if (type === 'error') { return '<div class="gpt-card gpt-error" data-card="error"><b>执行失败：</b>' + esc(part.message || '') + '</div>'; }
    return '<div class="gpt-part"><pre class="mono">' + esc(JSON.stringify(part).slice(0, 2000)) + '</pre></div>';
  }
  function appendUserMessage(text) {
    var list = byId('gpt-messages');
    if (list === null) return;
    var empty = byId('gpt-empty'); if (empty !== null) empty.remove();
    var node = document.createElement('article');
    node.className = 'gpt-msg'; node.setAttribute('data-role', 'user'); node.setAttribute('data-message-id', 'local-user');
    node.innerHTML = '<span class="gpt-avatar">你</span><div class="gpt-bubble"><div class="gpt-msg-meta"><b>你</b></div><div class="gpt-part gpt-part-text" data-part="text"><p>' + esc(text) + '</p></div></div>';
    list.appendChild(node); list.scrollTop = list.scrollHeight;
  }
  function createAssistantMessage() {
    var list = byId('gpt-messages'); if (list === null) return null;
    var node = document.createElement('article');
    node.className = 'gpt-msg'; node.setAttribute('data-role', 'assistant'); node.setAttribute('data-message-id', 'streaming'); node.setAttribute('data-status', 'streaming');
    node.innerHTML = '<span class="gpt-avatar">◈</span><div class="gpt-bubble"><div class="gpt-msg-meta"><b>总调度助手</b><span class="gpt-streaming" data-streaming>思考中…</span></div><div class="gpt-parts"></div></div>';
    list.appendChild(node); list.scrollTop = list.scrollHeight;
    return node;
  }
  function conversationId() { var page = byId('gpt-page'); return page === null ? '' : (page.getAttribute('data-conv-id') || ''); }
  function refreshStatus() { api('GET', '/api/chat/status').then(function (payload) { var badge = byId('chat-status-badge'); if (badge) badge.textContent = '运行中 ' + payload.data.runs_active + ' · 待审批 ' + payload.data.awaiting_approval; }).catch(function () {}); }
  function stream(conversation, text) {
    var assistantNode = createAssistantMessage();
    var partsBox = assistantNode === null ? null : assistantNode.querySelector('.gpt-parts');
    var parts = [];
    var typing = byId('typing-indicator'); if (typing !== null) typing.hidden = false;
    showError('');
    function renderParts(streaming) {
      if (partsBox === null) return;
      partsBox.innerHTML = renderAssistantParts(parts, streaming);
      var list = byId('gpt-messages'); if (list !== null) list.scrollTop = list.scrollHeight;
    }
    return api('POST', '/api/chat/conversations/' + encodeURIComponent(conversation) + '/messages', { text: text, stream: true }).then(function (payload) {
      var info = payload.data || {};
      var streamInfo = info.stream || {};
      var url = streamInfo.url || ('/api/chat/conversations/' + encodeURIComponent(conversation) + '/stream?assistant_id=' + encodeURIComponent(streamInfo.assistant_id || '') + '&since=0');
      var done = false;
      var source = new EventSource(url);
      function finish() {
        done = true; source.close();
        if (typing !== null) typing.hidden = true;
        if (assistantNode !== null) { assistantNode.setAttribute('data-status', 'done'); var badge = assistantNode.querySelector('[data-streaming]'); if (badge !== null) badge.remove(); }
        renderParts(false);
        refreshStatus();
      }
      source.onmessage = function (message) {
        var event = null;
        try { event = JSON.parse(message.data); } catch (e) { event = null; }
        if (event === null) return;
        if (event.done === true) { finish(); return; }
        if (event.part) {
          parts.push(event.part);
          renderParts(true);
        }
      };
      source.onerror = function () { if (!done) { source.close(); source = new EventSource(url); } };
      renderParts(true);
      return payload;
    }).catch(function (error) {
      if (typing !== null) typing.hidden = true;
      if (assistantNode !== null) assistantNode.remove();
      showError('发送失败：' + error.message);
      throw error;
    });
  }

  function send(text) {
    var input = byId('composer-input');
    var value = String(text === undefined ? (input === null ? '' : input.value) : text).trim();
    if (value === '') return;
    if (input !== null && text === undefined) input.value = '';
    if (text === undefined) {
      var agentSelect = byId('composer-agent');
      var selectedAgent = agentSelect === null ? '' : String(agentSelect.value || '');
      if (selectedAgent !== '' && value.indexOf('@') !== 0) value = '@' + selectedAgent + ' ' + value;
    }
    var conversation = conversationId();
    appendUserMessage(value);
    if (conversation === '') {
      api('POST', '/api/chat/conversations', {}).then(function (payload) {
        var conv = payload.data;
        var page = byId('gpt-page'); if (page !== null) page.setAttribute('data-conv-id', conv.id);
        window.history.replaceState(null, '', '/chat?conversation=' + encodeURIComponent(conv.id));
        return stream(conv.id, value);
      }).catch(function (error) { showError('创建对话失败：' + error.message); });
      return;
    }
    stream(conversation, value).catch(function () {});
  }
  function bind() {
    var page = byId('gpt-page'); if (page === null) return;
    var form = byId('gpt-composer');
    if (form !== null) form.addEventListener('submit', function (event) { event.preventDefault(); send(); });
    var input = byId('composer-input');
    if (input !== null) input.addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });
    var chips = document.querySelectorAll('#quick-chips .gpt-chip[data-query]');
    for (var i = 0; i < chips.length; i++) (function (chip) { chip.addEventListener('click', function () { send(chip.getAttribute('data-query') || ''); }); })(chips[i]);
    var newButton = byId('conv-new');
    if (newButton !== null) newButton.addEventListener('click', function () { api('POST', '/api/chat/conversations', {}).then(function (payload) { var conv = payload.data; window.location.href = '/chat?conversation=' + encodeURIComponent(conv.id); }).catch(function (error) { showError('新建失败：' + error.message); }); });
    var renames = document.querySelectorAll('[data-conv-rename]');
    for (var r = 0; r < renames.length; r++) (function (button) { button.addEventListener('click', function (event) { event.preventDefault(); var id = button.getAttribute('data-conv-rename'); var current = button.closest('.gpt-conv-item').querySelector('.gpt-conv-open').getAttribute('title'); var title = window.prompt('重命名对话', current); if (title === null || title.trim() === '') return; api('PATCH', '/api/chat/conversations/' + encodeURIComponent(id), { title: title.trim() }).then(function () { window.location.reload(); }).catch(function (error) { toast('重命名失败：' + error.message, 'error'); }); }); })(renames[r]);
    var deletes = document.querySelectorAll('[data-conv-delete]');
    for (var d = 0; d < deletes.length; d++) (function (button) { button.addEventListener('click', function (event) { event.preventDefault(); var id = button.getAttribute('data-conv-delete'); if (!window.confirm('删除该对话？')) return; api('DELETE', '/api/chat/conversations/' + encodeURIComponent(id)).then(function () { if (id === conversationId()) window.location.href = '/chat'; else window.location.reload(); }).catch(function (error) { toast('删除失败：' + error.message, 'error'); }); }); })(deletes[d]);
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var approve = target.closest('[data-approve]');
      var reject = target.closest('[data-reject]');
      if (approve === null && reject === null) return;
      var card = target.closest('.gpt-approval'); if (card === null) return;
      var decision = approve !== null ? 'approve' : 'reject';
      api('POST', '/api/chat/conversations/' + encodeURIComponent(conversationId()) + '/approvals', { approval_id: card.getAttribute('data-approval-id'), step: Number(card.getAttribute('data-step') || 0), decision: decision }).then(function () { card.setAttribute('data-status', decision === 'approve' ? 'approved' : 'rejected'); var actions = card.querySelector('.gpt-approval-actions'); if (actions !== null) actions.innerHTML = '<span class="gpt-meta">' + (decision === 'approve' ? '✅ 已批准，继续执行' : '⛔ 已驳回') + '</span>'; toast(decision === 'approve' ? '已批准' : '已驳回', 'ok'); refreshStatus(); }).catch(function (error) { toast('审批失败：' + error.message, 'error'); });
    });
    var search = byId('memory-search');
    if (search !== null) search.addEventListener('keydown', function (event) { if (event.key !== 'Enter') return; event.preventDefault(); api('GET', '/api/chat/memory?query=' + encodeURIComponent(search.value.trim())).then(function (payload) { var list = byId('memory-list'); if (list === null) return; if (!payload.data.length) { list.innerHTML = '<p class="empty-state">没有匹配的记忆</p>'; return; } list.innerHTML = payload.data.map(function (mem) { return '<article class="gpt-memory-item" data-memory-id="' + esc(mem.id) + '"><div class="gpt-memory-head"><span class="badge status-idle">' + esc(mem.kind) + '</span><b>重要度 ' + mem.importance + '</b><button type="button" data-memory-delete="' + esc(mem.id) + '" title="删除记忆">🗑</button></div><p class="gpt-memory-content">' + esc(mem.content) + '</p></article>'; }).join(''); }); });
    document.addEventListener('click', function (event) { var target = event.target; if (!(target instanceof Element)) return; var del = target.closest('[data-memory-delete]'); if (del === null) return; var id = del.getAttribute('data-memory-delete'); api('DELETE', '/api/chat/memory/' + encodeURIComponent(id)).then(function () { del.closest('.gpt-memory-item').remove(); toast('记忆已删除', 'ok'); }).catch(function (error) { toast('删除失败：' + error.message, 'error'); }); });
    var agentParam = new URLSearchParams(window.location.search).get('agent');
    var agentPicker = byId('composer-agent');
    if (agentParam !== null && agentPicker !== null) {
      agentPicker.value = agentParam;
    }
    var params = new URLSearchParams(window.location.search);
    var prompt = params.get('prompt');
    if (prompt !== null && prompt.trim() !== '') {
      params.delete('prompt');
      var query = params.toString();
      window.history.replaceState(null, '', '/chat' + (query === '' ? '' : '?' + query));
      setTimeout(function () { send(prompt.trim()); }, 120);
    }
    refreshStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
`;
