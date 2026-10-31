import type { SpindleAPI } from "lumiverse-spindle-types";
import type { PersistedSession } from "./sessions";
import type { ChatMessage } from "../types";
import { projectMessage, SESSION_PAGE_SIZE, messageEditCounts } from "./session-view";

type ViewMetadata = Omit<PersistedSession, "messages" | "edits" | "llmHistory">;
interface ViewIndex { version: 2; total: number; pages: string[]; metadata: ViewMetadata; last: ChatMessage | null }
const savedViews = new WeakMap<PersistedSession, { refs: ChatMessage[]; pages: string[]; edits: string }>();
const queues = new WeakMap<SpindleAPI, Map<string, Promise<unknown>>>();

export async function waitForSessionViewWrites(spindle: SpindleAPI, sessionId: string, userId: string): Promise<void> {
  await queues.get(spindle)?.get(JSON.stringify([userId, sessionId]))?.catch(() => {});
}

function directory(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid session identifier");
  return `session-views/${id}`;
}

export function saveSessionView(spindle: SpindleAPI, session: PersistedSession, userId: string): Promise<void> {
  let users = queues.get(spindle);
  if (!users) queues.set(spindle, users = new Map());
  const key = JSON.stringify([userId, session.sessionId]);
  const prior = users.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(async () => {
    const dir = directory(session.sessionId);
    const previous = savedViews.get(session);
    const oldIndex = previous ?? await spindle.userStorage.getJson<ViewIndex | null>(`${dir}/index.json`, { userId, fallback: null });
    const pages: string[] = [];
    const counts = messageEditCounts(session.messages, session.edits);
    const editsKey = session.edits.map(edit => `${edit.id}:${edit.reverted}`).join("|");
    for (let start = 0; start < session.messages.length; start += SESSION_PAGE_SIZE) {
      const end = Math.min(session.messages.length, start + SESSION_PAGE_SIZE);
      const pageIndex = Math.floor(start / SESSION_PAGE_SIZE);
      const unchanged = previous && previous.edits === editsKey && end < session.messages.length && end <= previous.refs.length
        && session.messages.slice(start, end).every((message, index) => previous.refs[start + index] === message);
      if (unchanged && previous.pages[pageIndex]) { pages.push(previous.pages[pageIndex]!); continue; }
      const path = `${dir}/${crypto.randomUUID()}.json`;
      await spindle.userStorage.setJson(path, session.messages.slice(start, end).map(message => ({ ...projectMessage(message), editCounts: counts.get(message.id)! })), { userId });
      pages.push(path);
    }
    const { messages } = session;
    const metadata: ViewMetadata = {
      version: session.version, sessionId: session.sessionId, characterId: session.characterId,
      characterName: session.characterName, connectionId: session.connectionId, createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      ...(session.compactedAt !== undefined ? { compactedAt: session.compactedAt } : {}),
      ...(session.lastPromptTokens !== undefined ? { lastPromptTokens: session.lastPromptTokens } : {}),
    };
    const index: ViewIndex = { version: 2, total: messages.length, pages, metadata, last: messages.length ? projectMessage(messages[messages.length - 1]!) : null };
    await spindle.userStorage.setJson(`${dir}/index.json`, index, { userId });
    savedViews.set(session, { refs: [...messages], pages, edits: editsKey });
    // Published pages are immutable until the manifest switches to the complete replacement.
    if (oldIndex && Array.isArray(oldIndex.pages)) for (const path of oldIndex.pages) if (typeof path === "string" && path.startsWith(`${dir}/`) && !pages.includes(path)) {
      try { await spindle.userStorage.delete(path, userId); } catch {}
    }
  });
  users.set(key, next);
  void next.finally(() => { if (users!.get(key) === next) users!.delete(key); }).catch(() => {});
  return next;
}

export async function loadSessionView(spindle: SpindleAPI, sessionId: string, userId: string, before?: number) {
  const index = await spindle.userStorage.getJson<ViewIndex | null>(`${directory(sessionId)}/index.json`, { userId, fallback: null });
  if (!index || index.version !== 2 || !Number.isSafeInteger(index.total) || index.total < 0 || !Array.isArray(index.pages) || index.metadata?.sessionId !== sessionId) return null;
  const end = before === undefined ? index.total : Math.min(index.total, Math.max(0, Math.floor(before)));
  const start = Math.max(0, end - SESSION_PAGE_SIZE);
  const messages: ChatMessage[] = [];
  for (let page = Math.floor(start / SESSION_PAGE_SIZE); page <= Math.floor((end - 1) / SESSION_PAGE_SIZE) && end > start; page++) {
    const key = index.pages[page];
    if (typeof key !== "string" || !key.startsWith(`${directory(sessionId)}/`)) return null;
    const records = await spindle.userStorage.getJson<ChatMessage[] | null>(key, { userId, fallback: null });
    if (!records) return null;
    const base = page * SESSION_PAGE_SIZE;
    messages.push(...records.slice(Math.max(0, start - base), Math.min(records.length, end - base)));
  }
  const statusSession: PersistedSession = { ...index.metadata, messages: index.last ? [index.last] : [], llmHistory: [], edits: [] };
  return { session: statusSession, page: { start, end, total: index.total, messages } };
}
