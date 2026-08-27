import type { SpindleAPI } from "lumiverse-spindle-types";
import { absPath, normaliseRelPath } from "./workspace";
import { LUMIVERSE_DOCS, LUMIVERSE_DOCS_VERSION } from "../generated/lumiverse-docs";

// Workspace files / directories the agent depends on. Created lazily on
// session start and on every Files-tab refresh; the workspace can't delete
// them or move them out from under us, but their contents can still be
// edited by hand if the user really wants.

export const SYSTEM_FILE_PATHS = [
  "custom_tools/tools.md",
  "custom_tools/example/tool.json",
  "agent/agent.md",
] as const;

// Directories that must exist and cannot be deleted as a whole. Their
// individual children may or may not be deletable; see the per-file rules.
export const SYSTEM_DIR_PATHS = [
  "custom_tools",
  "custom_tools/example",
  "agent",
  "tmp",
] as const;

// Where deletion is allowed:
// - tmp/<anything> is fine (LRU evicts them anyway).
// - everything else under custom_tools/ / agent/ that isn't in the protected
//   list above is fine — only the seed files and their parent dirs are locked.

export interface ProtectionResult {
  readonly protected: boolean;
  readonly reason?: string;
}

export function checkDeleteAllowed(relPath: string): ProtectionResult {
  const norm = normaliseRelPath(relPath);
  // System files: never delete.
  for (const p of SYSTEM_FILE_PATHS) {
    if (norm === p) return { protected: true, reason: `'${p}' is a system file and cannot be deleted. You can edit it instead.` };
  }
  // System dirs: never delete the dir itself.
  for (const d of SYSTEM_DIR_PATHS) {
    if (norm === d) return { protected: true, reason: `'${d}/' is a system directory and cannot be deleted.` };
  }
  return { protected: false };
}

export function checkMoveAllowed(fromRel: string): ProtectionResult {
  const norm = normaliseRelPath(fromRel);
  for (const p of SYSTEM_FILE_PATHS) {
    if (norm === p) return { protected: true, reason: `'${p}' is a system file and cannot be renamed or moved.` };
  }
  for (const d of SYSTEM_DIR_PATHS) {
    if (norm === d) return { protected: true, reason: `'${d}/' is a system directory and cannot be renamed or moved.` };
  }
  return { protected: false };
}

export function isSystemPath(relPath: string): boolean {
  const norm = normaliseRelPath(relPath);
  for (const p of SYSTEM_FILE_PATHS) if (norm === p) return true;
  for (const d of SYSTEM_DIR_PATHS) if (norm === d) return true;
  return false;
}

const TOOLS_MD_TEMPLATE = `# Custom tools

Recipes the agent has saved for itself. Format: one bullet per tool with a
short description, so the agent can pick the right one quickly without
re-reading every manifest.

- example_count_chars — count characters in any character field. Demo recipe; safe to study or delete.
`;

const EXAMPLE_TOOL_JSON = JSON.stringify({
  name: "example_count_chars",
  description: "Count characters in a chosen character field. Demonstrates the recipe shape.",
  params: {
    field: { type: "string", description: "Field name, e.g. first_mes / description / personality." },
  },
  steps: [
    { call: "read", args: { path: "char/{{field}}" }, save_as: "body" },
    { call: "count_cjk_chars", args: { text: "{{$body}}" } },
  ],
  return: "{{$body}}",
}, null, 2);

const AGENT_MD_TEMPLATE = `# Agent notes

This file is your long-term memory. Anything written here is loaded at the
start of every session, so use it for facts the user wants you to remember
across conversations: preferences, ongoing projects, glossary terms,
recurring workflows.

Keep entries short and information-dense. One bullet per fact is ideal.

## Notes
`;

async function readFromStorage<T>(spindle: SpindleAPI, userId: string, path: string): Promise<T | null> {
  try {
    const stat = await spindle.userStorage.stat(absPath(path), userId);
    if (!stat.exists) return null;
    const text = await spindle.userStorage.read(absPath(path), userId);
    return text as unknown as T;
  } catch { return null; }
}

async function writeIfMissing(spindle: SpindleAPI, userId: string, relPath: string, content: string): Promise<boolean> {
  const existing = await readFromStorage<string>(spindle, userId, relPath);
  if (existing !== null) return false;
  await spindle.userStorage.write(absPath(relPath), content, userId);
  return true;
}

async function ensureDir(spindle: SpindleAPI, userId: string, relPath: string): Promise<void> {
  try { await spindle.userStorage.mkdir(absPath(relPath), userId); } catch { /* already exists is fine */ }
}

// Lumiverse user-docs are bundled at build time and mirrored under
// docs/lumiverse/. Upstream owns this tree: a version bump rewrites every file
// and deletes anything no longer in the bundle, so a renamed section can't
// linger describing a removed feature. Local edits and deletions under this
// root do not survive a bump, by design.
// The marker at docs/lumiverse/.version gates the whole pass so an unchanged
// bundle costs one stat per session instead of one write per file.
const LUMIVERSE_DOCS_ROOT = "docs/lumiverse";
const LUMIVERSE_DOCS_MARKER = `${LUMIVERSE_DOCS_ROOT}/.version`;

// Host list() returns descendants relative to the prefix, backslash-separated
// on Windows.
async function pruneOrphanedDocs(spindle: SpindleAPI, userId: string, keep: ReadonlySet<string>): Promise<void> {
  let entries: string[];
  try { entries = await spindle.userStorage.list(`${absPath(LUMIVERSE_DOCS_ROOT)}/`, userId); }
  catch { return; }
  for (const raw of entries) {
    const rel = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    if (rel === "" || rel === ".version" || keep.has(rel)) continue;
    try { await spindle.userStorage.delete(absPath(`${LUMIVERSE_DOCS_ROOT}/${rel}`), userId); }
    catch { /* already gone */ }
  }
}

async function seedLumiverseDocsIfNeeded(spindle: SpindleAPI, userId: string): Promise<void> {
  const paths = Object.keys(LUMIVERSE_DOCS);
  if (paths.length === 0) return;
  const existing = await readFromStorage<string>(spindle, userId, LUMIVERSE_DOCS_MARKER);
  if (existing !== null && existing.trim() === LUMIVERSE_DOCS_VERSION) return;
  for (const rel of paths) {
    await spindle.userStorage.write(absPath(`${LUMIVERSE_DOCS_ROOT}/${rel}`), LUMIVERSE_DOCS[rel]!, userId);
  }
  await pruneOrphanedDocs(spindle, userId, new Set(paths));
  // Marker last: a crash mid-write leaves it stale so the next start retries.
  await spindle.userStorage.write(absPath(LUMIVERSE_DOCS_MARKER), LUMIVERSE_DOCS_VERSION, userId);
}

// Idempotent. Creates anything missing; leaves existing content alone.
// Safe to call on every session start and every Files-tab refresh — when
// the user deletes a system file by going around our protection, the next
// touch puts the seed back.
export async function ensureSystemFiles(spindle: SpindleAPI, userId: string): Promise<void> {
  for (const d of SYSTEM_DIR_PATHS) await ensureDir(spindle, userId, d);
  await writeIfMissing(spindle, userId, "custom_tools/tools.md", TOOLS_MD_TEMPLATE);
  await writeIfMissing(spindle, userId, "custom_tools/example/tool.json", EXAMPLE_TOOL_JSON);
  await writeIfMissing(spindle, userId, "agent/agent.md", AGENT_MD_TEMPLATE);
  await seedLumiverseDocsIfNeeded(spindle, userId);
}

// Path to surface in the Settings → "Open agent notes" shortcut.
export const AGENT_NOTES_PATH = "agent/agent.md";
