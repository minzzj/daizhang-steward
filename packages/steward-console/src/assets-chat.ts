/**
 * packages/steward-console/src/assets-chat.ts
 *
 * v1.2 静态资源（同源内联字符串，无 CDN/外链）：
 * - CHAT_CSS：对话/智能体记录/run 证据/变现/模型与提示词组件样式（复用专业版设计 token）。
 * - CHAT_JS：对话创建与发送、打断/恢复/审批、证据灯箱、收款请求创建与人工确认到账、
 *            模型配置保存/一键同步、系统提示词保存。
 */

export const CHAT_CSS = `/* ===== v1.2：对话 ===== */
.agent-card-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.agent-card-actions .agent-expand { align-self: auto; }
.chat-layout { display: grid; grid-template-columns: minmax(280px, 0.85fr) minmax(0, 1.5fr); gap: 16px; align-items: start; }
.chat-sessions { display: flex; flex-direction: column; gap: 8px; }
.chat-session { display: flex; flex-direction: column; gap: 5px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: inherit; text-decoration: none; }
.chat-session:hover { border-color: #c4d0f8; text-decoration: none; background: #fbfcff; }
.chat-session-title { font-size: 14px; font-weight: 800; }
.chat-session-goal { font-size: 12px; color: #47536b; }
.chat-session-summary { font-size: 11px; color: var(--muted); line-height: 1.5; }
.chat-session-meta { font-size: 10px; }
.chat-status { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 800; background: #eef1f8; color: #47536b; align-self: flex-start; }
.chat-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chat-status[data-status="running"], .chat-status[data-status="active"] { background: #e8f7ee; color: #0f7a45; }
.chat-status[data-status="planning"] { background: #eef1ff; color: #3b5bfd; }
.chat-status[data-status="paused"] { background: var(--warn-soft); color: #7a4a00; }
.chat-status[data-status="done"] { background: #e8f7ee; color: #0f7a45; }
.chat-status[data-status="blocked"] { background: var(--danger-soft); color: var(--danger); }
.chat-create-form { display: flex; flex-direction: column; gap: 12px; }
.chat-create-form label, .money-form label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); font-weight: 600; }
.chat-create-form textarea, .money-form .input { font-size: 13px; }
.chat-tip { margin: 0; }

.chat-session-page { display: flex; flex-direction: column; gap: 14px; }
.chat-session-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.chat-session-headline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chat-session-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chat-session-params { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 16px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fbfcff; font-size: 12px; }
.chat-session-params > div { display: flex; flex-direction: column; gap: 2px; }
.chat-main-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.9fr); gap: 16px; align-items: start; }
.chat-plan-panel { display: flex; flex-direction: column; gap: 16px; }
.chat-messages { display: flex; flex-direction: column; gap: 12px; max-height: 620px; overflow-y: auto; padding: 4px 2px 8px; }
.chat-message { display: flex; gap: 10px; align-items: flex-start; }
.chat-message[data-role="user"] { flex-direction: row-reverse; }
.chat-avatar { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; background: #eef1f8; color: #47536b; }
.chat-message[data-role="conductor"] .chat-avatar { background: var(--brand-soft); color: var(--brand); }
.chat-message[data-role="user"] .chat-avatar { background: #0c1322; color: #9df3e5; }
.chat-bubble { max-width: 82%; padding: 10px 13px; border-radius: 12px; background: #f7f9fd; border: 1px solid var(--line); font-size: 13px; line-height: 1.65; }
.chat-message[data-role="user"] .chat-bubble { background: var(--brand); color: #fff; border-color: transparent; }
.chat-message[data-role="user"] .chat-bubble .muted, .chat-message[data-role="user"] .chat-bubble .chat-meta { color: #dbe4ff; }
.chat-bubble.kind-plan { border-color: #c9d4ff; background: #f4f6ff; }
.chat-bubble.kind-approval { border-color: #f0d5a8; background: #fffaf1; }
.chat-bubble.kind-error { border-color: #f5c2bf; background: #fff5f4; }
.chat-meta { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 3px; font-size: 11px; }
.chat-summary { margin-top: 6px; padding-top: 5px; border-top: 1px dashed rgba(102, 120, 150, 0.28); font-size: 10px; }
.chat-composer { display: flex; gap: 8px; margin-top: 10px; }
.chat-composer .input { flex: 1; }
.chat-plan { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.plan-step { display: grid; grid-template-columns: 22px minmax(80px, 0.6fr) minmax(120px, 1.4fr); gap: 6px 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; font-size: 12px; align-items: baseline; }
.plan-seq { font-size: 11px; color: var(--muted); }
.plan-agent { font-weight: 800; }
.plan-summary { grid-column: 2 / 4; }
.plan-status { grid-column: 2 / 4; justify-self: start; font-size: 10px; font-weight: 800; padding: 1px 8px; border-radius: 999px; background: #eef1f8; color: #47536b; }
.plan-step[data-status="done"] { background: #fafcfb; }
.plan-step[data-status="done"] .plan-status { background: #e8f7ee; color: #0f7a45; }
.plan-step[data-status="running"] { border-color: #b9d9c8; background: #f6fcf8; }
.plan-step[data-status="running"] .plan-status { background: #e8f7ee; color: #0f7a45; }
.plan-step[data-status="blocked"] .plan-status { background: var(--warn-soft); color: #7a4a00; }
.approval-panel { margin-top: 12px; padding: 12px 14px; border: 1px solid #f0d5a8; border-radius: 10px; background: #fffaf1; }
.approval-panel-title { font-size: 13px; font-weight: 800; color: #7a4a00; }
.approval-panel-actions { display: flex; gap: 8px; margin-top: 10px; }
.run-link { font-size: 11px; font-weight: 700; color: var(--brand); }
.btn-link { font-size: 12px; font-weight: 700; color: var(--brand); text-decoration: none; padding: 5px 10px; border: 1px solid #cfd9ff; border-radius: 8px; }

/* ===== v1.2：智能体对话记录 ===== */
.agent-role-page { display: flex; flex-direction: column; gap: 14px; }
.agent-role-head { display: flex; gap: 14px; align-items: center; }
.agent-avatar { width: 54px; height: 54px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; background: var(--brand-soft); color: var(--brand); }
.agent-role-headline h2 { margin: 0 0 3px; font-size: 20px; }
.agent-role-info { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; color: var(--muted); }
.agent-role-info b { color: var(--ink); }
.agent-role-stats { display: flex; gap: 18px; flex-wrap: wrap; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fbfcff; font-size: 12px; }
.agent-turns { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.agent-turn { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.agent-turn-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.agent-turn-tokens { margin-left: auto; }
.agent-turn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px; line-height: 1.6; }
.turn-input, .turn-output { margin-top: 2px; padding: 7px 9px; border-radius: 8px; background: #f7f9fd; }
.turn-output { background: #f4fbf7; }

/* ===== v1.2：run 详情 / 证据 ===== */
.run-page { display: flex; flex-direction: column; gap: 14px; }
.run-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.run-head h2 { margin: 0; font-size: 18px; }
.run-stats { display: flex; gap: 18px; flex-wrap: wrap; padding: 9px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fbfcff; font-size: 12px; }
.run-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.md-body { font-size: 13px; line-height: 1.7; color: #1d2738; }
.md-body h1 { font-size: 19px; margin: 4px 0 10px; }
.md-body h2 { font-size: 16px; margin: 14px 0 6px; }
.md-body h3 { font-size: 14px; margin: 10px 0 4px; }
.md-body ul, .md-body ol { padding-left: 22px; margin: 6px 0; }
.md-body li.md-check { list-style: none; margin-left: -18px; }
.md-body code { background: #eef1f8; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.md-body pre.md-code { background: #0c1322; color: #dce6f5; padding: 10px 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
.md-body blockquote { margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--brand); background: #f4f6ff; color: #47536b; }
.evidence-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.evidence-card { margin: 0; border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; }
.evidence-thumb { position: relative; display: block; width: 100%; padding: 0; border: none; background: #0c1322; cursor: zoom-in; }
.evidence-thumb img { display: block; width: 100%; height: auto; }
.evidence-zoom { position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px; background: rgba(7, 11, 20, 0.78); color: #9df3e5; font-size: 10px; font-weight: 700; }
.evidence-card figcaption { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; font-size: 12px; }
.evidence-log header, .evidence-json header, .evidence-report header { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-bottom: 1px solid var(--line); font-size: 12px; }
.evidence-log p, .evidence-json p, .evidence-report p { margin: 0; padding: 4px 11px; }
.payloads { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.payload-item { border: 1px solid var(--line); border-radius: 9px; background: #fbfcff; }
.payload-item summary { padding: 8px 11px; cursor: pointer; font-size: 12px; }
.payload-item pre { margin: 0; padding: 0 12px 12px; overflow-x: auto; font-size: 11px; line-height: 1.6; color: #33415c; white-space: pre-wrap; word-break: break-all; }
.run-agents { display: flex; flex-direction: column; gap: 10px; }
.run-agent { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 10px 12px; }
.run-agent header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; }
.run-agent header .run-link { margin-left: auto; }
.run-agent-turns { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.7; }

/* 证据灯箱 */
.lightbox { position: fixed; inset: 0; z-index: 80; background: rgba(6, 10, 18, 0.9); display: flex; align-items: center; justify-content: center; padding: 24px; }
.lightbox[hidden] { display: none !important; }
.lightbox-body { display: flex; flex-direction: column; gap: 10px; align-items: center; max-width: 92vw; max-height: 90vh; }
.lightbox-body img { max-width: 92vw; max-height: 78vh; border-radius: 10px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55); background: #fff; }
.lightbox-title { color: #dce6f5; font-size: 13px; }
.lightbox-close { position: absolute; top: 18px; right: 22px; width: 38px; height: 38px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(10, 16, 28, 0.7); color: #fff; font-size: 16px; cursor: pointer; }

/* ===== v1.2：变现 ===== */
.money-disclaimer { font-size: 13px; line-height: 1.75; }
.money-channels { display: flex; flex-direction: column; gap: 8px; }
.money-channel { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px; background: #fff; font-size: 13px; }
.money-channel-name { font-weight: 800; }
.money-channel .mono { margin-left: auto; }
.money-form { display: flex; flex-direction: column; gap: 12px; }
.money-requests { display: flex; flex-direction: column; gap: 10px; }
.money-request { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 12px 14px; }
.money-request[data-status="paid"] { background: #fafcfb; }
.money-request-main { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.money-request-amount { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; min-width: 120px; }
.money-request-info { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.money-request-info .muted { font-size: 11px; }
.money-status { margin-left: auto; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; background: #eef1f8; color: #47536b; }
.money-status[data-status="pending"] { background: var(--warn-soft); color: #7a4a00; }
.money-status[data-status="paid"] { background: #e8f7ee; color: #0f7a45; }
.money-request-side { display: flex; align-items: flex-start; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
.money-qr, .money-qr-large { border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.money-request-actions { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.money-ledger { font-size: 12px; font-weight: 700; color: var(--ok); }
.money-note { margin: 8px 0 0; }
.money-request-page-head { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }

/* ===== v1.2：模型与提示词（settings 内） ===== */
.panel-models { border: 2px solid #cfd9ff; }
.model-providers { display: flex; flex-direction: column; gap: 10px; }
.model-provider { padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.model-provider-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.model-provider-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px 12px; }
.model-provider-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); font-weight: 600; }
.model-provider-grid .input { font-size: 12px; }
.model-key-masked { font-size: 12px; padding: 7px 10px; border-radius: 8px; background: #f1f4fa; border: 1px dashed var(--line); }
.models-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.panel-prompts { border: 2px solid #dfe7f6; }
.prompt-editors { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.prompt-editor { padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.prompt-editor.prompt-conductor { border-color: #cfd9ff; background: #fbfcff; }
.prompt-editor-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; }
.prompt-textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.65; width: 100%; resize: vertical; }

/* ===== v1.4：发送即执行 + SSE 实时流 ===== */
.live-run-panel { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 2px solid #cfd9ff; border-radius: 12px; background: #fbfcff; }
.live-run-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.live-status { padding: 3px 11px; border-radius: 999px; font-size: 12px; font-weight: 800; background: #eef1f8; color: #47536b; }
.live-status[data-status="running"], .live-status[data-status="queued"] { background: #e8f7ee; color: #0f7a45; }
.live-status[data-status="running"]::after { content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: currentColor; animation: livePulse 1s infinite; }
.live-status[data-status="awaiting_approval"], .live-status[data-status="interrupted"] { background: var(--warn-soft); color: #7a4a00; }
.live-status[data-status="done"] { background: var(--ok-soft); color: var(--ok); }
.live-status[data-status="blocked"], .live-status[data-status="failed"] { background: var(--danger-soft); color: var(--danger); }
@keyframes livePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.live-sse { margin-left: auto; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #eef1f8; color: #47536b; }
.live-sse[data-state="open"] { background: #e8f7ee; color: #0f7a45; }
.live-sse[data-state="reconnecting"] { background: var(--warn-soft); color: #7a4a00; }
.live-controls { display: flex; gap: 6px; }
.live-controls button { font-size: 11px; padding: 4px 10px; }
.live-thought { margin: 0; padding: 8px 11px; border-radius: 9px; background: #fff; border: 1px dashed #cfd9ff; font-size: 13px; color: #1d2738; }
.live-plan-wrap h3, .live-timeline-wrap h3 { margin: 4px 0 6px; font-size: 12px; color: #47536b; }
.live-plan { display: flex; flex-direction: column; gap: 5px; }
.live-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.live-event { display: flex; align-items: baseline; gap: 8px; padding: 5px 9px; border-radius: 8px; background: #fff; border: 1px solid #eef1f7; font-size: 12px; }
.live-event-type { flex: 0 0 auto; font-size: 10px; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: #eef1ff; color: #3b5bfd; }
.live-event[data-type="agent.turn.completed"] .live-event-type { background: #e8f7ee; color: #0f7a45; }
.live-event[data-type="agent.turn.started"] .live-event-type { background: #eef7ff; color: #1c6aa8; }
.live-event[data-type="approval.required"] .live-event-type { background: var(--warn-soft); color: #7a4a00; }
.live-event[data-type="run.completed"] .live-event-type { background: var(--ok-soft); color: var(--ok); }
.live-event[data-type="run.failed"] .live-event-type { background: var(--danger-soft); color: var(--danger); }
.live-event-text { flex: 1; line-height: 1.5; }
.live-complete { padding: 10px 14px; border: 1px solid #bfe6d0; border-radius: 10px; background: #f2fbf6; }
.live-complete[hidden] { display: none; }
.live-complete-title { font-size: 14px; font-weight: 800; color: #0b6b3a; margin-bottom: 4px; }
/* ===== v1.5：run Tabs / 产物 / 数据 / 报告 ===== */
.run-tabs { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.run-tab { font: inherit; font-size: 13px; font-weight: 700; padding: 7px 14px; border-radius: 9px 9px 0 0; border: 1px solid transparent; border-bottom: none; background: transparent; color: #47536b; cursor: pointer; }
.run-tab:hover { background: #f1f4fa; }
.run-tab.active { background: #fff; border-color: var(--line); color: var(--brand); box-shadow: 0 2px 0 #fff; }
.run-tab .tab-count { display: inline-block; min-width: 16px; padding: 0 5px; margin-left: 4px; border-radius: 999px; background: #eef1f8; color: #47536b; font-size: 10px; }
.run-tab-panel { display: flex; flex-direction: column; gap: 14px; }
.run-tab-panel .run-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.artifact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.artifact-card { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 11px 13px; display: flex; flex-direction: column; gap: 7px; }
.artifact-card[hidden] { display: none !important; }
.artifact-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.artifact-kind { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #eef1ff; color: #3b5bfd; }
.artifact-kind.kind-html { background: #fff4e2; color: #8a5a00; }
.artifact-kind.kind-markdown { background: #eef1ff; color: #3b5bfd; }
.artifact-kind.kind-json, .artifact-kind.kind-data { background: #e8f7ee; color: #0f7a45; }
.artifact-kind.kind-image { background: #f3edff; color: #6b3fd0; }
.artifact-kind.kind-code { background: #eef7ff; color: #1c6aa8; }
.artifact-title { font-size: 13px; }
.artifact-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; }
.artifact-preview summary { font-size: 11px; font-weight: 700; color: var(--brand); cursor: pointer; padding: 3px 0; }
.artifact-md { max-height: 320px; overflow: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fbfcff; }
.artifact-iframe { width: 100%; height: 300px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.artifact-image { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.artifact-pre { max-height: 280px; overflow: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #0c1322; color: #dce6f5; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
.artifact-download { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--brand); }
.artifact-run { margin: 0; font-size: 10px; }
/* 数据指标 */
.metrics-grid { display: flex; flex-direction: column; gap: 12px; }
.metrics-cards, .metrics-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.metric-card { padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.metric-label { font-size: 11px; color: var(--muted); }
.metric-value { font-size: 22px; font-weight: 800; margin: 2px 0 6px; font-variant-numeric: tabular-nums; }
.metric-bar { height: 6px; border-radius: 999px; background: #eef1f8; overflow: hidden; }
.metric-bar > span { display: block; height: 100%; background: linear-gradient(90deg, #3b5bfd, #66e3d2); }
.metric-bar-cell { width: 40%; }
.metric-bar-inline { display: block; height: 8px; border-radius: 999px; background: #c9d4ff; min-width: 4px; }
.metrics-tables { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr); gap: 14px; align-items: start; }
.metrics-side { font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
.metrics-side p { margin: 0; }
/* 报告列表 */
.run-report-item, .report-item { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 11px 13px; margin-bottom: 10px; }
.run-report-head, .report-item-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; margin-bottom: 6px; }
.run-report-details summary, .report-details summary { font-size: 11px; font-weight: 700; color: var(--brand); cursor: pointer; padding: 3px 0; }
.run-report-md, .report-md { margin-top: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fbfcff; }
/* 实时思考 / 工具 / 产物提示 */
.live-streams { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 12px; }
.live-thinking, .live-tools, .live-artifacts { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 4px; border: 1px solid var(--line); border-radius: 9px; background: #fff; }
.live-thinking-block { border: 1px solid #eef1f7; border-radius: 8px; background: #fbfcff; padding: 6px 9px; }
.live-thinking-block summary { font-size: 11px; font-weight: 800; color: #47536b; cursor: pointer; }
.live-thinking-text { margin-top: 5px; white-space: pre-wrap; font-size: 12px; line-height: 1.6; color: #1d2738; max-height: 140px; overflow-y: auto; }
.live-tool { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 6px 9px; border: 1px solid #eef1f7; border-radius: 8px; background: #fff; font-size: 12px; }
.live-tool[data-status="running"] { border-color: #c9d4ff; background: #f4f6ff; }
.live-tool[data-status="ok"] { border-color: #bfe6d0; background: #f2fbf6; }
.live-tool[data-status="error"] { border-color: #f5c2bf; background: #fff5f4; }
.live-tool-name { font-family: ui-monospace, monospace; font-weight: 700; font-size: 11px; }
.live-tool-args { flex: 1; min-width: 120px; word-break: break-all; }
.live-tool-status { font-size: 10px; font-weight: 700; color: #47536b; }
.live-artifact, .live-report { display: block; padding: 6px 9px; border: 1px solid #eef1f7; border-radius: 8px; background: #fff; font-size: 12px; }
.live-streams h3 { margin: 0 0 4px; font-size: 12px; color: #47536b; }
.live-streams h3 .hint { font-weight: 400; color: var(--muted); margin-left: 6px; }
/* 产物/报告中心 */
.center-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.center-toolbar label { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
.center-toolbar .input { padding: 5px 8px; font-size: 12px; }
/* agents harness */
.agent-harness { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 9px 11px; border: 1px dashed #cfd9ff; border-radius: 9px; background: #fbfcff; }
.agent-harness-badge { align-self: flex-start; font-size: 10px; font-weight: 800; padding: 2px 9px; border-radius: 999px; background: linear-gradient(90deg, #3b5bfd, #66e3d2); color: #fff; }
.agent-harness-stats { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
.agent-harness-stats b { color: var(--ink); }
.agent-harness-links { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; }
.agent-harness-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 10px; }
.agent-harness-meta b { color: var(--ink); }
@media (max-width: 1100px) {
  .chat-layout { grid-template-columns: 1fr; }
  .chat-main-grid { grid-template-columns: 1fr; }
  .run-grid { grid-template-columns: 1fr; }
  .agent-turn-grid { grid-template-columns: 1fr; }
}
`;

export const CHAT_JS = `(function () {
  'use strict';

  var TOKEN = readMeta('steward-token');

  function readMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta === null ? '' : (meta.getAttribute('content') || '');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setHidden(id, hidden) {
    var element = byId(id);
    if (element !== null) { element.hidden = hidden; }
  }

  function setText(id, text) {
    var element = byId(id);
    if (element !== null) { element.textContent = text; }
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

  function reloadSoon(delay) {
    window.setTimeout(function () { window.location.reload(); }, delay === undefined ? 500 : delay);
  }

  // ---- /chat：新建项目 ---------------------------------------------------
  function initChatCreate() {
    var button = byId('chat-create-submit');
    if (button === null) { return; }
    button.addEventListener('click', function () {
      var goal = (byId('chat-goal') || {}).value || '';
      if (String(goal).trim().length < 4) { showError('chat-create-error', '请先告诉总调度你要做什么（至少 4 个字）'); return; }
      button.disabled = true;
      showError('chat-create-error', '');
      api('POST', '/api/chat/runs', {
        goal: String(goal).trim(),
        budget_cny: Number((byId('chat-budget') || {}).value || 0),
        token_limit: Number((byId('chat-token') || {}).value || 0),
        mode: (byId('chat-mode') || {}).value || 'demo'
      }).then(function (payload) {
        var session = payload.data.session;
        // 发送即执行：服务端已自动开始 run；跳转到会话页并自动打开 SSE 实时流
        window.location.href = '/chat/' + encodeURIComponent(session.id);
      }).catch(function (error) {
        button.disabled = false;
        var payload = error.payload;
        var errors = payload !== null && payload !== undefined && payload.data !== undefined && payload.data.errors !== undefined ? payload.data.errors : [error.message];
        showError('chat-create-error', errors.join('；'));
      });
    });
  }

  // ---- /chat/:id：发送消息 / 开始 / 打断 / 恢复 / 审批 ---------------------
  function postSessionAction(path, buttonId) {
    var button = byId(buttonId);
    if (button === null) { return; }
    button.addEventListener('click', function () {
      button.disabled = true;
      api('POST', path, {}).then(function () { reloadSoon(400); }).catch(function (error) {
        button.disabled = false;
        toast('操作失败：' + error.message, 'error');
      });
    });
  }

  function initChatSession() {
    var page = byId('chat-session-page');
    if (page === null) { return; }

    postSessionAction('/api/chat/sessions/' + encodeURIComponent(sessionId()) + '/interrupt', 'chat-interrupt');
    postSessionAction('/api/chat/sessions/' + encodeURIComponent(sessionId()) + '/resume', 'chat-resume');

    var sendButton = byId('chat-send');
    var input = byId('chat-input');
    function send() {
      if (input === null) { return; }
      var text = String(input.value || '').trim();
      if (text === '') { return; }
      if (sendButton !== null) { sendButton.disabled = true; }
      api('POST', '/api/chat/sessions/' + encodeURIComponent(sessionId()) + '/messages', { text: text }).then(function () {
        if (input !== null) { input.value = ''; }
        reloadSoon(350);
      }).catch(function (error) {
        if (sendButton !== null) { sendButton.disabled = false; }
        showError('chat-error', '发送失败：' + error.message);
      });
    }
    if (sendButton !== null) { sendButton.addEventListener('click', send); }
    if (input !== null) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); send(); }
      });
    }
    var approve = byId('chat-approve');
    if (approve !== null) {
      approve.addEventListener('click', function () {
        var panel = byId('chat-approval');
        var step = panel === null ? 0 : Number(panel.getAttribute('data-step') || '0');
        approve.disabled = true;
        api('POST', '/api/chat/sessions/' + encodeURIComponent(sessionId()) + '/approvals', { step: step, decision: 'approve' })
          .then(function () { toast('已批准，继续执行', 'ok'); reloadSoon(400); })
          .catch(function (error) { approve.disabled = false; toast('批准失败：' + error.message, 'error'); });
      });
    }
    var reject = byId('chat-reject');
    if (reject !== null) {
      reject.addEventListener('click', function () {
        var panel = byId('chat-approval');
        var step = panel === null ? 0 : Number(panel.getAttribute('data-step') || '0');
        reject.disabled = true;
        api('POST', '/api/chat/sessions/' + encodeURIComponent(sessionId()) + '/approvals', { step: step, decision: 'reject' })
          .then(function () { toast('已驳回，项目暂停', 'warn'); reloadSoon(400); })
          .catch(function (error) { reject.disabled = false; toast('驳回失败：' + error.message, 'error'); });
      });
    }
  }

  function sessionId() {
    var match = /\\/chat\\/([^/?#]+)/.exec(window.location.pathname);
    return match === null ? '' : decodeURIComponent(match[1]);
  }

  // ---- /runs/:id：证据灯箱 ----------------------------------------------
  function initLightbox() {
    var lightbox = byId('evidence-lightbox');
    if (lightbox === null) { return; }
    var img = byId('lightbox-img');
    var title = byId('lightbox-title');
    function close() {
      lightbox.hidden = true;
      if (img !== null) { img.setAttribute('src', ''); }
    }
    var thumbs = document.querySelectorAll('.evidence-thumb[data-full-url]');
    for (var index = 0; index < thumbs.length; index++) {
      (function (thumb) {
        thumb.addEventListener('click', function () {
          var url = thumb.getAttribute('data-full-url') || '';
          var label = thumb.getAttribute('data-title') || '证据大图';
          if (img !== null) { img.setAttribute('src', url); img.setAttribute('alt', label); }
          if (title !== null) { title.textContent = label; }
          lightbox.hidden = false;
        });
      })(thumbs[index]);
    }
    var closeButton = byId('lightbox-close');
    if (closeButton !== null) { closeButton.addEventListener('click', close); }
    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox) { close(); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && lightbox.hidden === false) { close(); }
    });
  }

  // ---- /money：创建收款请求 / 人工确认到账 ------------------------------
  function initMoney() {
    var form = byId('money-form');
    if (form === null) { return; }
    var button = byId('money-create');
    if (button !== null) {
      button.addEventListener('click', function () {
        button.disabled = true;
        showError('money-error', '');
        api('POST', '/api/money/requests', {
          amount_cny: Number((byId('money-amount') || {}).value || 0),
          client: (byId('money-client') || {}).value || '',
          purpose: (byId('money-purpose') || {}).value || '',
          payment_method: (byId('money-method') || {}).value || 'manual'
        }).then(function (payload) {
          var request = payload.data.request;
          toast('已创建收款请求：' + String(request.amount_cny) + ' 元（演示渠道）', 'ok');
          window.location.href = '/money#money-request-' + encodeURIComponent(request.id);
          window.location.reload();
        }).catch(function (error) {
          button.disabled = false;
          var payload = error.payload;
          var errors = payload !== null && payload !== undefined && payload.data !== undefined && payload.data.errors !== undefined ? payload.data.errors : [error.message];
          showError('money-error', errors.join('；'));
        });
      });
    }
    var confirmButtons = document.querySelectorAll('[data-confirm-id]');
    for (var index = 0; index < confirmButtons.length; index++) {
      (function (confirmButton) {
        confirmButton.addEventListener('click', function () {
          var id = confirmButton.getAttribute('data-confirm-id');
          confirmButton.disabled = true;
          api('POST', '/api/money/requests/' + encodeURIComponent(id) + '/confirm', { by: '人工确认（控制台）' })
            .then(function (payload) {
              var request = payload.data.request;
              toast('已确认到账：' + String(request.amount_cny) + ' 元，已记入账本', 'ok');
              reloadSoon(500);
            })
            .catch(function (error) { confirmButton.disabled = false; toast('确认到账失败：' + error.message, 'error'); });
        });
      })(confirmButtons[index]);
    }
  }

  // ---- /settings：模型与 API 密钥 / 系统提示词 --------------------------
  function initModels() {
    var saveButton = byId('models-save');
    if (saveButton === null) { return; }
    function collectProviders() {
      var providers = [];
      var nodes = document.querySelectorAll('[data-provider-id]');
      for (var index = 0; index < nodes.length; index++) {
        var node = nodes[index];
        var id = node.getAttribute('data-provider-id');
        var enabled = byId('model-' + id + '-enabled');
        var baseUrl = byId('model-' + id + '-base-url');
        var model = byId('model-' + id + '-model');
        var keyRef = byId('model-' + id + '-key-ref');
        var masked = byId('model-' + id + '-key-masked');
        providers.push({
          id: id,
          name: (node.querySelector('.model-provider-main b') || {}).textContent || id,
          kind: node.getAttribute('data-provider-kind') || 'deepseek',
          base_url: baseUrl === null ? '' : baseUrl.value,
          model: model === null ? '' : model.value,
          api_key_ref: keyRef === null ? '' : keyRef.value,
          api_key_masked: masked === null ? '' : masked.textContent,
          enabled: enabled !== null && enabled.checked
        });
      }
      return providers;
    }
    function collectBindings() {
      var bindings = [];
      var selects = document.querySelectorAll('[data-agent-binding]');
      for (var index = 0; index < selects.length; index++) {
        var select = selects[index];
        var role = select.getAttribute('data-agent-binding');
        var modelInput = byId('model-bind-' + role + '-model');
        bindings.push({ agent_role: role, provider_id: select.value, model: modelInput === null ? '' : modelInput.value });
      }
      return bindings;
    }
    saveButton.addEventListener('click', function () {
      saveButton.disabled = true;
      setText('models-feedback', '保存中…');
      api('PUT', '/api/model-settings', { providers: collectProviders(), agent_bindings: collectBindings() }).then(function (payload) {
        saveButton.disabled = false;
        setText('models-feedback', '已保存模型配置（' + new Date().toLocaleTimeString('zh-CN') + '）');
        toast('模型配置已保存', 'ok');
        var settings = payload.data.settings;
        setText('models-sync-status', '同步状态：' + (settings.sync_status === 'synced' ? '已同步' : '未同步（请点一键同步）'));
      }).catch(function (error) {
        saveButton.disabled = false;
        var payload = error.payload;
        var errors = payload !== null && payload !== undefined && payload.data !== undefined && payload.data.errors !== undefined ? payload.data.errors : [error.message];
        showError('models-error', '保存失败：' + errors.join('；'));
        setText('models-feedback', '保存失败');
      });
    });
    var syncButton = byId('models-sync');
    if (syncButton !== null) {
      syncButton.addEventListener('click', function () {
        syncButton.disabled = true;
        api('POST', '/api/model-settings/sync', {}).then(function (payload) {
          syncButton.disabled = false;
          showError('models-error', '');
          setText('models-sync-status', '同步状态：已同步（' + new Date().toLocaleTimeString('zh-CN') + '）');
          setText('models-feedback', '已同步密钥到 ' + String(payload.data.targets) + ' 个目标（providers + agents）');
          toast('已一键同步密钥到所有功能', 'ok');
        }).catch(function (error) {
          syncButton.disabled = false;
          showError('models-error', '同步失败：' + error.message);
        });
      });
    }
  }

  function initPrompts() {
    var saveButton = byId('prompts-save');
    if (saveButton === null) { return; }
    saveButton.addEventListener('click', function () {
      saveButton.disabled = true;
      setText('prompts-feedback', '保存中…');
      var patches = [];
      var nodes = document.querySelectorAll('[data-prompt-editor]');
      for (var index = 0; index < nodes.length; index++) {
        patches.push({ id: nodes[index].getAttribute('data-prompt-editor'), content: nodes[index].value });
      }
      api('PUT', '/api/prompts', { prompts: patches }).then(function () {
        saveButton.disabled = false;
        showError('prompts-error', '');
        setText('prompts-feedback', '已保存系统提示词（' + new Date().toLocaleTimeString('zh-CN') + '，版本已升）');
        toast('系统提示词已保存', 'ok');
      }).catch(function (error) {
        saveButton.disabled = false;
        var payload = error.payload;
        var errors = payload !== null && payload !== undefined && payload.data !== undefined && payload.data.errors !== undefined ? payload.data.errors : [error.message];
        setText('prompts-feedback', '保存失败');
        showError('prompts-error', '保存失败：' + errors.join('；'));
      });
    });
  }

  // ---- v1.4：发送即执行 + SSE 实时流（/chat/:id） -------------------------
  var LIVE_STATUS_LABELS = {
    queued: '排队中', running: '执行中', paused: '已暂停', awaiting_approval: '等待审批',
    interrupted: '已打断', done: '已完成', blocked: '已阻塞', failed: '失败'
  };
  var LIVE_EVENT_LABELS = {
    'run.created': '已排队', 'run.started': '开始执行', 'conductor.thinking': '总调度思考中',
    'plan.created': '计划生成', 'step.started': '步骤开始', 'agent.turn.started': '智能体开始',
    'agent.turn.completed': '智能体完成', 'step.completed': '步骤完成', 'approval.required': '等待审批',
    'approval.approved': '审批通过', 'approval.rejected': '审批驳回', 'run.interrupted': '已打断',
    'run.resumed': '已恢复', 'run.completed': '执行完成', 'run.failed': '执行失败'
  };
  var live = { runId: '', source: null, lastSeq: 0, tokens: 0, stepsDone: 0, stepsTotal: 0, status: '', planSteps: [] };

  function livePanel() { return byId('live-run-panel'); }

  var SESSION_STATUS_TEXT = {
    queued: '计划中', running: '执行中', awaiting_approval: '等待审批', interrupted: '已打断',
    paused: '已暂停', done: '已完成', blocked: '已阻塞', failed: '失败'
  };

  function liveStatus(status) {
    if (status === undefined || status === null) { return; }
    live.status = status;
    // 同步会话页顶部状态徽章（SSR 快照可能早于执行，实时状态以 SSE 为准）
    var sessionBadge = byId('chat-status');
    if (sessionBadge !== null) {
      sessionBadge.setAttribute('data-status', status === 'running' || status === 'queued' ? 'running' : status === 'done' ? 'done' : status === 'awaiting_approval' ? 'paused' : status);
      sessionBadge.textContent = SESSION_STATUS_TEXT[status] || status;
    }
    var badge = byId('live-status');
    if (badge !== null) {
      badge.setAttribute('data-status', status);
      badge.textContent = LIVE_STATUS_LABELS[status] || status;
    }
    var panel = livePanel();
    if (panel !== null) { panel.setAttribute('data-status', status); }
    var interrupt = byId('live-interrupt');
    if (interrupt !== null) { interrupt.hidden = !(status === 'running' || status === 'queued' || status === 'awaiting_approval'); }
    var resume = byId('live-resume');
    if (resume !== null) { resume.hidden = status !== 'interrupted'; }
  }

  function liveStep(step, status) {
    var item = document.querySelector('#live-plan [data-step="' + String(step) + '"]');
    if (item === null) { return; }
    item.setAttribute('data-status', status);
    var label = item.querySelector('[data-live-plan-status]');
    if (label !== null) {
      label.textContent = status === 'done' ? '已完成' : status === 'running' ? '执行中' : status === 'blocked' ? '已暂停' : '待执行';
    }
  }

  function liveSse(state, text) {
    var element = byId('live-sse-state');
    if (element === null) { return; }
    element.setAttribute('data-state', state);
    element.textContent = text;
  }

  function liveAppendEvent(event) {
    var list = byId('live-timeline');
    if (list === null) { return; }
    var data = event.data || {};
    var item = document.createElement('li');
    item.className = 'live-event';
    item.setAttribute('data-type', event.type);
    item.setAttribute('data-seq', String(event.seq));
    var label = document.createElement('span');
    label.className = 'live-event-type';
    label.textContent = LIVE_EVENT_LABELS[event.type] || event.type;
    var text = document.createElement('span');
    text.className = 'live-event-text';
    if (event.type === 'agent.turn.completed') {
      text.textContent = (data.agent_title || data.agent_role || 'agent') + '：' + (data.output_summary || '') + '（Token ' + String(data.tokens || 0) + '，model_mode=' + String(data.model_mode || '—') + '）';
    } else if (event.type === 'agent.turn.started') {
      text.textContent = (data.agent_title || data.agent_role || 'agent') + ' 输入：' + (data.input_summary || '');
    } else if (event.type === 'step.started') {
      text.textContent = '步骤 ' + String(data.step) + '：' + String(data.agent_title || data.agent_role || '') + ' / ' + String(data.action || '');
    } else if (event.type === 'plan.created') {
      text.textContent = '计划已生成：' + String((data.steps || []).length) + ' 步';
    } else if (event.type === 'harness.thinking') {
      text.textContent = String(data.agent_title || data.agent_role || 'agent') + ' 思考：' + String(data.text || data.chunk || '');
    } else if (event.type === 'harness.tool_call') {
      text.textContent = '工具调用 ' + String(data.tool || '') + ' ' + String(data.input || data.args_summary || '');
    } else if (event.type === 'harness.tool_result') {
      text.textContent = '工具结果 ' + String(data.tool || '') + '：' + String(data.status || '') + (data.duration_ms === undefined ? '' : ' · ' + String(data.duration_ms || 0) + 'ms') + ' ' + String(data.result_preview || '');
    } else if (event.type === 'artifact.created') {
      var artifactData = data.artifact || data; text.textContent = '产物生成：' + String(artifactData.title || artifactData.rel_path || '') + '（' + String(artifactData.kind || '') + '）';
    } else if (event.type === 'report.created') {
      var reportData = data.report || data; text.textContent = '报告生成：' + String(reportData.title || '');
    } else {
      text.textContent = String(data.summary || data.output_summary || data.error || JSON.stringify(data)).slice(0, 160);
    }
    item.appendChild(label);
    item.appendChild(text);
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
    live.lastSeq = Math.max(live.lastSeq, Number(event.seq || 0));
  }

  function liveHandle(event) {
    var data = event.data || {};
    liveAppendEvent(event);
    if (event.type === 'run.created' || event.type === 'run.started') { liveStatus('running'); }
    if (event.type === 'conductor.thinking') { setText('live-thought', String(data.summary || '总调度思考中…')); }
    if (event.type === 'plan.created') {
      setText('live-thought', '计划已生成，开始自动执行（无需手动点开始）');
      live.planSteps = data.steps || [];
      live.stepsTotal = live.planSteps.length;
      var steps = byId('live-steps');
      if (steps !== null) { steps.textContent = String(live.stepsDone) + '/' + String(live.stepsTotal); }
    }
    if (event.type === 'step.started') {
      liveStep(Number(data.step), 'running');
      setText('live-thought', '执行中：' + String(data.agent_title || data.agent_role || '') + ' / ' + String(data.action || ''));
    }
    if (event.type === 'step.completed') {
      liveStep(Number(data.step), 'done');
      live.stepsDone += 1;
      var stepsEl = byId('live-steps');
      if (stepsEl !== null) { stepsEl.textContent = String(live.stepsDone) + '/' + String(live.stepsTotal); }
    }
    if (event.type === 'agent.turn.completed') {
      live.tokens += Number(data.tokens || 0);
      var tokenEl = byId('live-token');
      if (tokenEl !== null) { tokenEl.textContent = String(live.tokens); }
    }
    if (event.type === 'approval.required') {
      liveStatus('awaiting_approval');
      var panel = byId('live-approval');
      if (panel !== null) {
        panel.hidden = false;
        panel.setAttribute('data-step', String(data.step));
        var title = panel.querySelector('.approval-panel-title');
        if (title !== null) { title.textContent = '⚠ 高风险步骤暂停，等待人工审批：步骤 ' + String(data.step) + '「' + String(data.summary || '') + '」'; }
        var risk = byId('live-approval-risk');
        if (risk !== null) { risk.textContent = '风险：' + String(data.risk || '高风险动作必须人工批准，AI 不绕过'); }
      }
      setText('live-thought', '等待人工审批（高风险步骤）…');
    }
    if (event.type === 'approval.approved') {
      var panel2 = byId('live-approval');
      if (panel2 !== null) { panel2.hidden = true; }
      liveStatus('running');
    }
    if (event.type === 'approval.rejected') { liveStatus('blocked'); }
    if (event.type === 'run.interrupted') { liveStatus('interrupted'); setText('live-thought', '已打断（事件已记录，点恢复从断点继续）'); }
    if (event.type === 'run.resumed') { liveStatus('running'); setText('live-thought', '已恢复执行…'); }
    if (event.type === 'run.completed') {
      liveStatus('done');
      setText('live-thought', '执行完成');
      var complete = byId('live-complete');
      if (complete !== null) {
        complete.hidden = false;
        var summary = byId('live-complete-summary');
        if (summary !== null) {
          summary.textContent = '计划 ' + String(data.steps_total || live.stepsTotal) + ' 步全部完成；Token ' + String(data.token_used || live.tokens) + '；证据已留档。';
        }
        var link = byId('live-run-link');
        if (link !== null) { link.href = '/runs/' + encodeURIComponent(live.runId); }
      }
    }
    if (event.type === 'harness.thinking') { liveThinking(data); }
    if (event.type === 'harness.tool_call') { liveTool(data, 'call'); }
    if (event.type === 'harness.tool_result') { liveTool(data, 'result'); }
    if (event.type === 'artifact.created') { liveArtifact(data); }
    if (event.type === 'report.created') { liveReport(data); }
    if (event.type === 'run.failed') {
      liveStatus('failed');
      showError('live-error', '执行失败/阻塞：' + String(data.error || '未知错误'));
    }
  }

  function liveConnect() {
    var source = new EventSource('/api/chat/runs/' + encodeURIComponent(live.runId) + '/stream?since=0');
    live.source = source;
    source.onopen = function () { liveSse('open', 'SSE 已连接'); };
    source.onerror = function () {
      liveSse('reconnecting', 'SSE 重连中…（断线恢复）');
      // EventSource 自动重连；服务端按 Last-Event-ID/seq 继续推送，前端按 seq 去重不重复渲染
    };
    source.onmessage = function (message) {
      liveSse('open', 'SSE 已连接');
      var event = null;
      try { event = JSON.parse(message.data); } catch (error) { event = null; }
      if (event === null) { return; }
      if (Number(event.seq || 0) <= live.lastSeq) { return; }
      liveHandle(event);
    };
  }

  function initLiveRun() {
    var panel = livePanel();
    if (panel === null) { return; }
    live.runId = panel.getAttribute('data-run-id') || '';
    var stepNodes = document.querySelectorAll('#live-plan [data-step]');
    live.stepsTotal = stepNodes.length;
    var doneNodes = document.querySelectorAll('#live-plan [data-status="done"]');
    live.stepsDone = doneNodes.length;
    // 先取快照（刷新恢复：状态/进度/计划立即正确），再打开 SSE 回放 + 实时
    api('GET', '/api/chat/runs/' + encodeURIComponent(live.runId)).then(function (payload) {
      var run = payload.data;
      if (run === null || run === undefined) { return; }
      liveStatus(run.status);
      live.stepsDone = Number(run.steps_done || 0);
      live.stepsTotal = Number(run.steps_total || live.stepsTotal);
      live.tokens = Number(run.token_used || 0);
      var stepsEl = byId('live-steps');
      if (stepsEl !== null) { stepsEl.textContent = String(live.stepsDone) + '/' + String(live.stepsTotal); }
      var tokenEl = byId('live-token');
      if (tokenEl !== null) { tokenEl.textContent = String(live.tokens); }
      if (run.pending_approval !== undefined && run.pending_approval !== null) { liveStatus('awaiting_approval'); }
    }).catch(function () {});
    liveConnect();
    var approve = byId('live-approve');
    if (approve !== null) {
      approve.addEventListener('click', function () {
        var approvalPanel = byId('live-approval');
        var step = approvalPanel === null ? 0 : Number(approvalPanel.getAttribute('data-step') || '0');
        approve.disabled = true;
        api('POST', '/api/chat/runs/' + encodeURIComponent(live.runId) + '/approvals', { step: step, decision: 'approve' })
          .then(function () { toast('已批准，继续执行', 'ok'); })
          .catch(function (error) { approve.disabled = false; showError('live-error', '批准失败：' + error.message); });
      });
    }
    var reject = byId('live-reject');
    if (reject !== null) {
      reject.addEventListener('click', function () {
        var approvalPanel = byId('live-approval');
        var step = approvalPanel === null ? 0 : Number(approvalPanel.getAttribute('data-step') || '0');
        reject.disabled = true;
        api('POST', '/api/chat/runs/' + encodeURIComponent(live.runId) + '/approvals', { step: step, decision: 'reject' })
          .then(function () { toast('已驳回，run 阻塞', 'warn'); })
          .catch(function (error) { reject.disabled = false; showError('live-error', '驳回失败：' + error.message); });
      });
    }
    var interrupt = byId('live-interrupt');
    if (interrupt !== null) {
      interrupt.addEventListener('click', function () {
        interrupt.disabled = true;
        api('POST', '/api/chat/runs/' + encodeURIComponent(live.runId) + '/interrupt', {}).then(function () {
          toast('已打断（可恢复）', 'warn');
        }).catch(function (error) { interrupt.disabled = false; showError('live-error', '打断失败：' + error.message); });
      });
    }
    var resume = byId('live-resume');
    if (resume !== null) {
      resume.addEventListener('click', function () {
        resume.disabled = true;
        api('POST', '/api/chat/runs/' + encodeURIComponent(live.runId) + '/resume', {}).then(function () {
          toast('已恢复执行', 'ok');
        }).catch(function (error) { resume.disabled = false; showError('live-error', '恢复失败：' + error.message); });
      });
    }
  }

  // ---- v1.5：run Tabs / 产物筛选 / 思考分块 / 工具卡片 -------------------
  function initRunTabs() {
    var tabs = document.querySelectorAll('#run-tabs .run-tab[data-tab]');
    if (tabs.length === 0) { return; }
    function activate(tabName) {
      for (var index = 0; index < tabs.length; index++) {
        var tab = tabs[index];
        var isActive = tab.getAttribute('data-tab') === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
      var panels = document.querySelectorAll('[data-tab-panel]');
      for (var panelIndex = 0; panelIndex < panels.length; panelIndex++) {
        var panel = panels[panelIndex];
        panel.hidden = panel.getAttribute('data-tab-panel') !== tabName;
      }
    }
    for (var index = 0; index < tabs.length; index++) {
      (function (tab) {
        tab.addEventListener('click', function () {
          activate(tab.getAttribute('data-tab'));
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', '#' + tab.getAttribute('data-tab'));
          }
        });
      })(tabs[index]);
    }
    var hash = String(window.location.hash || '').replace('#', '');
    if (hash === 'artifacts' || hash === 'metrics' || hash === 'report' || hash === 'process') { activate(hash); }
  }

  function filterCards(cards, predicate) {
    var visible = 0;
    for (var index = 0; index < cards.length; index++) {
      var card = cards[index];
      var show = predicate(card);
      card.hidden = !show;
      if (show) { visible += 1; }
    }
    return visible;
  }

  function initArtifactFilters() {
    var kind = byId('artifact-filter-kind');
    var agent = byId('artifact-filter-agent');
    var run = byId('artifact-filter-run');
    var list = byId('artifact-list');
    if (list === null) { return; }
    function apply() {
      var cards = list.querySelectorAll('.artifact-card');
      var visible = filterCards(cards, function (card) {
        var kindOk = kind === null || kind.value === '' || card.getAttribute('data-kind') === kind.value;
        var agentOk = agent === null || agent.value === '' || card.getAttribute('data-agent') === agent.value;
        var runOk = run === null || run.value === '' || card.getAttribute('data-run-id') === run.value;
        return kindOk && agentOk && runOk;
      });
      var count = byId('artifact-count');
      if (count !== null) { count.textContent = '共 ' + String(visible) + ' 个产物（已筛选）'; }
      var empty = byId('artifact-list-empty');
      if (empty !== null) { empty.hidden = visible > 0; }
    }
    if (kind !== null) { kind.addEventListener('change', apply); }
    if (agent !== null) { agent.addEventListener('change', apply); }
    if (run !== null) { run.addEventListener('change', apply); }
    var reportAgent = byId('report-filter-agent');
    var reportRun = byId('report-filter-run');
    var reportList = byId('reports-list');
    if (reportList !== null) {
      function applyReports() {
        var items = reportList.querySelectorAll('.report-item');
        var visible = filterCards(items, function (item) {
          var agentOk = reportAgent === null || reportAgent.value === '' || item.getAttribute('data-agent') === reportAgent.value;
          var runOk = reportRun === null || reportRun.value === '' || item.getAttribute('data-run-id') === reportRun.value;
          return agentOk && runOk;
        });
        var count = byId('report-count');
        if (count !== null) { count.textContent = '共 ' + String(visible) + ' 份报告（已筛选）'; }
        var empty = byId('reports-list-empty');
        if (empty !== null) { empty.hidden = visible > 0; }
      }
      if (reportAgent !== null) { reportAgent.addEventListener('change', applyReports); }
      if (reportRun !== null) { reportRun.addEventListener('change', applyReports); }
    }
  }

  function liveThinking(data) {
    var wrap = byId('live-thinking');
    if (wrap === null) { return; }
    var step = String(data.step || '0');
    var block = wrap.querySelector('.live-thinking-block[data-step="' + step + '"]');
    if (block === null) {
      block = document.createElement('details');
      block.className = 'live-thinking-block';
      block.setAttribute('data-step', step);
      block.open = true;
      var summary = document.createElement('summary');
      summary.textContent = '步骤 ' + step + ' · ' + String(data.agent_title || data.agent_role || 'agent') + ' 思考过程';
      block.appendChild(summary);
      var text = document.createElement('div');
      text.className = 'live-thinking-text';
      block.appendChild(text);
      wrap.appendChild(block);
    }
    var target = block.querySelector('.live-thinking-text');
    if (target !== null) {
      target.textContent = target.textContent + (target.textContent === '' ? '' : '\\n') + String(data.text || data.chunk || '');
      target.scrollTop = target.scrollHeight;
    }
  }

  function liveTool(data, phase) {
    var wrap = byId('live-tools');
    if (wrap === null) { return; }
    var callId = String(data.callId || data.call_id || '');
    if (phase === 'call') {
      var card = document.createElement('div');
      card.className = 'live-tool';
      card.setAttribute('data-call-id', callId);
      card.setAttribute('data-status', 'running');
      card.innerHTML = '';
      var name = document.createElement('span');
      name.className = 'live-tool-name';
      name.textContent = String(data.tool || 'tool');
      var args = document.createElement('span');
      args.className = 'live-tool-args mono small muted';
      args.textContent = String(data.input || data.args_summary || '');
      var status = document.createElement('span');
      status.className = 'live-tool-status';
      status.textContent = '调用中…';
      card.appendChild(name);
      card.appendChild(args);
      card.appendChild(status);
      wrap.appendChild(card);
      return;
    }
    var nodes = wrap.querySelectorAll('.live-tool');
    for (var index = 0; index < nodes.length; index++) {
      var node = nodes[index];
      if (node.getAttribute('data-call-id') !== callId) { continue; }
      node.setAttribute('data-status', String(data.status || 'ok'));
      var statusEl = node.querySelector('.live-tool-status');
      if (statusEl !== null) {
        statusEl.textContent = (String(data.status) === 'ok' ? '成功' : '失败') + (data.duration_ms === undefined ? '' : ' · ' + String(data.duration_ms || 0) + 'ms') + ' · ' + String(data.result_preview || data.result_summary || '');
      }
      return;
    }
  }

  function liveArtifact(rawData) {
    var data = rawData.artifact || rawData;
    var wrap = byId('live-artifacts');
    if (wrap === null) { return; }
    var empty = byId('live-artifacts-empty');
    if (empty !== null) { empty.hidden = true; }
    var link = document.createElement('a');
    link.className = 'live-artifact run-link';
    link.setAttribute('data-artifact-id', String(data.artifact_id || ''));
    link.href = '/artifacts?run_id=' + encodeURIComponent(String(data.run_id || '')) + '#artifact-' + encodeURIComponent(String(data.artifact_id || ''));
    link.textContent = '📄 产物已生成：' + String(data.title || data.rel_path || '') + '（' + String(data.kind || '') + '，' + String(data.size || 0) + ' B）';
    wrap.appendChild(link);
  }

  function liveReport(rawData) {
    var data = rawData.report || rawData;
    var wrap = byId('live-artifacts');
    if (wrap === null) { return; }
    var empty = byId('live-artifacts-empty');
    if (empty !== null) { empty.hidden = true; }
    var link = document.createElement('a');
    link.className = 'live-report run-link';
    link.setAttribute('data-report-id', String(data.report_id || ''));
    link.href = '/reports?run_id=' + encodeURIComponent(String(data.run_id || '')) + '#report-' + encodeURIComponent(String(data.report_id || ''));
    link.textContent = '🧾 报告已生成：' + String(data.title || '');
    wrap.appendChild(link);
  }

  function init() {
    initChatCreate();
    initChatSession();
    initLiveRun();
    initRunTabs();
    initArtifactFilters();
    initLightbox();
    initMoney();
    initModels();
    initPrompts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
