import type { SpindleAPI } from "lumiverse-spindle-types";

// Per-user agent workspace. Backed by spindle.userStorage's filesystem-style
// API. All paths in agent / wire space are relative to the workspace root;
// absolute paths, `..` segments, empty segments, and backslashes are rejected.

export const WORKSPACE_ROOT = "workspace";
const DIRECTORY_MARKER = ".lumiagent-directory";

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

interface UsageState {
  tail: Promise<unknown>;
  usage?: { totalBytes: number; fileCount: number; scannedAt: number; fileSizes: Map<string, number> };
}

const usageStates = new WeakMap<SpindleAPI, Map<string, UsageState>>();
// Direct host filesystem edits cannot notify the worker, so cached totals expire.
const USAGE_MAX_AGE_MS = 60_000;

function usageState(spindle: SpindleAPI, userId: string): UsageState {
  let users = usageStates.get(spindle);
  if (!users) usageStates.set(spindle, users = new Map());
  let state = users.get(userId);
  if (!state) users.set(userId, state = { tail: Promise.resolve() });
  return state;
}

async function serializeMutation<T>(spindle: SpindleAPI, userId: string, action: () => Promise<T>): Promise<T> {
  const state = usageState(spindle, userId);
  const pending = state.tail.then(action);
  state.tail = pending.catch(() => { delete state.usage; });
  return pending;
}

export function unmeteredWorkspaceMutation<T>(spindle: SpindleAPI, userId: string, action: () => Promise<T>): Promise<T> {
  return serializeMutation(spindle, userId, async () => {
    const state = usageState(spindle, userId);
    delete state.usage;
    try { return await action(); }
    finally { delete state.usage; }
  });
}

function isTemporary(rel: string): boolean {
  return rel === "tmp" || rel.startsWith("tmp/");
}

async function cachedUsage(spindle: SpindleAPI, userId: string) {
  const state = usageState(spindle, userId);
  if (!state.usage || Date.now() - state.usage.scannedAt >= USAGE_MAX_AGE_MS) {
    state.usage = { ...await scanUsage(spindle, userId), scannedAt: Date.now() };
  }
  return state.usage;
}

async function meteredWrite(spindle: SpindleAPI, userId: string, relPath: string, bytes: number, caps: WorkspaceCaps, write: () => Promise<void>): Promise<void> {
  await serializeMutation(spindle, userId, async () => {
    const target = normaliseRelPath(relPath);
    if (!target) throw new Error("file path must be non-empty");
    if (bytes > caps.maxFileBytes) throw new Error(`file size ${bytes} exceeds per-file cap (${caps.maxFileBytes} bytes)`);
    let usage = await cachedUsage(spindle, userId);
    const existing = await spindle.userStorage.stat(absPath(target), userId);
    if (existing.exists && existing.isDirectory) throw new Error(`path is a directory: ${target}`);
    if (!isTemporary(target) && usage.fileSizes.get(target) !== (existing.exists ? existing.sizeBytes : undefined)) {
      delete usageState(spindle, userId).usage;
      usage = await cachedUsage(spindle, userId);
    }
    const deltaBytes = isTemporary(target) ? 0 : bytes - (existing.exists ? existing.sizeBytes : 0);
    const deltaFiles = isTemporary(target) || existing.exists ? 0 : 1;
    if (usage.totalBytes + deltaBytes > caps.maxTotalBytes) throw new Error(`workspace would exceed ${caps.maxTotalBytes}-byte cap`);
    if (usage.fileCount + deltaFiles > caps.maxFiles) throw new Error(`workspace would exceed ${caps.maxFiles}-file cap`);
    await ensureParentDir(spindle, userId, target);
    await write();
    usage.totalBytes += deltaBytes;
    usage.fileCount += deltaFiles;
    if (!isTemporary(target)) usage.fileSizes.set(target, bytes);
  });
}

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
    if (seg === DIRECTORY_MARKER) throw new Error(`reserved workspace path segment: '${seg}'`);
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

export async function listDir(spindle: SpindleAPI, userId: string, relPath: string, strict = false): Promise<FileNode[]> {
  const prefix = listingPrefix(relPath);
  const parent = normaliseRelPath(relPath);
  let entries: string[];
  try { entries = await spindle.userStorage.list(prefix, userId); } catch (error) {
    if (strict) throw error;
    return [];
  }
  const childNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    // The host returns recursive files only. The first segment identifies the
    // immediate child, including directories that contain deeper files.
    const norm = raw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const childName = norm.split("/")[0] ?? "";
    if (childName === "" || childName === DIRECTORY_MARKER || seen.has(childName)) continue;
    seen.add(childName);
    childNames.push(childName);
  }
  const out: FileNode[] = [];
  for (const childName of childNames) {
    const childRel = parent === "" ? childName : `${parent}/${childName}`;
    const node = await stat(spindle, userId, childRel, strict).catch((error) => {
      if (strict) throw error;
      return null;
    });
    if (!node && strict) throw new Error(`workspace path disappeared during listing: ${childRel}`);
    if (node) out.push(node);
  }
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export async function stat(spindle: SpindleAPI, userId: string, relPath: string, strict = false): Promise<FileNode | null> {
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
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

export async function readText(spindle: SpindleAPI, userId: string, relPath: string): Promise<string> {
  return spindle.userStorage.read(absPath(relPath), userId);
}

export async function readBinary(spindle: SpindleAPI, userId: string, relPath: string): Promise<Uint8Array> {
  return spindle.userStorage.readBinary(absPath(relPath), userId);
}

export async function writeText(spindle: SpindleAPI, userId: string, relPath: string, content: string, caps: WorkspaceCaps = DEFAULT_WORKSPACE_CAPS): Promise<void> {
  await meteredWrite(spindle, userId, relPath, new TextEncoder().encode(content).byteLength, caps,
    () => spindle.userStorage.write(absPath(relPath), content, userId));
}

export async function writeBinary(spindle: SpindleAPI, userId: string, relPath: string, data: Uint8Array, caps: WorkspaceCaps = DEFAULT_WORKSPACE_CAPS): Promise<void> {
  await meteredWrite(spindle, userId, relPath, data.byteLength, caps,
    () => spindle.userStorage.writeBinary(absPath(relPath), data, userId));
}

export async function makeDir(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  if (norm === "") return;
  await spindle.userStorage.mkdir(absPath(norm), userId);
  await writeDirectoryMarker(spindle, userId, norm);
}

export async function remove(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  if (norm === "") throw new Error("refusing to delete the workspace root");
  const { checkDeleteAllowed } = await import("./system-files");
  const guard = checkDeleteAllowed(norm);
  if (guard.protected) throw new Error(guard.reason ?? "protected path");
  await unmeteredWorkspaceMutation(spindle, userId, () => spindle.userStorage.delete(absPath(norm), userId));
}

export async function movePath(spindle: SpindleAPI, userId: string, fromRel: string, toRel: string): Promise<void> {
  return unmeteredWorkspaceMutation(spindle, userId, () => movePathUnlocked(spindle, userId, fromRel, toRel));
}

async function movePathUnlocked(spindle: SpindleAPI, userId: string, fromRel: string, toRel: string): Promise<void> {
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
  const source = await stat(spindle, userId, a);
  if (source?.isDirectory) await writeDirectoryMarker(spindle, userId, a);
  await ensureParentDir(spindle, userId, b);
  await spindle.userStorage.move(absPath(a), absPath(b), userId);
}

export async function walk(spindle: SpindleAPI, userId: string, relPath: string, strict = false): Promise<FileNode[]> {
  const root = await stat(spindle, userId, relPath, strict);
  if (!root) return [];
  if (!root.isDirectory) return [root];
  const out: FileNode[] = [];
  const queue: string[] = [normaliseRelPath(relPath)];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const children = await listDir(spindle, userId, cur, strict);
    for (const child of children) {
      if (child.isDirectory) queue.push(child.path);
      else out.push(child);
    }
  }
  return out;
}

export async function copyPath(
  spindle: SpindleAPI,
  userId: string,
  fromRel: string,
  toRel: string,
  options: { recursive?: boolean; caps?: WorkspaceCaps; signal?: AbortSignal } = {},
): Promise<{ from: string; to: string; files_copied: number; directories_copied: number; bytes_copied: number }> {
  return serializeMutation(spindle, userId, () => copyPathUnlocked(spindle, userId, fromRel, toRel, options));
}

async function copyPathUnlocked(
  spindle: SpindleAPI, userId: string, fromRel: string, toRel: string,
  options: { recursive?: boolean; caps?: WorkspaceCaps; signal?: AbortSignal },
) {
  const from = normaliseRelPath(fromRel);
  const to = normaliseRelPath(toRel);
  if (!from || !to) throw new Error("source and destination must be non-empty");
  const sourceKey = from.toLowerCase();
  const targetKey = to.toLowerCase();
  if (sourceKey === targetKey || targetKey.startsWith(`${sourceKey}/`)) {
    throw new Error("cannot copy a path onto itself or into its own directory");
  }
  options.signal?.throwIfAborted();
  const source = await stat(spindle, userId, from, true);
  if (!source) throw new Error(`workspace path '${from}' not found`);
  if (source.isDirectory && !options.recursive) throw new Error("copying a directory requires recursive=true");
  if (await spindle.userStorage.exists(absPath(to), userId)) throw new Error(`destination already exists: ${to}`);

  const nodes: FileNode[] = [source];
  for (let i = 0; i < nodes.length; i++) {
    options.signal?.throwIfAborted();
    const node = nodes[i]!;
    if (node.isDirectory) nodes.push(...await listDir(spindle, userId, node.path, true));
  }
  const caps = options.caps ?? DEFAULT_WORKSPACE_CAPS;
  const usage = await cachedUsage(spindle, userId);
  const files = nodes.filter((node) => !node.isDirectory);
  const incomingBytes = files.reduce((sum, node) => sum + node.sizeBytes, 0);
  if (files.some((node) => node.sizeBytes > caps.maxFileBytes)) throw new Error("copy exceeds the per-file size cap");
  const counted = !isTemporary(to);
  if (counted && usage.totalBytes + incomingBytes > caps.maxTotalBytes) throw new Error("copy would exceed the workspace byte cap");
  if (counted && usage.fileCount + files.length > caps.maxFiles) throw new Error("copy would exceed the workspace file cap");

  const result = { from, to, files_copied: 0, directories_copied: 0, bytes_copied: 0 };
  let remainingBytes = counted ? caps.maxTotalBytes - usage.totalBytes : Infinity;
  try {
    for (const node of nodes) {
      options.signal?.throwIfAborted();
      const target = to + node.path.slice(from.length);
      if (await spindle.userStorage.exists(absPath(target), userId)) throw new Error(`destination already exists: ${target}`);
      if (node.isDirectory) {
        await makeDir(spindle, userId, target);
        result.directories_copied++;
        continue;
      }
      // UTF-8 decoding replaces invalid bytes, so copies must use binary storage.
      const bytes = await readBinary(spindle, userId, node.path);
      if (bytes.byteLength !== node.sizeBytes || bytes.byteLength > caps.maxFileBytes || bytes.byteLength > remainingBytes) {
        throw new Error(`source changed beyond the copy size budget: ${node.path}`);
      }
      options.signal?.throwIfAborted();
      await ensureParentDir(spindle, userId, target);
      if (await spindle.userStorage.exists(absPath(target), userId)) throw new Error(`destination already exists: ${target}`);
      options.signal?.throwIfAborted();
      // One quota preflight avoids a full workspace scan for every copied file.
      await spindle.userStorage.writeBinary(absPath(target), bytes, userId);
      if (counted) {
        usage.totalBytes += bytes.byteLength;
        usage.fileCount++;
        usage.fileSizes.set(target, bytes.byteLength);
      }
      remainingBytes -= bytes.byteLength;
      result.files_copied++;
      result.bytes_copied += bytes.byteLength;
    }
  } catch (error) {
    throw new Error(`Copy incomplete: ${result.files_copied} files and ${result.directories_copied} directories copied to '${to}'. The source was kept. ${(error as Error).message}`);
  }
  return result;
}

async function ensureParentDir(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  const ix = norm.lastIndexOf("/");
  if (ix < 0) return;
  const parent = norm.slice(0, ix);
  await spindle.userStorage.mkdir(absPath(parent), userId);
  await writeDirectoryMarker(spindle, userId, parent);
}

async function writeDirectoryMarker(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  const norm = normaliseRelPath(relPath);
  if (norm === "") return;
  await spindle.userStorage.write(`${absPath(norm)}/${DIRECTORY_MARKER}`, "", userId);
}

async function scanUsage(spindle: SpindleAPI, userId: string) {
  const entries = await spindle.userStorage.list(`${WORKSPACE_ROOT}/`, userId);
  const paths = [...new Set(entries.map((path) => path.replace(/\\/g, "/")))];
  let totalBytes = 0;
  let fileCount = 0;
  const fileSizes = new Map<string, number>();
  for (let i = 0; i < paths.length; i += 16) {
    const batch = paths.slice(i, i + 16).filter((path) => !isTemporary(path) && path.split("/").at(-1) !== DIRECTORY_MARKER);
    const nodes = await Promise.all(batch.map((path) => spindle.userStorage.stat(absPath(path), userId)));
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j]!;
      if (!node.exists) throw new Error("workspace changed during quota scan, retry the operation");
      if (!node.isDirectory) {
        totalBytes += node.sizeBytes;
        fileCount++;
        fileSizes.set(batch[j]!, node.sizeBytes);
      }
    }
  }
  return { totalBytes, fileCount, fileSizes };
}

export async function getWorkspaceUsage(spindle: SpindleAPI, userId: string): Promise<{ totalBytes: number; fileCount: number }> {
  return serializeMutation(spindle, userId, async () => {
    const usage = await scanUsage(spindle, userId);
    usageState(spindle, userId).usage = { ...usage, scannedAt: Date.now() };
    return { totalBytes: usage.totalBytes, fileCount: usage.fileCount };
  });
}
