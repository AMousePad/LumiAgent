import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { FrontendToBackend, WorkspaceEntry } from "../types";

// Tree-based file browser over the per-user workspace. Self-contained: the
// caller wires the message-handler hook so this panel reacts to ws_listed /
// ws_text_pushed / ws_changed / ws_download_ready / ws_zip_ready / ws_error.

export interface WorkspacePanelDeps {
  readonly ctx: SpindleFrontendContext;
  sendBackend(msg: FrontendToBackend): void;
}

export interface WorkspacePanelHandle {
  readonly root: HTMLElement;
  // Called by the drawer's onBackendMessage when the matching events arrive.
  onListed(path: string, entries: readonly WorkspaceEntry[]): void;
  onTextPushed(path: string, content: string, sizeBytes: number): void;
  onChanged(): void;
  onDownloadReady(path: string, dataBase64: string, mimeType: string): void;
  onZipReady(dataBase64: string, filename: string): void;
  onError(error: string): void;
  // Programmatically select a file as if the user clicked it. Expands parent
  // directories, kicks off the preview fetch. Used by the Settings → Open
  // agent notes shortcut.
  focusFile(path: string): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function joinPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

function dirname(path: string): string {
  const ix = path.lastIndexOf("/");
  return ix < 0 ? "" : path.slice(0, ix);
}

function basename(path: string): string {
  const ix = path.lastIndexOf("/");
  return ix < 0 ? path : path.slice(ix + 1);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

// Pick a preview mode by extension. Binary previews go through ws_download
// (returns base64 + mime); text previews go through ws_read_text. Unknown
// types default to text and the user can still download to inspect.
function previewKind(path: string): "text" | "image" | "audio" | "video" | "binary" {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"].includes(ext)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "flac", "opus"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) return "video";
  if (["zip", "tar", "gz", "7z", "rar", "exe", "dll", "so", "dylib", "pdf", "wasm", "bin"].includes(ext)) return "binary";
  return "text";
}

function mimeFromKind(kind: "image" | "audio" | "video", path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (kind === "image") {
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "svg") return "image/svg+xml";
    return `image/${ext}`;
  }
  if (kind === "audio") {
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "m4a") return "audio/mp4";
    return `audio/${ext}`;
  }
  if (ext === "mov") return "video/quicktime";
  if (ext === "mkv") return "video/x-matroska";
  return `video/${ext}`;
}

export function mountWorkspacePanel(deps: WorkspacePanelDeps): WorkspacePanelHandle {
  const root = el("div", "la-ws");

  const toolbar = el("div", "la-ws-toolbar");
  const refreshBtn = el("button", "la-btn la-btn-mini", "Refresh") as HTMLButtonElement;
  const uploadBtn = el("button", "la-btn la-btn-mini la-btn-primary", "Upload...") as HTMLButtonElement;
  const newFolderBtn = el("button", "la-btn la-btn-mini", "New folder") as HTMLButtonElement;
  const newFileBtn = el("button", "la-btn la-btn-mini", "New file") as HTMLButtonElement;
  const downloadZipBtn = el("button", "la-btn la-btn-mini", "Download .zip") as HTMLButtonElement;
  const spacer = el("span", "la-flex-spacer");
  const status = el("div", "la-ws-status");
  toolbar.append(refreshBtn, uploadBtn, newFolderBtn, newFileBtn, downloadZipBtn, spacer, status);
  root.appendChild(toolbar);

  const split = el("div", "la-ws-split");
  const treeWrap = el("aside", "la-ws-tree");
  const pane = el("section", "la-ws-pane");
  split.append(treeWrap, pane);
  root.appendChild(split);

  // State: a map of path -> entries (children). Empty path is root.
  const dirCache = new Map<string, WorkspaceEntry[]>();
  const expanded = new Set<string>([""]);
  let selectedPath: string | null = null;
  let selectedIsDirectory = false;
  let selectedSize = 0;
  let selectedIsSystem = false;
  // Tracks an open text editor with unsaved changes, so a ws_changed echo (our
  // own save fires one) doesn't tear the textarea down mid-edit.
  let editorDirty = false;
  // path -> bool indicating in-flight list request, to avoid duplicate requests.
  const pendingList = new Set<string>();

  const setStatus = (text: string, isError = false): void => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
    if (!isError && text) {
      setTimeout(() => { if (status.textContent === text) status.textContent = ""; }, 3000);
    }
  };

  const requestList = (path: string): void => {
    if (pendingList.has(path)) return;
    pendingList.add(path);
    deps.sendBackend({ type: "ws_list", path });
  };

  const renderTree = (): void => {
    treeWrap.innerHTML = "";
    const renderDir = (path: string, depth: number, parentEl: HTMLElement): void => {
      const children = dirCache.get(path);
      if (children === undefined) {
        const placeholder = el("div", "la-ws-row la-ws-loading");
        placeholder.style.paddingLeft = `${depth * 14 + 8}px`;
        placeholder.textContent = "Loading...";
        parentEl.appendChild(placeholder);
        requestList(path);
        return;
      }
      if (children.length === 0 && depth === 0) {
        const empty = el("div", "la-ws-empty");
        empty.textContent = "Workspace is empty. Upload a file or have the agent write one.";
        parentEl.appendChild(empty);
        return;
      }
      for (const entry of children) {
        const row = el("div", `la-ws-row ${selectedPath === entry.path ? "is-selected" : ""}`);
        row.style.paddingLeft = `${depth * 14 + 6}px`;
        const caret = el("span", "la-ws-caret");
        const icon = el("span", "la-ws-icon");
        const name = el("span", "la-ws-name", entry.name);
        const size = el("span", "la-ws-size", entry.isDirectory ? "" : fmtBytes(entry.sizeBytes));
        if (entry.isDirectory) {
          caret.textContent = expanded.has(entry.path) ? "▾" : "▸";
          icon.textContent = "📁";
        } else {
          caret.textContent = " ";
          icon.textContent = "📄";
        }
        row.append(caret, icon, name);
        if (entry.isSystem) {
          const tag = el("span", "la-ws-system-tag", "system");
          tag.title = "System file — needed by the agent. You can read and edit it, but deleting or renaming is blocked.";
          row.appendChild(tag);
        }
        row.appendChild(size);
        row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectedPath = entry.path;
          selectedIsDirectory = entry.isDirectory;
          selectedSize = entry.sizeBytes;
          selectedIsSystem = !!entry.isSystem;
          if (entry.isDirectory) {
            if (expanded.has(entry.path)) expanded.delete(entry.path);
            else { expanded.add(entry.path); if (!dirCache.has(entry.path)) requestList(entry.path); }
          }
          renderTree();
          renderPane();
        });
        parentEl.appendChild(row);
        if (entry.isDirectory && expanded.has(entry.path)) {
          renderDir(entry.path, depth + 1, parentEl);
        }
      }
    };
    renderDir("", 0, treeWrap);
  };

  const renderPane = (): void => {
    pane.innerHTML = "";
    editorDirty = false;
    if (!selectedPath) {
      pane.appendChild(el("div", "la-ws-pane-empty", "Select a file or folder."));
      return;
    }
    const header = el("div", "la-ws-pane-header");
    const title = el("div", "la-ws-pane-title", selectedPath);
    const meta = el("div", "la-ws-pane-meta", selectedIsDirectory ? "Directory" : fmtBytes(selectedSize));
    header.append(title, meta);
    pane.appendChild(header);

    const actions = el("div", "la-ws-pane-actions");
    if (!selectedIsDirectory) {
      const dl = el("button", "la-btn la-btn-mini", "Download");
      dl.addEventListener("click", () => deps.sendBackend({ type: "ws_download", path: selectedPath! }));
      actions.appendChild(dl);
    }
    const dlZip = el("button", "la-btn la-btn-mini", selectedIsDirectory ? "Download as .zip" : "Download in zip");
    dlZip.addEventListener("click", () => deps.sendBackend({ type: "ws_download_zip", paths: [selectedPath!] }));
    actions.appendChild(dlZip);
    const rename = el("button", `la-btn la-btn-mini${selectedIsSystem ? " la-btn-disabled" : ""}`, "Rename") as HTMLButtonElement;
    rename.disabled = selectedIsSystem;
    if (selectedIsSystem) rename.title = "System paths can't be renamed.";
    rename.addEventListener("click", () => {
      const newName = window.prompt(`Rename '${basename(selectedPath!)}' to:`, basename(selectedPath!));
      if (!newName || newName === basename(selectedPath!)) return;
      const to = joinPath(dirname(selectedPath!), newName);
      deps.sendBackend({ type: "ws_move", from: selectedPath!, to });
      // Re-target the selection to the new path so the pane (title + Download /
      // Delete buttons) doesn't keep acting on the now-vanished old path.
      selectedPath = to;
      renderPane();
    });
    actions.appendChild(rename);
    if (!selectedIsDirectory) {
      const dup = el("button", "la-btn la-btn-mini", "Duplicate") as HTMLButtonElement;
      dup.title = "Copy this file to a new name in the same folder.";
      dup.addEventListener("click", () => deps.sendBackend({ type: "ws_duplicate", path: selectedPath! }));
      actions.appendChild(dup);
    }
    const inCustomTools = !!selectedPath && (selectedPath === "custom_tools" || selectedPath.startsWith("custom_tools/"));
    const del = el("button", `la-btn la-btn-mini la-btn-danger${selectedIsSystem ? " la-btn-disabled" : ""}`, "Delete") as HTMLButtonElement;
    del.disabled = selectedIsSystem;
    if (selectedIsSystem) del.title = "This is a system file/folder — the agent depends on it. The backend will reject deletion.";
    del.addEventListener("click", async () => {
      const baseMsg = `Permanently delete '${selectedPath}'?${selectedIsDirectory ? " This removes the folder and everything in it." : ""}`;
      const message = inCustomTools
        ? `${baseMsg}\n\nThis lives under custom_tools/. The agent's saved tool recipes are stored here — only delete if you know what you're doing.`
        : baseMsg;
      const c = await deps.ctx.ui.showConfirm({
        title: "Delete",
        message,
        variant: "danger",
        confirmLabel: "Delete",
      });
      if (c.confirmed) {
        deps.sendBackend({ type: "ws_delete", path: selectedPath!, recursive: selectedIsDirectory });
        selectedPath = null;
        renderPane();
      }
    });
    actions.appendChild(del);
    pane.appendChild(actions);

    // Agent notes warning. The system prompt snapshots this file at the start
    // of each session; edits here don't reach an already-running chat unless
    // the user asks the agent to re-read the file.
    if (selectedPath === "agent/agent.md") {
      pane.appendChild(el(
        "div",
        "la-ws-pane-note la-ws-pane-note-info",
        "Saved edits apply to new chats automatically. To pick them up in the current chat, ask the agent to re-read this file.",
      ));
    }

    if (!selectedIsDirectory) {
      const kind = previewKind(selectedPath);
      if (kind === "binary") {
        pane.appendChild(el("div", "la-ws-pane-note", "Binary file. Download to inspect."));
      } else if (selectedSize >= 4 * 1024 * 1024) {
        pane.appendChild(el("div", "la-ws-pane-note", "File is larger than 4 MB. Download to view."));
      } else {
        const previewWrap = el("div", "la-ws-preview");
        previewWrap.textContent = "Loading preview...";
        pane.appendChild(previewWrap);
        // renderPane owns the fetch (not the tree-row click), so a re-render
        // after save / rename / external change re-requests the content instead
        // of leaving the wrap stuck on "Loading preview...". Content arrives via
        // onTextPushed (text) or onDownloadReady (image / audio / video).
        if (kind === "text") deps.sendBackend({ type: "ws_read_text", path: selectedPath });
        else deps.sendBackend({ type: "ws_download", path: selectedPath });
      }
    }
  };

  const refresh = (): void => {
    dirCache.clear();
    pendingList.clear();
    requestList("");
    renderTree();
  };

  refreshBtn.addEventListener("click", refresh);

  // Lumiverse caps SPINDLE_BACKEND_MSG at 4MB. Stay well clear with 2MB raw
  // per chunk (~2.7MB base64). For files under one chunk we still go through
  // the chunked path to keep the assembly logic uniform.
  const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

  uploadBtn.addEventListener("click", async () => {
    try {
      const targetDir = selectedPath && selectedIsDirectory ? selectedPath : "";
      const files = await deps.ctx.uploads.pickFile({ multiple: true, maxSizeBytes: 25 * 1024 * 1024 });
      if (files.length === 0) return;
      for (const file of files) {
        const path = joinPath(targetDir, file.name);
        const total = Math.max(1, Math.ceil(file.bytes.length / UPLOAD_CHUNK_BYTES));
        const transferId = `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        for (let i = 0; i < total; i++) {
          const start = i * UPLOAD_CHUNK_BYTES;
          const chunk = file.bytes.subarray(start, Math.min(file.bytes.length, start + UPLOAD_CHUNK_BYTES));
          const dataBase64 = await bytesToBase64(chunk);
          deps.sendBackend({ type: "ws_upload_part", transferId, path, dataBase64, index: i, total });
        }
        setStatus(`Uploading ${file.name} (${total} part${total === 1 ? "" : "s"})...`);
      }
    } catch (err) {
      setStatus(`Upload failed: ${(err as Error).message}`, true);
    }
  });

  newFolderBtn.addEventListener("click", () => {
    const targetDir = selectedPath && selectedIsDirectory ? selectedPath : "";
    const name = window.prompt(`New folder name under '${targetDir || "/"}':`);
    if (!name) return;
    deps.sendBackend({ type: "ws_mkdir", path: joinPath(targetDir, name) });
  });

  newFileBtn.addEventListener("click", () => {
    const targetDir = selectedPath && selectedIsDirectory ? selectedPath : "";
    const name = window.prompt(`New file name under '${targetDir || "/"}':`);
    if (!name) return;
    deps.sendBackend({ type: "ws_write_text", path: joinPath(targetDir, name), content: "" });
  });

  downloadZipBtn.addEventListener("click", () => {
    deps.sendBackend({ type: "ws_download_zip", paths: selectedPath ? [selectedPath] : [] });
    setStatus("Building zip...");
  });

  // Kick off initial root load.
  refresh();

  return {
    root,
    onListed(path, entries) {
      pendingList.delete(path);
      dirCache.set(path, [...entries]);
      renderTree();
    },
    onTextPushed(path, content) {
      if (path !== selectedPath) return;
      const wrap = pane.querySelector(".la-ws-preview") as HTMLElement | null;
      if (!wrap) return;
      wrap.innerHTML = "";
      // Editable textarea. Native ctrl-z/y just work. Save flushes via
      // ws_write_text; ws_changed comes back and we don't lose focus because
      // the path didn't change.
      const editor = document.createElement("textarea");
      editor.className = "la-ws-editor";
      editor.value = content;
      editor.spellcheck = false;
      const bar = document.createElement("div");
      bar.className = "la-ws-editor-bar";
      const statusLabel = document.createElement("span");
      statusLabel.className = "la-ws-editor-status";
      statusLabel.textContent = "Saved";
      const saveBtn = document.createElement("button");
      saveBtn.className = "la-btn la-btn-mini la-btn-primary";
      saveBtn.textContent = "Save";
      saveBtn.disabled = true;
      let savedValue = content;
      const markDirty = (): void => {
        const dirty = editor.value !== savedValue;
        editorDirty = dirty;
        saveBtn.disabled = !dirty;
        statusLabel.textContent = dirty ? "Unsaved changes" : "Saved";
        statusLabel.classList.toggle("is-dirty", dirty);
      };
      const doSave = (): void => {
        if (editor.value === savedValue) return;
        const next = editor.value;
        deps.sendBackend({ type: "ws_write_text", path, content: next });
        savedValue = next;
        editorDirty = false;
        saveBtn.disabled = true;
        statusLabel.textContent = "Saved";
        statusLabel.classList.remove("is-dirty");
      };
      editor.addEventListener("input", markDirty);
      editor.addEventListener("keydown", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S")) {
          ev.preventDefault();
          doSave();
        }
      });
      saveBtn.addEventListener("click", doSave);
      bar.append(statusLabel, saveBtn);
      wrap.appendChild(bar);
      wrap.appendChild(editor);
    },
    onChanged() {
      // Wholesale-refresh so renames, deletes, and new folders all reflect.
      // Cheap because list_text only requests immediate children of root and
      // currently-expanded folders re-fetch on demand.
      refresh();
      // Re-render the pane too: a rename/delete that originated elsewhere (or
      // the backend confirming one) must not leave the pane showing a stale or
      // orphaned file. BUT our own ws_write_text save also echoes ws_changed, and
      // renderPane re-fetches + remounts the textarea: skip it while the user is
      // focused in or has unsaved changes in the editor, or we drop their work.
      const wrap = pane.querySelector(".la-ws-preview");
      if ((wrap && wrap.contains(document.activeElement)) || editorDirty) {
        setStatus("Workspace updated.");
        return;
      }
      renderPane();
      setStatus("Workspace updated.");
    },
    onDownloadReady(path, dataBase64, mimeType) {
      // Two callers land here: (1) the Download button — save to disk; (2) an
      // image/audio/video auto-preview — render inline. Disambiguate by
      // whether this is the selected file AND its kind is previewable AND a
      // preview wrap is mounted waiting for content.
      if (path === selectedPath) {
        const kind = previewKind(path);
        const wrap = pane.querySelector(".la-ws-preview") as HTMLElement | null;
        if (wrap && (kind === "image" || kind === "audio" || kind === "video")) {
          wrap.innerHTML = "";
          const dataUrl = `data:${mimeType || mimeFromKind(kind, path)};base64,${dataBase64}`;
          let media: HTMLElement;
          if (kind === "image") {
            const img = document.createElement("img");
            img.className = "la-ws-preview-img";
            img.src = dataUrl;
            img.alt = basename(path);
            media = img;
          } else if (kind === "audio") {
            const a = document.createElement("audio");
            a.className = "la-ws-preview-audio";
            a.controls = true;
            a.src = dataUrl;
            media = a;
          } else {
            const v = document.createElement("video");
            v.className = "la-ws-preview-video";
            v.controls = true;
            v.src = dataUrl;
            media = v;
          }
          wrap.appendChild(media);
          return;
        }
      }
      const blob = base64ToBlob(dataBase64, mimeType);
      triggerDownload(blob, basename(path));
      setStatus("Downloaded.");
    },
    onZipReady(dataBase64, filename) {
      const blob = base64ToBlob(dataBase64, "application/zip");
      triggerDownload(blob, filename);
      setStatus("Zip ready.");
    },
    onError(error) {
      setStatus(error, true);
    },
    focusFile(path) {
      // Expand every ancestor so the row renders inside its tree, then act
      // as if the user clicked the leaf. The actual selection and preview
      // fetch happen synchronously; the row's row.click() reuses the same
      // handler we registered above.
      const parts = path.split("/").filter(Boolean);
      let cur = "";
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur === "" ? parts[i]! : `${cur}/${parts[i]}`;
        expanded.add(cur);
        if (!dirCache.has(cur)) requestList(cur);
      }
      selectedPath = path;
      selectedIsDirectory = false;
      selectedSize = 0;
      selectedIsSystem = true;
      const kind = previewKind(path);
      if (kind === "text") deps.sendBackend({ type: "ws_read_text", path });
      else if (kind !== "binary") deps.sendBackend({ type: "ws_download", path });
      renderTree();
      renderPane();
    },
  };
}
