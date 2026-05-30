// All colours / radii / shadows / fonts use Lumiverse host tokens
// (--lumiverse-* / --lcs-*). No hardcoded hex / rgba in production paths.

import { LOADERS_CSS } from "./loaders";

export const STYLES = `
${LOADERS_CSS}

.la-drawer {
  display: flex; flex-direction: column; height: 100%;
  font-family: var(--lumiverse-font-family);
  color: var(--lumiverse-text);
  background: var(--lumiverse-bg);
  overflow: hidden;
}

/* Host's drawer panel applies a 12px/40px content inset as a mobile scroll
   buffer, which reads as a border gap around our full-bleed UI. The host only
   drops it for its own built-in tabs. We own scrolling and bottom insets, so
   cancel the inset for the panel wrapping our root only. */
:has(> div > [data-spindle-extension-root].la-drawer) {
  padding: 0 !important;
}

/* Fullscreen expansion: drawer breaks out of its host slot to fill the
 * viewport. position:fixed snaps to the viewport unless an ancestor has
 * a transform / filter / contain:paint; verified clean on Lumiverse's
 * drawer chrome. */
.la-drawer.la-drawer-expanded {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  /* Below Spindle's modal backdrop (10003) and Lumiverse SettingsModal
   * (10001) so dialogs spawned from the expanded drawer still cover it. */
  z-index: 10000;
  box-shadow: 0 0 0 1px var(--lumiverse-border), 0 24px 64px rgba(0, 0, 0, 0.45);
}

/* ─── Header ─── */
.la-header {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-header-row {
  display: flex; align-items: center; gap: 8px;
  min-width: 0;
}
.la-header-row-char { gap: 6px; flex-wrap: wrap; row-gap: 6px; }
.la-header-row-char .la-combo-host-char { flex: 1 1 160px; min-width: 0; }
.la-header-row-char .la-combo-host-char .la-combo-trigger { width: 100%; max-width: none; }
.la-header-row-meta { gap: 6px; flex-wrap: wrap; row-gap: 6px; }
.la-header-row-meta .la-combo-host-conn { flex: 1 1 140px; min-width: 0; }
.la-header-row-meta .la-combo-host-conn .la-combo-trigger { width: 100%; max-width: none; }
.la-select {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-text);
  border-radius: var(--lumiverse-radius-sm);
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  min-width: 0;
  cursor: pointer;
  transition: border-color var(--lumiverse-transition-fast), background var(--lumiverse-transition-fast);
}
.la-select:hover { border-color: var(--lumiverse-border-hover); background: var(--lumiverse-bg-hover); }
.la-select:focus { outline: none; border-color: var(--lumiverse-primary-muted); background: var(--lumiverse-bg-hover); }

/* Connection picker: shrink to fit, truncate long labels, keep a reasonable minimum. */
.la-conn-select {
  min-width: 55px;
  max-width: 240px;
  flex: 1 1 55px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.la-btn {
  background: transparent;
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-text);
  border-radius: var(--lumiverse-radius-sm);
  padding: 5px 11px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-btn:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); }
.la-btn:focus-visible { outline: none; border-color: var(--lumiverse-primary-muted); box-shadow: 0 0 0 2px var(--lumiverse-primary-015); }
.la-btn-primary {
  background: var(--lumiverse-primary);
  border-color: var(--lumiverse-primary);
  color: var(--lumiverse-text);
}
.la-btn-primary:hover { background: var(--lumiverse-primary-hover); border-color: var(--lumiverse-primary-hover); }
.la-btn-danger { color: var(--lumiverse-danger); border-color: var(--lumiverse-border); }
.la-btn-danger:hover { background: var(--lumiverse-danger-015); border-color: var(--lumiverse-danger-050); color: var(--lumiverse-danger); }
.la-btn-ghost { background: transparent; border-color: transparent; color: var(--lumiverse-text-muted); }
.la-btn-ghost:hover { background: var(--lumiverse-bg-hover); color: var(--lumiverse-text); }
.la-btn-mini { padding: 2px 8px; font-size: 11px; }
.la-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.la-btn:disabled:hover { background: transparent; border-color: var(--lumiverse-border); }

.la-flex-spacer { flex: 1; }

/* Searchable combobox */
.la-combo { position: relative; display: inline-block; min-width: 0; }
.la-combo-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent;
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-text);
  border-radius: var(--lumiverse-radius-sm);
  padding: 5px 8px 5px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  max-width: 240px;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-combo-trigger:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); }
.la-combo-trigger:focus { outline: none; border-color: var(--lumiverse-primary-muted); }
.la-combo.is-open .la-combo-trigger { border-color: var(--lumiverse-primary-muted); }
.la-combo-trigger.is-placeholder .la-combo-trigger-label { color: var(--lumiverse-text-dim); }
.la-combo-trigger-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.la-combo-caret { color: var(--lumiverse-text-dim); font-size: 20px; line-height: 1; flex-shrink: 0; margin-left: auto; }
.la-combo-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.la-combo-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 240px;
  max-width: 360px;
  z-index: 1000;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  box-shadow: var(--lumiverse-shadow-md);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.la-combo-search {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.la-combo-search::placeholder { color: var(--lumiverse-text-dim); }
.la-combo-list { max-height: 280px; overflow-y: auto; padding: 4px; }
.la-combo-item {
  display: block; width: 100%; text-align: left;
  background: transparent; border: none; color: var(--lumiverse-text);
  font-family: inherit; font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
}
.la-combo-item.is-active { background: var(--lumiverse-bg-hover); }
.la-combo-item.is-selected { color: var(--lumiverse-primary-text); }
.la-combo-item-label { line-height: 1.3; }
.la-combo-item-sub { color: var(--lumiverse-text-muted); font-size: 11px; margin-top: 2px; }
.la-combo-empty { padding: 10px; font-size: 12px; color: var(--lumiverse-text-muted); }
.la-combo-group { padding: 8px 10px 3px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--lumiverse-text-muted); }
.la-combo-group:first-child { padding-top: 2px; }
.la-pre-compaction { opacity: 0.55; }
.la-pre-compaction .la-msg-bubble { filter: grayscale(0.4); }
.la-pre-compaction .la-tool-free-btn { display: none !important; }
.la-toast {
  position: fixed; left: 50%; bottom: 28px;
  transform: translateX(-50%) translateY(16px);
  background: var(--lumiverse-bg-elevated, #2a2a2a); color: var(--lumiverse-text);
  padding: 10px 18px; border-radius: var(--lumiverse-radius-md, 8px);
  font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,0.35);
  opacity: 0; pointer-events: none;
  transition: opacity 220ms ease, transform 220ms ease;
  z-index: 9999; max-width: 380px;
}
.la-toast.is-visible { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Workshop button: icon-shaped, count rendered as a corner badge. */
.la-changes-btn { position: relative; }
.la-changes-count {
  position: absolute;
  top: -4px; right: -4px;
  background: var(--lumiverse-secondary);
  color: var(--lumiverse-text-muted);
  border-radius: 999px;
  font-size: 10px;
  padding: 0 5px;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  font-weight: 600;
  border: 1px solid var(--lumiverse-bg-elevated);
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-changes-btn.has-edits .la-changes-count {
  background: var(--lumiverse-primary);
  color: var(--lumiverse-text);
}
.la-changes-btn.has-edits { color: var(--lumiverse-primary); }

.la-icon-btn {
  padding: 5px;
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.la-icon-btn svg { display: block; }

/* Chat-pin button: the icon glyph (pin / pin-off) carries the pinned state. */
.la-chat-pin-btn { color: var(--lumiverse-text-muted); }
.la-chat-pin-btn:hover { color: var(--lumiverse-text); }

.la-perm-modal {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 16px 20px;
  color: var(--lumiverse-text, inherit);
  font-size: 14px;
}
.la-perm-lead {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
}
.la-perm-list {
  margin: 0;
  padding: 0 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  line-height: 1.5;
}
.la-perm-list li { list-style: disc; }
.la-perm-name {
  font-weight: 600;
  color: var(--lumiverse-primary, #9370db);
}
.la-perm-note {
  margin: 4px 0 0 0;
  padding: 10px 12px;
  background: var(--lumiverse-surface-alt, rgba(147, 112, 219, 0.08));
  border-left: 3px solid var(--lumiverse-primary, #9370db);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--lumiverse-text-muted, inherit);
}
.la-perm-note-label {
  font-weight: 600;
  margin-right: 4px;
}
.la-perm-emphasize {
  display: inline-block;
  padding: 1px 7px;
  background: var(--lumiverse-warning, #f5a623);
  color: #1a1a1a;
  border-radius: 4px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-size: 0.95em;
}
.la-perm-actions {
  display: flex;
  justify-content: flex-start;
}
.la-perm-ok {
  padding: 7px 18px;
  background: var(--lumiverse-primary, #9370db);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.la-perm-ok:hover { filter: brightness(1.08); }
.la-perm-ok:focus-visible {
  outline: 2px solid var(--lumiverse-primary, #9370db);
  outline-offset: 2px;
}

.la-modal-note {
  margin: 0 0 8px;
  padding: 0;
  font-size: 12px;
  color: var(--lumiverse-text-muted);
  line-height: 1.5;
}

/* Inline error banner — shown in the thread when generation fails. */
.la-error-banner {
  border: 1px solid var(--lumiverse-danger);
  background: var(--lumiverse-danger-015);
  color: var(--lumiverse-danger);
  border-radius: var(--lumiverse-radius);
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  margin: 8px 0;
}
.la-error-banner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.la-error-banner-title {
  font-weight: 600;
}
.la-error-banner-dismiss {
  background: transparent;
  border: none;
  color: var(--lumiverse-danger);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--lumiverse-radius-sm);
  opacity: 0.7;
}
.la-error-banner-dismiss:hover { opacity: 1; background: var(--lumiverse-danger-015); }
.la-error-banner-body {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  margin: 0;
  color: var(--lumiverse-text);
  background: var(--lumiverse-bg);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 10px;
}

/* Agent settings modal */
.la-agent-settings {
  display: flex; flex-direction: column; gap: 6px;
  /* Breathing room from the host modal's edges. Host adds its own header
     padding; this is the body inset. */
  padding: 4px 18px 4px 18px;
}
.la-settings-divider {
  border: none;
  border-top: 1px solid var(--lumiverse-border);
  margin: 18px 0 10px;
}
.la-settings-section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 6px;
}
.la-settings-label {
  font-weight: 600; font-size: 12px;
  color: var(--lumiverse-text);
  letter-spacing: 0.02em;
  margin-top: 6px;
}
.la-settings-section-head .la-settings-label,
.la-settings-reset-row .la-settings-label { margin-top: 0; }
.la-settings-reset-row {
  display: flex; justify-content: flex-end;
  margin-top: 2px; margin-bottom: 4px;
}
.la-settings-hint {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  margin-bottom: 4px;
  line-height: 1.4;
}
.la-settings-textarea {
  width: 100%;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-sm);
  color: var(--lumiverse-text);
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 10px;
  resize: vertical;
  min-height: 90px;
  outline: none;
}
.la-settings-textarea-tall { min-height: 220px; }
.la-settings-textarea:focus { border-color: var(--lumiverse-primary-muted); }
.la-settings-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 6px;
}

/* Sampler sliders inside the settings modal */
.la-samplers-list { display: flex; flex-direction: column; gap: 8px; }
.la-slider-row {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 10px;
}
.la-slider-header { display: flex; align-items: center; gap: 8px; }
.la-slider-label {
  flex: 1; font-size: 12px; color: var(--lumiverse-text-muted);
  letter-spacing: 0.02em;
}
.la-slider-label.la-slider-label-set { color: var(--lumiverse-primary-text); }
.la-slider-input {
  width: 90px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text-muted);
  border-radius: var(--lumiverse-radius-sm);
  padding: 3px 6px;
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  text-align: right;
}
.la-slider-input.la-slider-input-set { color: var(--lumiverse-primary-text); border-color: var(--lumiverse-primary-muted); }
.la-slider-track {
  position: relative;
  height: 6px;
  margin-top: 8px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
}
.la-slider-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 0%;
  background: var(--lumiverse-secondary);
  border-radius: 999px;
}
.la-slider-track.la-slider-track-set .la-slider-fill { background: var(--lumiverse-primary); }
.la-slider-thumb {
  position: absolute; top: 50%; left: 0%;
  width: 14px; height: 14px;
  margin-left: -7px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--lumiverse-bg-elevated);
  border: 2px solid var(--lumiverse-border-hover);
}
.la-slider-track.la-slider-track-set .la-slider-thumb {
  background: var(--lumiverse-primary);
  border-color: var(--lumiverse-primary-hover);
}

.la-settings-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.la-settings-row.is-disabled { opacity: 0.55; }
.la-settings-row.is-disabled .la-settings-row-label { color: var(--lumiverse-text-muted); }
.la-settings-row-label {
  font-size: 12px; color: var(--lumiverse-text-muted);
}

/* Icon settings modal */
.la-icon-settings { display: flex; flex-direction: column; gap: 10px; }
.la-icon-settings-preview {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 16px;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius);
}
.la-icon-settings-image {
  width: 96px; height: 96px;
  object-fit: contain;
  border-radius: var(--lumiverse-radius-md);
  background: var(--lumiverse-bg-elevated);
}
.la-icon-settings-image-tall {
  width: 120px;
  height: 180px;
}
.la-icon-settings-caption {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.la-icon-settings-actions {
  display: flex; justify-content: space-between; gap: 8px;
  margin-top: 4px;
}

/* ─── Session bar (removed; kept for back-compat selectors) ─── */
.la-session-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--lumiverse-border-light);
  background: var(--lumiverse-bg);
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  flex-shrink: 0;
}
.la-session-bar-spacer { flex: 1; }
.la-session-bar-label { font-weight: 500; }

/* ─── Thread (scrolling area) ─── */
.la-thread {
  flex: 1; min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* Bottom reserve lives on .la-virt-inner below; this padding only frames
     the spacer when nothing's mounted yet. */
  padding: 24px 16px 24px;
}
/* The mousey reserve only matters when the message column horizontally
   overlaps the mousey figure. Mousey sits at left:12 of the composer; the
   message column is max-width 760, centered. They clear each other once
   the drawer is wide enough that (drawer_width - 760) / 2 > mousey_right
   edge (~105px at full mousey size), i.e. drawer_width > ~970px. Default
   gives 24px breathing room; the @container override below kicks in only
   when the figure is in the column's vertical channel. */
.la-virt-inner {
  padding-bottom: 24px;
}
@container drawer (max-width: 970px) {
  .la-virt-inner {
    /* Reserve = mousey_visible_extent + 24px buffer. Mousey extends above
       the composer by height * (1 - 0.33) = height * 0.67. Both scale via
       22cqw so the reserve tracks the figure 1:1 across drawer widths. */
    padding-bottom: max(24px, calc(min(140px, 22cqw) * 0.67 + 24px));
  }
  display: flex; flex-direction: column;
  /* scroll-behavior is intentionally NOT smooth here: programmatic stick-to-
     bottom would animate, fighting the user's wheel/keyboard input mid-
     stream. Native browser scrolling stays smooth on its own. */
}
.la-thread > * { width: 100%; max-width: 760px; min-width: 0; margin-left: auto; margin-right: auto; }
.la-thread > * + * { margin-top: 20px; }
/* Spans full chat width, not the 760px message column, so the label sits on the visible midline. */
.la-thread > .la-cache-divider { max-width: none; }

/* ─── Messages ─── */
.la-msg { display: flex; flex-direction: column; gap: 6px; }
.la-msg-user { align-items: flex-end; }
.la-msg-assistant { align-items: stretch; }

.la-msg-bubble {
  word-wrap: break-word;
  line-height: 1.6;
  font-size: 14px;
}
.la-msg-user .la-msg-bubble {
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-lg);
  padding: 10px 14px;
  max-width: 80%;
  white-space: pre-wrap;
}
.la-msg-assistant .la-msg-bubble {
  background: transparent;
  border: none;
  padding: 0;
  width: 100%;
}
.la-msg-meta {
  font-size: 10px;
  color: var(--lumiverse-text-dim);
  padding: 0 4px;
  letter-spacing: 0.02em;
}

.la-msg-block + .la-msg-block { margin-top: 10px; }

/* Markdown tables inside assistant messages. Wrapped in horizontal scroll
   so wide tables don't overflow the bubble. */
.la-msg-bubble table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
  display: block;
  overflow-x: auto;
  max-width: 100%;
}
.la-msg-bubble table th, .la-msg-bubble table td {
  border: 1px solid var(--lumiverse-border);
  padding: 5px 9px;
  text-align: left;
  vertical-align: top;
}
.la-msg-bubble table th {
  background: var(--lumiverse-bg-hover);
  font-weight: 600;
}
.la-msg-bubble table th[align="center"], .la-msg-bubble table td[align="center"] { text-align: center; }
.la-msg-bubble table th[align="right"],  .la-msg-bubble table td[align="right"]  { text-align: right; }
.la-msg-bubble table tbody tr:nth-child(even) { background: var(--lumiverse-bg); }
/* GFM task-list marker (☐ / ☑). Inline-aligned with text, slightly muted
   when unchecked so the eye reads the row content first. */
.la-msg-bubble .la-task-mark {
  display: inline-block;
  width: 1.1em;
  text-align: center;
  color: var(--lumiverse-text-muted);
}

/* Message-level actions (Edit / Regenerate) — fade in on hover. */
.la-msg-actions {
  display: flex; gap: 4px;
  opacity: 0;
  transition: opacity var(--lumiverse-transition-fast);
}
.la-msg:hover .la-msg-actions, .la-msg-actions:focus-within { opacity: 1; }
.la-msg-action-btn {
  background: transparent;
  border: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text-muted);
  border-radius: var(--lumiverse-radius-sm);
  padding: 2px 9px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-msg-action-btn:hover { background: var(--lumiverse-bg-hover); color: var(--lumiverse-text); border-color: var(--lumiverse-border-hover); }
.la-msg-action-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  line-height: 0;
}
.la-msg-action-btn-icon svg { width: 14px; height: 14px; display: block; }
.la-msg-action-btn-danger { color: var(--lumiverse-danger); border-color: var(--lumiverse-border); }
.la-msg-action-btn-danger:hover { background: var(--lumiverse-danger-015); border-color: var(--lumiverse-danger-050); color: var(--lumiverse-danger); }

/* Inline-edit textarea inside a user message bubble. Bubble claims the full
   80% lane (vs the content-driven width when not editing) so short messages
   get room to grow. */
.la-msg-user .la-msg-bubble.is-editing { padding: 8px; width: 80%; box-sizing: border-box; }
.la-msg-edit-textarea {
  width: 100%;
  background: transparent;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-sm);
  color: var(--lumiverse-text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 6px 8px;
  resize: vertical;
  min-height: 44px;
  outline: none;
}
.la-msg-edit-textarea:focus { border-color: var(--lumiverse-primary-muted); }
.la-msg-edit-actions {
  display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px;
}

/* Markdown text in assistant messages */
.la-text-block { line-height: 1.65; }
.la-text-block p { margin: 0 0 10px; white-space: pre-wrap; }
.la-text-block p:last-child { margin-bottom: 0; }
.la-text-block ul, .la-text-block ol { margin: 6px 0 10px 22px; padding: 0; }
.la-text-block li { margin: 2px 0; }
.la-text-block h1, .la-text-block h2, .la-text-block h3,
.la-text-block h4, .la-text-block h5, .la-text-block h6 {
  margin: 14px 0 6px; font-weight: 600; color: var(--lumiverse-text);
}
.la-text-block h1 { font-size: 1.4em; }
.la-text-block h2 { font-size: 1.25em; }
.la-text-block h3 { font-size: 1.1em; }
.la-text-block a { color: var(--lumiverse-primary-text); text-decoration: none; border-bottom: 1px solid var(--lumiverse-primary-020); }
.la-text-block a:hover { border-bottom-color: var(--lumiverse-primary-muted); }
.la-text-block code {
  background: var(--lumiverse-fill);
  border: 1px solid var(--lumiverse-border-light);
  padding: 1px 6px;
  border-radius: var(--lumiverse-radius-sm);
  font-family: var(--lumiverse-font-mono);
  font-size: 0.88em;
  color: var(--lumiverse-primary-text);
}
.la-text-block pre {
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  padding: 12px 14px;
  border-radius: var(--lumiverse-radius);
  overflow-x: auto;
  margin: 10px 0;
}
.la-text-block pre code {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--lumiverse-text);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre;
  display: block;
}
.la-text-block blockquote {
  border-left: 3px solid var(--lumiverse-border);
  padding: 2px 0 2px 12px;
  margin: 6px 0;
  color: var(--lumiverse-prose-blockquote, var(--lumiverse-text-muted));
}
.la-text-block hr {
  border: none;
  border-top: 1px solid var(--lumiverse-border-light);
  margin: 14px 0;
}
.la-text-block strong { color: var(--lumiverse-text); }
.la-text-block em { color: var(--lumiverse-prose-italic, var(--lumiverse-text-muted)); }

.la-chunk-fade { animation: la-chunk-fade 180ms ease-out both; }
@keyframes la-chunk-fade { from { opacity: 0; } to { opacity: 1; } }

.la-cache-divider {
  position: relative;
  text-align: center;
  margin: 18px 0 14px;
  opacity: 0.6;
  pointer-events: none;
}
.la-cache-divider::before {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 50%;
  height: 1px;
  background: var(--lumiverse-text-muted);
  z-index: 0;
}
.la-cache-divider-label {
  position: relative;
  z-index: 1;
  display: inline-block;
  background: var(--lumiverse-bg);
  padding: 0 12px;
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  font-style: italic;
  letter-spacing: 0.02em;
}

/* Scramble-cycling "thinking" indicator (Claude-Code-style). */
.la-thinking {
  display: inline-flex; align-items: baseline; gap: 2px;
  color: var(--lumiverse-text-muted);
  font-size: 13px;
  font-family: var(--lumiverse-font-family);
  font-style: italic;
  padding: 4px 0;
  user-select: none;
}
.la-thinking-word {
  font-feature-settings: "tnum" 1;
  background: linear-gradient(
    90deg,
    var(--lumiverse-text-muted) 0%,
    var(--lumiverse-primary-text) 50%,
    var(--lumiverse-text-muted) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: la-thinking-shimmer 3.4s linear infinite;
}
@keyframes la-thinking-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.la-thinking-dots {
  display: inline-flex; gap: 1px; margin-left: 1px;
  color: var(--lumiverse-text-muted);
}
.la-thinking-dots > span {
  display: inline-block;
  animation: la-thinking-dot 1.4s ease-in-out infinite;
}
.la-thinking-dots > span:nth-child(2) { animation-delay: 0.18s; }
.la-thinking-dots > span:nth-child(3) { animation-delay: 0.36s; }
@keyframes la-thinking-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}

/* Reasoning collapsible */
.la-reasoning {
  background: var(--lumiverse-fill-subtle);
  border-left: 2px solid var(--lumiverse-border);
  border-radius: 0 var(--lumiverse-radius-sm) var(--lumiverse-radius-sm) 0;
  padding: 6px 10px;
  color: var(--lumiverse-text-muted);
  font-size: 12px;
  font-style: italic;
}
.la-reasoning-toggle {
  cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 4px;
}
.la-reasoning-body { display: none; margin-top: 6px; white-space: pre-wrap; font-style: normal; }
.la-reasoning.is-open .la-reasoning-body { display: block; }

/* Tool call card */
.la-tool-card {
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-bg-elevated);
  overflow: hidden;
  font-size: 13px;
  transition: border-color var(--lumiverse-transition-fast);
}
.la-tool-card:hover { border-color: var(--lumiverse-border-hover); }
.la-tool-head {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
}
.la-tool-head:hover { background: var(--lumiverse-bg-hover); }
.la-tool-icon { color: var(--lumiverse-text-dim); font-size: 10px; }
.la-tool-name {
  font-weight: 500; font-family: var(--lumiverse-font-mono); font-size: 12px;
  color: var(--lumiverse-primary-text);
}
.la-tool-args-preview {
  color: var(--lumiverse-text-dim);
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}
/* Activity (verb + target) grows to take all slack so the sens / free cluster
   gets pushed to the right edge of the row. */
.la-tool-activity { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Caret color carries the run-state: muted while running, primary on success,
   danger on error. Theme tokens, so it adapts per theme. Open/closed shape is
   the same arrow toggled by the click handler. */
.la-tool-card.is-done .la-tool-caret { color: var(--lumiverse-primary); }
.la-tool-card.is-error .la-tool-caret { color: var(--lumiverse-danger); }
.la-tool-sens {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid currentColor;
  opacity: 0.7;
}
.la-tool-sens-sensitive { color: var(--lumiverse-primary, #7a9bff); }
.la-tool-sens-insensitive { color: var(--lumiverse-text-muted); }
.la-tool-sens-freed { color: var(--lumiverse-text-muted); opacity: 0.5; }
.la-tool-free-btn {
  background: none;
  border: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.la-tool-free-btn:hover {
  border-color: var(--lumiverse-danger);
  color: var(--lumiverse-danger);
}
.la-tool-free-btn.is-confirming {
  background: var(--lumiverse-danger-015);
  border-color: var(--lumiverse-danger);
  color: var(--lumiverse-danger);
}
.la-tool-body {
  display: none;
  border-top: 1px solid var(--lumiverse-border-light);
  padding: 10px 12px;
}
.la-tool-card.is-open .la-tool-body { display: block; }
.la-tool-body-section { margin-bottom: 8px; }
.la-tool-body-section:last-child { margin-bottom: 0; }
.la-tool-body-section-label {
  color: var(--lumiverse-text-dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.la-tool-body pre {
  margin: 0;
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 10px;
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--lumiverse-text);
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 320px;
  overflow-y: auto;
}

/* ask_user_question modal */
.la-phoneline-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: 20px;
}
.la-phoneline-modal {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  width: min(420px, 92vw);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column;
}
.la-phoneline-header { padding: 14px 18px 8px; display: flex; flex-direction: column; gap: 2px; }
.la-phoneline-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lumiverse-primary); }
.la-phoneline-title { font-size: 15px; font-weight: 600; color: var(--lumiverse-text); }
.la-phoneline-body { padding: 4px 18px 14px; display: flex; flex-direction: column; gap: 10px; }
.la-phoneline-meta { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 12px; }
.la-phoneline-meta-row { display: contents; }
.la-phoneline-meta-label { color: var(--lumiverse-text-muted); }
.la-phoneline-meta-value { color: var(--lumiverse-text); font-family: var(--lumiverse-font-mono, monospace); word-break: break-all; }
.la-phoneline-notice { font-size: 13px; color: var(--lumiverse-text); line-height: 1.45; }
.la-phoneline-quote {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-left: 3px solid var(--lumiverse-primary);
  background: var(--lumiverse-bg-subtle);
  border-radius: 0 4px 4px 0;
  cursor: pointer;
}
.la-phoneline-quote:hover { background: var(--lumiverse-bg-hover); }
.la-phoneline-cb { flex-shrink: 0; }
.la-phoneline-quote-text { font-size: 13px; color: var(--lumiverse-text); }
.la-phoneline-foot { font-size: 11px; color: var(--lumiverse-text-muted); line-height: 1.4; }
.la-phoneline-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 18px 14px; }

.la-pairings-panel { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.la-pairings-empty { font-size: 12px; color: var(--lumiverse-text-muted); padding: 8px 0; }
.la-pairing-row { padding: 8px 12px; border: 1px solid var(--lumiverse-border-subtle); border-radius: 6px; display: flex; align-items: center; gap: 12px; }
.la-pairing-name-col { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.la-pairing-name { font-size: 13px; font-weight: 600; color: var(--lumiverse-text); }
.la-pairing-id { font-family: var(--lumiverse-font-mono, monospace); font-size: 11px; color: var(--lumiverse-text-muted); }
.la-pairing-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.la-pairing-toggle-label { font-size: 12px; color: var(--lumiverse-text-muted); }

.la-ask-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: 20px;
}
.la-ask-modal {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  padding: 18px 20px;
  max-width: 720px; width: 100%;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column; gap: 16px;
}
.la-ask-header { display: flex; flex-direction: column; gap: 3px; }
.la-ask-title { font-weight: 600; font-size: 15px; color: var(--lumiverse-text); }
.la-ask-subtitle { font-size: 12px; color: var(--lumiverse-text-muted); }
.la-ask-body { display: flex; flex-direction: column; gap: 14px; }
.la-ask-question {
  padding: 12px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  display: flex; flex-direction: column; gap: 10px;
}
.la-ask-question-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.la-ask-chip {
  background: var(--lumiverse-primary-015); color: var(--lumiverse-primary-text);
  padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.la-ask-question-text { font-size: 14px; color: var(--lumiverse-text); flex: 1; }
.la-ask-multi-badge {
  font-size: 10px; color: var(--lumiverse-text-dim); font-style: italic;
}
.la-ask-options { display: flex; flex-direction: column; gap: 6px; }
.la-ask-option {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 10px;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  transition: background 0.1s;
}
.la-ask-option:hover { background: var(--lumiverse-bg-hover); }
.la-ask-option input { margin-top: 2px; flex-shrink: 0; }
.la-ask-option-text { display: flex; flex-direction: column; gap: 2px; }
.la-ask-option-label { font-weight: 600; font-size: 13px; color: var(--lumiverse-text); }
.la-ask-option-desc { font-size: 11px; color: var(--lumiverse-text-muted); line-height: 1.4; }
.la-ask-other-input {
  width: 100%; resize: vertical; min-height: 48px;
  padding: 6px 8px;
  background: var(--lumiverse-bg); color: var(--lumiverse-text);
  border: 1px solid var(--lumiverse-border-light); border-radius: var(--lumiverse-radius-sm);
  font-family: inherit; font-size: 12px;
}
.la-ask-preview {
  background: var(--lumiverse-bg-dark); color: var(--lumiverse-text);
  padding: 8px; border-radius: var(--lumiverse-radius-sm);
  font-family: var(--lumiverse-font-mono); font-size: 11px;
  white-space: pre-wrap; word-wrap: break-word;
  max-height: 240px; overflow-y: auto;
  border: 1px solid var(--lumiverse-border-light);
}
.la-ask-footer { display: flex; justify-content: flex-end; gap: 8px; }

/* Todos panel (todo_write tool card) */
.la-todos-panel {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  font-size: 12px;
}
.la-todos-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.la-todo-item { display: flex; gap: 8px; align-items: baseline; line-height: 1.45; }
.la-todo-mark {
  width: 14px; flex-shrink: 0; text-align: center;
  font-family: var(--lumiverse-font-mono);
  color: var(--lumiverse-text-dim);
}
.la-todo-label { white-space: pre-wrap; word-wrap: break-word; }
.la-todo-pending .la-todo-label { color: var(--lumiverse-text-muted); }
.la-todo-in_progress .la-todo-mark { color: var(--lumiverse-primary-text); }
.la-todo-in_progress .la-todo-label { color: var(--lumiverse-text); font-weight: 600; }
.la-todo-completed .la-todo-mark { color: var(--lumiverse-success); }
.la-todo-completed .la-todo-label { color: var(--lumiverse-text-dim); text-decoration: line-through; }
.la-todos-empty { color: var(--lumiverse-text-dim); font-style: italic; }

/* Edits card */
.la-edits-card {
  border: 1px solid var(--lumiverse-primary-muted);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-primary-015);
  padding: 10px 14px;
  font-size: 13px;
}
.la-edits-head {
  display: flex; align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.la-edits-caret {
  color: var(--lumiverse-primary-text);
  font-size: 11px;
  flex-shrink: 0;
  width: 12px; text-align: center;
}
.la-edits-title {
  font-weight: 600;
  color: var(--lumiverse-primary-text);
  letter-spacing: 0.01em;
  flex: 1;
}
.la-edits-head-right { flex-shrink: 0; }
.la-edits-list { display: none; margin-top: 10px; }
.la-edits-card.is-open .la-edits-list { display: flex; flex-direction: column; gap: 8px; }
.la-edit-row {
  padding: 8px 10px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
}
.la-edit-row.is-reverted { opacity: 0.5; }
.la-edit-row-head {
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap; font-size: 12px;
  margin-bottom: 6px;
}
.la-edit-row-surface { color: var(--lumiverse-text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.la-edit-row-label { font-weight: 600; color: var(--lumiverse-text); }
.la-edit-row-field { color: var(--lumiverse-text-muted); font-family: var(--lumiverse-font-mono); font-size: 11px; }
.la-edit-row-stat { color: var(--lumiverse-text-dim); font-size: 11px; }
.la-edit-row-actions { margin-left: auto; display: flex; gap: 4px; }
.la-edit-row-diff { font-family: var(--lumiverse-font-mono); font-size: 11px; }

/* Inline diff coloring */
.la-diff-inline { display: inline; word-wrap: break-word; }
.la-diff-add { color: var(--lumiverse-success); background: var(--lumiverse-success-015); border-radius: 2px; padding: 0 1px; }
.la-diff-del { color: var(--lumiverse-danger); background: var(--lumiverse-danger-015); border-radius: 2px; padding: 0 1px; text-decoration: line-through; }
.la-diff-ctx { color: var(--lumiverse-text-muted); }

/* Unified diff */
.la-diff-unified {
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 6px;
  overflow-x: auto;
  max-height: 280px;
  overflow-y: auto;
}
.la-diff-row {
  display: flex; gap: 6px; padding: 0 2px;
  font-family: var(--lumiverse-font-mono); font-size: 11px; line-height: 1.55;
}
.la-diff-row .la-diff-sigil { color: var(--lumiverse-text-dim); width: 12px; text-align: center; flex-shrink: 0; }
.la-diff-row .la-diff-text { white-space: pre; overflow-wrap: anywhere; flex: 1; min-width: 0; }
.la-diff-lineno {
  color: var(--lumiverse-text-dim);
  text-align: right;
  width: 36px;
  flex-shrink: 0;
  user-select: none;
  font-feature-settings: "tnum" 1;
  padding-right: 4px;
}
.la-diff-lineno-new { border-left: 1px solid var(--lumiverse-border-light); padding-left: 6px; }
.la-diff-add-row { background: var(--lumiverse-success-015); color: var(--lumiverse-success); }
.la-diff-del-row { background: var(--lumiverse-danger-015); color: var(--lumiverse-danger); }
.la-diff-gap { font-size: 10px; color: var(--lumiverse-text-dim); text-align: center; padding: 3px 0; font-family: var(--lumiverse-font-mono); }
.la-diff-empty { font-size: 11px; color: var(--lumiverse-text-dim); padding: 6px; }
.la-diff-gap-expander, .la-diff-sxs-gap-expander {
  display: block;
  width: 100%;
  text-align: center;
  background: var(--lumiverse-bg-elevated);
  color: var(--lumiverse-text-muted);
  border: none;
  border-top: 1px dashed var(--lumiverse-border-light);
  border-bottom: 1px dashed var(--lumiverse-border-light);
  padding: 4px 6px;
  font-family: var(--lumiverse-font-mono); font-size: 10px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-diff-gap-expander:hover, .la-diff-sxs-gap-expander:hover {
  background: var(--lumiverse-bg-hover);
  color: var(--lumiverse-primary-text);
}

/* Composer */
.la-composer {
  position: relative;
  border-top: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg);
  padding: 12px 16px 14px;
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
}
.la-drawer { container-type: inline-size; container-name: drawer; }
.la-mousey {
  position: absolute;
  left: 12px;
  bottom: 100%;
  height: min(140px, 22cqw);
  width: auto;
  pointer-events: none;
  user-select: none;
  transform: translateY(33%);
  z-index: 1;
  transition: -webkit-mask-image var(--lumiverse-transition-fast), mask-image var(--lumiverse-transition-fast);
}
/* Soft alpha falloff applied ONLY when text is detected behind the image.
   Toggled by the overlap detector in drawer.ts. The mask fades the image's
   own bottom edge so the figure stays visible without occluding text under
   it. backdrop-filter is deliberately NOT used here: it would blur a square
   region matching the element's bounding box, ignoring the PNG's alpha. */
.la-mousey.la-mousey-overlap {
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 72%, rgba(0,0,0,0.35) 92%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 72%, rgba(0,0,0,0.35) 92%, transparent 100%);
}
.la-composer-inner {
  width: 100%; max-width: 760px;
  margin: 0 auto;
  display: flex; flex-direction: column; gap: 6px;
}
.la-composer-area {
  position: relative;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-xl);
  padding: 4px 4px 4px 16px;
  display: flex; align-items: flex-end; gap: 8px;
  transition: border-color var(--lumiverse-transition-fast), box-shadow var(--lumiverse-transition-fast);
}
.la-composer-area:focus-within {
  border-color: var(--lumiverse-primary-muted);
  box-shadow: 0 0 0 3px var(--lumiverse-primary-015);
}
.la-textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--lumiverse-text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 10px 0;
  min-height: 24px;
  max-height: 84px;
  overflow-y: auto;
  resize: none;
  outline: none;
}
.la-textarea::placeholder { color: var(--lumiverse-text-dim); }
.la-composer-actions {
  display: flex; align-items: center;
  flex-shrink: 0;
}
.la-compact-btn {
  position: relative;
  width: 32px; height: 32px;
  background: transparent;
  border: none;
  padding: 0;
  margin-right: 6px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background var(--lumiverse-transition-fast);
}
.la-compact-btn:hover:not(:disabled) { background: var(--lumiverse-bg-hover); }
.la-compact-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.la-compact-btn.is-busy { opacity: 0.55; cursor: progress; }
.la-compact-ring { width: 26px; height: 26px; display: block; }
.la-compact-track { stroke: var(--lumiverse-border); }
.la-compact-fill {
  stroke: var(--lumiverse-primary);
  transition: stroke-dashoffset var(--lumiverse-transition-fast), stroke var(--lumiverse-transition-fast);
}
.la-compact-btn.is-near-limit .la-compact-fill { stroke: var(--lumiverse-warning, var(--lumiverse-primary-hover)); }
.la-compact-btn.is-at-limit .la-compact-fill { stroke: var(--lumiverse-danger); }
.la-compact-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  box-shadow: var(--lumiverse-shadow-md);
  padding: 8px 10px;
  min-width: 220px;
  max-width: 260px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity var(--lumiverse-transition-fast), transform var(--lumiverse-transition-fast);
  z-index: 50;
  text-align: left;
}
.la-compact-btn:hover .la-compact-tooltip,
.la-compact-btn:focus-visible .la-compact-tooltip { opacity: 1; transform: translateY(0); }
.la-compact-tooltip-main {
  font-size: 12px;
  color: var(--lumiverse-text);
  font-weight: 500;
  margin-bottom: 2px;
}
.la-compact-tooltip-sub {
  font-size: 10px;
  color: var(--lumiverse-text-muted);
}

.la-send-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--lumiverse-primary);
  border: none;
  color: var(--lumiverse-text);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--lumiverse-transition-fast), opacity var(--lumiverse-transition-fast);
}
.la-send-btn:hover:not(:disabled) { background: var(--lumiverse-primary-hover); }
.la-send-btn:disabled { background: var(--lumiverse-secondary); cursor: not-allowed; opacity: 0.6; }
.la-send-btn svg { width: 18px; height: 18px; }
.la-cancel-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--lumiverse-bg-hover);
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-danger);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--lumiverse-transition-fast);
}
.la-cancel-btn:hover { background: var(--lumiverse-danger-015); border-color: var(--lumiverse-danger-050); }
.la-cancel-btn svg { width: 14px; height: 14px; }
.la-composer-status { display: none; }
.la-composer-status.is-error { display: none; }
.la-composer-hint { color: var(--lumiverse-text-dim); font-size: 10px; text-align: right; padding: 0 16px; }

/* Empty state */
.la-empty {
  display: flex; align-items: center; justify-content: center;
  flex: 1; flex-direction: column; gap: 14px;
  color: var(--lumiverse-text-muted);
  text-align: center;
  padding: 40px 24px;
  min-height: 240px;
}
.la-empty h3 { margin: 0; color: var(--lumiverse-text); font-weight: 600; font-size: 16px; }
.la-empty p { margin: 0; font-size: 13px; max-width: 420px; line-height: 1.6; color: var(--lumiverse-text-muted); }
.la-empty-suggestions { display: flex; flex-direction: column; gap: 6px; align-items: center; margin-top: 8px; }
.la-empty-suggestion {
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius);
  padding: 6px 14px;
  font-size: 12px;
  color: var(--lumiverse-text-muted);
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-empty-suggestion:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); color: var(--lumiverse-text); }

/* ─── Workshop modal tabs ─── */
.la-workshop-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-workshop-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  color: var(--lumiverse-text-muted);
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--lumiverse-radius-sm) var(--lumiverse-radius-sm) 0 0;
  margin-bottom: -1px;
  transition: color var(--lumiverse-transition-fast), background var(--lumiverse-transition-fast);
}
.la-workshop-tab:hover { color: var(--lumiverse-text); }
.la-workshop-tab.is-active {
  background: var(--lumiverse-bg);
  border-color: var(--lumiverse-border);
  border-bottom-color: var(--lumiverse-bg);
  color: var(--lumiverse-primary-text);
  font-weight: 600;
}
.la-workshop-view { display: none; flex: 1; min-height: 0; flex-direction: column; }
.la-workshop-view.is-active { display: flex; }

/* ─── Workspace (Files tab) ─── */
.la-ws {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: var(--lumiverse-bg);
}
.la-ws-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-ws-status {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  margin-left: auto;
  max-width: 50%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-ws-status.is-error { color: var(--lumiverse-danger); }
.la-ws-split {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  flex: 1; min-height: 0;
}
.la-ws-tree {
  overflow-y: auto;
  border-right: 1px solid var(--lumiverse-border);
  padding: 6px 4px;
  background: var(--lumiverse-bg-elevated);
  min-height: 0;
}
.la-ws-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  font-size: 12px;
  user-select: none;
}
.la-ws-row:hover { background: var(--lumiverse-bg-hover); }
.la-ws-row.is-selected { background: var(--lumiverse-primary-015); color: var(--lumiverse-primary-text); }
.la-ws-caret { color: var(--lumiverse-text-dim); width: 10px; font-size: 10px; flex-shrink: 0; }
.la-ws-icon { width: 16px; text-align: center; flex-shrink: 0; }
.la-ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.la-ws-size { color: var(--lumiverse-text-dim); font-size: 10px; flex-shrink: 0; }
.la-ws-loading { color: var(--lumiverse-text-dim); font-size: 11px; }
.la-ws-empty {
  padding: 16px;
  color: var(--lumiverse-text-muted);
  font-size: 12px;
  text-align: center;
}
.la-ws-pane {
  display: flex; flex-direction: column;
  overflow: hidden;
  min-height: 0;
  padding: 12px 16px;
}
.la-ws-pane-empty { color: var(--lumiverse-text-muted); font-size: 13px; padding: 8px; }
.la-ws-pane-header { margin-bottom: 8px; }
.la-ws-pane-title { font-weight: 600; font-size: 13px; word-break: break-all; }
.la-ws-pane-meta { font-size: 11px; color: var(--lumiverse-text-muted); margin-top: 2px; }
.la-ws-pane-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.la-ws-pane-note {
  font-size: 12px;
  color: var(--lumiverse-text-muted);
  padding: 8px 12px;
  background: var(--lumiverse-fill-subtle);
  border-radius: var(--lumiverse-radius-sm);
}
/* Info-flavoured note (e.g. the agent-notes snapshot warning). Adds a thin
   primary-tinted left border so it reads as guidance rather than a warning. */
.la-ws-pane-note-info {
  border-left: 3px solid var(--lumiverse-primary-muted);
  color: var(--lumiverse-text);
  margin-bottom: 10px;
}
.la-ws-preview {
  flex: 1; min-height: 0;
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  overflow: auto;
}
.la-ws-preview-pre {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.la-ws-preview { display: flex; flex-direction: column; }
.la-ws-editor-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--lumiverse-border-light);
  background: var(--lumiverse-bg-dark);
  flex-shrink: 0;
}
.la-ws-editor-status {
  flex: 1;
  font-size: 11px;
  color: var(--lumiverse-text-muted);
}
.la-ws-editor-status.is-dirty { color: var(--lumiverse-primary); font-weight: 600; }
.la-ws-editor {
  flex: 1;
  width: 100%;
  min-height: 200px;
  margin: 0;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  line-height: 1.5;
  background: var(--lumiverse-bg-dark);
  color: var(--lumiverse-text);
  box-sizing: border-box;
}
.la-ws-system-tag {
  margin-left: 6px;
  padding: 0 6px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--lumiverse-text-muted);
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: 4px;
  line-height: 14px;
  flex-shrink: 0;
}
.la-ws-preview-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  margin: 0 auto;
  object-fit: contain;
  background: var(--lumiverse-bg-dark);
}
.la-ws-preview-audio { display: block; width: 100%; padding: 16px 12px; }
.la-ws-preview-video { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; background: black; }
@media (max-width: 720px) {
  .la-ws-split { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .la-ws-tree { max-height: 30vh; border-right: none; border-bottom: 1px solid var(--lumiverse-border); }
  .la-ws-pane { padding: 8px 10px; }
}

/* ─── Workshop Characters tab ─── */
.la-chars {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: var(--lumiverse-bg);
}
.la-chars-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-chars-summary { display: flex; gap: 6px; flex-wrap: wrap; }
.la-chars-summary-pill {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 2px 8px;
}
.la-chars-list { flex: 1; overflow-y: auto; padding: 6px; min-height: 0; }
.la-chars-empty {
  padding: 24px 16px;
  color: var(--lumiverse-text-muted);
  font-size: 12px;
  text-align: center;
}
.la-chars-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-bg-elevated);
  margin-bottom: 6px;
}
.la-chars-row:hover { background: var(--lumiverse-bg-hover); }
.la-chars-main { flex: 1; min-width: 0; }
.la-chars-name {
  font-weight: 600; font-size: 13px;
  display: flex; align-items: baseline; gap: 8px;
  overflow: hidden; white-space: nowrap;
}
.la-chars-name-text { overflow: hidden; text-overflow: ellipsis; }
.la-chars-size {
  font-weight: 400; font-size: 11px;
  color: var(--lumiverse-text-muted);
  flex-shrink: 0;
}
.la-chars-meta {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-chars-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* ─── Diff modal (rendered inside host showModal body) ─── */
/* Host body has padding 16px and overflowY auto. We size root to 100% of that
   content area, then run internal scroll on tree and pane-body so the host
   body never scrolls itself. */
.la-diff-modal-root {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  margin: -16px;
  background: var(--lumiverse-bg);
  color: var(--lumiverse-text);
  font-family: var(--lumiverse-font-family);
}
.la-diff-modal-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-diff-toolbar-select { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.la-diff-scope-combo { flex: 0 1 240px; min-width: 150px; }
.la-diff-scope-combo .la-combo-trigger { width: 100%; max-width: none; }
.la-diff-modal-toolbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.la-diff-modal-stats { font-size: 12px; color: var(--lumiverse-text-muted); white-space: nowrap; }
.la-diff-view-toggle {
  display: inline-flex;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-sm);
  padding: 2px;
}
.la-diff-view-tab {
  background: transparent; border: none; color: var(--lumiverse-text-muted);
  font-family: inherit; font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-diff-view-tab.is-active { background: var(--lumiverse-bg-elevated); color: var(--lumiverse-text); }
.la-diff-view-tab:hover:not(.is-active) { color: var(--lumiverse-text); }
.la-diff-modal-body {
  display: grid;
  grid-template-columns: minmax(220px, 300px) 1fr;
  grid-template-rows: minmax(0, 1fr);
  flex: 1; min-height: 0;
}
.la-diff-modal-tree {
  overflow-y: auto;
  border-right: 1px solid var(--lumiverse-border);
  padding: 8px 6px;
  background: var(--lumiverse-bg-elevated);
  min-height: 0;
}
.la-diff-tree-section { margin-bottom: 10px; }
.la-diff-tree-section-head {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--lumiverse-text-dim);
  padding: 6px 10px;
  font-weight: 600;
}
.la-diff-tree-row {
  display: block; width: 100%; text-align: left;
  background: transparent; border: none; color: inherit; font-family: inherit;
  padding: 7px 10px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background var(--lumiverse-transition-fast);
}
.la-diff-tree-row:hover { background: var(--lumiverse-bg-hover); }
.la-diff-tree-row.is-active { background: var(--lumiverse-primary-015); }
.la-diff-tree-row.is-reverted { opacity: 0.5; }
.la-diff-tree-primary {
  font-size: 13px; color: var(--lumiverse-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-diff-tree-secondary {
  font-size: 11px; color: var(--lumiverse-text-muted); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-diff-tree-empty, .la-diff-pane-empty {
  padding: 16px; color: var(--lumiverse-text-muted); font-size: 13px;
}
.la-diff-modal-pane {
  display: flex; flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.la-diff-pane-toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-diff-pane-heading {
  grid-column: 1; grid-row: 1; font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.la-diff-pane-sub { color: var(--lumiverse-text-muted); font-weight: 400; }
.la-diff-pane-meta {
  grid-column: 1; grid-row: 2; font-size: 11px; color: var(--lumiverse-text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.la-diff-pane-actions { grid-column: 2; grid-row: 1 / span 2; align-self: center; display: flex; gap: 8px; }
.la-diff-pane-body {
  flex: 1; overflow: auto; padding: 18px;
  min-height: 0;
}
.la-diff-pane-note {
  background: var(--lumiverse-fill-subtle);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--lumiverse-text-muted);
}

/* ─── Mobile (matches MOBILE_BREAKPOINT_PX in diff-modal.ts) ─── */
/* Tree above pane. Both compact: single-line truncated rows in the tree,
   single-line pane heading + meta. Revert button stays full width but tighter. */
@media (max-width: 720px) {
  .la-diff-modal-toolbar { padding: 6px 8px; gap: 6px 8px; }
  .la-diff-modal-stats { font-size: 11px; }
  .la-diff-view-tab { padding: 3px 8px; font-size: 10px; }
  /* Selector takes the full first row; actions wrap to a compact second
     row so small screens don't lose vertical space to a tall toolbar. */
  .la-diff-toolbar-select { flex: 1 1 100%; }
  .la-diff-scope-combo { flex: 1 1 auto; }
  .la-diff-modal-toolbar-actions { margin-left: 0; width: 100%; gap: 6px; }
  .la-diff-modal-toolbar-actions .la-btn-mini { padding: 4px 8px; font-size: 11px; }

  .la-diff-modal-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .la-diff-modal-tree {
    max-height: 26vh;
    padding: 4px 4px;
    border-right: none;
    border-bottom: 1px solid var(--lumiverse-border);
  }
  .la-diff-tree-section { margin-bottom: 4px; }
  .la-diff-tree-section-head {
    padding: 3px 6px;
    font-size: 9px;
    letter-spacing: 0.06em;
  }
  .la-diff-tree-row {
    padding: 4px 8px;
    margin-bottom: 1px;
  }
  .la-diff-tree-primary { font-size: 12px; line-height: 1.25; }
  .la-diff-tree-secondary { font-size: 10px; margin-top: 0; line-height: 1.2; }

  .la-diff-pane-toolbar {
    padding: 6px 10px;
    gap: 2px 8px;
  }
  .la-diff-pane-heading { font-size: 12px; }
  .la-diff-pane-meta { font-size: 10px; }
  .la-diff-pane-body { padding: 10px; }
  .la-diff-pane-note { padding: 6px 8px; margin-bottom: 8px; font-size: 11px; }
  .la-diff-pane-actions .la-btn { padding: 4px 9px; font-size: 11px; }
}

/* Side-by-side diff */
.la-diff-sxs {
  display: flex; flex-direction: column;
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  line-height: 1.55;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  overflow: hidden;
}
.la-diff-sxs-head { display: grid; grid-template-columns: 1fr 1fr; background: var(--lumiverse-bg-elevated); }
.la-diff-sxs-headcell {
  padding: 7px 14px; font-weight: 600;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--lumiverse-text-muted);
  border-bottom: 1px solid var(--lumiverse-border);
}
.la-diff-sxs-headcell-old { border-right: 1px solid var(--lumiverse-border); }
.la-diff-sxs-body { background: var(--lumiverse-bg-dark); }
.la-diff-sxs-row { display: grid; grid-template-columns: 1fr 1fr; }
.la-diff-sxs-cell {
  padding: 2px 14px;
  white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;
  border-right: 1px solid var(--lumiverse-border-light);
}
.la-diff-sxs-cell:last-child { border-right: none; }
.la-diff-sxs-row.la-diff-sxs-del .la-diff-sxs-old { background: var(--lumiverse-danger-015); }
.la-diff-sxs-row.la-diff-sxs-add .la-diff-sxs-new { background: var(--lumiverse-success-015); }
.la-diff-sxs-row.la-diff-sxs-change .la-diff-sxs-old { background: var(--lumiverse-danger-015); }
.la-diff-sxs-row.la-diff-sxs-change .la-diff-sxs-new { background: var(--lumiverse-success-015); }
.la-diff-sxs-empty { background: var(--lumiverse-bg) !important; }

/* Sessions modal list */
.la-sessions-modal-list { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
.la-session-item {
  padding: 10px 14px;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-bg-elevated);
  cursor: pointer;
  display: flex; align-items: center; gap: 10px;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-session-item:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); }
.la-session-item.is-active { border-color: var(--lumiverse-primary-muted); background: var(--lumiverse-primary-010); }
.la-session-item-main { flex: 1; min-width: 0; }
.la-session-item-meta { color: var(--lumiverse-text-muted); font-size: 11px; margin-top: 2px; }
.la-session-item-actions { margin-left: auto; display: flex; gap: 6px; }
.la-session-item-delete {
  margin-left: auto;
  flex-shrink: 0;
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--lumiverse-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--lumiverse-transition-fast),
              background var(--lumiverse-transition-fast),
              border-color var(--lumiverse-transition-fast),
              color var(--lumiverse-transition-fast);
}
.la-session-item:hover .la-session-item-delete,
.la-session-item-delete:focus-visible { opacity: 1; }
.la-session-item-delete:hover {
  background: var(--lumiverse-danger-015);
  border-color: var(--lumiverse-danger-050);
  color: var(--lumiverse-danger);
}
.la-session-item-delete:disabled { opacity: 0.4; cursor: not-allowed; }
.la-session-item-delete svg { width: 14px; height: 14px; display: block; }
/* "Currently active" marker on rows in the Pin / Sessions modals. Sits
   between the row body and the action buttons. Inherits row text color
   per the user's request, so no theme-specific tint. */
.la-session-item-tick {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  flex-shrink: 0;
  color: var(--lumiverse-text-muted);
}
.la-session-item-tick svg { width: 16px; height: 16px; display: block; }

@media (max-width: 640px) {
  .la-header { padding: 8px 10px; }
  .la-thread { padding: 16px 10px 16px; }
  .la-composer { padding: 10px 10px 12px; }
  .la-msg-user .la-msg-bubble { max-width: 92%; }
}
`;
