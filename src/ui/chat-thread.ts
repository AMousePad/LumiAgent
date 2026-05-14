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
  // Fires on inline edit entry and exit. Drawer uses it to preserve the
  // edited bubble across rerenders.
  onEditingChange?(messageId: string | null): void;
}

export interface AssistantHandle {
  root: HTMLElement;
  appendToken(token: string): void;
  appendReasoning(token: string): void;
  startTool(callId: string, name: string, args: Record<string, unknown>): void;
  finishTool(callId: string, result: string, isError: boolean, editIds: readonly string[]): void;
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

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Leaf paths address one string-valued surface. Returns null when the path
// looks like a container instead.
function describePathLeaf(path: string): string | null {
  let m = /^char\/alternate_greetings\/(\d+)$/.exec(path);
  if (m) return `alternate greeting #${m[1]}`;
  m = /^char\/extensions\/(.+)$/.exec(path);
  if (m) return `extensions.${m[1]}`;
  m = /^char\/([^/]+)$/.exec(path);
  if (m) return m[1]!;
  m = /^rx\/([^/]+)\/(find_regex|replace_string)$/.exec(path);
  if (m) return `regex ${shortId(m[1]!)}.${m[2]}`;
  m = /^wb\/([^/]+)\/(content|comment)$/.exec(path);
  if (m) return `world book entry ${shortId(m[1]!)}.${m[2]}`;
  return null;
}

// Container paths address a parent that holds many leaves. Used by `list`
// and as a fallback for `inspect` paths that point at a regex script or
// world book without a field segment.
function describePathContainer(path: string): string | null {
  if (path === "" || path === "char" || path === "character") return "character overview";
  if (path === "char/alternate_greetings" || path === "alternate_greetings") return "alternate greetings";
  if (path === "rx" || path === "regex_scripts") return "regex scripts";
  if (path === "wb" || path === "world_books") return "world books";
  if (path === "char/extensions" || path === "extensions") return "extensions";
  let m = /^(?:wb|world_books)\/([^/]+)$/.exec(path);
  if (m) return `world book ${shortId(m[1]!)}`;
  m = /^(?:char\/)?extensions\/(.+)$/.exec(path);
  if (m) return `extensions.${m[1]}`;
  m = /^rx\/([^/]+)$/.exec(path);
  if (m) return `regex ${shortId(m[1]!)}`;
  return null;
}

function describePath(path: string | undefined): string {
  if (!path) return "?";
  return describePathLeaf(path) ?? describePathContainer(path) ?? path;
}

// Provider surface ids (`module_envelope`, etc.) are snake_case identifiers
// the agent sends over the wire. Render them with spaces for the human UI.
function humanizeSurfaceId(sid: string | undefined): string {
  return sid ? sid.replace(/_/g, " ") : "?";
}

function describeExternalTarget(surfaceId: string | undefined, itemId: string | undefined, field: string | undefined): string {
  const sid = humanizeSurfaceId(surfaceId);
  const iid = itemId ? shortId(itemId) : "?";
  const f = field ? `.${field}` : "";
  return `${sid}/${iid}${f}`;
}

function describeToolActivity(name: string, args: Record<string, unknown>): { kind: "read" | "write" | "create" | "delete" | "search" | "test" | "finish"; verb: string; target: string } {
  const s = (k: string): string | undefined => typeof args[k] === "string" ? args[k] as string : undefined;
  const n = (k: string): number | undefined => typeof args[k] === "number" ? args[k] as number : undefined;
  switch (name) {
    // Path-based read/edit/inspect/list/grep — the workhorses.
    case "read": return { kind: "read", verb: "Reading", target: describePath(s("path")) };
    case "inspect": return { kind: "read", verb: "Inspecting", target: describePath(s("path")) };
    case "list": return { kind: "read", verb: "Listing", target: describePathContainer(s("path") ?? "") ?? describePath(s("path")) };
    case "grep": { const p = s("pattern"); return { kind: "search", verb: "Searching", target: p ? `for ${JSON.stringify(truncate(p, 40))}` : "the card" }; }
    case "edit": return { kind: "write", verb: "Editing", target: describePath(s("path")) };
    case "rewrite": return { kind: "write", verb: "Rewriting", target: describePath(s("path")) };
    case "set": return { kind: "write", verb: "Setting", target: describePath(s("path")) };
    case "list_characters": return { kind: "read", verb: "Listing", target: "characters" };
    case "list_connections": return { kind: "read", verb: "Listing", target: "connections" };
    case "survey_cjk": return { kind: "search", verb: "Surveying", target: "CJK runs across the card" };
    case "audit_card_coverage": { const lang = s("source_lang") ?? "cjk"; return { kind: "search", verb: "Auditing", target: `${lang} coverage` }; }
    case "update_character": return { kind: "write", verb: "Updating", target: `character (${Object.keys((args["patch"] as Record<string, unknown>) ?? {}).join(", ")})` };
    case "update_regex_script": return { kind: "write", verb: "Updating", target: `regex ${shortId(s("script_id") ?? "?")} metadata` };
    case "update_world_book_entry": return { kind: "write", verb: "Updating", target: `world book entry ${shortId(s("entry_id") ?? "?")} metadata` };
    case "create_world_book_entry": return { kind: "create", verb: "Creating", target: `world book entry${s("comment") ? ` '${s("comment")}'` : ""}` };
    case "delete_world_book_entry": return { kind: "delete", verb: "Deleting", target: `world book entry ${shortId(s("entry_id") ?? "?")}` };
    case "create_regex_script": return { kind: "create", verb: "Creating", target: `regex script${s("name") ? ` '${s("name")}'` : ""}` };
    case "delete_regex_script": return { kind: "delete", verb: "Deleting", target: `regex script ${shortId(s("script_id") ?? "?")}` };
    case "create_alternate_greeting": { const i = n("index"); return { kind: "create", verb: "Adding", target: i !== undefined ? `alternate greeting #${i}` : "alternate greeting" }; }
    case "delete_alternate_greeting": { const i = n("index"); return { kind: "delete", verb: "Deleting", target: `alternate greeting #${i ?? "?"}` }; }
    case "apply_glossary": { const e = (args["entries"] as Record<string, unknown>) ?? {}; const dry = args["dry_run"] === true; return { kind: dry ? "search" : "write", verb: dry ? "Dry-running" : "Applying", target: `glossary (${Object.keys(e).length} entries)` }; }
    case "test_regex": return { kind: "test", verb: "Testing", target: "regex pattern" };
    case "count_cjk_chars": return { kind: "read", verb: "Counting", target: "CJK chars" };
    // External provider surfaces (phone-line protocol).
    case "list_external": { const sid = s("surface_id"); return { kind: "read", verb: "Listing", target: sid ? `${humanizeSurfaceId(sid)} items` : "external items" }; }
    case "read_external": return { kind: "read", verb: "Reading", target: describeExternalTarget(s("surface_id"), s("item_id"), s("field")) };
    case "edit_external": return { kind: "write", verb: "Editing", target: describeExternalTarget(s("surface_id"), s("item_id"), s("field")) };
    case "update_external": return { kind: "write", verb: "Updating", target: describeExternalTarget(s("surface_id"), s("item_id"), s("field")) };
    case "grep_external": { const p = s("pattern"); const sid = humanizeSurfaceId(s("surface_id")); return { kind: "search", verb: "Searching", target: p ? `${sid} for ${JSON.stringify(truncate(p, 30))}` : sid }; }
    // Ledger.
    case "list_session_edits": { const sc = s("scope") ?? "current_message"; return { kind: "read", verb: "Listing", target: `edits (${sc.replace(/_/g, " ")})` }; }
    case "revert_session_edits": { const ids = Array.isArray(args["edit_ids"]) ? (args["edit_ids"] as unknown[]).length : 0; return { kind: "write", verb: "Reverting", target: ids === 1 ? "1 edit" : `${ids} edits` }; }
    case "squash_session_edits": return { kind: "write", verb: "Squashing", target: "session edits" };
    case "todo_write": {
      const todos = Array.isArray(args["todos"]) ? args["todos"] as TodoItem[] : [];
      const active = todos.find((t) => t && t.status === "in_progress");
      if (active) return { kind: "write", verb: "Working on", target: active.activeForm };
      return { kind: "write", verb: "Updating", target: `todos (${todos.length})` };
    }
    case "finish": return { kind: "finish", verb: "Marking", target: "task complete" };
    case "custom_tool_run": {
      const named = s("name");
      if (named) return { kind: "read", verb: "Running", target: `recipe '${named}'` };
      const steps = Array.isArray(args["steps"]) ? args["steps"] as Array<{ call?: unknown }> : [];
      const calls = steps.map((st) => typeof st?.call === "string" ? st.call : null).filter((c): c is string => c !== null);
      if (calls.length === 0) return { kind: "read", verb: "Chaining", target: "(empty pipe)" };
      const shown = calls.length <= 4 ? calls.join(" → ") : `${calls.slice(0, 3).join(" → ")} → … (${calls.length} steps)`;
      return { kind: "read", verb: "Chaining", target: shown };
    }
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
  // The caret carries success/error state via color (is-done / is-error
  // classes on the card). Free stays anchored right next to the badge.
  head.append(caret, spinner, activity, sensBadge, freeBtn);
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

function applyToolCardFreed(card: HTMLElement, freed: boolean | undefined): void {
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
  badge.style.display = "none";
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
        deps.onEditingChange?.(msg.id);
        try {
          const result = await enterEditMode(bubble, msg.content);
          if (result === null) return;
          const liveEdits = deps.liveEditsAfterUserMessage?.(msg.id) ?? 0;
          let action: "keep" | "revert" = "keep";
          if (liveEdits > 0 && deps.promptEditsAction) {
            const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "edit" });
            if (choice === "cancel") return;
            action = choice;
          }
          await deps.onEditUserMessage!(msg.id, result, action);
        } finally {
          deps.onEditingChange?.(null);
        }
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
    // Snapshot rendered height BEFORE wiping so the textarea preserves the
    // soft-wrapped line count from the static bubble. Width is owned by CSS:
    // `.is-editing` claims the full 80% lane.
    const renderedHeight = bubble.getBoundingClientRect().height;
    bubble.innerHTML = "";
    bubble.classList.add("is-editing");
    const ta = document.createElement("textarea");
    ta.className = "la-msg-edit-textarea";
    ta.value = current;
    ta.rows = Math.max(2, Math.min(10, current.split("\n").length));
    if (renderedHeight > 0) ta.style.minHeight = `${Math.ceil(renderedHeight)}px`;
    // Grow-only. Resetting height to "auto" before measuring scrollHeight
    // briefly collapses the textarea to its row default for one frame.
    const autoGrow = (): void => {
      if (ta.scrollHeight > ta.clientHeight) {
        ta.style.height = `${ta.scrollHeight}px`;
      }
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
      // is-done / is-error drive the caret color.
      card.classList.remove("is-running");
      card.classList.add(block.is_error ? "is-error" : "is-done");
      const resultPre = card.querySelector(".la-tool-body-result pre") as HTMLElement | null;
      if (resultPre) resultPre.textContent = block.result ?? "";
      applyToolCardFreed(card, block.freed);
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
    const prefix = msg.usage.estimated ? "~" : "";
    const meta = el("div", "la-msg-meta", `${prefix}${msg.usage.total} tokens · turn ${msg.turn}`);
    if (msg.usage.estimated) meta.title = "Provider did not report usage; tokens estimated locally.";
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
    finishTool(callId, result, isError, editIds) {
      const card = toolCardsByCallId.get(callId);
      if (!card) return;
      card.classList.remove("is-running");
      card.classList.add(isError ? "is-error" : "is-done");
      const resultPre = card.querySelector(".la-tool-body-result pre") as HTMLElement | null;
      if (resultPre) resultPre.textContent = result;
      pendingForTools.set(callId, [...editIds]);
      if (editIds.length === 0) return;
      const card2 = ensureEditsCard();
      for (const id of editIds) {
        const entry = editIndex.get(id);
        if (entry) card2.add(entry);
      }
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
      const prefix = usage.estimated ? "~" : "";
      metaLine.textContent = `${prefix}${usage.total} tokens`;
      if (usage.estimated) metaLine.title = "Provider did not report usage; tokens estimated locally.";
    },
  };
}

export function renderMessage(msg: ChatMessage, deps: ChatThreadDeps, allEdits: EditIndex | readonly EditLogEntry[]): HTMLElement {
  if (msg.role === "user") return renderUserMessage(msg, deps);
  return renderStaticAssistant(msg, deps, allEdits);
}
