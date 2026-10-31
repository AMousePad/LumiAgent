import { createUuid } from "./uuid";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { BackendToFrontend, FrontendToBackend, WorkspaceEntry } from "../types";
import type { WorkspaceAction, WorkspaceResult } from "../workspace-contract";

export interface WorkspacePanelDeps {
  readonly ctx: SpindleFrontendContext;
  sendBackend(msg: FrontendToBackend): void;
  upload(file: File, path: string, onProgress: (fraction: number) => void): Promise<void>;
}
export interface WorkspacePanelHandle {
  readonly root: HTMLElement;
  receive(message: BackendToFrontend): void;
  onChanged(): void;
  onError(error: string): void;
  focusFile(path: string): void;
  destroy(): void;
}
const node = (tag: string, cls = "", text = "") => {
  const element = document.createElement(tag); element.className = cls; element.textContent = text; return element;
};
const parentPath = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const fileName = (path: string) => path.split("/").at(-1) ?? path;
const join = (path: string, name: string) => path ? `${path}/${name}` : name;
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const mime = (path: string) => ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", opus: "audio/opus", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" } as Record<string, string>)[path.split(".").at(-1)?.toLowerCase() ?? ""];

export function mountWorkspacePanel(deps: WorkspacePanelDeps): WorkspacePanelHandle {
  const root = node("div", "la-files");
  const toolbar = node("div", "la-files-toolbar");
  const breadcrumbs = node("nav", "la-files-breadcrumbs"); breadcrumbs.setAttribute("aria-label", "Folder location");
  const actions = node("div", "la-files-actions");
  const status = node("div", "la-files-status"); status.setAttribute("role", "status");
  const split = node("div", "la-files-split");
  const list = node("div", "la-files-list"); list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Files"); list.tabIndex = 0;
  const pane = node("section", "la-files-preview");
  split.append(list, pane); root.append(toolbar, breadcrumbs, actions, status, split);
  let directory = "";
  let entries: readonly WorkspaceEntry[] = [];
  let selected: WorkspaceEntry | null = null;
  let clipboard: { path: string; mode: "copy" | "move" } | null = null;
  let dirty = false, saving = false, busy = false, destroyed = false, refreshQueued = false;
  let listing = 0, preview = 0;
  const pending = new Map<string, { resolve(value: WorkspaceResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const request = (input: WorkspaceAction): Promise<WorkspaceResult> => new Promise((resolve, reject) => {
    const requestId = createUuid();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("The server has not responded. Refresh to check the latest state.")); }, input.action === "download" ? 120000 : 30000);
    pending.set(requestId, { resolve, reject, timer });
    try { deps.sendBackend({ type: "workspace_request", requestId, input }); }
    catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
  });
  const report = (text: string, error = false) => { status.textContent = text; status.classList.toggle("is-error", error); };
  const loading = (target: HTMLElement, label: string) => {
    const state = node("div", "la-files-loading"); state.setAttribute("role", "status");
    const spinner = node("span", "la-pending-spinner"); spinner.setAttribute("aria-hidden", "true");
    state.append(spinner, node("span", "", label)); target.replaceChildren(state);
  };
  const button = (text: string, action: () => void, disabled = false) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "la-btn la-btn-mini"; b.textContent = text; b.disabled = disabled; b.onclick = action; return b;
  };
  const discardDraft = async () => !dirty || (await deps.ctx.ui.showConfirm({ title: "Discard changes?", message: "This file has unsaved changes.", confirmLabel: "Discard", variant: "danger" })).confirmed;
  const nameDialog = (title: string, initial = ""): Promise<string | null> => new Promise(resolve => {
    const dialog = document.createElement("dialog"); dialog.className = "la-file-name-dialog";
    const form = document.createElement("form"); form.method = "dialog";
    const label = document.createElement("label"); label.textContent = title;
    const input = document.createElement("input"); input.value = initial; input.required = true; input.setAttribute("aria-label", title);
    const error = node("span", "la-files-status is-error"); label.append(input);
    const controls = node("div", "la-files-actions"); const cancel = button("Cancel", () => dialog.close()); const save = button("Save", () => {}); save.type = "submit";
    controls.append(cancel, save); form.append(label, error, controls); dialog.append(form); root.append(dialog);
    let value: string | null = null;
    form.onsubmit = event => {
      const text = input.value.trim();
      if (!text || text === "." || text === ".." || /[\\/\x00]/.test(text)) { event.preventDefault(); error.textContent = "Enter a name without slashes."; return; }
      value = text;
    };
    dialog.addEventListener("close", () => { dialog.remove(); resolve(value); }, { once: true }); dialog.showModal(); input.focus(); input.select();
  });
  const renderBreadcrumbs = () => {
    breadcrumbs.replaceChildren(button("Files", () => void navigate("")));
    let path = "";
    for (const segment of directory.split("/").filter(Boolean)) { path = join(path, segment); const target = path; breadcrumbs.append(node("span", "", "/"), button(segment, () => void navigate(target))); }
    breadcrumbs.lastElementChild?.setAttribute("aria-current", "location");
  };
  const setClipboard = (mode: "copy" | "move") => {
    if (!selected || (mode === "move" && selected.isSystem) || busy) return;
    clipboard = { path: selected.path, mode }; report(`${mode === "copy" ? "Copied" : "Cut"} ${selected.name}`); renderActions(); renderRows();
  };
  const transfer = async (from: string, destination: string, mode: "copy" | "move") => {
    if (busy || !(await discardDraft())) return;
    let to = join(destination, fileName(from));
    if (mode === "copy" && to.toLowerCase() === from.toLowerCase()) {
      const original = fileName(from), dot = original.lastIndexOf(".");
      const suggestion = dot > 0 ? `${original.slice(0, dot)} copy${original.slice(dot)}` : `${original} copy`;
      const name = await nameDialog("Copy as", suggestion); if (!name) return; to = join(destination, name);
    }
    if (to.toLowerCase() === from.toLowerCase() || to.toLowerCase().startsWith(`${from.toLowerCase()}/`)) { report("Choose a different destination folder.", true); return; }
    await mutate({ action: mode, from, to }, mode === "copy" ? "Copying…" : "Moving…");
  };
  const paste = () => { if (clipboard) void transfer(clipboard.path, selected?.isDirectory ? selected.path : directory, clipboard.mode); };
  const download = async (path: string, archive: boolean) => {
    if (busy) return; busy = true; renderActions(); loading(status, "Preparing download…");
    try { const result = await request({ action: "download", path, archive }); if (result.kind === "file") { deps.ctx.files.download(result.fileId); report(""); } }
    catch (error) { report((error as Error).message, true); }
    finally { busy = false; renderActions(); }
  };
  const renderActions = () => {
    toolbar.replaceChildren(button("Upload", () => uploadInput.click(), busy), button("New folder", () => void create(true), busy), button("New file", () => void create(false), busy), button("Refresh", () => void refresh(), busy));
    actions.replaceChildren();
    if (selected) {
      if (selected.isDirectory) actions.append(button("Open", () => void navigate(selected!.path), busy));
      actions.append(button("Cut", () => setClipboard("move"), busy || !!selected.isSystem), button("Copy", () => setClipboard("copy"), busy), button("Rename", () => void rename(), busy || !!selected.isSystem), button("Delete", () => void remove(), busy || !!selected.isSystem));
    }
    actions.append(button("Paste", paste, busy || !clipboard), button(selected && !selected.isDirectory ? "Download" : "Download ZIP", () => void download(selected?.path ?? directory, selected?.isDirectory ?? true), busy));
  };
  const wireDrop = (target: HTMLElement, destination: () => string) => {
    target.ondragover = event => { if (!event.dataTransfer?.types.includes("application/x-lumiagent-path")) return; event.preventDefault(); event.stopPropagation(); target.classList.add("is-drop-target"); event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "copy" : "move"; };
    target.ondragleave = () => target.classList.remove("is-drop-target");
    target.ondrop = event => { const from = event.dataTransfer?.getData("application/x-lumiagent-path"); target.classList.remove("is-drop-target"); if (!from) return; event.preventDefault(); event.stopPropagation(); void transfer(from, destination(), event.ctrlKey || event.metaKey ? "copy" : "move"); };
  };
  const renderRows = () => {
    if (list.getAttribute("aria-busy") === "true") return;
    const start = Math.max(0, Math.floor(list.scrollTop / 44) - 5), end = Math.min(entries.length, start + Math.ceil((list.clientHeight || 500) / 44) + 10);
    const spacer = node("div", "la-files-list-space"); spacer.style.height = `${entries.length * 44}px`;
    for (let i = start; i < end; i++) {
      const entry = entries[i]!;
      const row = node("div", `la-file-row${selected?.path === entry.path ? " is-selected" : ""}${clipboard?.mode === "move" && clipboard.path === entry.path ? " is-cut" : ""}`);
      row.style.top = `${i * 44}px`; row.dataset.path = entry.path; row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(selected?.path === entry.path)); row.id = `la-file-${i}`;
      const icon = node("span", "la-file-icon"); icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = entry.isDirectory ? '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 3h9v11H3z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h4"/></svg>';
      row.append(icon, node("span", "la-file-name", entry.name), node("span", "la-file-size", entry.isDirectory ? "Folder" : size(entry.sizeBytes)));
      row.onclick = () => { list.focus({ preventScroll: true }); void select(entry); }; row.ondblclick = () => { if (entry.isDirectory) void navigate(entry.path); }; row.draggable = !entry.isSystem;
      row.ondragstart = event => { event.dataTransfer?.setData("application/x-lumiagent-path", entry.path); if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove"; };
      if (entry.isDirectory) wireDrop(row, () => entry.path); spacer.append(row);
    }
    list.replaceChildren(spacer); if (!entries.length) list.append(node("div", "la-files-empty", "Empty folder"));
    const index = entries.findIndex(entry => entry.path === selected?.path);
    if (index >= start && index < end) list.setAttribute("aria-activedescendant", `la-file-${index}`); else list.removeAttribute("aria-activedescendant");
  };
  wireDrop(list, () => directory); wireDrop(breadcrumbs, () => directory);
  list.addEventListener("scroll", renderRows, { passive: true }); const resize = new ResizeObserver(renderRows); resize.observe(list);
  async function refresh() {
    const version = ++listing, path = directory; list.setAttribute("aria-busy", "true"); if (!entries.length) loading(list, "Loading files…");
    try {
      const result = await request({ action: "list", path }); if (destroyed || version !== listing || result.kind !== "entries") return;
      entries = [...result.entries].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (selected && !entries.some(entry => entry.path === selected!.path) && !dirty && !saving) { selected = null; preview++; pane.replaceChildren(); root.classList.remove("has-preview"); }
      list.removeAttribute("aria-busy"); renderRows(); renderActions();
    } catch (error) { if (version !== listing || destroyed) return; list.removeAttribute("aria-busy"); renderRows(); report((error as Error).message, true); list.append(button("Retry", () => void refresh())); }
  }
  async function navigate(path: string) {
    if (saving || !(await discardDraft())) return;
    directory = path; selected = null; entries = []; dirty = false; preview++; pane.replaceChildren(); root.classList.remove("has-preview"); list.scrollTop = 0;
    renderBreadcrumbs(); renderActions(); await refresh();
  }
  async function mutate(input: WorkspaceAction, label: string): Promise<boolean> {
    if (busy || saving) return false; busy = true; renderActions(); loading(status, label);
    try {
      await request(input);
      if (input.action === "move" && clipboard?.path === input.from) clipboard = null;
      if (input.action === "move" || input.action === "delete") { dirty = false; selected = null; preview++; pane.replaceChildren(); root.classList.remove("has-preview"); }
      report(""); await refresh(); return true;
    } catch (error) { report((error as Error).message, true); return false; }
    finally { busy = false; renderActions(); }
  }
  async function create(folder: boolean) { const name = await nameDialog(folder ? "Folder name" : "File name"); if (name) await mutate(folder ? { action: "mkdir", path: join(directory, name) } : { action: "write", path: join(directory, name), content: "", create: true }, "Creating…"); }
  async function rename() { const entry = selected; if (!entry || !(await discardDraft())) return; const name = await nameDialog("Rename", entry.name); if (name && name !== entry.name) await mutate({ action: "move", from: entry.path, to: join(parentPath(entry.path), name) }, "Renaming…"); }
  async function remove() { const entry = selected; if (!entry) return; const confirmed = await deps.ctx.ui.showConfirm({ title: `Delete ${entry.name}?`, message: entry.isDirectory ? "This deletes the folder and its contents." : "This permanently deletes the file.", confirmLabel: "Delete", variant: "danger" }); if (confirmed.confirmed) await mutate({ action: "delete", path: entry.path }, "Deleting…"); }
  async function select(entry: WorkspaceEntry) { if (entry.path === selected?.path) { root.classList.add("has-preview"); return; } if (saving || !(await discardDraft())) return; selected = entry; dirty = false; renderRows(); renderActions(); await showPreview(entry); }
  async function showPreview(entry: WorkspaceEntry) {
    const version = ++preview; pane.replaceChildren(); root.classList.add("has-preview");
    const header = node("header", "la-files-preview-header"); header.append(button("Back", () => { root.classList.remove("has-preview"); list.focus(); }), node("strong", "", entry.name)); pane.append(header);
    if (entry.isDirectory) { pane.append(button("Open folder", () => void navigate(entry.path))); return; }
    if (/\.(zip|charx|tar|gz|7z|rar|exe|dll|so|pdf|wasm|bin)$/i.test(entry.path) || entry.sizeBytes > 2097152) { pane.append(node("div", "la-files-empty", "Download to open this file.")); return; }
    const body = node("div", "la-files-preview-body"); pane.append(body); loading(body, "Loading preview…");
    try {
      const result = await request({ action: "preview", path: entry.path }); if (destroyed || version !== preview) return; body.replaceChildren();
      if (result.kind === "text") {
        const editor = document.createElement("textarea"); editor.className = "la-files-editor"; editor.value = result.content; editor.spellcheck = false; editor.setAttribute("aria-label", `Edit ${entry.name}`);
        let saved = result.content;
        const bar = node("div", "la-files-editor-bar"), label = node("span", "", "Saved"); const save = button("Save", () => void saveDraft(), true);
        const mark = () => { dirty = editor.value !== saved; save.disabled = !dirty || saving; label.textContent = saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"; };
        async function saveDraft() {
          if (saving || !dirty) return; const content = editor.value; saving = true; mark();
          try { await request({ action: "write", path: entry.path, content, expectedContent: saved }); saved = content; report(""); }
          catch (error) { report((error as Error).message, true); }
          finally { saving = false; mark(); void refresh(); }
        }
        editor.oninput = mark; editor.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveDraft(); } };
        bar.append(label, save); body.append(bar, editor);
      } else if (result.kind === "media") {
        const type = mime(entry.path) ?? "application/octet-stream"; const media = document.createElement(type.startsWith("image/") ? "img" : type.startsWith("audio/") ? "audio" : "video");
        media.src = `data:${type};base64,${result.dataBase64}`; if (media instanceof HTMLImageElement) media.alt = entry.name; else media.controls = true; body.append(media);
      }
    } catch (error) { if (version === preview && !destroyed) body.replaceChildren(node("div", "la-files-empty", (error as Error).message), button("Retry", () => void showPreview(entry))); }
  }
  root.addEventListener("keydown", event => {
    if ((event.target as HTMLElement).closest("input,textarea,[contenteditable=true],dialog")) return;
    if (event.ctrlKey || event.metaKey) { const key = event.key.toLowerCase(); if (["x", "c", "v"].includes(key)) { event.preventDefault(); if (key === "v") paste(); else setClipboard(key === "x" ? "move" : "copy"); } return; }
    if (event.target !== list) return;
    const index = entries.findIndex(entry => entry.path === selected?.path);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); const next = Math.min(entries.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))), entry = entries[next]; if (!entry) return;
      if (next * 44 < list.scrollTop) list.scrollTop = next * 44; if ((next + 1) * 44 > list.scrollTop + list.clientHeight) list.scrollTop = (next + 1) * 44 - list.clientHeight; void select(entry);
    } else if (event.key === "Enter" && selected?.isDirectory) { event.preventDefault(); void navigate(selected.path); }
    else if (event.key === "Backspace" && directory) { event.preventDefault(); void navigate(parentPath(directory)); }
    else if (event.key === "F2") { event.preventDefault(); void rename(); }
    else if (event.key === "Delete" && selected && !selected.isSystem) { event.preventDefault(); void remove(); }
    else if (event.key === "Escape") { clipboard = null; renderActions(); renderRows(); }
  });
  const uploadInput = document.createElement("input"); uploadInput.type = "file"; uploadInput.multiple = true; uploadInput.hidden = true; root.append(uploadInput);
  uploadInput.onchange = async () => {
    const files = [...uploadInput.files ?? []]; uploadInput.value = ""; if (!files.length || busy) return; const target = directory; busy = true; renderActions();
    try { for (const file of files) await deps.upload(file, join(target, file.name), progress => report(`${file.name} · ${Math.round(progress * 100)}%`)); report(""); await refresh(); }
    catch (error) { report((error as Error).message, true); } finally { busy = false; renderActions(); }
  };
  renderActions(); renderBreadcrumbs(); void refresh();
  return {
    root,
    receive(message) { if (message.type !== "workspace_response") return; const item = pending.get(message.requestId); if (!item) return; pending.delete(message.requestId); clearTimeout(item.timer); if (message.error) item.reject(new Error(message.error)); else if (message.result) item.resolve(message.result); else item.reject(new Error("Invalid server response")); },
    onChanged() { if (refreshQueued || destroyed) return; refreshQueued = true; queueMicrotask(() => { refreshQueued = false; if (!destroyed) void refresh(); }); },
    onError(error) { report(error, true); },
    focusFile(path) { void (async () => { await navigate(parentPath(path)); const entry = entries.find(entry => entry.path === path); if (entry) await select(entry); })(); },
    destroy() { destroyed = true; listing++; preview++; resize.disconnect(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Files closed")); } pending.clear(); },
  };
}
