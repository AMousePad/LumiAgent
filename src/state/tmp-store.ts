import type { SpindleAPI } from "lumiverse-spindle-types";

// Session-scoped spillover store for oversized tool results. Path shape is
// `tmp/{sessionId}/{handle}.txt` so session deletion clears the directory.

// Lives inside the workspace tree so the user can see / inspect spills via
// the Files tab. Workspace cap math excludes this subtree.
const TMP_ROOT = "workspace/tmp";
const MAX_HANDLES_PER_LIST = 200;
// LRU eviction triggers on the next write whenever either cap would be
// exceeded after the incoming payload lands.
export const TMP_MAX_FILES_PER_USER = 50;
export const TMP_MAX_BYTES_PER_USER = 30 * 1024 * 1024;

export interface TmpHandleInfo {
  readonly handle: string;
  readonly totalChars: number;
  readonly totalLines: number;
  readonly createdAt: number;
  readonly origin: string;
  // Denormalised so cross-session listing doesn't have to crawl twice.
  readonly sessionId: string;
}

let counter = 0;
function makeHandle(): string {
  counter++;
  return `tmp_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

function bodyPath(sessionId: string, handle: string): string {
  return `${TMP_ROOT}/${sessionId}/${handle}.txt`;
}

function metaPath(sessionId: string, handle: string): string {
  return `${TMP_ROOT}/${sessionId}/${handle}.meta.json`;
}

export async function writeTmp(
  spindle: SpindleAPI,
  sessionId: string,
  userId: string,
  payload: string,
  origin: string,
): Promise<TmpHandleInfo> {
  // Eviction runs before the write so a hot loop can't briefly overshoot.
  await evictUntilFits(spindle, userId, payload.length);
  const handle = makeHandle();
  await spindle.userStorage.write(bodyPath(sessionId, handle), payload, userId);
  const info: TmpHandleInfo = {
    handle,
    totalChars: payload.length,
    totalLines: payload.length === 0 ? 0 : payload.split("\n").length,
    createdAt: Date.now(),
    origin,
    sessionId,
  };
  await spindle.userStorage.setJson(metaPath(sessionId, handle), info, { userId });
  return info;
}

async function deleteTmp(spindle: SpindleAPI, info: TmpHandleInfo, userId: string): Promise<void> {
  try { await spindle.userStorage.delete(bodyPath(info.sessionId, info.handle), userId); } catch { /* already gone */ }
  try { await spindle.userStorage.delete(metaPath(info.sessionId, info.handle), userId); } catch { /* already gone */ }
}

async function listAllTmpMeta(spindle: SpindleAPI, userId: string): Promise<TmpHandleInfo[]> {
  // userStorage.list is non-recursive, so walk session dirs by hand.
  let sessionDirs: string[];
  try { sessionDirs = await spindle.userStorage.list(`${TMP_ROOT}/`, userId); }
  catch { return []; }
  const out: TmpHandleInfo[] = [];
  for (const rel of sessionDirs) {
    const sessionId = rel.endsWith("/") ? rel.slice(0, -1) : rel;
    let entries: string[];
    try { entries = await spindle.userStorage.list(`${TMP_ROOT}/${sessionId}/`, userId); }
    catch { continue; }
    for (const e of entries) {
      if (!e.endsWith(".meta.json")) continue;
      const handle = e.slice(0, -".meta.json".length);
      const info = await spindle.userStorage.getJson<TmpHandleInfo | null>(
        metaPath(sessionId, handle),
        { fallback: null, userId },
      );
      if (info) out.push(info.sessionId ? info : { ...info, sessionId });
    }
  }
  return out;
}

async function evictUntilFits(spindle: SpindleAPI, userId: string, incomingBytes: number): Promise<void> {
  const all = await listAllTmpMeta(spindle, userId);
  all.sort((a, b) => a.createdAt - b.createdAt); // oldest first
  let totalBytes = all.reduce((s, x) => s + x.totalChars, 0);
  let totalFiles = all.length;
  // +1 for the file we're about to create.
  while (
    totalFiles + 1 > TMP_MAX_FILES_PER_USER ||
    totalBytes + incomingBytes > TMP_MAX_BYTES_PER_USER
  ) {
    const victim = all.shift();
    if (!victim) break;
    await deleteTmp(spindle, victim, userId);
    totalBytes -= victim.totalChars;
    totalFiles -= 1;
  }
}

export async function readTmp(
  spindle: SpindleAPI,
  sessionId: string,
  userId: string,
  handle: string,
): Promise<string | null> {
  try {
    return await spindle.userStorage.read(bodyPath(sessionId, handle), userId);
  } catch { return null; }
}

export async function statTmp(
  spindle: SpindleAPI,
  sessionId: string,
  userId: string,
  handle: string,
): Promise<TmpHandleInfo | null> {
  return spindle.userStorage.getJson<TmpHandleInfo | null>(
    metaPath(sessionId, handle),
    { fallback: null, userId },
  );
}

export async function listTmp(
  spindle: SpindleAPI,
  sessionId: string,
  userId: string,
): Promise<readonly TmpHandleInfo[]> {
  let entries: string[];
  try {
    entries = await spindle.userStorage.list(`${TMP_ROOT}/${sessionId}/`, userId);
  } catch { return []; }
  const out: TmpHandleInfo[] = [];
  for (const rel of entries) {
    if (!rel.endsWith(".meta.json")) continue;
    const handle = rel.slice(0, -".meta.json".length);
    const info = await spindle.userStorage.getJson<TmpHandleInfo | null>(
      metaPath(sessionId, handle),
      { fallback: null, userId },
    );
    if (info) out.push(info.sessionId ? info : { ...info, sessionId });
    if (out.length >= MAX_HANDLES_PER_LIST) break;
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function listAllTmpForUser(
  spindle: SpindleAPI,
  userId: string,
): Promise<readonly TmpHandleInfo[]> {
  const all = await listAllTmpMeta(spindle, userId);
  all.sort((a, b) => b.createdAt - a.createdAt);
  return all.slice(0, MAX_HANDLES_PER_LIST);
}

export async function clearSessionTmp(
  spindle: SpindleAPI,
  sessionId: string,
  userId: string,
): Promise<void> {
  const entries = await listTmp(spindle, sessionId, userId);
  for (const info of entries) await deleteTmp(spindle, info, userId);
}
