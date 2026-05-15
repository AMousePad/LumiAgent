import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import type { EditLogEntry, EditSurface } from "../types";
import { fileKeyOf } from "../types";
import { renderInlineFieldDiff, renderSideBySideDiff, renderUnifiedDiff, computeDiffStats, isShortField } from "./diff";

const SURFACE_LABELS: Record<EditSurface, string> = {
  character_field: "Character",
  alternate_greeting: "Alternate greetings",
  world_book_entry: "World book",
  regex_script: "Regex scripts",
  extension: "Extensions",
  persona_field: "Personas",
  chat_message: "Chat messages",
  external: "External (other extensions)",
};

const SURFACE_ORDER: EditSurface[] = ["character_field", "alternate_greeting", "world_book_entry", "regex_script", "extension", "persona_field", "chat_message", "external"];

const MOBILE_BREAKPOINT_PX = 720;
const DESKTOP_WIDTH_CAP = 1700;
const DESKTOP_WIDTH_MIN = 720;
const DESKTOP_MARGIN_PX = 80;
const DESKTOP_HEIGHT_CAP = 1400;
const DESKTOP_HEIGHT_MIN = 480;

function computeModalWidth(): number {
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1180;
  return Math.max(DESKTOP_WIDTH_MIN, Math.min(DESKTOP_WIDTH_CAP, vw - DESKTOP_MARGIN_PX));
}

function computeModalMaxHeight(): number {
  const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 880;
  return Math.max(DESKTOP_HEIGHT_MIN, Math.min(DESKTOP_HEIGHT_CAP, vh - DESKTOP_MARGIN_PX));
}

export interface DiffModalDeps {
  getEdits(): readonly EditLogEntry[];
  onRevert(editId: string): Promise<void>;
  onClose?(): void;
  // Optional: when supplied, a "Files" tab is shown alongside "Edits" and
  // mounts this panel root. The drawer owns the panel's wiring.
  filesPanel?: HTMLElement;
  // Optional: when supplied, a "Characters" tab is shown for per-character
  // storage management and switching the Edits view.
  charactersPanel?: HTMLElement;
  // Optional: fired whenever the Characters tab is activated so the drawer
  // can re-fetch fresh per-character data.
  onCharactersTabActivated?: () => void;
  // Optional: a short label describing whose edits are being shown. Surfaces
  // in the stats line and empty state. Lets the modal distinguish a
  // no-character session from a character with zero edits.
  getScopeLabel?(): string | null;
}

export interface DiffModalHandle {
  setEdits(edits: readonly EditLogEntry[]): void;
  focusEdit(editId: string): void;
  focusTab(tab: "edits" | "files" | "characters"): void;
  close(): void;
  isOpen(): boolean;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function groupBySurface(edits: readonly EditLogEntry[]): Map<EditSurface, EditLogEntry[]> {
  const out = new Map<EditSurface, EditLogEntry[]>();
  for (const e of edits) {
    const r = e.record;
    const surface: EditSurface = r.surface;
    if (!out.has(surface)) out.set(surface, []);
    out.get(surface)!.push(e);
  }
  return out;
}

function describeRecord(entry: EditLogEntry): { primary: string; secondary: string; statSummary: string } {
  const r = entry.record;
  if (r.op === "create") {
    return {
      primary: `+ ${r.surfaceLabel}`,
      secondary: `created (${r.surface})`,
      statSummary: "created",
    };
  }
  if (r.op === "delete") {
    return {
      primary: `× ${r.surfaceLabel}`,
      secondary: `deleted (${r.surface})`,
      statSummary: "deleted",
    };
  }
  const stats = computeDiffStats(r.before, r.after);
  const stat = `+${stats.added} -${stats.removed}`;
  return {
    primary: r.surfaceLabel,
    secondary: r.field,
    statSummary: stat,
  };
}

export function openDiffModal(ctx: SpindleFrontendContext, deps: DiffModalDeps, opts?: { initialEditId?: string | undefined }): DiffModalHandle {
  const modal: SpindleModalHandle = ctx.ui.showModal({
    title: "Workshop",
    width: computeModalWidth(),
    maxHeight: computeModalMaxHeight(),
  });
  const root = modal.root;
  root.classList.add("la-diff-modal-root");
  let open = true;
  const handleClose = (): void => {
    if (!open) return;
    open = false;
    try { modal.dismiss(); } catch { /* already dismissed */ }
    deps.onClose?.();
  };
  modal.onDismiss(() => {
    if (!open) return;
    open = false;
    deps.onClose?.();
  });

  // Top-level tabs.
  let activeTab: "edits" | "files" | "characters" = "edits";
  const tabs = el("div", "la-workshop-tabs");
  const editsTabBtn = el("button", "la-workshop-tab is-active", "Edits") as HTMLButtonElement;
  const filesTabBtn = el("button", "la-workshop-tab", "Files") as HTMLButtonElement;
  const charsTabBtn = el("button", "la-workshop-tab", "Characters") as HTMLButtonElement;
  tabs.append(editsTabBtn, filesTabBtn, charsTabBtn);
  if (!deps.filesPanel) filesTabBtn.style.display = "none";
  if (!deps.charactersPanel) charsTabBtn.style.display = "none";

  const toolbar = el("div", "la-diff-modal-toolbar");
  const stats = el("div", "la-diff-modal-stats");
  const spacer = el("div", "la-flex-spacer");
  const viewToggle = el("div", "la-diff-view-toggle");
  const byTimeBtn = el("button", "la-diff-view-tab is-active", "By time") as HTMLButtonElement;
  const byFileBtn = el("button", "la-diff-view-tab", "By file") as HTMLButtonElement;
  viewToggle.append(byTimeBtn, byFileBtn);
  toolbar.append(stats, spacer, viewToggle);

  let viewMode: "time" | "file" = "time";
  byTimeBtn.addEventListener("click", () => {
    if (viewMode === "time") return;
    viewMode = "time";
    byTimeBtn.classList.add("is-active"); byFileBtn.classList.remove("is-active");
    refresh();
  });
  byFileBtn.addEventListener("click", () => {
    if (viewMode === "file") return;
    viewMode = "file";
    byFileBtn.classList.add("is-active"); byTimeBtn.classList.remove("is-active");
    refresh();
  });

  const body = el("div", "la-diff-modal-body");
  const tree = el("aside", "la-diff-modal-tree");
  const pane = el("section", "la-diff-modal-pane");
  body.append(tree, pane);

  const editsView = el("div", "la-workshop-view la-workshop-view-edits is-active");
  editsView.append(toolbar, body);
  const filesView = el("div", "la-workshop-view la-workshop-view-files");
  if (deps.filesPanel) filesView.appendChild(deps.filesPanel);
  const charsView = el("div", "la-workshop-view la-workshop-view-chars");
  if (deps.charactersPanel) charsView.appendChild(deps.charactersPanel);

  const switchTab = (next: "edits" | "files" | "characters"): void => {
    if (activeTab === next) return;
    activeTab = next;
    editsTabBtn.classList.toggle("is-active", next === "edits");
    filesTabBtn.classList.toggle("is-active", next === "files");
    charsTabBtn.classList.toggle("is-active", next === "characters");
    editsView.classList.toggle("is-active", next === "edits");
    filesView.classList.toggle("is-active", next === "files");
    charsView.classList.toggle("is-active", next === "characters");
    if (next === "characters") deps.onCharactersTabActivated?.();
  };
  editsTabBtn.addEventListener("click", () => switchTab("edits"));
  filesTabBtn.addEventListener("click", () => { if (deps.filesPanel) switchTab("files"); });
  charsTabBtn.addEventListener("click", () => { if (deps.charactersPanel) switchTab("characters"); });

  root.append(tabs, editsView, filesView, charsView);

  let currentEditId: string | null = opts?.initialEditId ?? null;
  let edits: readonly EditLogEntry[] = deps.getEdits();

  const refresh = (): void => {
    const liveCount = edits.filter((e) => !e.reverted).length;
    const scope = deps.getScopeLabel?.();
    stats.textContent = `${liveCount} live / ${edits.length} total${scope ? ` · ${scope}` : ""}`;
    renderTree();
    renderPane();
  };

  const renderTree = (): void => {
    tree.innerHTML = "";
    if (edits.length === 0) {
      tree.appendChild(el("div", "la-diff-tree-empty", "No edits yet."));
      return;
    }
    if (viewMode === "time") renderTreeByTime();
    else renderTreeByFile();
  };

  const renderTreeByTime = (): void => {
    const grouped = groupBySurface(edits);
    for (const surf of SURFACE_ORDER) {
      const group = grouped.get(surf);
      if (!group || group.length === 0) continue;
      const section = el("div", "la-diff-tree-section");
      const sectionHead = el("div", "la-diff-tree-section-head");
      sectionHead.textContent = `${SURFACE_LABELS[surf]}  (${group.length})`;
      section.appendChild(sectionHead);
      for (const entry of group) appendEntryRow(section, entry);
      tree.appendChild(section);
    }
  };

  const renderTreeByFile = (): void => {
    const byFile = new Map<string, EditLogEntry[]>();
    for (const e of edits) {
      const k = fileKeyOf(e);
      if (!byFile.has(k)) byFile.set(k, []);
      byFile.get(k)!.push(e);
    }
    const fileList = [...byFile.entries()].map(([k, entries]) => {
      entries.sort((a, b) => a.ts - b.ts);
      return { fileKey: k, entries };
    });
    fileList.sort((a, b) => {
      const aLive = a.entries.filter((e) => !e.reverted).length;
      const bLive = b.entries.filter((e) => !e.reverted).length;
      if (aLive !== bLive) return bLive - aLive;
      return b.entries[b.entries.length - 1]!.ts - a.entries[a.entries.length - 1]!.ts;
    });
    for (const f of fileList) {
      const section = el("div", "la-diff-tree-section");
      const sectionHead = el("div", "la-diff-tree-section-head");
      const first = f.entries[0]!;
      const r = first.record;
      const surface = SURFACE_LABELS[r.surface] ?? r.surface;
      const surfaceLabel = "surfaceLabel" in r ? r.surfaceLabel : "";
      const field = r.op === "edit" ? r.field : "";
      const live = f.entries.filter((e) => !e.reverted).length;
      sectionHead.textContent = `${surface}: ${surfaceLabel}${field ? " · " + field : ""}  (${live}/${f.entries.length})`;
      section.appendChild(sectionHead);
      for (const entry of f.entries) appendEntryRow(section, entry);
      tree.appendChild(section);
    }
  };

  const appendEntryRow = (section: HTMLElement, entry: EditLogEntry): void => {
    const row = el("button", `la-diff-tree-row ${entry.id === currentEditId ? "is-active" : ""} ${entry.reverted ? "is-reverted" : ""}`);
    const desc = describeRecord(entry);
    const primary = el("div", "la-diff-tree-primary");
    primary.textContent = desc.primary;
    const secondary = el("div", "la-diff-tree-secondary");
    secondary.textContent = `${desc.secondary} · ${desc.statSummary} · turn ${entry.turn}${entry.reverted ? " · reverted" : ""}`;
    row.append(primary, secondary);
    row.addEventListener("click", () => {
      currentEditId = entry.id;
      refresh();
    });
    section.appendChild(row);
  };

  const renderPane = (): void => {
    pane.innerHTML = "";
    if (edits.length === 0) {
      const scope = deps.getScopeLabel?.();
      const msg = scope
        ? `Nothing changed in this session yet. (${scope})`
        : "Nothing changed in this session yet.";
      pane.appendChild(el("div", "la-diff-pane-empty", msg));
      return;
    }
    const target = currentEditId ? edits.find((e) => e.id === currentEditId) : edits[0];
    if (!target) {
      pane.appendChild(el("div", "la-diff-pane-empty", "Select an edit on the left."));
      return;
    }
    currentEditId = target.id;
    const r = target.record;

    const toolbar = el("div", "la-diff-pane-toolbar");
    const heading = el("div", "la-diff-pane-heading");
    const desc = describeRecord(target);
    heading.appendChild(el("strong", undefined, desc.primary));
    heading.appendChild(el("span", "la-diff-pane-sub", ` · ${desc.secondary}`));
    const meta = el("div", "la-diff-pane-meta", `Turn ${target.turn} · ${desc.statSummary} · tool ${target.toolName} · ${new Date(target.ts).toLocaleString()}`);

    const actions = el("div", "la-diff-pane-actions");
    const revertBtn = el("button", `la-btn ${target.reverted ? "la-btn-disabled" : "la-btn-danger"}`, target.reverted ? "Reverted" : "Revert this edit") as HTMLButtonElement;
    revertBtn.disabled = target.reverted;
    revertBtn.addEventListener("click", async () => {
      if (target.reverted) return;
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting…";
      try {
        await deps.onRevert(target.id);
      } finally {
        // Caller refreshes edits via setEdits().
      }
    });
    actions.appendChild(revertBtn);

    toolbar.appendChild(heading);
    toolbar.appendChild(meta);
    toolbar.appendChild(actions);
    pane.appendChild(toolbar);

    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    if (r.op === "create") {
      const snap = r.snapshot;
      const wrap = el("div", "la-diff-pane-body");
      wrap.appendChild(el("div", "la-diff-pane-note", "Created — full content of the new entry is below."));
      const full = "world_book_id" in snap || "find_regex" in snap ? JSON.stringify(snap, null, 2) : (snap as { greeting: string }).greeting;
      wrap.appendChild(renderSideBySideDiff("", full));
      pane.appendChild(wrap);
      return;
    }
    if (r.op === "delete") {
      const snap = r.snapshot;
      const wrap = el("div", "la-diff-pane-body");
      wrap.appendChild(el("div", "la-diff-pane-note", "Deleted — content shown was removed; revert restores it."));
      const full = "world_book_id" in snap || "find_regex" in snap ? JSON.stringify(snap, null, 2) : (snap as { greeting: string }).greeting;
      wrap.appendChild(renderSideBySideDiff(full, ""));
      pane.appendChild(wrap);
      return;
    }

    const wrap = el("div", "la-diff-pane-body");
    if (isShortField(r.before, r.after) && !isMobile) {
      wrap.appendChild(renderInlineFieldDiff(r.before, r.after));
    } else if (isMobile) {
      wrap.appendChild(renderUnifiedDiff(r.before, r.after, 3));
    } else {
      wrap.appendChild(renderSideBySideDiff(r.before, r.after));
    }
    pane.appendChild(wrap);
  };

  refresh();

  return {
    setEdits(next) { if (!open) return; edits = next; refresh(); },
    focusEdit(editId) { if (!open) return; currentEditId = editId; refresh(); },
    focusTab(tab) { if (!open) return; switchTab(tab); },
    isOpen() { return open; },
    close() { handleClose(); },
  };
}
