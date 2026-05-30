import type { SpindleAPI } from "lumiverse-spindle-types";

// Per-user agent workspace. Backed by spindle.userStorage's filesystem-style
// API. All paths in agent / wire space are relative to the workspace root;
// absolute paths, `..` segments, empty segments, and backslashes are rejected.

export const WORKSPACE_ROOT = "workspace";

// Hardcoded ceiling for a single file (chunked upload buffers the full payload
// before writing, so this is bounded by memory not disk). Total workspace size
// and file count come from AgentSettings and are passed into write paths.
export const WORKSPACE_MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const WORKSPACE_MAX_FILES = 5000;

export interface WorkspaceCaps {
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
}

export const DEFAULT_WORKSPACE_CAPS: WorkspaceCaps = {
  maxTotalBytes: 5 * 1024 * 1024 * 1024,
  maxFiles: WORKSPACE_MAX_FILES,
  maxFileBytes: WORKSPACE_MAX_FILE_BYTES,
};

// Per-user caps from the saved settings. Use this from any tool that writes
// to the workspace (fs_write, fs_edit, fs_unzip, …) so the user's configured
// workspaceCapBytes override is honored. The default-arg path on writeText /
// writeBinary uses DEFAULT_WORKSPACE_CAPS, which is hardcoded 5 GB. Without
// this helper, agent-side writes silently bypass the user's setting.
export async function resolveUserCaps(spindle: SpindleAPI, userId: string): Promise<WorkspaceCaps> {
  const { loadSettings, resolveWorkspaceCap } = await import("./settings");
  const settings = await loadSettings(spindle, userId);
  return {
    maxTotalBytes: resolveWorkspaceCap(settings),
    maxFiles: WORKSPACE_MAX_FILES,
    maxFileBytes: WORKSPACE_MAX_FILE_BYTES,
  };
}

export interface FileNode {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly sizeBytes: number;
  readonly modifiedAt: string | null;
  readonly isSystem?: boolean;
}

export function normaliseRelPath(input: string): string {
  if (typeof input !== "string") throw new Error("path must be a string");
  let p = input.replace(/\\/g, "/").trim();
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  if (p === "" || p === ".") return "";
  const parts = p.split("/").map((seg) =>
    // Windows strips trailing dots/spaces from a path component at the FS layer,
    // so "tools.md." resolves to "tools.md". Strip them here too, else an
    // exact-match system-file guard (system-files.ts) is bypassable by appending
    // a dot/space. After stripping, a segment that became empty is invalid.
    seg.replace(/[ .]+$/, ""));
  for (const seg of parts) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error(`invalid path segment in '${input}': '${seg}'`);
    }
    if (seg.length > 200) throw new Error(`path segment too long: '${seg}'`);
    for (const ch of seg) { if (ch.charCodeAt(0) < 0x20) throw new Error("control characters not allowed in path: " + input); }
  }
  return parts.join("/");
}

export function absPath(rel: string): string {
  const norm = normaliseRelPath(rel);
  return norm === "" ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/${norm}`;
}

function listingPrefix(rel: string): string {
  const norm = normaliseRelPath(rel);
  return norm === "" ? `${WORKSPACE_ROOT}/` : `${WORKSPACE_ROOT}/${norm}/`;
}

function basename(rel: string): string {
  const ix = rel.lastIndexOf("/");
  return ix < 0 ? rel : rel.slice(ix + 1);
}

export async function listDir(spindle: SpindleAPI, userId: string, relPath: string): Promise<FileNode[]> {
  const prefix = listingPrefix(relPath);
  let entries: string[];
  try { entries = await spindle.userStorage.list(prefix, userId); } catch { return []; }
  const out: FileNode[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    // Host returns the full descendant tree, normalize backslashes (Windows readdirSync) so the descendant filter actually catches them.
    const norm = raw.replace(/\\/g, "/");
    const trimmed = norm.endsWith("/") ? norm.slice(0, -1) : norm;
    if (trimmed === "" || trimmed.includes("/")) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    const childRel = relPath === "" ? trimmed : `${normaliseRelPath(relPath)}/${trimmed}`;
    const node = await stat(spindle, userId, childRel).catch(() => null);
    if (!node) continue;
    out.push(node);
  }
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export async function stat(spindle: SpindleAPI, userId: string, relPath: string): Promise<FileNode | null> {
  const abs = absPath(relPath);
  const norm = normaliseRelPath(relPath);
  try {
    const s = await spindle.userStorage.stat(abs, userId);
    if (!s.exists) return null;
    const { isSystemPath } = await import("./system-files");
    return {
      name: basename(norm) || "",
      path: norm,
      isDirectory: s.isDirectory,
      sizeBytes: s.sizeBytes,
      modifiedAt: s.modifiedAt ?? null,
      ...(isSystemPath(norm) ? { isSystem: true } : {}),
    };
  } catch { return null; }
}

export async function readText(spindle: SpindleAPI, userId: string, relPath: string): Promise<string> {
  return spindle.userStorage.read(absPath(relPath), userId);
}

export async function readBinary(spindle: SpindleAPI, userId: string, relPath: string): Promise<Uint8Array> {
  return spindle.userStorage.readBinary(absPath(relPath), userId);
}

export async function writeText(spindle: SpindleAPI, userId: string, relPath: string, content: string, caps: WorkspaceCaps = DEFAULT_WORKSPACE_CAPS): Promise<void> {
  // Caps are byte caps and the host stores UTF-8, so measure encoded bytes, not
  // UTF-16 code units. content.length undercounts multibyte text (CJK, emoji) by
  // up to 3x, which would let it slip past the per-file and total caps.
  await ensureUnderCaps(spindle, userId, new TextEncoder().encode(content).byteLength, relPath, caps);
  await ensureParentDir(spindle, userId, relPath);
  await spindle.userStorage.write(absPath(relPath), content, userId);
}

export async function writeBinary(spindle: SpindleAPI, userId: string, relPath: string, data: Uint8Array, caps: WorkspaceCaps = DEFAULT_WORKSPACE_CAPS): Promise<void> {
  await ensureUnderCaps(spindle, userId, data.byteLength, relPath, caps);
  await ensureParentDir(spindle, userId, relPath);
  await spindle.userStorage.writeBinary(absPath(relPath), data, userId);
}

export async function makeDir(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  if (norm === "") return;
  await spindle.userStorage.mkdir(absPath(norm), userId);
}

export async function remove(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  if (norm === "") throw new Error("refusing to delete the workspace root");
  const { checkDeleteAllowed } = await import("./system-files");
  const guard = checkDeleteAllowed(norm);
  if (guard.protected) throw new Error(guard.reason ?? "protected path");
  await spindle.userStorage.delete(absPath(norm), userId);
}

export async function movePath(spindle: SpindleAPI, userId: string, fromRel: string, toRel: string): Promise<void> {
  const a = normaliseRelPath(fromRel);
  const b = normaliseRelPath(toRel);
  if (a === "" || b === "") throw new Error("source and destination must be non-empty");
  const { checkMoveAllowed } = await import("./system-files");
  const guard = checkMoveAllowed(a);
  if (guard.protected) throw new Error(guard.reason ?? "protected path");
  // Also guard the DESTINATION: the host move is renameSync, which silently
  // overwrites an existing target, so moving onto a protected system file
  // (agent.md, custom_tools/*) would destroy it despite the source-side guard.
  const destGuard = checkMoveAllowed(b);
  if (destGuard.protected) throw new Error(`refusing to overwrite a protected path: ${b}`);
  // The host move is renameSync, which silently overwrites an existing file (and
  // the rename UI does no existence check), so a rename onto an existing sibling
  // would destroy it with no prompt. Refuse when the destination already exists.
  // Skip the exists-check for a case-only rename: on a case-insensitive host FS
  // stat(b) resolves to the source itself, which would wrongly block a legit
  // Foo.txt -> foo.txt rename.
  if (a !== b && a.toLowerCase() !== b.toLowerCase()) {
    const existing = await stat(spindle, userId, b);
    if (existing) throw new Error(`destination already exists: ${b}`);
  }
  await ensureParentDir(spindle, userId, b);
  await spindle.userStorage.move(absPath(a), absPath(b), userId);
}

export async function walk(spindle: SpindleAPI, userId: string, relPath: string): Promise<FileNode[]> {
  const root = await stat(spindle, userId, relPath);
  if (!root) return [];
  if (!root.isDirectory) return [root];
  const out: FileNode[] = [];
  const queue: string[] = [normaliseRelPath(relPath)];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const children = await listDir(spindle, userId, cur);
    for (const child of children) {
      if (child.isDirectory) queue.push(child.path);
      else out.push(child);
    }
  }
  return out;
}

async function ensureParentDir(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  const ix = norm.lastIndexOf("/");
  if (ix < 0) return;
  const parent = norm.slice(0, ix);
  await spindle.userStorage.mkdir(absPath(parent), userId);
}

async function ensureUnderCaps(spindle: SpindleAPI, userId: string, incomingBytes: number, relPath: string, caps: WorkspaceCaps): Promise<void> {
  if (incomingBytes > caps.maxFileBytes) {
    throw new Error(`file size ${incomingBytes} exceeds per-file cap (${caps.maxFileBytes} bytes)`);
  }
  // tmp/ has its own per-user LRU caps managed in tmp-store.ts, so leave it
  // out of the workspace count to avoid double-billing the user.
  const all = (await walk(spindle, userId, "")).filter((n) => !n.path.startsWith("tmp/") && n.path !== "tmp");
  const target = normaliseRelPath(relPath);
  const existingNode = all.find((n) => n.path === target);
  const existingBytes = existingNode?.sizeBytes ?? 0;
  const usedBytes = all.reduce((s, n) => s + n.sizeBytes, 0) - existingBytes;
  if (usedBytes + incomingBytes > caps.maxTotalBytes) {
    throw new Error(`workspace would exceed ${caps.maxTotalBytes}-byte cap. Currently using ${usedBytes} bytes.`);
  }
  if (!existingNode && all.length + 1 > caps.maxFiles) {
    throw new Error(`workspace would exceed ${caps.maxFiles}-file cap.`);
  }
}

export async function getWorkspaceUsage(spindle: SpindleAPI, userId: string): Promise<{ totalBytes: number; fileCount: number }> {
  const all = (await walk(spindle, userId, "")).filter((n) => !n.path.startsWith("tmp/") && n.path !== "tmp");
  return {
    totalBytes: all.reduce((s, n) => s + n.sizeBytes, 0),
    fileCount: all.length,
  };
}
