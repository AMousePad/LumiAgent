import type { SpindleAPI } from "lumiverse-spindle-types";
import type {
  ChatMessage,
  EditLogEntry,
  LlmMessage,
  SessionSummaryWire,
} from "../types";

const SESSION_DIR = "sessions";
const INDEX_PATH = `${SESSION_DIR}/index.json`;
const SCHEMA_VERSION = 1;
const INDEX_SCHEMA_VERSION = 1;

interface SessionIndexEntry {
  readonly sessionId: string;
  readonly characterId: string | null;
  readonly characterName: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly messageCount: number;
  readonly editCount: number;
  readonly revertedEditCount: number;
}

interface SessionIndex {
  readonly version: number;
  readonly entries: readonly SessionIndexEntry[];
}

function summarizeForIndex(s: PersistedSession): SessionIndexEntry {
  return {
    sessionId: s.sessionId,
    characterId: s.characterId,
    characterName: s.characterName,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    messageCount: s.messages.length,
    editCount: s.edits.length,
    revertedEditCount: s.edits.filter((e) => e.reverted).length,
  };
}

async function loadIndex(spindle: SpindleAPI, userId: string): Promise<SessionIndex | null> {
  const raw = await spindle.userStorage.getJson<SessionIndex | null>(INDEX_PATH, { fallback: null, userId });
  if (!raw || typeof raw !== "object") return null;
  if ((raw as SessionIndex).version !== INDEX_SCHEMA_VERSION) return null;
  return raw as SessionIndex;
}

async function writeIndex(spindle: SpindleAPI, entries: readonly SessionIndexEntry[], userId: string): Promise<void> {
  const payload: SessionIndex = { version: INDEX_SCHEMA_VERSION, entries };
  await spindle.userStorage.write(INDEX_PATH, JSON.stringify(payload), userId);
}

async function upsertIndex(spindle: SpindleAPI, entry: SessionIndexEntry, userId: string): Promise<void> {
  const cur = await loadIndex(spindle, userId);
  const next = [entry, ...(cur?.entries ?? []).filter((e) => e.sessionId !== entry.sessionId)];
  await writeIndex(spindle, next, userId);
}

async function removeFromIndex(spindle: SpindleAPI, sessionId: string, userId: string): Promise<void> {
  const cur = await loadIndex(spindle, userId);
  if (!cur) return;
  const next = cur.entries.filter((e) => e.sessionId !== sessionId);
  if (next.length === cur.entries.length) return;
  await writeIndex(spindle, next, userId);
}

export interface PersistedSession {
  readonly version: number;
  readonly sessionId: string;
  // Null means "no character selected": a general-purpose session without
  // access to the path-based card surface, ledger, chat tools, or external
  // providers. The agent is told to redirect character-specific work to a
  // character-pinned session via the system prompt.
  readonly characterId: string | null;
  readonly characterName: string;
  connectionId: string | null;
  readonly createdAt: number;
  lastActivityAt: number;
  messages: ChatMessage[];
  llmHistory: LlmMessage[];
  edits: EditLogEntry[];
  pinnedChatId?: string | null;
  // Prompt tokens reported by the model on the most recent turn. Reflects the
  // size of the conversation we'd resend on the next call, so it's the right
  // signal for when to compact.
  lastPromptTokens?: number;
  compactedAt?: number;
  // Snapshot of workspace/agent/agent.md taken when this session's first
  // system prompt was built. Frozen for the life of the session so mid-chat
  // edits to the file don't invalidate the prompt cache. `null` means the
  // snapshot was empty/missing; `undefined` means it hasn't been captured
  // yet (legacy sessions, or pending sessions whose first send hasn't run).
  frozenAgentNotes?: string | null;
}

function path(sessionId: string): string {
  return `${SESSION_DIR}/${sessionId}.json`;
}

export function newSession(opts: {
  sessionId: string;
  characterId: string | null;
  characterName: string;
  connectionId: string | null;
}): PersistedSession {
  const now = Date.now();
  return {
    version: SCHEMA_VERSION,
    sessionId: opts.sessionId,
    characterId: opts.characterId,
    characterName: opts.characterName,
    connectionId: opts.connectionId,
    createdAt: now,
    lastActivityAt: now,
    messages: [],
    llmHistory: [],
    edits: [],
    pinnedChatId: null,
  };
}

export async function saveSession(spindle: SpindleAPI, s: PersistedSession, userId: string): Promise<void> {
  s.lastActivityAt = Date.now();
  await spindle.userStorage.setJson(path(s.sessionId), s, { userId });
  try { await upsertIndex(spindle, summarizeForIndex(s), userId); } catch { /* index is a cache; fallback walk handles loss */ }
}

export async function loadSession(spindle: SpindleAPI, sessionId: string, userId: string): Promise<PersistedSession | null> {
  return spindle.userStorage.getJson<PersistedSession | null>(path(sessionId), { fallback: null, userId });
}

// Mark a set of edit ids reverted in their owning session and append system
// notes to its llmHistory. Lets a revert originating from one session keep
// the OWNING session's persisted view in sync.
export async function spliceRevertedFromSession(
  spindle: SpindleAPI,
  sessionId: string,
  removedIds: ReadonlySet<string>,
  notes: readonly string[],
  userId: string,
): Promise<void> {
  if (!sessionId || removedIds.size === 0) return;
  try {
    const s = await loadSession(spindle, sessionId, userId);
    if (!s) return;
    s.edits = s.edits.filter((e) => !removedIds.has(e.id));
    for (const note of notes) s.llmHistory.push({ role: "user", content: note });
    await saveSession(spindle, s, userId);
  } catch { /* session may be gone; ledger is authoritative */ }
}

export async function deleteSessionFile(spindle: SpindleAPI, sessionId: string, userId: string): Promise<void> {
  try {
    await spindle.userStorage.delete(path(sessionId), userId);
  } catch {
    // already gone
  }
  try { await removeFromIndex(spindle, sessionId, userId); } catch { /* index is best-effort */ }
}

function entryToWire(e: SessionIndexEntry, isActive: boolean): SessionSummaryWire {
  return {
    sessionId: e.sessionId,
    characterId: e.characterId,
    characterName: e.characterName,
    createdAt: e.createdAt,
    lastActivityAt: e.lastActivityAt,
    messageCount: e.messageCount,
    editCount: e.editCount,
    revertedEditCount: e.revertedEditCount,
    isActive,
  };
}

// Rebuild the index by walking every session JSON. Triggered on first run
// after upgrade (no index file yet) and as the safety net when the index is
// missing.
async function rebuildIndex(spindle: SpindleAPI, userId: string): Promise<SessionIndexEntry[]> {
  let names: string[];
  try { names = await spindle.userStorage.list(`${SESSION_DIR}/`, userId); }
  catch { return []; }
  const out: SessionIndexEntry[] = [];
  for (const rel of names) {
    if (!rel.endsWith(".json")) continue;
    if (rel === "index.json") continue;
    const id = rel.slice(0, -5);
    const s = await spindle.userStorage.getJson<PersistedSession | null>(`${SESSION_DIR}/${id}.json`, { fallback: null, userId });
    if (!s) continue;
    out.push(summarizeForIndex(s));
  }
  out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  try { await writeIndex(spindle, out, userId); } catch { /* index write best-effort */ }
  return out;
}

export async function listSessionSummaries(
  spindle: SpindleAPI,
  userId: string,
  activeIds: ReadonlySet<string>,
  filterCharacterId?: string | null,
): Promise<SessionSummaryWire[]> {
  const cur = await loadIndex(spindle, userId);
  const entries = cur ? cur.entries : await rebuildIndex(spindle, userId);
  const out: SessionSummaryWire[] = [];
  for (const e of entries) {
    if (filterCharacterId !== undefined && e.characterId !== filterCharacterId) continue;
    out.push(entryToWire(e, activeIds.has(e.sessionId)));
  }
  out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return out;
}
