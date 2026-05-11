import type {
  ChatAssistantMessage,
  ChatMessage,
  ChatUserMessage,
  EditLogEntry,
  TodoItem,
  TodoStatus,
} from "../types";
import { renderMarkdown } from "./markdown";
import { renderInlineFieldDiff, renderUnifiedDiff, computeDiffStats, isShortField } from "./diff";
import { ICON_EDIT, ICON_RETRY, ICON_TRASH } from "./icons";
import { mountLoading, type LoadingHandle } from "./loading";

const MAX_ARGS_PREVIEW = 80;

export interface ChatThreadDeps {
  onRevertEdit(editId: string): Promise<void>;
  onRevertManyEdits?(editIds: readonly string[]): Promise<void>;
  onOpenDiffModal(initialEditId?: string): void;
  onEditUserMessage?(messageId: string, newContent: string, editsAction: "keep" | "revert"): Promise<void>;
  onRegenerateAssistant?(assistantMessageId: string, editsAction: "keep" | "revert"): Promise<void>;
  onDeleteMessage?(messageId: string, editsAction: "keep" | "revert"): Promise<void>;
  onFreeToolResult?(callId: string): Promise<void>;
  // True when this result sits at-or-before the rolling cache anchor (free invalidates the cache prefix). Drives modal-vs-inline-confirm.
  isToolResultInCache?(callId: string): boolean;
  promptEditsAction?(opts: { liveEditCount: number; action: "edit" | "regenerate" | "delete" }): Promise<"keep" | "revert" | "cancel">;
  liveEditsForAssistantMessage?(assistantMessageId: string): number;
  liveEditsAfterUserMessage?(messageId: string): number;
}

export interface AssistantHandle {
  root: HTMLElement;
  appendToken(token: string): void;
  appendReasoning(token: string): void;
  startTool(callId: string, name: string, args: Record<string, unknown>): void;
  finishTool(callId: string, result: string, isError: boolean, editIds: readonly string[], sensitivity?: "sensitive" | "insensitive"): void;
  setToolSensitivity(callId: string, sensitivity: "sensitive" | "insensitive", freed?: boolean): void;
  attachEdits(edits: readonly EditLogEntry[]): void;
  addWarning(message: string): void;
  setStatus(status: ChatAssistantMessage["status"]): void;
  setUsage(usage: ChatAssistantMessage["usage"]): void;
  // Show / hide the cycling "thinking" indicator inside the bubble. Pinned
  // to the bottom of the bubble so it visually trails whatever content has
  // streamed in. Cleared automatically on completion.
  setLoading(active: boolean): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function previewArgs(args: Record<string, unknown>): string {
  try {
    const compact = JSON.stringify(args);
    return compact.length > MAX_ARGS_PREVIEW ? `${compact.slice(0, MAX_ARGS_PREVIEW - 1)}…` : compact;
  } catch { return "{…}"; }
}

function describeToolActivity(name: string, args: Record<string, unknown>): { kind: "read" | "write" | "create" | "delete" | "search" | "test" | "finish"; verb: string; target: string } {
  const s = (k: string): string | undefined => typeof args[k] === "string" ? args[k] as string : undefined;
  const n = (k: string): number | undefined => typeof args[k] === "number" ? args[k] as number : undefined;
  switch (name) {
    case "list_characters": return { kind: "read", verb: "Listing", target: "characters" };
    case "list_connections": return { kind: "read", verb: "Listing", target: "connections" };
    case "list_world_books": return { kind: "read", verb: "Listing", target: "world books" };
    case "list_world_book_entries": return { kind: "read", verb: "Listing", target: "world book entries" };
    case "list_regex_scripts": return { kind: "read", verb: "Listing", target: "regex scripts" };
    case "list_alternate_greetings": return { kind: "read", verb: "Listing", target: "alternate greetings" };
    case "list_extension_keys": { const p = s("path"); return { kind: "read", verb: "Inspecting", target: p ? `extensions.${p}` : "extensions" }; }
    case "grep_card": return { kind: "search", verb: "Searching", target: `for ${JSON.stringify(s("pattern") ?? "")}` };
    case "survey_cjk": return { kind: "search", verb: "Surveying", target: "CJK runs across the card" };
    case "read_character_field": return { kind: "read", verb: "Reading", target: s("field") ?? "character field" };
    case "read_alternate_greeting": { const i = n("index"); return { kind: "read", verb: "Reading", target: `alternate_greetings[${i ?? "?"}]` }; }
    case "read_world_book_entry": return { kind: "read", verb: "Reading", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "read_regex_script_meta": return { kind: "read", verb: "Reading", target: `regex script ${s("script_id") ?? "?"} metadata` };
    case "read_regex_script_field": return { kind: "read", verb: "Reading", target: `regex script ${s("script_id") ?? "?"}.${s("field") ?? "?"}` };
    case "read_character_extension": return { kind: "read", verb: "Reading", target: `extensions.${s("path") ?? "?"}` };
    case "edit_character_field": return { kind: "write", verb: "Editing", target: s("field") ?? "character field" };
    case "edit_alternate_greeting": { const i = n("index"); return { kind: "write", verb: "Editing", target: `alternate_greetings[${i ?? "?"}]` }; }
    case "edit_world_book_entry": return { kind: "write", verb: "Editing", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "edit_regex_script_field": return { kind: "write", verb: "Editing", target: `regex script ${s("script_id") ?? "?"}.${s("field") ?? "?"}` };
    case "edit_character_extension": return { kind: "write", verb: "Editing", target: `extensions.${s("path") ?? "?"}` };
    case "update_character": return { kind: "write", verb: "Updating", target: `character (${Object.keys((args["patch"] as Record<string, unknown>) ?? {}).join(", ")})` };
    case "update_world_book_entry": return { kind: "write", verb: "Updating", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "update_regex_script": return { kind: "write", verb: "Updating", target: `regex script ${s("script_id") ?? "?"}` };
    case "update_character_extension": return { kind: "write", verb: "Replacing", target: `extensions.${s("path") ?? "?"}` };
    case "create_world_book_entry": return { kind: "create", verb: "Creating", target: `world book entry${s("comment") ? ` '${s("comment")}'` : ""}` };
    case "delete_world_book_entry": return { kind: "delete", verb: "Deleting", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "create_regex_script": return { kind: "create", verb: "Creating", target: `regex script${s("name") ? ` '${s("name")}'` : ""}` };
    case "delete_regex_script": return { kind: "delete", verb: "Deleting", target: `regex script ${s("script_id") ?? "?"}` };
    case "create_alternate_greeting": { const i = n("index"); return { kind: "create", verb: "Adding", target: i !== undefined ? `alternate_greetings[${i}]` : "alternate greeting" }; }
    case "delete_alternate_greeting": { const i = n("index"); return { kind: "delete", verb: "Deleting", target: `alternate_greetings[${i ?? "?"}]` }; }
    case "apply_glossary": { const e = (args["entries"] as Record<string, unknown>) ?? {}; const dry = args["dry_run"] === true; return { kind: dry ? "search" : "write", verb: dry ? "Dry-running" : "Applying", target: `glossary (${Object.keys(e).length} entries)` }; }
    case "test_regex": return { kind: "test", verb: "Testing", target: "regex pattern" };
    case "count_cjk_chars": return { kind: "read", verb: "Counting", target: "CJK chars" };
    case "todo_write": {
      const todos = Array.isArray(args["todos"]) ? args["todos"] as TodoItem[] : [];
      const active = todos.find((t) => t && t.status === "in_progress");
      if (active) return { kind: "write", verb: "Working on", target: active.activeForm };
      return { kind: "write", verb: "Updating", target: `todos (${todos.length})` };
    }
    case "finish": return { kind: "finish", verb: "Marking", target: "task complete" };
    default: return { kind: "read", verb: "Calling", target: name };
  }
}

function todoMark(status: TodoStatus): string {
  switch (status) {
    case "completed": return "✓";
    case "in_progress": return "→";
    case "pending": return "·";
  }
}

function renderTodosPanel(todos: readonly TodoItem[]): HTMLElement {
  const panel = el("div", "la-todos-panel");
  if (todos.length === 0) {
    panel.appendChild(el("div", "la-todos-empty", "(no items)"));
    return panel;
  }
  const list = el("ul", "la-todos-list");
  for (const t of todos) {
    if (!t || typeof t !== "object") continue;
    const status = (t.status === "in_progress" || t.status === "completed") ? t.status : "pending";
    const li = el("li", `la-todo-item la-todo-${status}`);
    li.append(
      el("span", "la-todo-mark", todoMark(status)),
      el("span", "la-todo-label", status === "in_progress" ? (t.activeForm ?? t.content ?? "") : (t.content ?? "")),
    );
    list.appendChild(li);
  }
  panel.appendChild(list);
  return panel;
}

function buildToolCard(callId: string, name: string, args: Record<string, unknown>, deps?: ChatThreadDeps): HTMLElement {
  const card = el("div", "la-tool-card la-msg-block is-running");
  card.dataset["callId"] = callId;
  const desc = describeToolActivity(name, args);
  card.dataset["kind"] = desc.kind;
  const head = el("div", "la-tool-head");
  const caret = el("span", "la-tool-caret", "▸");
  const spinner = el("span", "la-tool-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const activity = el("span", "la-tool-activity");
  const verbSpan = el("span", "la-tool-verb", desc.verb);
  const targetSpan = el("span", "la-tool-target", " " + desc.target);
  activity.append(verbSpan, targetSpan);
  const sensBadge = el("span", "la-tool-sens");
  sensBadge.style.display = "none";
  const status = el("span", "la-tool-status", "running");
  const freeBtn = el("button", "la-tool-free-btn", "free") as HTMLButtonElement;
  freeBtn.type = "button";
  freeBtn.title = "Replace this result with a stub to save context. The model loses access to its content.";
  freeBtn.style.display = "none";
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  const resetConfirm = () => {
    if (confirmTimer !== null) { clearTimeout(confirmTimer); confirmTimer = null; }
    freeBtn.classList.remove("is-confirming");
    freeBtn.textContent = "free";
  };
  freeBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!deps?.onFreeToolResult) return;
    const inCache = deps.isToolResultInCache?.(callId) ?? false;
    if (inCache) {
      // Cache-invalidating free goes through the modal in drawer.ts.
      void deps.onFreeToolResult(callId);
      return;
    }
    // Safe free, two-click inline confirm so a stray click can't drop content.
    if (freeBtn.classList.contains("is-confirming")) {
      resetConfirm();
      void deps.onFreeToolResult(callId);
      return;
    }
    freeBtn.classList.add("is-confirming");
    freeBtn.textContent = "Confirm?";
    confirmTimer = setTimeout(resetConfirm, 4000);
  });
  head.append(caret, spinner, activity, sensBadge, freeBtn, status);
  const body = el("div", "la-tool-body");
  const argsSection = el("div", "la-tool-body-section");
  argsSection.append(
    el("div", "la-tool-body-section-label", `${name} args`),
    Object.assign(el("pre"), { textContent: JSON.stringify(args, null, 2) }),
  );
  body.appendChild(argsSection);
  const resultSection = el("div", "la-tool-body-section la-tool-body-result");
  resultSection.append(el("div", "la-tool-body-section-label", "result"), el("pre", undefined, ""));
  body.appendChild(resultSection);
  card.append(head);
  if (name === "todo_write" && Array.isArray(args["todos"])) {
    // Todos render above the expand/collapse body so they stay visible at a
    // glance without forcing the user to open the args/result panes.
    card.appendChild(renderTodosPanel(args["todos"] as readonly TodoItem[]));
  }
  card.appendChild(body);
  head.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest(".la-tool-free-btn")) return;
    card.classList.toggle("is-open");
    caret.textContent = card.classList.contains("is-open") ? "▾" : "▸";
  });
  return card;
}

function applyToolCardSensitivity(card: HTMLElement, sensitivity: "sensitive" | "insensitive" | undefined, freed: boolean | undefined): void {
  const badge = card.querySelector(".la-tool-sens") as HTMLElement | null;
  const freeBtn = card.querySelector(".la-tool-free-btn") as HTMLButtonElement | null;
  if (!badge || !freeBtn) return;
  if (freed) {
    badge.textContent = "freed";
    badge.className = "la-tool-sens la-tool-sens-freed";
    badge.style.display = "";
    freeBtn.style.display = "none";
    return;
  }
  if (sensitivity === "sensitive") {
    badge.textContent = "sensitive";
    badge.className = "la-tool-sens la-tool-sens-sensitive";
    badge.style.display = "";
  } else if (sensitivity === "insensitive") {
    badge.textContent = "insensitive";
    badge.className = "la-tool-sens la-tool-sens-insensitive";
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
  freeBtn.style.display = "";
}

function describeEditSurface(entry: EditLogEntry): { primary: string; secondary: string; statSummary: string } {
  const r = entry.record;
  if (r.op === "create") return { primary: `+ ${r.surfaceLabel}`, secondary: r.surface, statSummary: "created" };
  if (r.op === "delete") return { primary: `× ${r.surfaceLabel}`, secondary: r.surface, statSummary: "deleted" };
  const stats = computeDiffStats(r.before, r.after);
  return { primary: r.surfaceLabel, secondary: r.field, statSummary: `+${stats.added} -${stats.removed}` };
}

function buildEditRow(entry: EditLogEntry, deps: ChatThreadDeps): HTMLElement {
  const row = el("div", `la-edit-row ${entry.reverted ? "is-reverted" : ""}`);
  row.dataset["editId"] = entry.id;
  const head = el("div", "la-edit-row-head");
  const desc = describeEditSurface(entry);
  head.appendChild(el("span", "la-edit-row-surface", desc.secondary));
  head.appendChild(el("span", "la-edit-row-label", desc.primary));
  if (entry.record.op === "edit") {
    head.appendChild(el("span", "la-edit-row-field", `· ${entry.record.field}`));
  }
  head.appendChild(el("span", "la-edit-row-stat", `· ${desc.statSummary}`));
  if (entry.reverted) head.appendChild(el("span", "la-edit-row-stat", "· reverted"));
  const actions = el("div", "la-edit-row-actions");
  const fullBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Open full diff");
  fullBtn.addEventListener("click", () => deps.onOpenDiffModal(entry.id));
  actions.appendChild(fullBtn);
  if (!entry.reverted) {
    const revertBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Revert") as HTMLButtonElement;
    revertBtn.addEventListener("click", async () => {
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting…";
      try {
        await deps.onRevertEdit(entry.id);
      } catch (err) {
        revertBtn.disabled = false;
        revertBtn.textContent = "Revert";
      }
    });
    actions.appendChild(revertBtn);
  }
  head.appendChild(actions);
  row.appendChild(head);

  const diffWrap = el("div", "la-edit-row-diff");
  const r = entry.record;
  if (r.op === "edit") {
    if (isShortField(r.before, r.after)) {
      diffWrap.appendChild(renderInlineFieldDiff(r.before, r.after));
    } else {
      diffWrap.appendChild(renderUnifiedDiff(r.before, r.after, 2));
    }
  } else if (r.op === "create") {
    diffWrap.textContent = "Created. Open full diff to inspect.";
  } else {
    diffWrap.textContent = "Deleted. Open full diff to inspect or revert.";
  }
  row.appendChild(diffWrap);
  return row;
}

function buildEditsCard(parentMsg: HTMLElement, deps: ChatThreadDeps): {
  card: HTMLElement;
  add(entry: EditLogEntry): void;
  rebuild(entries: readonly EditLogEntry[]): void;
  count(): number;
} {
  const card = el("div", "la-edits-card la-msg-block");
  const head = el("div", "la-edits-head");
  const caret = el("span", "la-edits-caret", "▸");
  const title = el("span", "la-edits-title", "Edits (0)");
  const right = el("span", "la-edits-head-right");
  const revertAllBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Revert all") as HTMLButtonElement;
  revertAllBtn.style.display = "none";
  revertAllBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const liveIds = entries.filter((e) => !e.reverted).map((e) => e.id);
    if (liveIds.length === 0) return;
    revertAllBtn.disabled = true;
    revertAllBtn.textContent = "Reverting…";
    try {
      if (deps.onRevertManyEdits) await deps.onRevertManyEdits(liveIds);
      else for (const id of [...liveIds].reverse()) await deps.onRevertEdit(id);
    } catch { /* outcome rendering happens via edit_reverted events */ }
    revertAllBtn.disabled = false;
    revertAllBtn.textContent = "Revert all";
  });
  const allBtn = el("button", "la-btn la-btn-mini", "See Workshop");
  allBtn.addEventListener("click", (ev) => { ev.stopPropagation(); deps.onOpenDiffModal(undefined); });
  right.append(revertAllBtn, allBtn);
  head.append(caret, title, right);
  const list = el("div", "la-edits-list");
  card.append(head, list);
  head.addEventListener("click", () => {
    card.classList.toggle("is-open");
    caret.textContent = card.classList.contains("is-open") ? "▾" : "▸";
  });
  const entries: EditLogEntry[] = [];
  const setTitle = () => {
    const liveCount = entries.filter((e) => !e.reverted).length;
    title.textContent = `Edits (${entries.length})`;
    revertAllBtn.style.display = liveCount > 0 ? "" : "none";
  };
  const append = (entry: EditLogEntry) => {
    entries.push(entry);
    list.appendChild(buildEditRow(entry, deps));
    setTitle();
  };
  const rebuild = (next: readonly EditLogEntry[]) => {
    entries.length = 0;
    list.innerHTML = "";
    for (const e of next) {
      entries.push(e);
      list.appendChild(buildEditRow(e, deps));
    }
    setTitle();
  };
  return { card, add: append, rebuild, count: () => entries.length };
}

export function renderUserMessage(msg: ChatUserMessage, deps?: ChatThreadDeps): HTMLElement {
  const wrap = el("div", "la-msg la-msg-user");
  const bubble = el("div", "la-msg-bubble");
  bubble.textContent = msg.content;
  wrap.appendChild(bubble);

  if (deps?.onEditUserMessage || deps?.onDeleteMessage) {
    const actions = el("div", "la-msg-actions");
    if (deps?.onEditUserMessage) {
      const editBtn = el("button", "la-msg-action-btn la-msg-action-btn-icon") as HTMLButtonElement;
      editBtn.innerHTML = ICON_EDIT;
      editBtn.setAttribute("aria-label", "Edit message");
      editBtn.title = "Edit message";
      editBtn.addEventListener("click", async () => {
        const editor = enterEditMode(bubble, msg.content);
        const result = await editor;
        if (result === null) return;
        const liveEdits = deps.liveEditsAfterUserMessage?.(msg.id) ?? 0;
        let action: "keep" | "revert" = "keep";
        if (liveEdits > 0 && deps.promptEditsAction) {
          const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "edit" });
          if (choice === "cancel") return;
          action = choice;
        }
        await deps.onEditUserMessage!(msg.id, result, action);
      });
      actions.appendChild(editBtn);
    }
    if (deps?.onDeleteMessage) {
      const delBtn = el("button", "la-msg-action-btn la-msg-action-btn-icon la-msg-action-btn-danger") as HTMLButtonElement;
      delBtn.innerHTML = ICON_TRASH;
      delBtn.setAttribute("aria-label", "Delete message");
      delBtn.title = "Delete this message";
      delBtn.addEventListener("click", async () => {
        await deps.onDeleteMessage!(msg.id, "keep");
      });
      actions.appendChild(delBtn);
    }
    wrap.appendChild(actions);
  }
  return wrap;
}

function enterEditMode(bubble: HTMLElement, current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const original = bubble.textContent ?? "";
    // Snapshot the rendered bubble height BEFORE we wipe its contents so
    // the textarea can match it. Without this, a one-line message that
    // soft-wraps to four visual lines collapses to a tiny 2-row editor.
    const renderedHeight = bubble.getBoundingClientRect().height;
    bubble.innerHTML = "";
    bubble.classList.add("is-editing");
    const ta = document.createElement("textarea");
    ta.className = "la-msg-edit-textarea";
    ta.value = current;
    ta.rows = Math.max(2, Math.min(10, current.split("\n").length));
    if (renderedHeight > 0) ta.style.minHeight = `${Math.ceil(renderedHeight)}px`;
    const autoGrow = (): void => {
      ta.style.height = "auto";
      const next = Math.max(renderedHeight, ta.scrollHeight);
      ta.style.height = `${Math.ceil(next)}px`;
    };
    const actions = el("div", "la-msg-edit-actions");
    const cancelBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Cancel");
    const saveBtn = el("button", "la-btn la-btn-mini la-btn-primary", "Save and resubmit");
    actions.append(cancelBtn, saveBtn);
    bubble.append(ta, actions);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autoGrow();
    ta.addEventListener("input", autoGrow);
    const finish = (val: string | null) => {
      bubble.classList.remove("is-editing");
      if (val === null) bubble.textContent = original;
      resolve(val);
    };
    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", () => {
      const v = ta.value.trim();
      if (v.length === 0) { finish(null); return; }
      finish(v);
    });
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); finish(null); }
      else if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); saveBtn.click(); }
    });
  });
}

// Map<editId, EditLogEntry> built once per render pass by the caller. Saves
// the per-message O(edits) array scan that dominated long-thread renders.
export type EditIndex = ReadonlyMap<string, EditLogEntry>;

export function buildEditIndex(edits: readonly EditLogEntry[]): EditIndex {
  const m = new Map<string, EditLogEntry>();
  for (const e of edits) m.set(e.id, e);
  return m;
}

export function renderStaticAssistant(msg: ChatAssistantMessage, deps: ChatThreadDeps, allEdits: EditIndex | readonly EditLogEntry[]): HTMLElement {
  const lookup = (id: string): EditLogEntry | undefined =>
    allEdits instanceof Map ? allEdits.get(id) : (allEdits as readonly EditLogEntry[]).find((e) => e.id === id);
  const wrap = el("div", "la-msg la-msg-assistant");
  const bubble = el("div", "la-msg-bubble");
  const collected: EditLogEntry[] = [];

  for (const block of msg.blocks) {
    if (block.type === "text") {
      if (block.content.length === 0) continue;
      const textBlock = el("div", "la-msg-block la-text-block");
      textBlock.appendChild(renderMarkdown(block.content));
      bubble.appendChild(textBlock);
    } else if (block.type === "reasoning") {
      if (block.content.length === 0) continue;
      const r = el("div", "la-reasoning la-msg-block");
      const t = el("div", "la-reasoning-toggle", "▸ Thinking");
      const b = el("div", "la-reasoning-body");
      b.textContent = block.content;
      r.append(t, b);
      t.addEventListener("click", () => r.classList.toggle("is-open"));
      bubble.appendChild(r);
    } else if (block.type === "tool") {
      const card = buildToolCard(block.call_id, block.name, block.args, deps);
      // Mark finished (this is the static-render path for reloaded history).
      card.classList.remove("is-running");
      card.classList.add(block.is_error ? "is-error" : "is-done");
      const status = card.querySelector(".la-tool-status") as HTMLElement;
      if (status) {
        status.textContent = block.is_error ? "error" : "done";
        if (block.is_error) status.classList.add("is-error");
      }
      const resultPre = card.querySelector(".la-tool-body-result pre") as HTMLElement | null;
      if (resultPre) resultPre.textContent = block.result ?? "";
      applyToolCardSensitivity(card, block.sensitivity, block.freed);
      bubble.appendChild(card);
      for (const eid of block.edit_ids) {
        const entry = lookup(eid);
        if (entry) collected.push(entry);
      }
    }
  }

  if (collected.length > 0) {
    const editsCard = buildEditsCard(wrap, deps);
    editsCard.rebuild(collected);
    bubble.appendChild(editsCard.card);
  }

  if (msg.status === "complete" && msg.usage) {
    const meta = el("div", "la-msg-meta", `${msg.usage.total} tokens · turn ${msg.turn}`);
    wrap.appendChild(meta);
  } else if (msg.status === "cancelled") {
    wrap.appendChild(el("div", "la-msg-meta", "cancelled"));
  } else if (msg.status === "errored") {
    wrap.appendChild(el("div", "la-msg-meta", "errored"));
  }
  wrap.appendChild(bubble);

  const canShowActions = msg.status === "complete" || msg.status === "cancelled" || msg.status === "errored";
  if (canShowActions && (deps.onRegenerateAssistant || deps.onDeleteMessage)) {
    const actions = el("div", "la-msg-actions la-msg-actions-right");
    if (deps.onRegenerateAssistant) {
      const regenBtn = el("button", "la-msg-action-btn la-msg-action-btn-icon") as HTMLButtonElement;
      regenBtn.innerHTML = ICON_RETRY;
      regenBtn.setAttribute("aria-label", "Regenerate response");
      regenBtn.title = "Regenerate";
      regenBtn.addEventListener("click", async () => {
        const liveEdits = deps.liveEditsForAssistantMessage?.(msg.id) ?? 0;
        let action: "keep" | "revert" = "keep";
        if (liveEdits > 0 && deps.promptEditsAction) {
          const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "regenerate" });
          if (choice === "cancel") return;
          action = choice;
        }
        await deps.onRegenerateAssistant!(msg.id, action);
      });
      actions.appendChild(regenBtn);
    }
    if (deps.onDeleteMessage) {
      const delBtn = el("button", "la-msg-action-btn la-msg-action-btn-icon la-msg-action-btn-danger") as HTMLButtonElement;
      delBtn.innerHTML = ICON_TRASH;
      delBtn.setAttribute("aria-label", "Delete message");
      delBtn.title = "Delete this message";
      delBtn.addEventListener("click", async () => {
        const liveEdits = deps.liveEditsForAssistantMessage?.(msg.id) ?? 0;
        let action: "keep" | "revert" = "keep";
        if (liveEdits > 0 && deps.promptEditsAction) {
          const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "delete" });
          if (choice === "cancel") return;
          action = choice;
        }
        await deps.onDeleteMessage!(msg.id, action);
      });
      actions.appendChild(delBtn);
    }
    wrap.appendChild(actions);
  }
  return wrap;
}

export function createStreamingAssistant(deps: ChatThreadDeps): AssistantHandle {
  const wrap = el("div", "la-msg la-msg-assistant");
  const bubble = el("div", "la-msg-bubble");
  wrap.appendChild(bubble);

  // Loading indicator lives inside the bubble so it tracks the streaming
  // message's actual position. Always re-appended as the last child so it
  // appears below whatever streamed in most recently.
  let loadingHandle: LoadingHandle | null = null;
  const loadingHost = el("div", "la-streaming-loading");
  const moveLoadingToTail = (): void => {
    if (!loadingHandle) return;
    bubble.appendChild(loadingHost);
  };
  const setLoading = (active: boolean): void => {
    const isActive = loadingHandle !== null;
    if (active === isActive) return;
    if (active) {
      loadingHandle = mountLoading(loadingHost);
      moveLoadingToTail();
    } else if (loadingHandle) {
      loadingHandle.destroy();
      loadingHandle = null;
      if (loadingHost.parentElement) loadingHost.remove();
    }
  };

  let textBlock: HTMLElement | null = null;
  let reasoningBlock: HTMLElement | null = null;
  let reasoningBody: HTMLElement | null = null;
  const toolCardsByCallId = new Map<string, HTMLElement>();
  let editsCardHandle: ReturnType<typeof buildEditsCard> | null = null;
  let metaLine: HTMLElement | null = null;
  const editIndex = new Map<string, EditLogEntry>();
  // Per-block raw markdown buffer (a message can have several text blocks split by tool cards). Re-render throttled to cap reparse cost.
  const textRaw = new Map<HTMLElement, string>();
  const dirtyBlocks = new Set<HTMLElement>();
  let pendingRenderTimer: ReturnType<typeof setTimeout> | null = null;
  const flushDirtyBlocks = (): void => {
    for (const tb of dirtyBlocks) {
      const raw = textRaw.get(tb) ?? "";
      tb.innerHTML = "";
      tb.appendChild(renderMarkdown(raw));
    }
    dirtyBlocks.clear();
  };
  const scheduleStreamingRender = (): void => {
    if (pendingRenderTimer !== null) return;
    pendingRenderTimer = setTimeout(() => {
      pendingRenderTimer = null;
      flushDirtyBlocks();
    }, 80);
  };
  const pendingForTools = new Map<string, string[]>();

  const ensureEditsCard = () => {
    if (!editsCardHandle) editsCardHandle = buildEditsCard(wrap, deps);
    // Re-append on every access so the card follows the most recent tool / edit.
    // appendChild moves an already-attached node, so this is a no-op when the
    // card is already last.
    bubble.appendChild(editsCardHandle.card);
    return editsCardHandle;
  };

  return {
    root: wrap,
    appendToken(token) {
      if (token.length === 0) return;
      if (!textBlock) {
        textBlock = el("div", "la-msg-block la-text-block");
        bubble.appendChild(textBlock);
        textRaw.set(textBlock, "");
      }
      textRaw.set(textBlock, (textRaw.get(textBlock) ?? "") + token);
      dirtyBlocks.add(textBlock);
      scheduleStreamingRender();
      moveLoadingToTail();
    },
    appendReasoning(token) {
      if (token.length === 0) return;
      if (!reasoningBlock) {
        reasoningBlock = el("div", "la-reasoning la-msg-block");
        const t = el("div", "la-reasoning-toggle", "▸ Thinking");
        reasoningBody = el("div", "la-reasoning-body");
        reasoningBlock.append(t, reasoningBody);
        t.addEventListener("click", () => reasoningBlock!.classList.toggle("is-open"));
        bubble.appendChild(reasoningBlock);
      }
      reasoningBody!.textContent = (reasoningBody!.textContent ?? "") + token;
      moveLoadingToTail();
    },
    startTool(callId, name, args) {
      // End any open text block so subsequent tokens start a new one after the tool card.
      textBlock = null;
      const card = buildToolCard(callId, name, args, deps);
      bubble.appendChild(card);
      toolCardsByCallId.set(callId, card);
      moveLoadingToTail();
    },
    finishTool(callId, result, isError, editIds, sensitivity) {
      const card = toolCardsByCallId.get(callId);
      if (!card) return;
      card.classList.remove("is-running");
      card.classList.add(isError ? "is-error" : "is-done");
      const status = card.querySelector(".la-tool-status") as HTMLElement | null;
      if (status) {
        status.textContent = isError ? "error" : "done";
        if (isError) status.classList.add("is-error");
        else status.classList.remove("is-error");
      }
      const resultPre = card.querySelector(".la-tool-body-result pre") as HTMLElement | null;
      if (resultPre) resultPre.textContent = result;
      if (sensitivity) applyToolCardSensitivity(card, sensitivity, false);
      pendingForTools.set(callId, [...editIds]);
      if (editIds.length === 0) return;
      const card2 = ensureEditsCard();
      for (const id of editIds) {
        const entry = editIndex.get(id);
        if (entry) card2.add(entry);
      }
    },
    setToolSensitivity(callId, sensitivity, freed) {
      const card = toolCardsByCallId.get(callId);
      if (!card) return;
      applyToolCardSensitivity(card, sensitivity, freed);
    },
    attachEdits(edits) {
      for (const e of edits) editIndex.set(e.id, e);
      if (edits.length === 0) return;
      // Fills in late-arriving edits for tools that finished earlier.
      const card = ensureEditsCard();
      const all: EditLogEntry[] = [];
      for (const [, ids] of pendingForTools) {
        for (const id of ids) {
          const entry = editIndex.get(id);
          if (entry) all.push(entry);
        }
      }
      if (all.length > 0) card.rebuild(all);
    },
    addWarning(_message) {
      // Warnings are surfaced via toast / system prompt, not in the chat bubble.
    },
    setLoading(active) { setLoading(active); },
    setStatus(status) {
      // Any terminal status clears the indicator so a stuck bubble can't keep
      // animating after the agent's done.
      if (status !== "streaming") setLoading(false);
      if (status === "cancelled") {
        if (!metaLine) { metaLine = el("div", "la-msg-meta", "cancelled"); wrap.appendChild(metaLine); }
        else metaLine.textContent = "cancelled";
      } else if (status === "errored") {
        if (!metaLine) { metaLine = el("div", "la-msg-meta", "errored"); wrap.appendChild(metaLine); }
        else metaLine.textContent = "errored";
      } else if (status === "complete") {
        // Final flush from textRaw, the rendered DOM has already lost the markdown markers.
        if (pendingRenderTimer !== null) { clearTimeout(pendingRenderTimer); pendingRenderTimer = null; }
        for (const tb of Array.from(bubble.querySelectorAll(".la-text-block"))) {
          const raw = textRaw.get(tb as HTMLElement);
          if (raw === undefined) continue;
          (tb as HTMLElement).innerHTML = "";
          (tb as HTMLElement).appendChild(renderMarkdown(raw));
        }
        dirtyBlocks.clear();
      }
    },
    setUsage(usage) {
      if (!usage) return;
      if (!metaLine) {
        metaLine = el("div", "la-msg-meta");
        wrap.appendChild(metaLine);
      }
      metaLine.textContent = `${usage.total} tokens`;
    },
  };
}

export function renderMessage(msg: ChatMessage, deps: ChatThreadDeps, allEdits: EditIndex | readonly EditLogEntry[]): HTMLElement {
  if (msg.role === "user") return renderUserMessage(msg, deps);
  return renderStaticAssistant(msg, deps, allEdits);
}
