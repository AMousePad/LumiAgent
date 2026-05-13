import type { SpindleAPI } from "lumiverse-spindle-types";
import type {
  ChatMessage,
  EditLogEntry,
  LlmMessage,
  SessionSummaryWire,
} from "../types";

const SESSION_DIR = "sessions";
const SCHEMA_VERSION = 1;

export interface PersistedSession {
  readonly version: number;
  readonly sessionId: string;
  readonly characterId: string;
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
  // Per-call-id overrides emitted by the AI via mark_tool_results, or by the
  // user via manual UI. Resolves at auto-free time, ahead of the tool's
  // defaultSensitivity. Sparse, keyed by call_id.
  sensitivityOverrides?: Record<string, "sensitive" | "insensitive">;
}

function path(sessionId: string): string {
  return `${SESSION_DIR}/${sessionId}.json`;
}

export function newSession(opts: {
  sessionId: string;
  characterId: string;
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
}

function summarize(s: PersistedSession, isActive: boolean): SessionSummaryWire {
  const revertedCount = s.edits.filter((e) => e.reverted).length;
  return {
    sessionId: s.sessionId,
    characterId: s.characterId,
    characterName: s.characterName,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    messageCount: s.messages.length,
    editCount: s.edits.length,
    revertedEditCount: revertedCount,
    isActive,
  };
}

export async function listSessionSummaries(
  spindle: SpindleAPI,
  userId: string,
  activeIds: ReadonlySet<string>,
  filterCharacterId?: string,
): Promise<SessionSummaryWire[]> {
  let names: string[];
  try {
    names = await spindle.userStorage.list(`${SESSION_DIR}/`, userId);
  } catch {
    return [];
  }
  const out: SessionSummaryWire[] = [];
  for (const rel of names) {
    if (!rel.endsWith(".json")) continue;
    const id = rel.slice(0, -5);
    const s = await spindle.userStorage.getJson<PersistedSession | null>(`${SESSION_DIR}/${id}.json`, { fallback: null, userId });
    if (!s) continue;
    if (filterCharacterId && s.characterId !== filterCharacterId) continue;
    out.push(summarize(s, activeIds.has(s.sessionId)));
  }
  out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return out;
}
