export const chatStyles = `
:root {
  color-scheme: light dark;
  --bg: var(--vscode-sideBar-background, #181a20);
  --fg: var(--vscode-foreground, #e1e4eb);
  --subtle: var(--vscode-descriptionForeground, #a1a9b8);
  --border: var(--vscode-panel-border, #303541);
  --accent: var(--vscode-button-background, #4668d9);
  --accent-fg: var(--vscode-button-foreground, #fff);
  --input-bg: var(--vscode-input-background, #232730);
  --input-fg: var(--vscode-input-foreground, #e1e4eb);
  --card-bg: var(--vscode-editor-background, #1c1f26);
  --success: var(--vscode-testing-iconPassed, #70bc92);
  --warning: var(--vscode-editorWarning-foreground, #dfb969);
  --error: var(--vscode-errorForeground, #f18b8b);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { height: 100%; }
body { margin: 0; height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); color: var(--fg); font: 13px/1.55 var(--vscode-font-family, system-ui, sans-serif); }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; border: 1px solid transparent; background: transparent; border-radius: 6px; padding: 6px 9px; }
button:hover { background: var(--input-bg); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--vscode-focusBorder, #8ca5ff); outline-offset: 2px; }
input, select, textarea { min-width: 0; max-width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--input-bg); color: var(--input-fg); padding: 7px 9px; }
select { width: 100%; }
option { background: var(--input-bg); color: var(--input-fg); }
textarea { resize: vertical; }
.header { padding: 8px 12px; flex: none; }
.header-top, .header-actions, .model-info-left, .composer-bottom, .toolbar-items, .drawer-header, .artifact-header { display: flex; align-items: center; gap: 6px; min-width: 0; }
.header-top { justify-content: space-between; }
.header-title { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 600; }
.header-logo { width: 18px; height: 18px; object-fit: contain; flex: none; background: transparent; border: none; }
#sessionTitle { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: normal; }
.header-actions { flex: none; gap: 2px; }
.icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; min-width: 30px; color: var(--subtle); }
#chatHistory { position: relative; }
#chatHistory summary { display: flex; align-items: center; justify-content: center; cursor: pointer; list-style: none; min-height: 30px; min-width: 30px; border-radius: 6px; color: var(--subtle); }
#chatHistory summary::-webkit-details-marker { display: none; }
#chatHistory summary:hover { background: var(--input-bg); }
.history-panel { position: fixed; top: 44px; right: 12px; left: 12px; z-index: 10; max-height: 45vh; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); padding: 10px; box-shadow: 0 5px 22px #0004; }
#chatFilter { width: 100%; }
#chatList { margin-top: 8px; }
.model-chip { display: flex; align-items: center; flex: 1; min-width: 0; }
#modelSelect { flex: 1; min-width: 0; width: 100%; padding: 4px 2px; font-size: 11px; background: transparent; border-color: transparent; }
#modeSelect { width: 73px; flex: none; padding: 4px 2px; font-size: 11px; background: transparent; border-color: transparent; }
#effortSelect { width: 76px; flex: none; padding: 4px 2px; font-size: 11px; background: transparent; border-color: transparent; }
#modelSelect:hover, #modeSelect:hover, #effortSelect:hover { background: var(--card-bg); }
#activeModelLabel { display: none; }
.model-badge { display: none; }
#remoteGpuStatus { display: block; overflow-wrap: anywhere; }
.strat-btn.active { background: var(--input-bg); color: var(--fg); border-color: var(--border); }
.strategy-toggle, .settings-actions { display: flex; gap: 6px; }
.strat-btn { color: var(--subtle); font-size: 10px; padding: 4px 6px; }
.conversation-area { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }
.main-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 18px 16px 24px; display: flex; flex-direction: column; gap: 20px; scrollbar-gutter: stable; }
.main-scroll > * { flex-shrink: 0; max-width: 100%; min-width: 0; }
.msg-assistant { padding: 0; overflow-wrap: anywhere; }
.msg-assistant.welcome { display: flex; flex-direction: column; gap: 10px; color: var(--subtle); margin: auto 0; padding: 24px 6px; text-align: left; }
.welcome-header { display: flex; align-items: center; gap: 12px; }
.welcome-logo { width: 56px; height: 56px; object-fit: contain; flex: none; background: transparent; border: none; box-shadow: none; filter: drop-shadow(0 3px 10px rgba(0,0,0,0.18)); }
.welcome-brand { display: flex; flex-direction: column; gap: 2px; }
.welcome-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
.welcome-tagline { font-size: 11px; color: var(--subtle); }
.msg-assistant.welcome strong { color: var(--fg); font-size: 22px; font-weight: 550; line-height: 1.35; letter-spacing: -.025em; }
.msg-assistant.welcome p { font-size: 12px; margin: 0; max-width: 330px; line-height: 1.7; }
.main-scroll:has(.msg-user) .welcome { display: none !important; }
.msg-user { align-self: flex-end; max-width: 92%; padding: 10px 14px; border: none; border-radius: 12px; background: var(--input-bg); white-space: pre-wrap; overflow-wrap: anywhere; }
.msg-assistant h1, .msg-assistant h2, .msg-assistant h3, .msg-assistant h4 { font-size: 15px; font-weight: 650; line-height: 1.4; margin: 18px 0 8px; }
.msg-assistant h1 { font-size: 19px; }
.msg-assistant h2 { font-size: 17px; }
.msg-assistant p { margin: 8px 0; }
.msg-assistant ul, .msg-assistant ol { padding-left: 22px; margin: 8px 0; }
.msg-assistant li { margin: 4px 0; }
a { color: var(--vscode-textLink-foreground, #9cb6ff); text-decoration: none; }
a:hover { text-decoration: underline; }
pre { margin: 8px 0; padding: 10px; max-width: 100%; overflow: auto; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; font: 11px/1.6 var(--vscode-editor-font-family, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
code { font-family: var(--vscode-editor-font-family, monospace); font-size: .92em; }
p code, li code { padding: 1px 4px; border-radius: 3px; background: var(--input-bg); }
table { display: block; overflow-x: auto; border-collapse: collapse; max-width: 100%; }
th, td { border: 1px solid var(--border); padding: 6px 9px; text-align: left; }
blockquote { border-left: 2px solid var(--border); padding-left: 12px; color: var(--subtle); margin: 10px 0; }
.timeline { display: flex; flex-direction: column; gap: 8px; }
.timeline-row { display: flex; gap: 8px; align-items: baseline; font-size: 11px; color: var(--subtle); }
.timeline-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.activity-symbol { color: var(--success); width: 12px; flex: none; }
.timeline-row[data-status="error"] .activity-symbol { color: var(--error); }
.timeline-row[data-status="warning"] .activity-symbol, .timeline-row[data-status="waiting_for_approval"] .activity-symbol { color: var(--warning); }
.timeline-row[data-status="running"] .activity-symbol, .thinking-spinner { animation: spin 1.5s linear infinite; }
.activity-duration { flex: none; font-size: 10px; font-variant-numeric: tabular-nums; }
.timeline-details summary { cursor: pointer; font-size: 10px; opacity: .8; margin-top: 3px; }
.timeline-details strong { font-size: 10px; }
.timeline-details pre { margin: 5px 0 10px; max-height: 260px; }
.thinking-bubble { display: flex; align-items: center; gap: 8px; color: var(--subtle); font-size: 12px; }
.thinking-spinner { width: 12px; height: 12px; border: 1px solid var(--border); border-top-color: var(--fg); border-radius: 50%; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.jump-latest { position: absolute; bottom: 12px; align-self: center; border: 1px solid var(--border); background: var(--input-bg); box-shadow: 0 3px 16px #0003; font-size: 11px; }
.toolbar-bar { display: flex; align-items: center; gap: 4px; padding: 6px 2px 0; min-width: 0; }
.toolbar-btn { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--subtle); padding: 4px; }
.toolbar-count { min-width: 13px; text-align: center; font-size: 9px; }
#footerStatusText { flex: 1; min-width: 60px; text-align: right; font-size: 10px; color: var(--subtle); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.composer { padding: 0 12px 10px; flex: none; position: relative; }
.ref-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.chip { padding: 2px 5px; color: var(--subtle); font-size: 10px; }
.composer-input-box { background: var(--input-bg); border: 1px solid var(--border); border-radius: 12px; padding: 8px 10px; position: relative; }
.composer-input-box:focus-within { border-color: var(--vscode-focusBorder, #8ca5ff); }
#promptInput { display: block; width: 100%; border: none; outline: none; padding: 6px 0; min-height: 78px; max-height: 22vh; resize: vertical; background: transparent; line-height: 1.6; }
#promptInput::placeholder { color: var(--subtle); opacity: .85; }
#promptInput:focus-visible { outline: none; }
.composer-bottom { justify-content: space-between; padding-top: 4px; gap: 4px; }
.context-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
#activeFileName { min-width: 0; font-size: 10px; color: var(--subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.send-btn, .action-btn { background: var(--accent); color: var(--accent-fg); font-size: 11px; padding: 5px 10px; }
.action-btn.secondary { background: transparent; border-color: var(--border); color: var(--fg); }
.permission-card, .artifact-card { padding: 12px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; }
.permission-title, .artifact-title { font-weight: 600; }
.permission-desc { color: var(--subtle); margin: 6px 0; }
.permission-command, .terminal-box { white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.6 var(--vscode-editor-font-family, monospace); background: var(--input-bg); border-radius: 6px; padding: 8px; max-height: 40vh; overflow: auto; }
.permission-actions, .artifact-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.artifact-body { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 8px; max-height: 45vh; overflow: auto; }
.drawer { display: none; position: absolute; inset: 8px; z-index: 20; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); box-shadow: 0 10px 40px #0005; overflow-y: auto; flex-direction: column; gap: 12px; }
.drawer.open { display: flex; }
.drawer-header { justify-content: space-between; flex: none; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.drawer-title { font-size: 14px; font-weight: 600; }
.drawer input, .drawer textarea, .drawer select { width: 100%; }
.drawer > * { flex-shrink: 0; }
.drawer label { font-size: 12px; }
.drawer details > summary { cursor: pointer; padding: 7px 0; font-weight: 600; }
.drawer details > div { display: flex; flex-direction: column; gap: 8px; }
.diff-list { display: flex; flex-direction: column; gap: 6px; }
.diff-item { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); padding: 8px 0; overflow-wrap: anywhere; }
.diff-stats { font-size: 10px; margin-left: auto; }
.stat-add { color: var(--success); }
.stat-del { color: var(--error); }
.slash-popup { display: none; position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); z-index: 5; padding: 4px; }
.slash-popup.open { display: block; }
.slash-item { display: flex; justify-content: space-between; padding: 6px; cursor: pointer; font-size: 11px; }
.slash-item:hover { background: var(--input-bg); }
#filePicker { flex: none; min-width: 0; }
#filePicker summary { cursor: pointer; list-style: none; font-size: 11px; color: var(--subtle); padding: 2px 4px; border-radius: 4px; }
#filePicker summary::-webkit-details-marker { display: none; }
#filePicker summary::before { content: "+"; margin-right: 5px; font-size: 14px; }
#filePicker summary:hover { background: var(--card-bg); }
.context-panel { position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; z-index: 10; max-height: 45vh; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); padding: 10px; box-shadow: 0 5px 22px #0004; }
#selectedFiles { display: flex; gap: 4px; flex-wrap: wrap; }
#selectedFiles button { font-size: 10px; padding: 2px 5px; max-width: 100%; overflow-wrap: anywhere; border-color: var(--border); }
#fileList { max-height: 180px; overflow: auto; margin-top: 6px; }
#fileList label { display: flex; align-items: center; gap: 6px; padding: 5px 0; font-size: 11px; overflow-wrap: anywhere; }
#fileList input { flex: none; }
#fileFilter { width: 100%; }
@media (max-width: 350px) {
  .header, .composer { padding-left: 8px; padding-right: 8px; }
  .main-scroll { padding-left: 10px; padding-right: 10px; }
  #sessionTitle { display: none; }
  .composer-input-box { padding: 8px; }
  .composer-bottom { flex-wrap: wrap; }
  .composer-bottom .model-chip { flex-basis: calc(100% - 84px); }
  #effortSelect { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; scroll-behavior: auto !important; } }
`;
