const SCROLL_SURFACE = ":is(.la-drawer, .la-drawer *, .la-modal-body, .la-modal-body *, .la-diff-modal-root, .la-diff-modal-root *, .la-ask-modal, .la-ask-modal *):not(.la-vn-lines)";

export const APP_STYLES = `
.la-history-only { font-size:12px; color:var(--lumiverse-text-muted); max-width:300px; }
.la-history-only summary { cursor:pointer; padding:8px 0; }
.la-history-only p { white-space:normal; line-height:1.5; margin:4px 0; }
.la-long-diff { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.la-long-diff section { min-width:0; }
.la-long-diff h4 { margin:0 0 10px; font-size:12px; }
@media(max-width:600px) { .la-long-diff { grid-template-columns:1fr; } }
.la-picker-search { width:100%; padding:11px 12px; margin-bottom:10px; border:1px solid var(--lumiverse-border); border-radius:10px; color:var(--lumiverse-text); background:var(--lumiverse-bg); font:inherit; }
.la-picker-list { position:relative; height:min(540px,65dvh); overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.la-picker-status { color:var(--lumiverse-text-muted); font-size:12px; padding:8px 0; }
.la-picker-status:empty { display:none; }
.la-picker-list .la-session-item-main { display:block; border:0; background:none; color:inherit; font:inherit; text-align:left; padding:8px 0; min-width:0; flex:1; cursor:pointer; }
.la-session-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.la-slider-native { width:100%; height:32px; accent-color:var(--lumiverse-primary); cursor:pointer; }
.la-slider-reset { border:0; background:transparent; color:var(--lumiverse-text-muted); font:inherit; font-size:11px; padding:8px; cursor:pointer; }
.la-agent-settings :is(button,input,textarea,summary,select):focus-visible,.la-diff-modal-root :is(button,input,summary):focus-visible { outline:2px solid var(--lumiverse-primary); outline-offset:2px; }
@media(hover:none),(pointer:coarse) { .la-diff-tree-row,.la-session-item-delete,.la-workshop-tab { min-height:42px; } .la-slider-reset { min-height:40px; } }
.la-settings-section { border-top:1px solid var(--lumiverse-border); padding:20px 0; }
.la-settings-section > h3 { margin:0 0 12px; font-size:14px; font-weight:600; }
.la-agent-settings { min-width:0; }
.la-agent-settings .la-composer-status { position:sticky; bottom:0; padding:10px 0; background:var(--lumiverse-bg); font-size:12px; }
.la-agent-settings .la-composer-status:empty { display:none; }
.la-settings-hint { line-height:1.5; }
.la-form-error { font-size:12px; color:var(--lumiverse-danger,var(--lumiverse-text)); }
.la-form-error:empty { display:none; }
.la-ask-modal { max-height:calc(100dvh - 32px); overflow-y:auto; overscroll-behavior:contain; }
.la-ask-footer { position:sticky; bottom:0; background:var(--lumiverse-bg-elevated); }
@media(max-width:600px) { .la-settings-row { flex-wrap:wrap; gap:8px; } .la-settings-textarea { font-size:16px; } .la-ask-modal { width:calc(100vw - 24px); max-width:none; padding:16px; } }
.la-activity-scroll { min-height:1px; max-height:min(360px,45dvh); overflow:auto; overscroll-behavior:auto; scrollbar-width:thin; padding:0 6px; }
.la-activity-status { display:flex; align-items:center; gap:8px; padding:8px 12px; color:var(--lumiverse-text-muted); font-size:12px; }
.la-activity-status:empty { display:none; }
.la-reasoning-summary { margin:8px 0 12px; color:var(--lumiverse-text-muted); border:1px solid transparent; border-radius:16px; }
.la-reasoning-summary[open] { border-color:var(--lumiverse-border); background:var(--la-conversation-soft); }
.la-reasoning-summary[open] > summary { border-color:transparent; background:transparent; }
.la-reasoning-summary > summary { display:inline-flex; align-items:center; gap:7px; min-height:32px; max-width:100%; padding:5px 11px; border:1px solid var(--lumiverse-border); border-radius:999px; background:var(--lumiverse-bg); cursor:pointer; list-style:none; font-size:12px; transition:background .15s,border-color .15s; }
.la-reasoning-summary > summary:hover { background:var(--lumiverse-bg-hover); }
.la-reasoning-summary > summary:focus-visible { outline:2px solid var(--lumiverse-primary); outline-offset:3px; }
.la-reasoning-summary.is-thinking > summary .la-activity-indicator { display:block; width:11px; height:11px; background:none; border:1.5px solid var(--lumiverse-border); border-top-color:var(--lumiverse-primary); border-radius:50%; animation:la-request-spin 1s linear infinite; }
.la-streaming-loading { display:flex; flex-direction:column; align-items:flex-start; gap:2px; min-height:28px; padding:4px 12px; }
.la-msg-assistant[data-live-message] > .la-msg-bubble:empty { display:none; }
@media(prefers-reduced-motion:reduce) { .la-thinking *, .la-thinking *::before, .la-thinking *::after { animation:none!important; } }
@media(prefers-reduced-motion:reduce) { .la-reasoning-summary.is-thinking > summary .la-activity-indicator { animation:none; border-style:dotted; } }
.la-progress-label { font-size:12px; color:var(--lumiverse-text-muted); }
.la-compaction-status { margin:0 0 8px; font-size:12px; line-height:1.5; color:var(--lumiverse-text-muted); }
.la-reasoning-summary > summary::-webkit-details-marker { display:none; }
.la-reasoning-summary .la-activity-indicator { display:none; }
.la-reasoning-summary .la-activity-label { flex:initial; font-weight:500; }
.la-reasoning-summary .la-activity-chevron { width:16px; height:16px; flex-basis:16px; }
.la-reasoning-summary[open] > summary .la-activity-chevron { transform:rotate(180deg); }
.la-reasoning-summary .la-activity-scroll { max-height:min(320px,40dvh); border:0; border-top:1px solid var(--lumiverse-border); padding:6px 0; margin:0; scrollbar-gutter:stable; }
.la-reasoning-tool { display:block; width:100%; text-align:left; padding:8px 11px; line-height:1.6; overflow-wrap:anywhere; white-space:normal; border:0; border-radius:8px; background:transparent; color:var(--lumiverse-primary); font:inherit; font-size:12px; cursor:pointer; }
.la-reasoning-tool:hover { background:var(--lumiverse-bg-hover); }
.la-reasoning-text { padding:8px 11px; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
.la-activity-scroll .la-tool-card { margin:3px 0; }
.la-inline-content { min-height:24px; font-size:12px; }
.la-inline-content pre,.la-inline-chunk pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:0; font:12px/1.6 ui-monospace,monospace; }
.la-inline-scroll { height:320px; overflow:auto; overscroll-behavior:auto; scrollbar-width:thin; }
.la-tool-body-section .la-inline-content { max-height:320px; overflow:auto; }
.la-inline-retry,.la-activity-status button { margin-left:8px; padding:6px 10px; border:1px solid var(--lumiverse-border); border-radius:8px; color:var(--lumiverse-text); background:var(--lumiverse-bg-hover); }
.la-files { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; gap:10px; padding:14px; color:var(--lumiverse-text); font:13px/1.5 var(--lumiverse-font-family,system-ui); container-type:inline-size; }
.la-files-toolbar,.la-files-actions,.la-files-breadcrumbs { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.la-files button { min-height:36px; border-radius:8px; font-family:inherit; font-size:12px; }
.la-files button:focus-visible,.la-files-list:focus-visible { outline:2px solid var(--lumiverse-primary); outline-offset:2px; }
.la-files-breadcrumbs { padding:5px 0; font-size:12px; color:var(--lumiverse-text-muted); }
.la-files-breadcrumbs button { background:transparent; border-color:transparent; max-width:220px; overflow:hidden; text-overflow:ellipsis; }
.la-files-breadcrumbs [aria-current] { color:var(--lumiverse-text); font-weight:600; }
.la-files-status { font-size:12px; overflow-wrap:anywhere; color:var(--lumiverse-text-muted); }
.la-files-status:empty { display:none; }
.la-files-status.is-error { color:var(--lumiverse-danger,var(--lumiverse-text)); }
.la-files-split { display:grid; grid-template-columns:minmax(220px,2fr) minmax(0,3fr); flex:1; min-height:0; border:1px solid var(--lumiverse-border); border-radius:12px; overflow:hidden; }
.la-files-list { overflow:auto; min-height:0; position:relative; overscroll-behavior:contain; scrollbar-width:thin; }
.la-files-list-space { position:relative; }
.la-file-row { height:44px; position:absolute; left:0; right:0; display:flex; align-items:center; gap:10px; padding:0 12px; cursor:pointer; border:1px solid transparent; font-size:12px; }
.la-file-row:hover { background:var(--lumiverse-bg-hover); }
.la-file-row.is-selected { background:color-mix(in srgb,var(--lumiverse-primary) 13%,transparent); border-color:color-mix(in srgb,var(--lumiverse-primary) 35%,transparent); }
.la-file-row.is-cut { opacity:.45; }
.la-files .is-drop-target { box-shadow:inset 0 0 0 2px var(--lumiverse-primary); background:color-mix(in srgb,var(--lumiverse-primary) 12%,transparent); }
.la-file-icon { width:20px; height:20px; flex:none; color:var(--lumiverse-text-muted); }
.la-file-icon svg { width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linejoin:round; }
.la-file-name { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.la-file-size { color:var(--lumiverse-text-muted); font-size:11px; white-space:nowrap; }
.la-files-preview { min-width:0; min-height:0; overflow:auto; display:flex; flex-direction:column; border-left:1px solid var(--lumiverse-border); padding:14px; gap:12px; }
.la-files-preview:empty::after { content:"Select a file to preview"; margin:auto; color:var(--lumiverse-text-muted); font-size:12px; }
.la-files-preview-header { display:flex; gap:10px; align-items:center; font-size:13px; overflow-wrap:anywhere; }
.la-files-preview-header button { display:none; }
.la-files-preview-body { flex:1; min-height:0; display:flex; flex-direction:column; gap:10px; }
.la-files-loading { display:flex; align-items:center; justify-content:center; gap:10px; min-height:120px; font-size:12px; color:var(--lumiverse-text-muted); }
.la-files-status .la-files-loading { min-height:24px; justify-content:flex-start; }
.la-files-empty { padding:24px 12px; color:var(--lumiverse-text-muted); font-size:12px; text-align:center; }
.la-files-editor-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:11px; color:var(--lumiverse-text-muted); }
.la-files-editor { flex:1; min-height:180px; width:100%; resize:none; border:1px solid var(--lumiverse-border); border-radius:8px; background:var(--lumiverse-bg); color:var(--lumiverse-text); padding:12px; font:12px/1.65 ui-monospace,monospace; tab-size:2; }
.la-files-preview-body :is(img,video) { max-width:100%; max-height:55dvh; object-fit:contain; border-radius:8px; }
.la-files-preview-body audio { width:100%; }
.la-file-name-dialog { width:min(360px,90vw); border:1px solid var(--lumiverse-border); border-radius:14px; padding:20px; background:var(--lumiverse-bg-elevated); color:var(--lumiverse-text); }
.la-file-name-dialog::backdrop { background:#0006; }
.la-file-name-dialog label { display:flex; flex-direction:column; gap:12px; font-size:14px; }
.la-file-name-dialog input { width:100%; padding:10px; background:var(--lumiverse-bg); color:inherit; border:1px solid var(--lumiverse-border); border-radius:8px; font:inherit; }
.la-file-name-dialog .la-files-actions { margin-top:18px; justify-content:flex-end; }
@container(max-width:600px) {
  .la-files-split { grid-template-columns:1fr; }
  .la-files-preview { display:none; border-left:0; }
  .has-preview .la-files-preview { display:flex; }
  .has-preview .la-files-list { display:none; }
  .la-files-preview-header button { display:inline-flex; }
}
@media(hover:none),(pointer:coarse) { .la-files button { min-height:42px; } .la-files-editor { font-size:16px; } }
${SCROLL_SURFACE} { scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--lumiverse-text-muted) 45%,transparent) transparent; }
@supports selector(::-webkit-scrollbar) {
  ${SCROLL_SURFACE} { scrollbar-width:auto; scrollbar-color:auto; }
  ${SCROLL_SURFACE}::-webkit-scrollbar { width:6px; height:6px; }
  ${SCROLL_SURFACE}::-webkit-scrollbar-track { background:transparent; }
  ${SCROLL_SURFACE}::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--lumiverse-text-muted) 45%,transparent); border-radius:999px; }
  ${SCROLL_SURFACE}::-webkit-scrollbar-thumb:hover { background:color-mix(in srgb,var(--lumiverse-text-muted) 70%,transparent); }
  ${SCROLL_SURFACE}::-webkit-scrollbar-button { display:none; width:0; height:0; }
  ${SCROLL_SURFACE}::-webkit-scrollbar-corner { background:transparent; }
}
@media(forced-colors:active) { ${SCROLL_SURFACE} { scrollbar-color:auto; } ${SCROLL_SURFACE}::-webkit-scrollbar-thumb { background:CanvasText; } }
`;
