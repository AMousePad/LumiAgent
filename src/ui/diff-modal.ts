import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import type { EditLogEntry, EditSurface, ScopeRef } from "../types";
import { fileKeyOf, scopeKeyString } from "../types";
import { mountCombo } from "./combo";
import { renderInlineFieldDiff, renderSideBySideDiff, renderUnifiedDiff, computeDiffStats, isShortField } from "./diff";

const SURFACE_LABELS: Record<EditSurface, string> = {
  character_field: "Character",
  alternate_greeting: "Alternate greetings",
  world_book_entry: "World book",
  regex_script: "Regex scripts",
  extension: "Extensions",
  persona_field: "Personas",
  chat_message: "Chat messages",
  preset_block: "Preset blocks",
  persona: "Personas",
  external: "External (other extensions)",
};

const SURFACE_ORDER: EditSurface[] = ["character_field", "alternate_greeting", "world_book_entry", "regex_script", "extension", "persona_field", "chat_message", "preset_block", "persona", "external"];

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

// A selectable ledger scope (one character / persona / chat / preset).
export interface ScopeOption {
  readonly scope: ScopeRef;
  readonly label: string;
  readonly liveCount: number;
  readonly totalCount: number;
}

type WorkshopTab = "characters" | "lumiverse" | "files";

function isLumiverseKind(k: ScopeRef["kind"]): boolean {
  return k !== "character";
}

export interface DiffModalDeps {
  getEdits(): readonly EditLogEntry[];
  getScopes(): readonly ScopeOption[];
  getSelectedScope(): ScopeRef | null;
  onSelectScope(scope: ScopeRef): void;
  onRevert(editId: string): Promise<void>;
  onRevertAll(scope: ScopeRef): void;
  onForget(scope: ScopeRef): void;
  // Called when the modal needs a fresh scope list (open / tab switch).
  onScopesNeeded?(): void;
  onClose?(): void;
  filesPanel?: HTMLElement;
}

export interface DiffModalHandle {
  setEdits(edits: readonly EditLogEntry[]): void;
  setScopes(scopes: readonly ScopeOption[]): void;
  focusEdit(editId: string): void;
  focusTab(tab: WorkshopTab): void;
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
  // Category (the surface type) leads; the specific name follows in parens.
  const cat = SURFACE_LABELS[r.surface] ?? r.surface;
  const named = r.surfaceLabel ? `${cat} (${r.surfaceLabel})` : cat;
  if (r.op === "create") {
    return { primary: `+ ${named}`, secondary: "created", statSummary: "created" };
  }
  if (r.op === "delete") {
    return { primary: `× ${named}`, secondary: "deleted", statSummary: "deleted" };
  }
  const stats = computeDiffStats(r.before, r.after);
  const stat = `+${stats.added} -${stats.removed}`;
  return {
    primary: named,
    secondary: r.field,
    statSummary: stat,
  };
}

export function openDiffModal(ctx: SpindleFrontendContext, deps: DiffModalDeps, opts?: { initialEditId?: string | undefined; initialTab?: WorkshopTab | undefined }): DiffModalHandle {
  const maxH = computeModalMaxHeight();
  const modal: SpindleModalHandle = ctx.ui.showModal({
    title: "Workshop",
    width: computeModalWidth(),
    maxHeight: maxH,
  });
  const root = modal.root;
  root.classList.add("la-diff-modal-root");
  // showModal sizes to content (up to maxHeight); pin the body so the modal
  // is always full-size even with no edits, instead of shrinking to a strip.
  // Fixed height + clipped: the modal is always full-size (even empty) and
  // the host never scrolls the whole body, so the change list and the diff
  // pane scroll independently within it.
  root.style.height = `${maxH}px`;
  root.style.overflow = "hidden";
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

  let activeTab: WorkshopTab = opts?.initialTab ?? "characters";
  let scopes: readonly ScopeOption[] = deps.getScopes();
  // Remembered combo selection per scope tab so switching back restores it.
  const remembered: { characters: string | null; lumiverse: string | null } = { characters: null, lumiverse: null };

  // ── Tabs ──
  const tabs = el("div", "la-workshop-tabs");
  const charsTabBtn = el("button", "la-workshop-tab is-active", "Characters") as HTMLButtonElement;
  const lumiTabBtn = el("button", "la-workshop-tab", "Lumiverse") as HTMLButtonElement;
  const filesTabBtn = el("button", "la-workshop-tab", "Files") as HTMLButtonElement;
  tabs.append(charsTabBtn, lumiTabBtn, filesTabBtn);
  if (!deps.filesPanel) filesTabBtn.style.display = "none";

  // ── Toolbar: [combo] · N live / N total ........ [by time|by file] [Revert all] [Forget changes] ──
  const toolbar = el("div", "la-diff-modal-toolbar");
  const selectGroup = el("div", "la-diff-toolbar-select");
  const comboRoot = el("div", "la-diff-scope-combo");
  const combo = mountCombo(comboRoot);
  combo.setPlaceholder("No scopes");
  const stats = el("span", "la-diff-modal-stats");
  selectGroup.append(comboRoot, stats);

  const actions = el("div", "la-diff-modal-toolbar-actions");
  const viewToggle = el("div", "la-diff-view-toggle");
  const byTimeBtn = el("button", "la-diff-view-tab is-active", "By time") as HTMLButtonElement;
  const byFileBtn = el("button", "la-diff-view-tab", "By file") as HTMLButtonElement;
  viewToggle.append(byTimeBtn, byFileBtn);
  const revertAllBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Revert all") as HTMLButtonElement;
  revertAllBtn.title = "Revert every live edit in the selected scope. Cascade-aware.";
  const forgetBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Forget changes") as HTMLButtonElement;
  forgetBtn.title = "Clear the edit ledger for the selected scope. The underlying data is NOT touched.";
  actions.append(viewToggle, revertAllBtn, forgetBtn);
  toolbar.append(selectGroup, actions);

  let viewMode: "time" | "file" = "time";
  byTimeBtn.addEventListener("click", () => {
    if (viewMode === "time") return;
    viewMode = "time";
    byTimeBtn.classList.add("is-active"); byFileBtn.classList.remove("is-active");
    renderTree();
  });
  byFileBtn.addEventListener("click", () => {
    if (viewMode === "file") return;
    viewMode = "file";
    byFileBtn.classList.add("is-active"); byTimeBtn.classList.remove("is-active");
    renderTree();
  });

  const selectedOption = (): ScopeOption | null => {
    const id = combo.getValue();
    if (!id) return null;
    return scopes.find((s) => scopeKeyString(s.scope) === id) ?? null;
  };

  revertAllBtn.addEventListener("click", () => {
    const o = selectedOption();
    if (o && o.liveCount > 0) deps.onRevertAll(o.scope);
  });
  forgetBtn.addEventListener("click", () => {
    const o = selectedOption();
    if (o && o.totalCount > 0) deps.onForget(o.scope);
  });

  combo.onChange((id) => {
    remembered[activeTab === "lumiverse" ? "lumiverse" : "characters"] = id;
    selectAndLoad();
  });

  // ── Body ──
  const body = el("div", "la-diff-modal-body");
  const tree = el("aside", "la-diff-modal-tree");
  const pane = el("section", "la-diff-modal-pane");
  body.append(tree, pane);

  const editsView = el("div", "la-workshop-view la-workshop-view-edits is-active");
  editsView.append(toolbar, body);
  const filesView = el("div", "la-workshop-view la-workshop-view-files");
  if (deps.filesPanel) filesView.appendChild(deps.filesPanel);

  root.append(tabs, editsView, filesView);

  // Apply the initial active tab (may be Lumiverse for a no-character chat).
  charsTabBtn.classList.toggle("is-active", activeTab === "characters");
  lumiTabBtn.classList.toggle("is-active", activeTab === "lumiverse");
  filesTabBtn.classList.toggle("is-active", activeTab === "files");
  editsView.classList.toggle("is-active", activeTab !== "files");
  filesView.classList.toggle("is-active", activeTab === "files");

  let currentEditId: string | null = opts?.initialEditId ?? null;
  let edits: readonly EditLogEntry[] = deps.getEdits();
  // True between asking the drawer to load a scope and its setEdits arriving.
  // Keeps the pane from flashing a previous scope's edits or a false "no
  // edits" while the ledger round-trips.
  let loading = false;
  // Scope key we last asked the drawer to load. Lets setScopes tell an
  // initial async population (load the now-available scope) apart from a
  // background refresh of an already-loaded scope (leave the view alone).
  let requestedKey: string | null = null;

  // Repopulate the combo for the active scope tab and sync the selection.
  const syncCombo = (): void => {
    const wantLumi = activeTab === "lumiverse";
    const opts2 = scopes.filter((s) => isLumiverseKind(s.scope.kind) === wantLumi);
    combo.setItems(opts2.map((s) => ({
      id: scopeKeyString(s.scope),
      label: s.label,
      sublabel: `${s.liveCount} live / ${s.totalCount} total`,
    })));
    const tabKey = wantLumi ? "lumiverse" : "characters";
    let want = remembered[tabKey];
    if (!want || !opts2.some((s) => scopeKeyString(s.scope) === want)) {
      const sel = deps.getSelectedScope();
      const selKey = sel ? scopeKeyString(sel) : null;
      want = selKey && opts2.some((s) => scopeKeyString(s.scope) === selKey)
        ? selKey
        : (opts2[0] ? scopeKeyString(opts2[0].scope) : null);
    }
    remembered[tabKey] = want;
    // Silent: don't fire a reload just for repopulating; only an explicit
    // user pick or a tab switch to an unloaded scope loads edits.
    combo.setValue(want, true);
  };

  // Establish the active tab's scope and load its edits. Clears the pane
  // immediately so a previous scope's edits never linger while the new
  // ledger round-trips. Used by open, tab switch, and combo pick.
  const selectAndLoad = (): void => {
    const o = selectedOption();
    const scope = o ? o.scope : (activeTab === "characters" ? deps.getSelectedScope() : null);
    edits = [];
    requestedKey = scope ? scopeKeyString(scope) : null;
    if (scope) {
      loading = true;
      deps.onSelectScope(scope);
    } else {
      loading = false;
    }
    refresh();
  };

  const refresh = (): void => {
    const liveCount = edits.filter((e) => !e.reverted).length;
    stats.textContent = `· ${liveCount} live / ${edits.length} total`;
    const o = selectedOption();
    revertAllBtn.disabled = !o || o.liveCount === 0;
    forgetBtn.disabled = !o || o.totalCount === 0;
    renderTree();
    renderPane();
  };

  const renderTree = (): void => {
    tree.innerHTML = "";
    if (edits.length === 0) {
      tree.appendChild(el("div", "la-diff-tree-empty", loading ? "Loading…" : "No edits yet."));
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
      if (loading) {
        pane.appendChild(el("div", "la-diff-pane-empty", "Loading…"));
        return;
      }
      const o = selectedOption();
      const noun = activeTab === "lumiverse" ? "Lumiverse" : "character";
      const msg = o
        ? `Nothing changed in ${o.label} yet.`
        : `No ${noun} edits yet.`;
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

    const paneToolbar = el("div", "la-diff-pane-toolbar");
    const heading = el("div", "la-diff-pane-heading");
    const desc = describeRecord(target);
    heading.appendChild(el("strong", undefined, desc.primary));
    heading.appendChild(el("span", "la-diff-pane-sub", ` · ${desc.secondary}`));
    const meta = el("div", "la-diff-pane-meta", `Turn ${target.turn} · ${desc.statSummary} · tool ${target.toolName} · ${new Date(target.ts).toLocaleString()}`);

    const paneActions = el("div", "la-diff-pane-actions");
    const revertBtn = el("button", `la-btn ${target.reverted ? "la-btn-disabled" : "la-btn-danger"}`, target.reverted ? "Reverted" : "Revert this edit") as HTMLButtonElement;
    revertBtn.disabled = target.reverted;
    revertBtn.addEventListener("click", async () => {
      if (target.reverted) return;
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting…";
      await deps.onRevert(target.id);
      // Caller refreshes edits via setEdits().
    });
    paneActions.appendChild(revertBtn);

    paneToolbar.appendChild(heading);
    paneToolbar.appendChild(meta);
    paneToolbar.appendChild(paneActions);
    pane.appendChild(paneToolbar);

    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    if (r.op === "create") {
      const snap = r.snapshot;
      const wrap = el("div", "la-diff-pane-body");
      wrap.appendChild(el("div", "la-diff-pane-note", "Created — full content of the new entry is below."));
      const full = typeof (snap as { greeting?: unknown }).greeting === "string" ? (snap as { greeting: string }).greeting : JSON.stringify(snap, null, 2);
      wrap.appendChild(renderSideBySideDiff("", full));
      pane.appendChild(wrap);
      return;
    }
    if (r.op === "delete") {
      const snap = r.snapshot;
      const wrap = el("div", "la-diff-pane-body");
      wrap.appendChild(el("div", "la-diff-pane-note", "Deleted — content shown was removed; revert restores it."));
      const full = typeof (snap as { greeting?: unknown }).greeting === "string" ? (snap as { greeting: string }).greeting : JSON.stringify(snap, null, 2);
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

  const switchTab = (next: WorkshopTab): void => {
    if (activeTab === next) return;
    const prev = activeTab;
    activeTab = next;
    charsTabBtn.classList.toggle("is-active", next === "characters");
    lumiTabBtn.classList.toggle("is-active", next === "lumiverse");
    filesTabBtn.classList.toggle("is-active", next === "files");
    editsView.classList.toggle("is-active", next !== "files");
    filesView.classList.toggle("is-active", next === "files");
    if (next === "files") return;
    deps.onScopesNeeded?.();
    // Moving between scope tabs: repoint the combo and load that tab's
    // scope. selectAndLoad clears the pane so the other tab's edits don't
    // linger (and shows a proper empty state when the tab has no scopes).
    if (prev !== next) {
      syncCombo();
      selectAndLoad();
    }
  };
  charsTabBtn.addEventListener("click", () => switchTab("characters"));
  lumiTabBtn.addEventListener("click", () => switchTab("lumiverse"));
  filesTabBtn.addEventListener("click", () => { if (deps.filesPanel) switchTab("files"); });

  deps.onScopesNeeded?.();
  syncCombo();
  selectAndLoad();

  return {
    setEdits(next) { if (!open) return; loading = false; edits = next; refresh(); },
    setScopes(next) {
      if (!open) return;
      scopes = next;
      syncCombo();
      // First population (or any change to a scope we haven't loaded, e.g.
      // a no-character open where scopes arrive after the modal mounts):
      // load it. A background refresh of the already-loaded scope is a
      // no-op here, so the current view isn't yanked.
      const o = selectedOption();
      if (o && scopeKeyString(o.scope) !== requestedKey) selectAndLoad();
      else refresh();
    },
    focusEdit(editId) { if (!open) return; currentEditId = editId; refresh(); },
    focusTab(tab) { if (!open) return; switchTab(tab); },
    isOpen() { return open; },
    close() { handleClose(); },
  };
}
