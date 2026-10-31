export const MESSAGE_STYLES = `
.la-drawer :is(button,summary,[role=button]) { -webkit-tap-highlight-color:transparent; }
.la-drawer { --la-conversation-soft: color-mix(in srgb, var(--lumiverse-text) 4%, var(--lumiverse-bg)); }
.la-header { background:var(--lumiverse-bg); padding:12px 14px; gap:8px; }
.la-header .la-btn { min-width:34px; min-height:34px; border-color:transparent; border-radius:10px; }
.la-header .la-combo-trigger { min-height:36px; border-radius:10px; padding:8px 12px; background:var(--la-conversation-soft); border:1px solid var(--lumiverse-border); }
.la-header .la-btn:hover { border-color:var(--lumiverse-border); }
.la-message-details,.la-activity-pagination button { font:inherit; font-size:12px; border:1px solid transparent; background:transparent; color:var(--lumiverse-text-muted); border-radius:8px; padding:7px 9px; min-height:34px; cursor:pointer; }
.la-message-details:hover,.la-activity-pagination button:hover:not(:disabled) { background:var(--lumiverse-bg-hover); color:var(--lumiverse-text); }
.la-activity-pagination button:disabled { opacity:.4; cursor:default; }
.la-thread { padding:22px 16px; min-height:0; scrollbar-gutter:stable; }
.la-thread-shell { position:relative; display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; }
.la-thread-shell.is-syncing .la-thread { filter:blur(4px); opacity:.55; pointer-events:none; }
.la-thread-shell.is-opening .la-empty { visibility:hidden; }
.la-request-feedback { position:absolute; z-index:4; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:8px; max-width:calc(100% - 24px); padding:8px 12px; border:1px solid var(--lumiverse-border); border-radius:12px; color:var(--lumiverse-text); background:var(--lumiverse-bg-elevated); box-shadow:0 3px 12px color-mix(in srgb,var(--lumiverse-bg) 35%,transparent); font-size:12px; line-height:1.4; }
.la-request-feedback[hidden],.la-request-feedback [hidden] { display:none!important; }
.la-request-feedback[data-position=top] { top:12px; }
.la-request-feedback[data-position=bottom] { bottom:12px; }
.la-request-feedback[data-position=center] { top:50%; transform:translate(-50%,-50%); }
.la-request-feedback button,.la-inspector-retry { border:0; border-radius:6px; padding:5px 8px; background:var(--lumiverse-bg-hover); color:var(--lumiverse-text); font:inherit; cursor:pointer; }
.la-pending-spinner { display:inline-block; flex:none; width:14px; height:14px; box-sizing:border-box; border:2px solid color-mix(in srgb,var(--lumiverse-text-muted) 30%,transparent); border-top-color:var(--lumiverse-primary); border-radius:50%; animation:la-request-spin .8s linear infinite; }
.la-inspector-progress { display:flex; align-items:center; gap:8px; }
@keyframes la-request-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .la-pending-spinner { animation:none; border-style:dotted; } }

.la-msg { margin-bottom:24px; padding:8px; border-radius:18px; }
.la-msg-bubble { transition:background .15s,border-color .15s; }
.la-virtual-row:hover .la-msg-bubble,.la-virtual-row:focus-within .la-msg-bubble { background:color-mix(in srgb,var(--lumiverse-text) 8%,var(--lumiverse-bg)); border-color:color-mix(in srgb,var(--lumiverse-text) 20%,var(--lumiverse-border)); }
.la-msg-assistant .la-msg-bubble { line-height:1.65; border-radius:16px 16px 16px 4px; padding:12px 16px; background:var(--la-conversation-soft); border:1px solid var(--lumiverse-border); }
.la-virtual-row:hover .la-msg-actions,.la-virtual-row:focus-within .la-msg-actions { opacity:1; pointer-events:auto; }
.la-msg-user .la-msg-bubble { border-radius:16px 16px 4px 16px; padding:12px 16px; background:var(--la-conversation-soft); border:1px solid var(--lumiverse-border); }
.la-msg-block { margin:12px 0; }
.la-activity-summary,.la-edits-card { margin:8px 0 16px; border:1px solid var(--lumiverse-border); border-radius:14px; background:var(--la-conversation-soft); overflow:hidden; }
.la-activity-summary > summary,.la-edits-card > summary { display:flex; align-items:center; gap:10px; padding:13px 14px; cursor:pointer; list-style:none; min-height:48px; }
.la-activity-summary > summary::-webkit-details-marker,.la-edits-card > summary::-webkit-details-marker { display:none; }
.la-activity-chevron { width:20px; height:20px; flex:0 0 20px; display:block; color:var(--lumiverse-text-muted); transition:transform .16s; }
.la-activity-summary[open] > summary > .la-activity-chevron,.la-edits-card[open] > summary > .la-activity-chevron { transform:rotate(180deg); }
.la-activity-chevron svg { display:block; width:100%; height:100%; }
.la-activity-count:empty { display:none; }
.la-activity-summary > summary:hover,.la-edits-card > summary:hover { background:var(--lumiverse-bg-hover); }
.la-drawer :is(.la-activity-summary,.la-edits-card) > summary:focus-visible { outline:2px solid var(--lumiverse-primary); outline-offset:-3px; border-radius:inherit; }
.la-edits-list { padding:0 12px; max-height:min(360px,45dvh); overflow:auto; overscroll-behavior:contain; }
.la-edits-card[open] .la-edits-list { display:flex; flex-direction:column; gap:8px; }
.la-edits-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; padding:10px 12px; }
.la-edits-actions .la-btn { min-height:32px; padding:6px 10px; background:var(--lumiverse-bg); border:1px solid var(--lumiverse-border); border-radius:8px; color:var(--lumiverse-text-muted); }
.la-edits-actions .la-btn-danger { color:var(--lumiverse-danger); }
@media(hover:none),(pointer:coarse) { .la-edits-actions .la-btn { min-height:40px; } }
.la-activity-label { flex:1; min-width:0; font-size:12px; font-weight:550; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.la-activity-count { color:var(--lumiverse-text-muted); font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.la-activity-indicator { width:7px; height:7px; border-radius:50%; background:var(--lumiverse-text-muted); flex:none; }
.la-activity-summary[data-state=running] .la-activity-indicator { background:var(--lumiverse-primary); box-shadow:0 0 0 4px color-mix(in srgb,var(--lumiverse-primary) 14%,transparent); }
.la-activity-summary[data-state=error] .la-activity-indicator { background:var(--lumiverse-danger,var(--lumiverse-text)); }
.la-activity-steps { padding:0 10px 10px; }
.la-activity-pagination { display:flex; align-items:center; gap:6px; color:var(--lumiverse-text-muted); font-size:11px; padding-bottom:6px; }
.la-activity-pagination span { margin-left:auto; }
.la-activity-steps .la-tool-card { margin:3px 0; border:0; border-radius:8px; background:transparent; box-shadow:none; }
.la-activity-steps .la-tool-head { min-height:38px; padding:9px 10px; }
.la-tool-caret { display:flex; align-items:center; justify-content:center; }
.la-tool-caret svg { display:block; transition:transform .16s; }
.la-tool-card.is-open .la-tool-caret svg { transform:rotate(90deg); }
.la-tool-head .la-tool-free-btn { display:none!important; }
.la-tool-card.is-open .la-tool-head .la-tool-free-btn { display:inline-flex!important; text-transform:none; font-size:10px; }
.la-tool-card.is-open .la-tool-head .la-tool-free-btn[hidden] { display:none!important; }
.la-tool-body pre { max-height:240px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.la-reasoning { border:0; background:none; margin:8px 0; padding:0; }
.la-reasoning-toggle { border:0; background:transparent; color:var(--lumiverse-text-muted); font:inherit; font-size:11px; min-height:32px; padding:5px 0; cursor:pointer; }
.la-reasoning-body { max-height:240px; overflow:auto; padding:10px 12px; border-left:2px solid var(--lumiverse-border); font-size:12px; line-height:1.65; white-space:pre-wrap; }
.la-run-notice { border-left:3px solid var(--lumiverse-primary); border-radius:0 8px 8px 0; padding:10px 12px; margin:12px 0; background:var(--la-conversation-soft); font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
.la-run-notice.is-error { border-color:var(--lumiverse-danger,var(--lumiverse-primary)); }
.la-run-notice summary { cursor:pointer; font-weight:550; }
.la-run-notice pre { max-height:240px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; }
.la-message-details { display:block; margin:4px 0 0; font-size:11px; }
.la-composer-input-wrap { border-radius:18px; box-shadow:none; }
.la-composer-area { border-radius:18px; padding:6px 8px; align-items:center; gap:8px; }
.la-composer-actions { align-items:center; gap:6px; align-self:flex-end; padding:2px 0; }
.la-composer-actions > button { box-sizing:border-box; flex:0 0 36px; width:36px; height:36px; min-width:36px; min-height:36px; padding:0; margin:0; align-items:center; justify-content:center; line-height:1; }
.la-composer-actions .la-compact-btn { display:flex; }
.la-composer-actions svg { display:block; flex:none; }
.la-composer .la-composer-status { display:none; }
.la-composer .la-composer-status.is-error:not(:empty) { display:block; color:var(--lumiverse-danger,var(--lumiverse-text)); font-size:11px; line-height:1.5; }
.la-send-btn,.la-cancel-btn,.la-attach-btn { width:36px; height:36px; border-radius:12px; }
.la-message-inspector { background:var(--lumiverse-bg); color:var(--lumiverse-text); border:1px solid var(--lumiverse-border); border-radius:18px; width:min(800px,94vw); max-height:85dvh; padding:20px; }
.la-message-inspector::backdrop { background:color-mix(in srgb,var(--lumiverse-bg) 70%,transparent); }
.la-message-inspector header,.la-message-inspector nav { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.la-message-inspector header { justify-content:space-between; }
.la-message-inspector h3 { margin:0; font-size:16px; }
.la-message-inspector p { color:var(--lumiverse-text-muted); font-size:12px; }
.la-message-inspector pre { max-height:55dvh; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.6; font-size:12px; }
.la-message-inspector button { font:inherit; font-size:12px; padding:9px 12px; border-radius:8px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-bg-hover); color:inherit; cursor:pointer; }
.la-message-inspector button:disabled { opacity:.4; cursor:default; }
.la-drawer :is(button,summary,[role=button]):focus-visible { outline:2px solid var(--lumiverse-primary); outline-offset:3px; }
@media(prefers-reduced-motion:reduce) { .la-msg-bubble,.la-activity-summary *,.la-edits-card *,.la-reasoning-summary * { animation:none!important; transition:none!important; } }
@media(hover:none),(pointer:coarse) { .la-msg-actions { opacity:1; pointer-events:auto; } .la-msg-action-btn { min-width:40px; min-height:40px; display:inline-flex; align-items:center; justify-content:center; } }
`;
