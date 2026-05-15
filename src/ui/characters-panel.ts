import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { FrontendToBackend, CharacterStorageEntry, ScopeRef } from "../types";
import { characterScope } from "../types";

function entryScope(e: CharacterStorageEntry): ScopeRef {
  return e.scope ?? characterScope(e.characterId);
}

// Workshop Characters tab. Shows per-character edit counts and lets the user
// clear the ledger with one click. Selecting a row asks the backend for that
// character's ledger so the Edits tab swaps over to view it.

export interface CharactersPanelDeps {
  readonly ctx: SpindleFrontendContext;
  sendBackend(msg: FrontendToBackend): void;
  onFocusCharacter(scope: ScopeRef, label: string): void;
}

export interface CharactersPanelHandle {
  readonly root: HTMLElement;
  onPushed(
    entries: readonly CharacterStorageEntry[],
    workspaceUsed: number,
    workspaceCap: number,
  ): void;
  refresh(): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function pctClampedString(used: number, cap: number): string {
  if (cap <= 0) return "—";
  return `${Math.min(100, Math.round((used / cap) * 100))}%`;
}

export function mountCharactersPanel(deps: CharactersPanelDeps): CharactersPanelHandle {
  const root = el("div", "la-chars");

  const toolbar = el("div", "la-chars-toolbar");
  const refreshBtn = el("button", "la-btn la-btn-mini", "Refresh") as HTMLButtonElement;
  const revertAllBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Revert all edits") as HTMLButtonElement;
  revertAllBtn.title = "Revert every live edit across every character. Cascade-aware.";
  const spacer = el("span", "la-flex-spacer");
  const summary = el("div", "la-chars-summary");
  toolbar.append(refreshBtn, revertAllBtn, spacer, summary);
  root.appendChild(toolbar);

  const list = el("div", "la-chars-list");
  root.appendChild(list);

  let lastEntries: readonly CharacterStorageEntry[] = [];

  const refresh = (): void => {
    deps.sendBackend({ type: "list_characters_storage" });
  };

  refreshBtn.addEventListener("click", refresh);

  revertAllBtn.addEventListener("click", async () => {
    const targets = lastEntries.filter((e) => e.liveEditCount > 0);
    if (targets.length === 0) return;
    const total = targets.reduce((acc, e) => acc + e.liveEditCount, 0);
    const c = await deps.ctx.ui.showConfirm({
      title: "Revert every edit",
      message: `Revert ${total} live edit${total === 1 ? "" : "s"} across ${targets.length} character${targets.length === 1 ? "" : "s"}? Cascade-aware. Cannot be undone in one click.`,
      variant: "danger",
      confirmLabel: "Revert all",
    });
    if (!c.confirmed) return;
    revertAllBtn.disabled = true;
    revertAllBtn.textContent = "Reverting...";
    // Single batched message. Fanning out per-character in parallel triggered
    // O(N) concurrent ledger scans + workspace walks on Lumiverse and crashed
    // the host on accounts with many cards.
    deps.sendBackend({ type: "revert_all_characters", characterIds: targets.map((t) => t.characterId), scopes: targets.map(entryScope) });
    revertAllBtn.disabled = false;
    revertAllBtn.textContent = "Revert all edits";
  });

  const renderRow = (entry: CharacterStorageEntry): HTMLElement => {
    const row = el("div", "la-chars-row");
    const main = el("div", "la-chars-main");
    const nameRow = el("div", "la-chars-name");
    nameRow.appendChild(el("span", "la-chars-name-text", entry.characterName));
    nameRow.appendChild(el("span", "la-chars-size", fmtBytes(entry.ledgerBytes)));
    main.append(
      nameRow,
      el(
        "div",
        "la-chars-meta",
        `${entry.liveEditCount}/${entry.editCount} edit${entry.editCount === 1 ? "" : "s"} live`,
      ),
    );
    const actions = el("div", "la-chars-actions");
    const viewBtn = el("button", "la-btn la-btn-mini", "View in workshop") as HTMLButtonElement;
    viewBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deps.onFocusCharacter(entryScope(entry), entry.label ?? entry.characterName);
    });
    const revertBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Revert all") as HTMLButtonElement;
    revertBtn.title = "Revert every live edit on this character. Cascade-aware.";
    revertBtn.disabled = entry.liveEditCount === 0;
    revertBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const c = await deps.ctx.ui.showConfirm({
        title: `Revert all edits: ${entry.characterName}`,
        message: `Revert every live edit on this character (${entry.liveEditCount} edit${entry.liveEditCount === 1 ? "" : "s"})? Cascade-aware. The ledger keeps the history so reverts can be undone individually.`,
        variant: "danger",
        confirmLabel: "Revert all",
      });
      if (!c.confirmed) return;
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting...";
      deps.sendBackend({ type: "revert_character_all", characterId: entry.characterId, scope: entryScope(entry) });
    });
    const squashBtn = el("button", "la-btn la-btn-mini la-btn-danger", "Clear ledger") as HTMLButtonElement;
    squashBtn.title = "Clear the edit ledger for this character. The card itself is NOT touched.";
    squashBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const c = await deps.ctx.ui.showConfirm({
        title: `Clear ledger: ${entry.characterName}`,
        message: `Permanently clear ${entry.editCount} edit log entr${entry.editCount === 1 ? "y" : "ies"} for this character? The card itself is NOT touched. You won't be able to revert any of these edits after this.`,
        variant: "danger",
        confirmLabel: "Clear",
      });
      if (!c.confirmed) return;
      squashBtn.disabled = true;
      squashBtn.textContent = "Clearing...";
      deps.sendBackend({ type: "squash_character", characterId: entry.characterId, scope: entryScope(entry) });
    });
    actions.append(viewBtn, revertBtn, squashBtn);
    row.append(main, actions);
    return row;
  };

  const render = (
    entries: readonly CharacterStorageEntry[],
    workspaceUsed: number,
    workspaceCap: number,
  ): void => {
    lastEntries = entries;
    summary.innerHTML = "";
    summary.append(
      el("span", "la-chars-summary-pill", `Workspace ${fmtBytes(workspaceUsed)} / ${fmtBytes(workspaceCap)} (${pctClampedString(workspaceUsed, workspaceCap)})`),
    );
    list.innerHTML = "";
    if (entries.length === 0) {
      list.appendChild(el("div", "la-chars-empty", "No characters with edits yet."));
      return;
    }
    for (const entry of entries) list.appendChild(renderRow(entry));
  };

  render([], 0, 1);
  refresh();

  return {
    root,
    onPushed(entries, workspaceUsed, workspaceCap) {
      render(entries, workspaceUsed, workspaceCap);
    },
    refresh() {
      if (lastEntries.length === 0) refresh();
      else refresh();
    },
  };
}
