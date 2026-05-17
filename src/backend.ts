declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import type { CharacterDTO } from "lumiverse-spindle-types";
import type {
  AssistantBlock,
  BackendToFrontend,
  ChatAssistantMessage,
  ChatUserMessage,
  CharacterSummary,
  ConnectionSummary,
  EditLogEntry,
  FrontendToBackend,
  LlmMessage,
  RevertOutcomeWire,
  ScopeRef,
  CharacterStorageEntry,
  SessionStatusWire,
} from "./types";
import { runAgent } from "./agent/loop";
import { listDeferredToolNames, makeDeferredToolSchemaMap, makeInitialToolSchemas, makeToolDispatch, toolRequiresCharacter } from "./agent/tools";
import { systemMessageWithCache } from "./agent/cache-control";
import { buildGeneralSystemPrompt } from "./tasks/general";
import { revertEditWithCheck, revertEdit, writeFieldValue } from "./state/edit-log";
import { appendEntries, entriesView, findEntry, loadLedger, ledgerPath, persistLedgerNow, purgeAllRevertedInMemory, squashMessage } from "./state/ledger";
import { characterScope } from "./types";
import { applySinglePatch, sha256 as patchSha256 } from "./state/patch-stack";
import { type AgentSettings, DEFAULT_PERSONA, loadSettings, saveSettings, resolveWorkspaceCap, resolveToolOutputCapTokens, WORKSPACE_FILE_CAP_BYTES, DEFAULT_WORKSPACE_MAX_FILES, DEFAULT_TOOL_OUTPUT_CAP_TOKENS } from "./state/settings";
import { loadUiPrefs, saveUiPrefs } from "./state/ui-prefs";
import { coerceSamplerBag, samplersToWireWithRequired } from "./state/samplers";
import { BUILTIN_PROMPT_BODY } from "./tasks/general";
import { encodeAssistantTurn, encodeToolResults } from "./agent/protocol";
import type { ToolCall, ToolResult } from "./types";
import {
  loadSession,
  newSession,
  saveSession,
  deleteSessionFile,
  listSessionSummaries,
  spliceRevertedFromSession as spliceReverted,
  type PersistedSession,
} from "./state/sessions";
import {
  initPermissions,
  getMissingPermissions,
  getMissingPermissionPurposes,
  isPermissionsLoaded,
  subscribeToMissingChanges,
  PERMISSION_PURPOSE,
} from "./state/permissions";
import { initHostVersionCheck, getHostVersionWarning } from "./state/version-check";

// Operator-scoped: one process serves every user, so any map keyed only by
// a user-supplied id (sessionId, rpcId, transferId) is a cross-user channel.
// Keep keys namespaced by userId so a request from user B can never reach
// user A's slot.
function scopedKey(userId: string, id: string): string {
  return `${userId}:${id}`;
}

const activeSessions = new Map<string, AbortController>();

// Sessions the user has started but never sent a message in. We keep them
// in memory only; they never hit disk. The first send_message promotes the
// pending session to a persisted one. A page refresh discards them, which
// is the desired behaviour: empty sessions clutter the picker for no gain.
const pendingSessions = new Map<string, PersistedSession>();

async function loadSessionWithPending(sessionId: string, userId: string): Promise<PersistedSession | null> {
  const p = pendingSessions.get(scopedKey(userId, sessionId));
  if (p) return p;
  return loadSession(spindle, sessionId, userId);
}

// Sessions whose generation is a compaction run (also registered in
// activeSessions for the shared abort path). Lets the status resolver label
// the phase distinctly so the UI shows "compacting" rather than "generating".
const compactingSessions = new Set<string>();

// An assistant message carries no usable content when it has no
// non-whitespace text and no tool calls. reasoning-only / warning-only /
// empty all qualify. This is the recover-send target after an errored turn.
function assistantHasNoContent(m: ChatAssistantMessage): boolean {
  for (const b of m.blocks) {
    if (b.type === "tool") return false;
    if (b.type === "text" && b.content.trim().length > 0) return false;
  }
  return true;
}

function computeSessionStatus(s: PersistedSession, userId: string, contextTokens: number): SessionStatusWire {
  const key = scopedKey(userId, s.sessionId);
  // generating = an AbortController is registered (a live runAgent). A merely
  // pending session (staged by start_session, no send yet) is NOT generating.
  const phase: SessionStatusWire["phase"] = compactingSessions.has(key)
    ? "compacting"
    : activeSessions.has(key) ? "generating" : "idle";
  const last = s.messages[s.messages.length - 1];
  let lastAssistant: ChatAssistantMessage | null = null;
  if (last && last.role === "assistant") lastAssistant = last;
  return {
    sessionId: s.sessionId,
    phase,
    lastMessageRole: last ? last.role : null,
    lastAssistantStatus: lastAssistant ? lastAssistant.status : null,
    lastAssistantEmpty: lastAssistant !== null && assistantHasNoContent(lastAssistant),
    lastAssistantId: lastAssistant ? lastAssistant.id : null,
    promptTokens: s.lastPromptTokens ?? 0,
    contextTokens,
  };
}

// Every caller is `void`ed (fire-and-forget on a lifecycle edge). A storage
// hiccup must not become an unhandled rejection or silently strand the UI on
// stale status, so swallow and log: the next transition pushes again.
async function pushSessionStatus(sessionId: string, userId: string): Promise<void> {
  try {
    const s = await loadSessionWithPending(sessionId, userId);
    if (!s) return;
    const settings = await loadSettings(spindle, userId);
    const contextTokens = resolveContextTokens(settings.samplers);
    send({ type: "session_status", status: computeSessionStatus(s, userId, contextTokens) }, userId);
  } catch (err) {
    log("warn", `pushSessionStatus ${sessionId} failed: ${(err as Error).message}`);
  }
}

const DEFAULT_MAX_TURNS_PER_MESSAGE = 80;

function send(msg: BackendToFrontend, userId: string): void {
  spindle.sendToFrontend(msg, userId);
}

// Backend-frontend request/response. The sandbox blocks net APIs, so any tool
// that needs a browser-side capability (Chrome Translator, etc.) hands a
// request to the frontend via this channel. Keyed by rpcId; the frontend
// posts back a frontend_rpc_response which resolves the pending promise.
interface PendingRpc { userId: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
const pendingFrontendRpc = new Map<string, PendingRpc>();
const DEFAULT_FRONTEND_RPC_TIMEOUT_MS = 60_000;

function callFrontend(userId: string, op: string, args: unknown, timeoutMs = DEFAULT_FRONTEND_RPC_TIMEOUT_MS): Promise<unknown> {
  const rpcId = makeId("rpc");
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingFrontendRpc.delete(rpcId);
      reject(new Error(`frontend rpc '${op}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingFrontendRpc.set(rpcId, { userId, resolve, reject, timer });
    try { send({ type: "frontend_rpc_request", rpcId, op, args }, userId); }
    catch (e) {
      clearTimeout(timer);
      pendingFrontendRpc.delete(rpcId);
      reject(e as Error);
    }
  });
}

// The responding userId must match the user the request was issued for.
// Without this check, any user could resolve another user's pending RPC
// (which routes phoneline-consent decisions), silently approving pairings.
function resolveFrontendRpc(rpcId: string, fromUserId: string, result: unknown, error: string | undefined): void {
  const pending = pendingFrontendRpc.get(rpcId);
  if (!pending) return;
  if (pending.userId !== fromUserId) {
    log("warn", `dropped frontend_rpc_response: rpcId=${rpcId} responder=${fromUserId} expected=${pending.userId}`);
    return;
  }
  clearTimeout(pending.timer);
  pendingFrontendRpc.delete(rpcId);
  if (error !== undefined) pending.reject(new Error(error));
  else pending.resolve(result);
}

function log(level: "info" | "warn" | "error", msg: string): void {
  if (level === "info") spindle.log.info(msg);
  else if (level === "warn") spindle.log.warn(msg);
  else spindle.log.error(msg);
}

function makeId(prefix: string): string {
  // crypto.randomUUID() is unguessable, 122 bits of entropy. The prior
  // Date.now+Math.random scheme was ~30 bits, which made cross-user id-guessing
  // attacks practical given that sessionId/rpcId/transferId were used as map
  // keys.
  return `${prefix}_${crypto.randomUUID()}`;
}

function characterToSummary(c: CharacterDTO, regexCount: number): CharacterSummary {
  return {
    id: c.id,
    name: c.name,
    world_book_ids: c.world_book_ids,
    regex_script_count: regexCount,
  };
}

async function handleListCharacters(userId: string): Promise<void> {
  const res = await spindle.characters.list({ limit: 1000, userId });
  const summaries: CharacterSummary[] = await Promise.all(
    res.data.map(async (c) => {
      const rxs = await spindle.regex_scripts.list({ scope: "character", scopeId: c.id, userId, limit: 1 });
      return characterToSummary(c, rxs.total);
    }),
  );
  send({ type: "characters_pushed", characters: summaries }, userId);
}

async function handleListConnections(userId: string): Promise<void> {
  const conns = await spindle.connections.list(userId);
  const out: ConnectionSummary[] = conns.map((c) => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    model: c.model ?? "",
    is_default: c.is_default ?? false,
  }));
  send({ type: "connections_pushed", connections: out }, userId);
}

async function handleListChats(characterId: string, sessionId: string | undefined, userId: string): Promise<void> {
  log("info", `list_chats characterId=${characterId} sessionId=${sessionId ?? "none"}`);
  let active: { id: string } | null = null;
  try { active = await spindle.chats.getActive(userId) ?? null; } catch { /* permission may not be granted yet */ }
  let pinnedChatId: string | null = null;
  let pinSource = "none";
  // Pin is per-session, resolve strictly from the named session. Old activeSessions fallback leaked other sessions' pins onto unpinned ones.
  if (sessionId) {
    try {
      const s = await loadSessionWithPending(sessionId, userId);
      if (s) {
        const characterMatch = s.characterId === characterId;
        log("info", `list_chats: loaded session sessionCharacterId=${s.characterId} pinnedChatId=${s.pinnedChatId ?? "null"} characterMatch=${characterMatch}`);
        if (characterMatch && s.pinnedChatId !== null && s.pinnedChatId !== undefined) {
          pinnedChatId = s.pinnedChatId;
          pinSource = "frontend_session";
        }
      } else {
        log("warn", `list_chats: sessionId=${sessionId} not found`);
      }
    } catch (err) { log("warn", `list_chats: loadSession failed: ${(err as Error).message}`); }
  }
  log("info", `list_chats: resolved pinnedChatId=${pinnedChatId ?? "null"} source=${pinSource}`);
  try {
    const res = await spindle.chats.list({ characterId, userId, limit: 200 });
    const chats = res.data.map((c) => ({
      id: c.id,
      characterId: c.character_id,
      name: c.name,
      updatedAt: c.updated_at,
      createdAt: c.created_at,
      isActive: active?.id === c.id,
      isPinned: pinnedChatId === c.id,
    }));
    chats.sort((a, b) => b.updatedAt - a.updatedAt);
    send({ type: "chats_pushed", characterId, chats, pinnedChatId }, userId);
  } catch (err) {
    log("warn", `list_chats failed: ${(err as Error).message}`);
    send({ type: "chats_pushed", characterId, chats: [], pinnedChatId }, userId);
  }
}

async function loadAgentNotes(userId: string): Promise<string | null> {
  try {
    const { absPath } = await import("./state/workspace");
    const { AGENT_NOTES_PATH } = await import("./state/system-files");
    const stat = await spindle.userStorage.stat(absPath(AGENT_NOTES_PATH), userId);
    if (!stat.exists) return null;
    const text = await spindle.userStorage.read(absPath(AGENT_NOTES_PATH), userId);
    return typeof text === "string" && text.trim().length > 0 ? text : null;
  } catch { return null; }
}

async function resolveExternalProviders(userId: string): Promise<import("./tasks/general").ExternalProviderSummary[]> {
  try {
    const { discoverProviders } = await import("./phoneline/registry");
    const providers = await discoverProviders(spindle, userId);
    return providers.map((p) => ({
      id: p.id,
      name: p.manifest.extension.name,
      surfaces: p.manifest.surfaces.map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        scope: s.scope,
      })),
    }));
  } catch (err) {
    log("warn", `phoneline discovery failed: ${(err as Error).message}`);
    return [];
  }
}

async function resolveExtensionSystemPrompts(userId: string, characterId: string | null): Promise<string> {
  if (characterId === null) return "";
  try {
    const { fetchSystemPromptContributions } = await import("./phoneline/prompt");
    return await fetchSystemPromptContributions(spindle, userId, characterId);
  } catch (err) {
    log("warn", `phoneline system prompt fetch failed: ${(err as Error).message}`);
    return "";
  }
}

async function handleGetPhonelinePairings(userId: string): Promise<void> {
  // Run discovery first. Each known phoneline is auto-approved on response;
  // we swallow errors so the pairings list still flushes even if a provider
  // misbehaves.
  try {
    const { discoverProviders } = await import("./phoneline/registry");
    await discoverProviders(spindle, userId);
  } catch (err) {
    log("warn", `phoneline discovery during pairings refresh failed: ${(err as Error).message}`);
  }
  const { loadAllPairings } = await import("./phoneline/consent");
  const all = await loadAllPairings(spindle, userId);
  const pairings = Object.values(all).map((p) => ({
    identifier: p.identifier,
    displayName: p.displayName,
    allowed: p.allowed,
    decidedAt: p.decidedAt,
  }));
  send({ type: "phoneline_pairings_pushed", pairings }, userId);
}

async function handleSetPhonelinePairing(userId: string, identifier: string, allowed: boolean): Promise<void> {
  const { loadPairing, savePairing } = await import("./phoneline/consent");
  const existing = await loadPairing(spindle, userId, identifier);
  if (!existing) return; // user shouldn't be able to toggle a pairing that isn't already known
  await savePairing(spindle, userId, { ...existing, allowed, decidedAt: Date.now() });
  const { invalidate } = await import("./phoneline/registry");
  invalidate(userId);
  await handleGetPhonelinePairings(userId);
}

async function handleRevokePhonelinePairing(userId: string, identifier: string): Promise<void> {
  const { deletePairing } = await import("./phoneline/consent");
  await deletePairing(spindle, userId, identifier);
  const { invalidate } = await import("./phoneline/registry");
  invalidate(userId);
  await handleGetPhonelinePairings(userId);
}

async function buildSessionSystemMessage(
  c: CharacterDTO | null,
  s: PersistedSession,
  settings: AgentSettings,
  userId: string,
): Promise<LlmMessage> {
  // Lazy snapshot: capture agent.md on the first build of this session, then
  // reuse it for every send. Keeps the prompt cache stable across mid-chat
  // edits to the file. User-facing notice is shown when they edit the file
  // in the workshop.
  if (s.frozenAgentNotes === undefined) {
    s.frozenAgentNotes = await loadAgentNotes(userId);
  }
  const hasCharacter = c !== null;
  let prompt = buildGeneralSystemPrompt({
    characterName: hasCharacter ? c.name : "",
    externalProviders: hasCharacter ? await resolveExternalProviders(userId) : [],
    extensionSystemPrompts: await resolveExtensionSystemPrompts(userId, hasCharacter ? c.id : null),
    persona: settings.persona,
    systemPromptOverride: settings.systemPromptOverride,
    agentNotes: s.frozenAgentNotes,
    deferredToolNames: listDeferredToolNames().filter((n) => hasCharacter || !toolRequiresCharacter(n)),
  });
  if (settings.jailbreak.trim().length > 0 && settings.jailbreakPlacement === "system_suffix") {
    prompt = `${prompt}\n\n${settings.jailbreak}`;
  }
  return systemMessageWithCache(prompt, settings.cacheMode);
}

// Apply the non-system jailbreak placements to a conversation already
// seeded with the system message. system_suffix is handled in
// buildSessionSystemMessage; the other two placements append a message.
function applyJailbreakNonSystem(conv: LlmMessage[], settings: AgentSettings): void {
  if (settings.jailbreak.trim().length === 0) return;
  if (settings.jailbreakPlacement === "user_suffix") {
    conv.push({ role: "user", content: settings.jailbreak });
  } else if (settings.jailbreakPlacement === "assistant_prefill") {
    conv.push({ role: "assistant", content: settings.jailbreak });
  }
}

async function handleGetSettings(userId: string): Promise<void> {
  const settings = await loadSettings(spindle, userId);
  const { DEFAULT_WORKSPACE_CAP_BYTES } = await import("./state/settings");
  send({
    type: "settings_pushed",
    persona: settings.persona,
    systemPromptOverride: settings.systemPromptOverride,
    defaultPersona: DEFAULT_PERSONA,
    defaultSystemPromptBody: BUILTIN_PROMPT_BODY,
    samplers: settings.samplers,
    jailbreak: settings.jailbreak,
    jailbreakPlacement: settings.jailbreakPlacement,
    workspaceCapBytes: settings.workspaceCapBytes,
    workspaceCapDefaultBytes: DEFAULT_WORKSPACE_CAP_BYTES,
    workspaceFileCapBytes: WORKSPACE_FILE_CAP_BYTES,
    toolOutputCapTokens: settings.toolOutputCapTokens,
    toolOutputCapDefaultTokens: DEFAULT_TOOL_OUTPUT_CAP_TOKENS,
    cacheMode: settings.cacheMode,
    parallelToolCalls: settings.parallelToolCalls,
    tpmLimit: settings.tpmLimit,
  }, userId);
}

async function resolveCapsForUser(userId: string): Promise<{ workspaceCaps: { maxTotalBytes: number; maxFiles: number; maxFileBytes: number } }> {
  const settings = await loadSettings(spindle, userId);
  return {
    workspaceCaps: {
      maxTotalBytes: resolveWorkspaceCap(settings),
      maxFiles: DEFAULT_WORKSPACE_MAX_FILES,
      maxFileBytes: WORKSPACE_FILE_CAP_BYTES,
    },
  };
}

// userId MUST be passed: the host rejects cross-user connection reads, so
// dropping it would expose another user's profile. Returns undefined when
// the connection is missing or not owned by this user.
async function resolveModelForConnection(connectionId: string | null | undefined, userId: string): Promise<string | undefined> {
  if (!connectionId) return undefined;
  try {
    const profile = await spindle.connections.get(connectionId, userId);
    if (!profile) return undefined;
    const m = profile.model;
    return typeof m === "string" && m.length > 0 ? m : undefined;
  } catch { return undefined; }
}

async function resolveProviderForConnection(connectionId: string | null | undefined, userId: string): Promise<string | undefined> {
  if (!connectionId) return undefined;
  try {
    const profile = await spindle.connections.get(connectionId, userId);
    return profile?.provider;
  } catch { return undefined; }
}

// `parallel_tool_calls` is an OpenAI-style parameter. Google rejects unknown
// top-level fields outright (400 INVALID_ARGUMENT); Anthropic uses a different
// shape (`tool_choice.disable_parallel_tool_use`). Drop it on providers that
// don't speak the OpenAI flavour.
const PARALLEL_TOOLS_INCOMPATIBLE_PROVIDERS: ReadonlySet<string> = new Set([
  "google",
  "google-vertex",
  "anthropic",
]);

function buildSamplerParams(
  samplers: Readonly<Record<string, number | null>>,
  parallelToolCalls: boolean,
  provider: string | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...samplersToWireWithRequired(samplers) };
  if (provider && PARALLEL_TOOLS_INCOMPATIBLE_PROVIDERS.has(provider)) return base;
  base["parallel_tool_calls"] = parallelToolCalls;
  return base;
}

async function handleUpdateSettings(
  persona: string,
  systemPromptOverride: string | null,
  samplers: Readonly<Record<string, number | null>>,
  jailbreak: string,
  jailbreakPlacement: "system_suffix" | "user_suffix" | "assistant_prefill",
  workspaceCapBytes: number | null,
  toolOutputCapTokens: number | null,
  cacheMode: "off" | "system_only" | "full",
  parallelToolCalls: boolean,
  tpmLimit: number | null,
  userId: string,
): Promise<void> {
  await saveSettings(spindle, {
    version: 3,
    persona: persona.length > 0 ? persona : DEFAULT_PERSONA,
    systemPromptOverride: systemPromptOverride !== null && systemPromptOverride.trim().length > 0 ? systemPromptOverride : null,
    samplers: coerceSamplerBag(samplers),
    jailbreak: typeof jailbreak === "string" ? jailbreak : "",
    jailbreakPlacement,
    workspaceCapBytes,
    toolOutputCapTokens,
    cacheMode,
    parallelToolCalls,
    tpmLimit,
  }, userId);
  await handleGetSettings(userId);
}

async function handleGetUiPrefs(userId: string): Promise<void> {
  const prefs = await loadUiPrefs(spindle, userId);
  send({ type: "ui_prefs_pushed", connectionId: prefs.connectionId, lastSessionId: prefs.lastSessionId }, userId);
}

async function handleUpdateUiPrefs(connectionId: string | null, lastSessionId: string | null, userId: string): Promise<void> {
  await saveUiPrefs(spindle, { version: 2, connectionId, lastSessionId }, userId);
}

// ───── per-character storage view + squash ─────

async function handleListCharactersStorage(userId: string): Promise<void> {
  try {
    const { getWorkspaceUsage } = await import("./state/workspace");
    const { workspaceCaps } = await resolveCapsForUser(userId);
    const workspaceUsage = await getWorkspaceUsage(spindle, userId);
    const charactersRes = await spindle.characters.list({ limit: 1000, userId });
    // Parallelise per-character ledger + stat. Serial scan was O(N) round-trips
    // and dominated the workshop refresh latency on accounts with many cards.
    const perChar = await Promise.all(charactersRes.data.map(async (c) => {
      const ledger = await loadLedger(spindle, characterScope(c.id), userId).catch(() => null);
      const view = ledger ? entriesView(ledger) : [];
      if (view.length === 0) return null;
      let ledgerBytes = 0;
      try {
        const s = await spindle.userStorage.stat(ledgerPath(characterScope(c.id)), userId);
        if (s.exists) ledgerBytes = s.sizeBytes;
      } catch { /* missing on disk, cache only */ }
      return {
        characterId: c.id,
        characterName: c.name,
        editCount: view.length,
        liveEditCount: view.filter((e) => !e.reverted).length,
        ledgerBytes,
      };
    }));
    const entries: CharacterStorageEntry[] = perChar.filter((e): e is NonNullable<typeof e> => e !== null);

    // Non-character scopes have no entity list to iterate, so enumerate their
    // ledger directories directly. Empty ledgers are skipped like characters.
    for (const kind of ["persona", "chat", "preset", "world_book", "regex_script"] as const) {
      let names: string[] = [];
      try { names = await spindle.userStorage.list(`ledgers/${kind}/`, userId); } catch { /* no dir yet */ }
      for (const rel of names) {
        const base = rel.split(/[\\/]/).pop() ?? "";
        if (!base.endsWith(".json")) continue;
        const id = base.slice(0, -5);
        const scope: ScopeRef = { kind, id };
        const ledger = await loadLedger(spindle, scope, userId).catch(() => null);
        const view = ledger ? entriesView(ledger) : [];
        if (view.length === 0) continue;
        let ledgerBytes = 0;
        try {
          const st = await spindle.userStorage.stat(ledgerPath(scope), userId);
          if (st.exists) ledgerBytes = st.sizeBytes;
        } catch { /* cache only */ }
        const kindLabel = kind === "chat" ? "Chat"
          : kind === "preset" ? "Preset"
          : kind === "world_book" ? "World book"
          : kind === "regex_script" ? "Regex script"
          : "Persona";
        let label = `${kindLabel} ${id.slice(0, 8)}`;
        if (kind === "persona") {
          try { const p = await spindle.personas.get(id, userId); if (p) label = p.name; } catch { /* fall back to id */ }
        } else if (kind === "preset") {
          try { const p = await spindle.presets.get(id, userId); if (p) label = p.name; } catch { /* fall back to id */ }
        } else if (kind === "world_book") {
          try { const wb = await spindle.world_books.get(id, userId); if (wb) label = wb.name; } catch { /* fall back to id */ }
        }
        entries.push({
          characterId: id, characterName: label, label, scope,
          editCount: view.length,
          liveEditCount: view.filter((e) => !e.reverted).length,
          ledgerBytes,
        });
      }
    }
    entries.sort((a, b) => b.ledgerBytes - a.ledgerBytes || b.editCount - a.editCount);

    send({
      type: "characters_storage_pushed",
      entries,
      workspaceUsedBytes: workspaceUsage.totalBytes,
      workspaceCapBytes: workspaceCaps.maxTotalBytes,
    }, userId);
  } catch (err) {
    log("warn", `list_characters_storage failed: ${(err as Error).message}`);
  }
}

async function handleSquashCharacter(scope: ScopeRef, userId: string): Promise<void> {
  try {
    const { dropCache } = await import("./state/ledger");
    let ledgerCleared = false;
    try {
      await spindle.userStorage.delete(ledgerPath(scope), userId);
      dropCache(scope, userId);
      ledgerCleared = true;
    } catch { /* nothing to clear */ }
    send({ type: "scope_squashed", scope, ledgerCleared }, userId);
    await handleListCharactersStorage(userId);
  } catch (err) {
    log("warn", `squash_character ${scope.kind}:${scope.id} failed: ${(err as Error).message}`);
  }
}

async function handleRevertCharacterAll(scope: ScopeRef, userId: string): Promise<void> {
  try {
    const ledger = await loadLedger(spindle, scope, userId);
    const liveIds: string[] = [];
    for (const f of ledger.files) for (const p of f.patches) {
      if (!p.reverted) liveIds.push(p.id);
    }
    for (const s of ledger.structural) if (!s.reverted) liveIds.push(s.id);
    for (const e of ledger.externalEdits) if (!e.reverted) liveIds.push(e.id);
    if (liveIds.length === 0) {
      send({ type: "edits_reverted_bulk", scope, outcomes: [] }, userId);
      return;
    }
    await handleRevertEditsBulk(scope, liveIds, userId);
  } catch (err) {
    log("warn", `revert_character_all ${scope.kind}:${scope.id} failed: ${(err as Error).message}`);
  }
}

async function handleLoadCharacterWorkshop(scope: ScopeRef, userId: string): Promise<void> {
  // Surfaces any scope's ledger without changing the active session. The
  // Scopes tab uses this to swap the Edits view to another scope's edits.
  try {
    const ledger = await loadLedger(spindle, scope, userId);
    send({ type: "scope_edits_pushed", scope, entries: entriesView(ledger) }, userId);
  } catch (err) {
    log("warn", `load_character_workshop ${scope.kind}:${scope.id} failed: ${(err as Error).message}`);
  }
}

// ───── context tracking + compaction ─────

const AUTO_COMPACT_THRESHOLD = 0.84;
const HANDOFF_PATH = "HANDOFF.md";

// Replace every text block on the assistant message with a single cleaned
// one appended at the end. Tool blocks keep their place. Used when the
// agent loop strips text-form tool-call markup from the model's output.
function replaceAssistantTextBlocks(assistant: ChatAssistantMessage, cleaned: string): void {
  assistant.blocks = assistant.blocks.filter((b) => b.type !== "text");
  if (cleaned.trim().length > 0) {
    assistant.blocks.push({ type: "text", content: cleaned });
  }
}

function emitContextUsage(s: PersistedSession, contextTokens: number, userId: string): void {
  const promptTokens = s.lastPromptTokens ?? 0;
  const percentUsed = contextTokens > 0 ? promptTokens / contextTokens : 0;
  send({ type: "context_usage", sessionId: s.sessionId, promptTokens, contextTokens, percentUsed }, userId);
}

function resolveContextTokens(samplers: Readonly<Record<string, number | null>>): number {
  const v = samplers["contextSize"];
  return typeof v === "number" && v > 0 ? v : 400_000;
}

function shouldAutoCompact(s: PersistedSession, samplers: Readonly<Record<string, number | null>>): boolean {
  const promptTokens = s.lastPromptTokens ?? 0;
  if (promptTokens === 0) return false;
  // Skip if we just compacted this turn, otherwise we'd loop on a single huge
  // turn that still hovers near the threshold.
  if (s.compactedAt !== undefined && Date.now() - s.compactedAt < 30_000) return false;
  const ctx = resolveContextTokens(samplers);
  return promptTokens / ctx >= AUTO_COMPACT_THRESHOLD;
}

function buildCompactionInstruction(maxHandoffChars: number): string {
  return `[SYSTEM COMPACTION REQUEST]

The conversation is approaching its context limit. Your one and only job this turn is to write or update workspace/${HANDOFF_PATH} so that a fresh copy of you can pick up exactly where you left off.

Rules:
- Read the current workspace/${HANDOFF_PATH} first (fs_read). If it exists and is still relevant, edit it. Otherwise overwrite it.
- The file MUST be under ${maxHandoffChars} chars. Aim much lower (under half this).
- Information-dense prose only. No preamble, no conclusion, no apologies, no AI-fingerprint phrasing.
- Cover, in order:
  1. The user's original request (one sentence).
  2. Everything you've done so far that matters (concrete: characters touched, fields edited, regex scripts renamed, lorebook entries added, tools called repeatedly).
  3. What's currently in progress (the specific next step you were about to take).
  4. What to do next, ordered.
  5. Hard facts to remember: character ids, exact regex patterns, file paths, naming conventions, the user's stated preferences, anything that would be expensive to rediscover.
- DO NOT respond to the user in chat this turn.
- After writing the file, stop. The next thing you say should be "Handoff saved." and nothing else.`;
}

async function compactSession(sessionId: string, userId: string, trigger: "auto" | "manual"): Promise<void> {
  log("info", `compact_session sessionId=${sessionId} trigger=${trigger}`);
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "ws_error", error: "Wait for the current generation to finish before compacting." }, userId);
    return;
  }
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) { send({ type: "ws_error", error: "Session not found." }, userId); return; }
  let c: CharacterDTO | null = null;
  if (s.characterId !== null) {
    c = await spindle.characters.get(s.characterId, userId);
    if (!c) { send({ type: "ws_error", error: "Character not found." }, userId); return; }
  }

  send({ type: "compaction_started", sessionId }, userId);

  const settings = await loadSettings(spindle, userId);
  const contextTokens = resolveContextTokens(settings.samplers);
  // Cap the handoff at 15% of context, with a conservative chars-per-token of 3.
  const maxHandoffChars = Math.floor(contextTokens * 0.15) * 3;

  const ac = new AbortController();
  compactingSessions.add(scopedKey(userId, sessionId));
  activeSessions.set(scopedKey(userId, sessionId), ac);
  void pushSessionStatus(sessionId, userId);

  try {
    const systemMsg = await buildSessionSystemMessage(c, s, settings, userId);
    const compactPrompt = buildCompactionInstruction(maxHandoffChars);
    const conv: LlmMessage[] = [systemMsg, ...s.llmHistory, { role: "user", content: compactPrompt }];

    const hasCharacter = s.characterId !== null;
    const tools = makeInitialToolSchemas(hasCharacter);
    const deferredToolSchemas = makeDeferredToolSchemaMap(hasCharacter);
    const dispatch = makeToolDispatch();
    const provider = await resolveProviderForConnection(s.connectionId, userId);
    const samplerParams = buildSamplerParams(settings.samplers, settings.parallelToolCalls, provider);
    const assistantId = makeId("msg");
    const assistant: ChatAssistantMessage = { id: assistantId, role: "assistant", ts: Date.now(), turn: 0, blocks: [{ type: "text", content: "[Compacting context, writing handoff notes...]" }], status: "streaming" };
    s.messages.push(assistant);

    let currentText: AssistantBlock & { type: "text" } | null = null;
    const toolBlocks = new Map<string, AssistantBlock & { type: "tool" }>();
    for await (const ev of runAgent({
      spindle, userId, sessionId, characterId: s.characterId, assistantMessageId: assistantId,
      pinnedChatId: s.pinnedChatId ?? null,
      conversation: conv, tools, deferredToolSchemas, dispatch,
      ...(s.connectionId ? { connectionId: s.connectionId } : {}),
      parameters: samplerParams,
      ...(settings.samplers.contextSize !== null ? { contextTokens: settings.samplers.contextSize } : {}),
      toolOutputCapTokens: resolveToolOutputCapTokens(settings),
      tokenizerModelId: await resolveModelForConnection(s.connectionId, userId),
      maxTurns: 8, startingTurn: 0, cacheMode: settings.cacheMode, tpmLimit: settings.tpmLimit, signal: ac.signal,
    })) {
      send({ type: "chat_event", sessionId, event: ev }, userId);
      switch (ev.type) {
        case "turn_started":
          assistant.turn = ev.turn;
          currentText = null;
          break;
        case "llm_token":
          if (!currentText) { currentText = { type: "text", content: ev.token }; assistant.blocks.push(currentText); }
          else currentText.content += ev.token;
          break;
        case "tool_started": {
          currentText = null;
          const block: AssistantBlock & { type: "tool" } = { type: "tool", call_id: ev.call_id, name: ev.name, args: ev.args, edit_ids: [] };
          assistant.blocks.push(block); toolBlocks.set(ev.call_id, block);
          break;
        }
        case "tool_finished": {
          const block = toolBlocks.get(ev.call_id);
          if (block) { block.result = ev.result; block.is_error = ev.is_error; block.edit_ids = [...ev.edit_ids]; }
          break;
        }
        case "turn_completed":
          if (ev.usage) { assistant.usage = ev.usage; s.lastPromptTokens = ev.usage.prompt; }
          if (ev.cleanedContent !== undefined) replaceAssistantTextBlocks(assistant, ev.cleanedContent);
          break;
        default: break;
      }
    }
    assistant.status = "complete";

    // Replace the model-facing history with a short primer so the next turn
    // starts fresh. The user's UI thread keeps the full history for their own
    // record; this only affects what the model sees next.
    s.llmHistory = [
      { role: "user", content: `[The previous agent compacted this conversation. Detailed handoff notes are saved at workspace/${HANDOFF_PATH}. If you need any context from before this point, read that file first with fs_read("${HANDOFF_PATH}"). Then respond to whatever the user says next.]` },
    ];
    s.compactedAt = Date.now();
    s.lastPromptTokens = 0;

    // Append a visible boundary message in the user's thread so they can see
    // where the compaction happened on next session reload.
    const marker: ChatAssistantMessage = {
      id: makeId("msg"),
      role: "assistant",
      ts: Date.now(),
      turn: assistant.turn,
      blocks: [{ type: "text", content: `Context compacted. Handoff notes saved at workspace/${HANDOFF_PATH}. The next agent will read this file before responding.` }],
      status: "complete",
    };
    s.messages.push(marker);

    await saveSession(spindle, s, userId);
    send({ type: "compaction_completed", sessionId, handoffPath: HANDOFF_PATH, promptTokens: 0, contextTokens }, userId);
    emitContextUsage(s, contextTokens, userId);
  } catch (err) {
    // User-initiated stop aborts the compaction AC. That surfaces here as a
    // thrown abort; treat it as a clean cancel, not a failure toast. The
    // partial assistant bubble stays as the persisted last message.
    if (ac.signal.aborted) {
      log("info", `compactSession ${sessionId} cancelled by user`);
      try { await saveSession(spindle, s, userId); } catch { /* best-effort */ }
      send({ type: "compaction_completed", sessionId, handoffPath: HANDOFF_PATH, promptTokens: s.lastPromptTokens ?? 0, contextTokens }, userId);
    } else {
      log("error", `compactSession ${sessionId} failed: ${(err as Error).message}`);
      send({ type: "ws_error", error: `Compaction failed: ${(err as Error).message}` }, userId);
    }
  } finally {
    activeSessions.delete(scopedKey(userId, sessionId));
    compactingSessions.delete(scopedKey(userId, sessionId));
    void pushSessionStatus(sessionId, userId);
  }
}

// ───── workspace handlers ─────

function guessMimeType(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "txt": case "md": case "log": return "text/plain";
    case "json": return "application/json";
    case "html": case "htm": return "text/html";
    case "css": return "text/css";
    case "js": return "application/javascript";
    case "ts": return "application/typescript";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "pdf": return "application/pdf";
    case "zip": return "application/zip";
    default: return "application/octet-stream";
  }
}

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/javascript" || mime === "application/typescript" || mime === "image/svg+xml";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return Buffer.from(binary, "binary").toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function handleWsList(path: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    // Self-heal system seeds when listing the root. Idempotent; cheap when
    // they already exist (one stat per file).
    if (ws.normaliseRelPath(path) === "") {
      const { ensureSystemFiles } = await import("./state/system-files");
      await ensureSystemFiles(spindle, userId).catch((e) => log("warn", `ensureSystemFiles failed: ${(e as Error).message}`));
    }
    const entries = await ws.listDir(spindle, userId, path);
    send({ type: "ws_listed", path: ws.normaliseRelPath(path), entries }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsReadText(path: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const node = await ws.stat(spindle, userId, path);
    if (!node || node.isDirectory) throw new Error(`'${path}' is not a file`);
    if (node.sizeBytes > 2 * 1024 * 1024) throw new Error(`file is ${node.sizeBytes} bytes, too large to preview inline. Download instead.`);
    const content = await ws.readText(spindle, userId, path);
    send({ type: "ws_text_pushed", path: ws.normaliseRelPath(path), content, sizeBytes: node.sizeBytes }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

// Copy a file (text or binary) to a sibling path with " (copy)" / " (copy 2)"
// suffix until the name is free. Used by the Files tab's Duplicate button.
async function handleWsDuplicate(path: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const node = await ws.stat(spindle, userId, path);
    if (!node) throw new Error(`'${path}' not found`);
    if (node.isDirectory) throw new Error(`'${path}' is a directory; duplicating folders isn't supported yet`);
    const norm = ws.normaliseRelPath(path);
    const slashIx = norm.lastIndexOf("/");
    const dir = slashIx < 0 ? "" : norm.slice(0, slashIx);
    const name = slashIx < 0 ? norm : norm.slice(slashIx + 1);
    const dotIx = name.lastIndexOf(".");
    const stem = dotIx > 0 ? name.slice(0, dotIx) : name;
    const ext = dotIx > 0 ? name.slice(dotIx) : "";
    const candidate = (n: number): string => {
      const suffix = n === 1 ? "(copy)" : `(copy ${n})`;
      const childName = `${stem} ${suffix}${ext}`;
      return dir === "" ? childName : `${dir}/${childName}`;
    };
    let dest = "";
    for (let i = 1; i < 100; i++) {
      const c = candidate(i);
      const s = await ws.stat(spindle, userId, c);
      if (!s) { dest = c; break; }
    }
    if (!dest) throw new Error("couldn't find a free name");
    const { workspaceCaps } = await resolveCapsForUser(userId);
    // Binary vs text: try text first, fall back to binary if read fails or
    // the file looks non-textual (we don't sniff content; just try).
    try {
      const text = await ws.readText(spindle, userId, path);
      await ws.writeText(spindle, userId, dest, text, workspaceCaps);
    } catch {
      const bytes = await ws.readBinary(spindle, userId, path);
      await ws.writeBinary(spindle, userId, dest, bytes, workspaceCaps);
    }
    send({ type: "ws_changed" }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsWriteText(path: string, content: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const { workspaceCaps } = await resolveCapsForUser(userId);
    await ws.writeText(spindle, userId, path, content, workspaceCaps);
    send({ type: "ws_changed" }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsUploadBinary(path: string, dataBase64: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const bytes = base64ToBytes(dataBase64);
    const { workspaceCaps } = await resolveCapsForUser(userId);
    await ws.writeBinary(spindle, userId, path, bytes, workspaceCaps);
    send({ type: "ws_changed" }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

// Chunked upload assembly buffer. Keyed by `${userId}:${transferId}` so
// concurrent uploads from the same user don't collide. Cleared on completion
// or when a different transferId starts writing to the same path.
const uploadBuffers = new Map<string, { path: string; total: number; parts: string[] }>();
const UPLOAD_BUFFER_TTL_MS = 5 * 60_000;
const uploadBufferTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearUploadBuffer(key: string): void {
  uploadBuffers.delete(key);
  const t = uploadBufferTimers.get(key);
  if (t) { clearTimeout(t); uploadBufferTimers.delete(key); }
}

async function handleWsUploadPart(transferId: string, path: string, dataBase64: string, index: number, total: number, userId: string): Promise<void> {
  const key = `${userId}:${transferId}`;
  try {
    let buf = uploadBuffers.get(key);
    if (!buf) {
      buf = { path, total, parts: new Array(total).fill("") };
      uploadBuffers.set(key, buf);
      uploadBufferTimers.set(key, setTimeout(() => {
        log("warn", `upload transfer ${transferId} timed out`);
        clearUploadBuffer(key);
      }, UPLOAD_BUFFER_TTL_MS));
    }
    if (buf.path !== path || buf.total !== total) {
      throw new Error(`upload part for ${transferId} mismatches path or total`);
    }
    if (index < 0 || index >= total) throw new Error(`bad upload index ${index}`);
    buf.parts[index] = dataBase64;
    // Check completion: every slot must be a non-empty string.
    if (buf.parts.every((p) => p.length > 0)) {
      const ws = await import("./state/workspace");
      // Concatenate decoded bytes in order.
      const decoded = buf.parts.map((b64) => base64ToBytes(b64));
      const totalLen = decoded.reduce((s, b) => s + b.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let off = 0;
      for (const b of decoded) { merged.set(b, off); off += b.byteLength; }
      clearUploadBuffer(key);
      const { workspaceCaps } = await resolveCapsForUser(userId);
      await ws.writeBinary(spindle, userId, path, merged, workspaceCaps);
      send({ type: "ws_changed" }, userId);
    }
  } catch (err) {
    clearUploadBuffer(key);
    send({ type: "ws_error", error: (err as Error).message }, userId);
  }
}

async function handleWsDelete(path: string, recursive: boolean, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const node = await ws.stat(spindle, userId, path);
    if (!node) { send({ type: "ws_changed" }, userId); return; }
    if (node.isDirectory && !recursive) {
      const kids = await ws.listDir(spindle, userId, path);
      if (kids.length > 0) throw new Error(`directory '${path}' is not empty`);
    }
    await ws.remove(spindle, userId, path);
    send({ type: "ws_changed" }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsMove(from: string, to: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    await ws.movePath(spindle, userId, from, to);
    send({ type: "ws_changed" }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsMkdir(path: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    await ws.makeDir(spindle, userId, path);
    send({ type: "ws_changed" }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsDownload(path: string, userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const node = await ws.stat(spindle, userId, path);
    if (!node) throw new Error(`'${path}' not found`);
    if (node.isDirectory) throw new Error(`'${path}' is a directory; use ws_download_zip`);
    const mime = guessMimeType(path);
    let bytes: Uint8Array;
    if (isTextMime(mime)) {
      const text = await ws.readText(spindle, userId, path);
      bytes = new TextEncoder().encode(text);
    } else {
      bytes = await ws.readBinary(spindle, userId, path);
    }
    send({ type: "ws_download_ready", path: ws.normaliseRelPath(path), dataBase64: bytesToBase64(bytes), mimeType: mime }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleWsDownloadZip(paths: readonly string[], userId: string): Promise<void> {
  try {
    const ws = await import("./state/workspace");
    const { buildZip } = await import("./state/zip");
    type Entry = { path: string; bytes: Uint8Array };
    const entries: Entry[] = [];
    const seen = new Set<string>();
    const enqueueFile = async (rel: string) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const mime = guessMimeType(rel);
      let bytes: Uint8Array;
      try {
        if (isTextMime(mime)) {
          const text = await ws.readText(spindle, userId, rel);
          bytes = new TextEncoder().encode(text);
        } else {
          bytes = await ws.readBinary(spindle, userId, rel);
        }
      } catch { return; }
      entries.push({ path: rel, bytes });
    };
    const targets = paths.length === 0 ? [""] : paths;
    for (const p of targets) {
      const node = await ws.stat(spindle, userId, p);
      if (!node) continue;
      if (node.isDirectory) {
        const files = await ws.walk(spindle, userId, p);
        for (const f of files) await enqueueFile(f.path);
      } else {
        await enqueueFile(node.path);
      }
    }
    if (entries.length === 0) throw new Error("nothing to download");
    const zip = buildZip(entries);
    const filename = paths.length === 1 ? `${(paths[0] ?? "workspace").replace(/\//g, "_") || "workspace"}.zip` : "workspace.zip";
    send({ type: "ws_zip_ready", dataBase64: bytesToBase64(zip), filename }, userId);
  } catch (err) { send({ type: "ws_error", error: (err as Error).message }, userId); }
}

async function handleSetPinnedChat(sessionId: string, chatId: string | null, userId: string): Promise<void> {
  log("info", `set_pinned_chat sessionId=${sessionId} chatId=${chatId ?? "null"}`);
  const isPending = pendingSessions.has(scopedKey(userId, sessionId));
  const s = await loadSessionWithPending(sessionId, userId);
  if (!s) {
    log("warn", `set_pinned_chat: session ${sessionId} not found, evicting frontend`);
    send({ type: "session_deleted", sessionId }, userId);
    return;
  }
  const prevPin = s.pinnedChatId ?? null;
  log("info", `set_pinned_chat: loaded session sessionCharacterId=${s.characterId} prevPinnedChatId=${prevPin ?? "null"} pending=${isPending}`);
  s.pinnedChatId = chatId;

  // Mirror the revert-note pattern: tell the agent the pin changed via a
  // system note on llmHistory so the next turn sees it. The chat name/id
  // stays out of the system prompt (cache-stable) but the agent learns from
  // a one-shot note here that it should re-read via read_chat_messages.
  if (!isPending && s.llmHistory.length > 0 && prevPin !== chatId) {
    const note = chatId === null
      ? "[Note from the system: the user just unpinned the chat that was previously pinned for context. From now on, `read_chat_messages` (no chat_id) will return `{pinned: false}`. If the user references 'this chat' or 'the conversation', tell them to pin one again.]"
      : prevPin === null
        ? "[Note from the system: the user just pinned a chat for context. `read_chat_messages` (no chat_id) now returns the messages of that chat. The pin replaces whatever you previously knew about chat history; re-read if you need fresh context.]"
        : "[Note from the system: the user just swapped the pinned chat. Any chat-history context you had cached is stale; `read_chat_messages` (no chat_id) now points at a different chat. Re-read it before referencing 'this chat' / 'the conversation'.]";
    s.llmHistory.push({ role: "user", content: note });
  }

  // Pending sessions stay in memory: mutating the held object is the save.
  // Disk write only fires once the session has its first message.
  if (!isPending) await saveSession(spindle, s, userId);
  log("info", `set_pinned_chat: ${isPending ? "updated in-memory pending session" : "saved"}, replying pinned_chat_set`);
  send({ type: "pinned_chat_set", sessionId, chatId }, userId);
}

async function handleListSessions(filter: string | null | undefined, userId: string): Promise<void> {
  // activeSessions is keyed by `${userId}:${sessionId}`. Extract just this
  // user's sessionIds for the "isActive" flag, otherwise we'd leak that another
  // user has a session of that id running.
  const prefix = `${userId}:`;
  const activeIds = new Set<string>();
  for (const k of activeSessions.keys()) {
    if (k.startsWith(prefix)) activeIds.add(k.slice(prefix.length));
  }
  const sessions = await listSessionSummaries(spindle, userId, activeIds, filter);
  send({ type: "sessions_pushed", sessions }, userId);
}

async function handleLoadSession(sessionId: string, userId: string): Promise<void> {
  const s = await loadSessionWithPending(sessionId, userId);
  if (!s) {
    log("warn", `load_session: ${sessionId} not found`);
    // A pending session that never saw a message is gone after a refresh.
    // Tell the frontend explicitly so it clears its in-memory pointer instead
    // of sitting on a dead session id.
    send({ type: "session_deleted", sessionId }, userId);
    return;
  }
  const settings = await loadSettings(spindle, userId);
  send({
    type: "session_loaded",
    sessionId: s.sessionId,
    characterId: s.characterId,
    characterName: s.characterName,
    createdAt: s.createdAt,
    messages: s.messages,
    edits: s.edits,
    status: computeSessionStatus(s, userId, resolveContextTokens(settings.samplers)),
  }, userId);
}

async function handleStartSession(sessionId: string, characterId: string | null, connectionId: string | undefined, userId: string): Promise<void> {
  log("info", `start_session sessionId=${sessionId} characterId=${characterId ?? "(none)"}`);
  // Stage the pending session synchronously so a follow-up set_pinned_chat or
  // list_chats arriving while we await character lookup or system-file seeding
  // still finds the session. characterName fills in below once we resolve it.
  const s = newSession({
    sessionId,
    characterId,
    characterName: "",
    connectionId: connectionId ?? null,
  });
  pendingSessions.set(scopedKey(userId, sessionId), s);

  try {
    if (characterId !== null) {
      const c = await spindle.characters.get(characterId, userId);
      if (!c) {
        pendingSessions.delete(scopedKey(userId, sessionId));
        send({ type: "generation_error", sessionId, error: `character ${characterId} not found` }, userId);
        return;
      }
      (s as { characterName: string }).characterName = c.name;
    }
    // Seed system files so the agent has its custom-tools index and notes
    // available from turn one. Idempotent, restored if the user deleted them.
    const { ensureSystemFiles } = await import("./state/system-files");
    await ensureSystemFiles(spindle, userId).catch((e) => log("warn", `ensureSystemFiles failed: ${(e as Error).message}`));

    send({
      type: "session_started",
      sessionId,
      characterId,
      characterName: s.characterName,
      createdAt: s.createdAt,
    }, userId);
    // No list refresh, an empty session shouldn't appear in the picker.
  } catch (err) {
    pendingSessions.delete(scopedKey(userId, sessionId));
    const msg = (err as Error).message;
    log("error", `start_session ${sessionId} threw: ${msg}`);
    send({ type: "generation_error", sessionId, error: `start_session failed: ${msg}` }, userId);
  }
}

// Re-run the agent on the current session state without appending a new
// user message. Used by the composer's "empty send" path when the last
// message is a user message that the agent didn't finish replying to.
async function handleContinueSession(sessionId: string, connectionId: string | undefined, userId: string): Promise<void> {
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "generation_error", sessionId, error: "session already has a generation in flight" }, userId);
    return;
  }
  const s = await loadSessionWithPending(sessionId, userId);
  if (!s) { send({ type: "generation_error", sessionId, error: `session ${sessionId} not found` }, userId); return; }
  if (s.messages.length === 0 || s.messages[s.messages.length - 1]!.role !== "user") {
    send({ type: "generation_error", sessionId, error: "nothing to continue: last message is not a user message" }, userId);
    return;
  }
  void handleSendMessageInternal(s, userId, connectionId);
}

async function handleSendMessage(
  sessionId: string,
  userMessageId: string,
  content: string,
  connectionId: string | undefined,
  userId: string,
): Promise<void> {
  log("info", `send_message sessionId=${sessionId} userMessageId=${userMessageId} contentLen=${content.length}`);
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "generation_error", sessionId, error: "session already has a generation in flight" }, userId);
    return;
  }
  const wasPending = pendingSessions.has(scopedKey(userId, sessionId));
  const s = await loadSessionWithPending(sessionId, userId);
  if (!s) {
    send({ type: "generation_error", sessionId, error: `session ${sessionId} not found` }, userId);
    return;
  }
  const userMsg: ChatUserMessage = { id: userMessageId, role: "user", ts: Date.now(), content };
  s.messages.push(userMsg);
  s.llmHistory.push({ role: "user", content });
  await saveSession(spindle, s, userId);
  if (wasPending) {
    // Now persisted; drop the in-memory hold so future loads come from disk.
    pendingSessions.delete(scopedKey(userId, sessionId));
    // First time this session appears in the picker.
    void handleListSessions(undefined, userId);
  }
  await handleSendMessageInternal(s, userId, connectionId);
}

function handleCancelGeneration(sessionId: string, userId: string): void {
  const ac = activeSessions.get(scopedKey(userId, sessionId));
  if (!ac) {
    log("warn", `cancel: no active generation on session ${sessionId}`);
    return;
  }
  ac.abort();
  log("info", `cancelled generation on session ${sessionId}`);
  send({ type: "generation_cancelled", sessionId }, userId);
}

async function handleDeleteSession(sessionId: string, userId: string): Promise<void> {
  const ac = activeSessions.get(scopedKey(userId, sessionId));
  if (ac) ac.abort();
  pendingSessions.delete(scopedKey(userId, sessionId));
  await deleteSessionFile(spindle, sessionId, userId);
  try {
    const { clearSessionTmp } = await import("./state/tmp-store");
    await clearSessionTmp(spindle, sessionId, userId);
  } catch (err) { log("warn", `tmp cleanup failed for ${sessionId}: ${(err as Error).message}`); }
  send({ type: "session_deleted", sessionId }, userId);
  void handleListSessions(undefined, userId);
}

async function handleExportSessionMarkdown(sessionId: string, userId: string): Promise<void> {
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) {
    send({ type: "session_markdown_error", sessionId, error: "Session not found." }, userId);
    return;
  }
  try {
    const { content, filename } = renderSessionMarkdown(s);
    send({ type: "session_markdown_ready", sessionId, filename, content }, userId);
  } catch (err) {
    send({ type: "session_markdown_error", sessionId, error: (err as Error).message }, userId);
  }
}

function renderSessionMarkdown(s: PersistedSession): { content: string; filename: string } {
  const lines: string[] = [];
  const isoNow = new Date().toISOString().slice(0, 19).replace("T", " ");
  lines.push(`# ${s.characterName} — session ${s.sessionId.slice(0, 8)}`);
  lines.push("");
  lines.push(`_Exported from LumiAgent — ${isoNow}_`);
  lines.push(`_Started ${new Date(s.createdAt).toISOString().slice(0, 19).replace("T", " ")}_`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of s.messages) {
    if (m.role === "user") {
      lines.push("## User");
      lines.push("");
      lines.push(m.content);
      lines.push("");
      lines.push("---");
      lines.push("");
      continue;
    }
    lines.push("## Assistant");
    lines.push("");
    for (const b of m.blocks) {
      if (b.type === "reasoning") {
        lines.push("> **Reasoning:**");
        for (const r of b.content.split("\n")) lines.push(`> ${r}`);
        lines.push("");
      } else if (b.type === "text") {
        lines.push(b.content);
        lines.push("");
      } else if (b.type === "warning") {
        lines.push(`> :warning: ${b.message}`);
        lines.push("");
      } else if (b.type === "tool") {
        lines.push(`**:wrench: Tool call: \`${b.name}\`**`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(b.args ?? {}, null, 2));
        lines.push("```");
        if (b.result !== undefined) {
          lines.push("");
          lines.push(b.is_error ? "**Tool error:**" : "**Tool result:**");
          lines.push("");
          let body = b.result;
          let lang = "";
          try { body = JSON.stringify(JSON.parse(b.result), null, 2); lang = "json"; }
          catch { /* not JSON, render verbatim */ }
          lines.push("```" + lang);
          lines.push(body);
          lines.push("```");
        }
        lines.push("");
      }
    }
    if (m.usage) {
      const prefix = m.usage.estimated ? "~" : "";
      lines.push(`_${prefix}${m.usage.total} tokens, turn ${m.turn}_`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }
  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = s.characterName.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60) || "session";
  const filename = `lumiagent-${safeName}-${s.sessionId.slice(0, 8)}-${datePart}.md`;
  return { content: lines.join("\n"), filename };
}

async function handleListCharacterEdits(scope: ScopeRef, userId: string): Promise<void> {
  const ledger = await loadLedger(spindle, scope, userId);
  send({ type: "scope_edits_pushed", scope, entries: entriesView(ledger) }, userId);
}

async function handleRevertEdit(scope: ScopeRef, editId: string, force: boolean, userId: string): Promise<void> {
  const ledger = await loadLedger(spindle, scope, userId);
  const entry = findEntry(ledger, editId);
  if (!entry) {
    send({ type: "edit_reverted", scope, editId, outcome: { kind: "failed", editId, error: "edit not found in ledger" } }, userId);
    return;
  }
  // revertEditWithCheck mutates the ledger in place (marks reverted, replays,
  // purges, persists). On clean outcome the patch is gone from the ledger.
  const outcome = await revertEditWithCheck(spindle, ledger, editId, scope.id, userId, force);

  if (outcome.kind === "clean") {
    const removedIds = new Set<string>([editId, ...(outcome.cascadedEditIds ?? [])]);
    await spliceReverted(spindle, entry.sessionId, removedIds, [buildRevertNote(entry)], userId);
  }
  send({ type: "edit_reverted", scope, editId, outcome }, userId);
  // Push fresh workshop view (reverted entries no longer appear).
  if (outcome.kind === "clean") {
    send({ type: "scope_edits_pushed", scope, entries: entriesView(ledger) }, userId);
    void handleListCharactersStorage(userId);
    void handleListSessions(undefined, userId);
  }
}

// Fast-path bulk revert. Groups requested edit ids by FileState, marks each
// file's hits reverted at once, replays once (with cascade detection),
// writes the recomputed value to the spindle in a single update per file,
// and persists the ledger once at the end. For "revert all on character"
// this collapses N×(spindle_get + spindle_update + ledger_write) to
// roughly (unique_files) parallel spindle updates + 1 ledger write.
async function handleRevertEditsBulk(scope: ScopeRef, editIds: readonly string[], userId: string, opts: { suppressRefresh?: boolean } = {}): Promise<void> {
  const ledger = await loadLedger(spindle, scope, userId);
  const targetSet = new Set(editIds);

  const outcomes: Array<{ editId: string; outcome: RevertOutcomeWire }> = [];
  const removedIds = new Set<string>();
  // Track per-session edit counts cheaply. We DON'T synthesize per-edit
  // notes here; for bulk revert that's O(N²) replay work on big fields.
  // One summary note per session at the end is enough context for the agent.
  const sessionEditCount = new Map<string, number>();
  const bumpSession = (sid: string | null | undefined): void => {
    if (!sid) return;
    sessionEditCount.set(sid, (sessionEditCount.get(sid) ?? 0) + 1);
  };

  // ───── 1. Per-file batched revert (the hot path) ─────
  type FileWork = { file: typeof ledger.files[number]; hits: typeof ledger.files[number]["patches"]; cascadeIds: string[]; recomputed: string };
  const fileWork: FileWork[] = [];
  const now = Date.now();
  for (const file of ledger.files) {
    const hits: typeof file.patches = [];
    for (const p of file.patches) if (targetSet.has(p.id) && !p.reverted) hits.push(p);
    if (hits.length === 0) continue;
    for (const p of hits) bumpSession(p.sessionId);
    for (const p of hits) { p.reverted = true; p.revertedAt = now; }
    let cur = file.base;
    const cascadeIds: string[] = [];
    for (const p of file.patches) {
      if (p.reverted) continue;
      const next = applySinglePatch(cur, p);
      if (next === null) { p.reverted = true; p.revertedAt = now; cascadeIds.push(p.id); continue; }
      cur = next;
    }
    file.expectedHash = patchSha256(cur);
    fileWork.push({ file, hits, cascadeIds, recomputed: cur });
  }

  // One spindle write per touched file, in parallel.
  const fileWriteResults = await Promise.allSettled(fileWork.map(({ file, recomputed }) =>
    writeFieldValue(spindle, file.key.surface, file.key.surfaceId, file.key.field, recomputed, scope.id, userId),
  ));

  fileWork.forEach((work, i) => {
    const r = fileWriteResults[i];
    if (r && r.status === "fulfilled") {
      for (const p of work.hits) {
        removedIds.add(p.id);
        const cas = work.cascadeIds.length > 0 && p === work.hits[0]
          ? { kind: "clean" as const, editId: p.id, cascadedEditIds: work.cascadeIds }
          : { kind: "clean" as const, editId: p.id };
        outcomes.push({ editId: p.id, outcome: cas });
      }
      for (const cid of work.cascadeIds) removedIds.add(cid);
    } else {
      // Roll back the in-memory marks for this file so the ledger stays honest.
      for (const p of work.hits) { p.reverted = false; delete p.revertedAt; }
      for (const cid of work.cascadeIds) {
        const p = work.file.patches.find((x) => x.id === cid);
        if (p) { p.reverted = false; delete p.revertedAt; }
      }
      const err = r && r.status === "rejected" ? String(r.reason?.message ?? r.reason) : "write failed";
      for (const p of work.hits) outcomes.push({ editId: p.id, outcome: { kind: "failed", editId: p.id, error: err } });
    }
  });

  // ───── 2. Structural (create/delete) — still per-item, but in parallel ─────
  const structHits = ledger.structural.filter((s) => targetSet.has(s.id) && !s.reverted);
  if (structHits.length > 0) {
    const structResults = await Promise.allSettled(structHits.map(async (s) => {
      const entry: EditLogEntry = {
        id: s.id, ts: s.ts, sessionId: s.sessionId ?? "", scope,
        toolCallId: s.toolCallId ?? "", toolName: s.op, turn: 0, reverted: false,
        record: s.op === "create"
          ? { op: "create", surface: s.surface, surfaceId: s.surfaceId, surfaceLabel: s.surfaceLabel, snapshot: s.snapshot as never }
          : { op: "delete", surface: s.surface, surfaceId: s.surfaceId, surfaceLabel: s.surfaceLabel, snapshot: s.snapshot as never },
      };
      const res = await revertEdit(spindle, entry, scope.id, userId);
      if (!res.success) throw new Error(res.error ?? "revert failed");
    }));
    structHits.forEach((s, i) => {
      const r = structResults[i];
      if (r && r.status === "fulfilled") {
        bumpSession(s.sessionId);
        // Mark reverted so the single purge at the end actually drops it;
        // without this the spindle delete happened but the structural entry
        // (and its scope row) lingered in the workshop.
        s.reverted = true; s.revertedAt = now;
        removedIds.add(s.id);
        outcomes.push({ editId: s.id, outcome: { kind: "clean", editId: s.id } });
      } else {
        const err = r && r.status === "rejected" ? String(r.reason?.message ?? r.reason) : "write failed";
        outcomes.push({ editId: s.id, outcome: { kind: "failed", editId: s.id, error: err } });
      }
    });
  }

  // ───── 3. External edits — per-item, parallel ─────
  const extHits = ledger.externalEdits.filter((e) => targetSet.has(e.id) && !e.reverted);
  if (extHits.length > 0) {
    const extResults = await Promise.allSettled(extHits.map(async (e) => {
      const res = await revertEdit(spindle, e, scope.id, userId);
      if (!res.success) throw new Error(res.error ?? "revert failed");
    }));
    extHits.forEach((e, i) => {
      const r = extResults[i];
      if (r && r.status === "fulfilled") {
        bumpSession(e.sessionId);
        e.reverted = true; e.revertedAt = now;
        removedIds.add(e.id);
        outcomes.push({ editId: e.id, outcome: { kind: "clean", editId: e.id } });
      } else {
        const err = r && r.status === "rejected" ? String(r.reason?.message ?? r.reason) : "write failed";
        outcomes.push({ editId: e.id, outcome: { kind: "failed", editId: e.id, error: err } });
      }
    });
  }

  // ───── 4. Purge + persist (once) ─────
  if (removedIds.size > 0) {
    purgeAllRevertedInMemory(ledger);
    await persistLedgerNow(spindle, ledger, userId);
  }

  // ───── 5. Mirror into owning sessions in parallel ─────
  // One summary note per session (not per edit) — synthesizing per-edit notes
  // for bulk would replay each patch from base, O(N²) on field size.
  if (sessionEditCount.size > 0) {
    await Promise.allSettled(Array.from(sessionEditCount, ([sid, count]) => {
      const note = `[Note from the system: the user reverted ${count} edit${count === 1 ? "" : "s"} you made earlier in this session via the workshop. The affected character fields have been restored to their prior state. The user did not explain why — they may have disliked the wording, hit revert by accident, or be re-planning. Do not bring it up unless they ask; if they re-request something similar, treat it as a fresh request and read the current state first.]`;
      return spliceReverted(spindle, sid, removedIds, [note], userId);
    }));
  }

  // ───── 6. Single frontend event + fresh workshop view ─────
  send({ type: "edits_reverted_bulk", scope, outcomes }, userId);
  if (removedIds.size > 0) {
    send({ type: "scope_edits_pushed", scope, entries: entriesView(ledger) }, userId);
    // Batched callers (revert_all_characters) suppress so we don't fire one
    // full Characters-tab + Sessions-list refresh per character.
    if (!opts.suppressRefresh) {
      void handleListCharactersStorage(userId);
      void handleListSessions(undefined, userId);
    }
  }
}

async function handleRevertAllCharacters(scopes: readonly ScopeRef[], userId: string): Promise<void> {
  // Serialise so we don't blow up Lumiverse with N concurrent ledger loads +
  // workspace walks. Each per-scope call also suppresses its refresh
  // fanout, then we fire ONE refresh at the end.
  for (const scope of scopes) {
    try {
      const ledger = await loadLedger(spindle, scope, userId);
      const liveIds: string[] = [];
      for (const f of ledger.files) for (const p of f.patches) {
        if (!p.reverted) liveIds.push(p.id);
      }
      for (const s of ledger.structural) if (!s.reverted) liveIds.push(s.id);
      for (const e of ledger.externalEdits) if (!e.reverted) liveIds.push(e.id);
      if (liveIds.length === 0) {
        send({ type: "edits_reverted_bulk", scope, outcomes: [] }, userId);
        continue;
      }
      await handleRevertEditsBulk(scope, liveIds, userId, { suppressRefresh: true });
    } catch (err) {
      log("warn", `revert_all_characters ${scope.kind}:${scope.id} failed: ${(err as Error).message}`);
    }
  }
  void handleListCharactersStorage(userId);
  void handleListSessions(undefined, userId);
}

function buildRevertNote(entry: EditLogEntry): string {
  const r = entry.record;
  const surfaceLabel = "surfaceLabel" in r ? r.surfaceLabel : "(unknown)";
  let detail = "";
  if (r.op === "edit") {
    const beforeLines = (r.before.match(/\n/g)?.length ?? 0) + 1;
    const afterLines = (r.after.match(/\n/g)?.length ?? 0) + 1;
    const sizeDiff = r.after.length - r.before.length;
    detail = `Field: ${r.field}. The edit changed ${r.before.length} chars (${beforeLines} lines) into ${r.after.length} chars (${afterLines} lines), net ${sizeDiff >= 0 ? "+" : ""}${sizeDiff} chars. The original content has been restored.`;
  } else if (r.op === "create") {
    detail = `You had created this item. It has now been deleted again.`;
  } else if (r.op === "delete") {
    detail = `You had deleted this item. It has now been re-created.`;
  }
  return `[Note from the system: the user reverted the edit you made in turn ${entry.turn} via tool \`${entry.toolName}\` on ${r.surface} "${surfaceLabel}". ${detail} The user did not explain why — they may have disliked the wording, hit revert by accident, or be re-planning. Do not bring it up unless they ask; if they re-request something similar, treat it as a fresh request and read the current state first.]`;
}

async function handleRevertSession(sessionId: string, userId: string): Promise<void> {
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) {
    send({ type: "generation_error", sessionId, error: "session not found" }, userId);
    return;
  }
  // Revert every live edit made during this session via the ledger. Walking
  // newest-first minimises cascade noise because later patches reverted
  // explicitly won't show up as collateral damage of earlier ones. No-character
  // sessions can't have edits, so this is effectively a no-op for them.
  if (s.characterId === null) {
    send({ type: "session_reverted", sessionId, entriesRestored: 0, entriesFailed: 0, scriptsRestored: 0, scriptsFailed: 0 }, userId);
    return;
  }
  const sessionEditIds = [...s.edits].filter((e) => !e.reverted).map((e) => e.id).reverse();
  const r = await revertEditsBatch(s.characterId, s.edits.filter((e) => sessionEditIds.includes(e.id)).reverse(), userId);
  for (const edit of s.edits) (edit as { reverted: boolean }).reverted = true;
  await saveSession(spindle, s, userId);
  send({
    type: "session_reverted",
    sessionId,
    entriesRestored: r.ok,
    entriesFailed: r.failed,
    scriptsRestored: 0,
    scriptsFailed: 0,
  }, userId);
}

// Rebuild llmHistory from session.messages. Used after truncating for edit / regenerate.
function rebuildLlmHistory(messages: readonly (ChatUserMessage | ChatAssistantMessage)[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let text = "";
    let reasoning = "";
    for (const b of m.blocks) {
      if (b.type === "text") text += b.content;
      else if (b.type === "reasoning") reasoning += b.content;
      else if (b.type === "tool") {
        toolCalls.push({ name: b.name, args: b.args, call_id: b.call_id });
        if (b.result !== undefined) {
          toolResults.push({ call_id: b.call_id, name: b.name, content: b.result, ...(b.is_error ? { is_error: true } : {}) });
        }
      }
    }
    out.push(encodeAssistantTurn(text, toolCalls, reasoning || undefined));
    if (toolResults.length > 0) out.push(encodeToolResults(toolResults));
  }
  return out;
}

// Revert a batch of edits via the fast-path bulk handler. Force-reverts on
// conflict (this is the "user explicitly asked to roll back this message" path,
// so we override later changes — they get tracked by the ledger anyway).
// Internal counter return for back-compat with callers that report counts.
async function revertEditsBatch(characterId: string, entries: readonly EditLogEntry[], userId: string): Promise<{ ok: number; failed: number }> {
  if (entries.length === 0) return { ok: 0, failed: 0 };
  const ids = entries.map((e) => e.id);
  await handleRevertEditsBulk(characterScope(characterId), ids, userId);
  // handleRevertEditsBulk purges successful ids from the ledger; survivors
  // are the failures. loadLedger is cache-backed so this is cheap.
  const after = await loadLedger(spindle, characterScope(characterId), userId);
  const survivors = new Set<string>();
  for (const f of after.files) for (const p of f.patches) survivors.add(p.id);
  for (const s of after.structural) survivors.add(s.id);
  for (const e of after.externalEdits) survivors.add(e.id);
  let ok = 0; let failed = 0;
  for (const id of ids) {
    if (survivors.has(id)) failed++;
    else ok++;
  }
  return { ok, failed };
}

// Delete a single message in place. Doesn't truncate the conversation,
// just removes one entry so the user can prune a stray bad turn without
// regenerating everything after it. If the deleted message is an assistant
// turn that made live edits, the caller chooses whether to revert those
// edits or leave them on the card.
async function handleDeleteMessage(sessionId: string, messageId: string, editsAction: "keep" | "revert", userId: string): Promise<void> {
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "generation_error", sessionId, error: "wait for the current generation to finish" }, userId);
    return;
  }
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) { send({ type: "generation_error", sessionId, error: "session not found" }, userId); return; }
  const idx = s.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) { send({ type: "generation_error", sessionId, error: "message not found" }, userId); return; }
  const target = s.messages[idx]!;

  if (target.role === "assistant" && editsAction === "revert") {
    const editsToRevert = s.edits.filter((e) => e.assistantMessageId === target.id && !e.reverted);
    if (editsToRevert.length > 0 && s.characterId !== null) {
      await revertEditsBatch(s.characterId, editsToRevert, userId);
      for (const e of s.edits) if (editsToRevert.some((x) => x.id === e.id)) { e.reverted = true; e.revertedAt = Date.now(); }
    }
  }

  s.messages = s.messages.slice(0, idx).concat(s.messages.slice(idx + 1));
  s.llmHistory = rebuildLlmHistory(s.messages);
  await saveSession(spindle, s, userId);
  send({ type: "session_truncated", sessionId, messages: s.messages, edits: s.edits }, userId);
}

async function handleFreeToolResult(sessionId: string, callId: string, userId: string): Promise<void> {
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "generation_error", sessionId, error: "wait for the current generation to finish before freeing tool results" }, userId);
    return;
  }
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) { send({ type: "generation_error", sessionId, error: "session not found" }, userId); return; }

  let foundBlock = false;
  let toolName = "tool";
  for (const m of s.messages) {
    if (m.role !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.type === "tool" && b.call_id === callId) {
        b.freed = true;
        toolName = b.name;
        foundBlock = true;
      }
    }
  }
  if (!foundBlock) {
    send({ type: "generation_error", sessionId, error: `tool call ${callId} not found in this session` }, userId);
    return;
  }

  for (let i = 0; i < s.llmHistory.length; i++) {
    const m = s.llmHistory[i]!;
    if (m.role !== "user" || typeof m.content === "string") continue;
    const parts = m.content;
    let mutated = false;
    const nextParts = parts.map((p) => {
      if (p.type !== "tool_result" || p.tool_use_id !== callId) return p;
      if (p.content.startsWith("[freed:")) return p;
      const originalChars = p.content.length;
      mutated = true;
      return {
        type: "tool_result" as const,
        tool_use_id: p.tool_use_id,
        content: `[freed: tool result was ${originalChars} chars, freed by user from ${toolName}. The model cannot reference this content. Re-call the tool if needed.]`,
        ...(p.is_error ? { is_error: true } : {}),
      };
    });
    if (mutated) s.llmHistory[i] = { ...m, content: nextParts };
  }

  await saveSession(spindle, s, userId);
  send({ type: "session_truncated", sessionId, messages: s.messages, edits: s.edits }, userId);
}

async function handleEditUserMessage(sessionId: string, messageId: string, newContent: string, editsAction: "keep" | "revert", connectionId: string | undefined, userId: string): Promise<void> {
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "generation_error", sessionId, error: "wait for the current generation to finish" }, userId);
    return;
  }
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) { send({ type: "generation_error", sessionId, error: "session not found" }, userId); return; }
  const idx = s.messages.findIndex((m) => m.id === messageId && m.role === "user");
  if (idx < 0) { send({ type: "generation_error", sessionId, error: "user message not found" }, userId); return; }

  // Collect edits made in messages STRICTLY AFTER the edited user message.
  const tailMessageIds = new Set(s.messages.slice(idx + 1).filter((m) => m.role === "assistant").map((m) => m.id));
  const editsToReview = s.edits.filter((e) => e.assistantMessageId !== undefined && tailMessageIds.has(e.assistantMessageId) && !e.reverted);
  if (editsAction === "revert" && editsToReview.length > 0 && s.characterId !== null) {
    await revertEditsBatch(s.characterId, editsToReview, userId);
    for (const e of s.edits) if (editsToReview.some((x) => x.id === e.id)) { e.reverted = true; e.revertedAt = Date.now(); }
  }

  // Truncate session: keep messages[0..idx-1], replace messages[idx] with new content, drop the rest.
  const editedMsg: ChatUserMessage = { id: messageId, role: "user", ts: Date.now(), content: newContent };
  s.messages = [...s.messages.slice(0, idx), editedMsg];
  s.llmHistory = rebuildLlmHistory(s.messages);
  await saveSession(spindle, s, userId);
  send({ type: "session_truncated", sessionId, messages: s.messages, edits: s.edits }, userId);

  // Kick off regeneration as if the user just sent this message.
  void handleSendMessageInternal(s, userId, connectionId);
}

async function handleRegenerateAssistant(sessionId: string, assistantMessageId: string, editsAction: "keep" | "revert", connectionId: string | undefined, userId: string): Promise<void> {
  if (activeSessions.has(scopedKey(userId, sessionId))) {
    send({ type: "generation_error", sessionId, error: "wait for the current generation to finish" }, userId);
    return;
  }
  const s = await loadSession(spindle, sessionId, userId);
  if (!s) { send({ type: "generation_error", sessionId, error: "session not found" }, userId); return; }
  const idx = s.messages.findIndex((m) => m.id === assistantMessageId && m.role === "assistant");
  if (idx < 0) { send({ type: "generation_error", sessionId, error: "assistant message not found" }, userId); return; }
  // Find the preceding user message so we can refuse cleanly if there isn't one.
  // The truncation below drops everything from `idx` onward, leaving the user
  // message in place at the end of llmHistory for the canonical loop to pick up.
  let userIdx = -1;
  for (let i = idx - 1; i >= 0; i--) { if (s.messages[i]!.role === "user") { userIdx = i; break; } }
  if (userIdx < 0) { send({ type: "generation_error", sessionId, error: "no preceding user message to regenerate from" }, userId); return; }

  const tailMessageIds = new Set(s.messages.slice(idx).filter((m) => m.role === "assistant").map((m) => m.id));
  const editsToReview = s.edits.filter((e) => e.assistantMessageId !== undefined && tailMessageIds.has(e.assistantMessageId) && !e.reverted);
  if (editsAction === "revert" && editsToReview.length > 0 && s.characterId !== null) {
    await revertEditsBatch(s.characterId, editsToReview, userId);
    for (const e of s.edits) if (editsToReview.some((x) => x.id === e.id)) { e.reverted = true; e.revertedAt = Date.now(); }
  }

  s.messages = s.messages.slice(0, idx);
  s.llmHistory = rebuildLlmHistory(s.messages);
  await saveSession(spindle, s, userId);
  send({ type: "session_truncated", sessionId, messages: s.messages, edits: s.edits }, userId);

  void handleSendMessageInternal(s, userId, connectionId);
}

// Canonical generation loop. Callers must ensure s.llmHistory already ends
// with the user message we're replying to. connectionIdOverride is the
// user's current dropdown value, applied here as the single heal point so
// every entry path (send, edit, regenerate, continue) picks up the latest.
async function handleSendMessageInternal(s: PersistedSession, userId: string, connectionIdOverride: string | undefined): Promise<void> {
  if (connectionIdOverride && s.connectionId !== connectionIdOverride) {
    s.connectionId = connectionIdOverride;
  }
  let c: CharacterDTO | null = null;
  if (s.characterId !== null) {
    c = await spindle.characters.get(s.characterId, userId);
    if (!c) { send({ type: "generation_error", sessionId: s.sessionId, error: `character ${s.characterId} not found` }, userId); return; }
  }
  const ac = new AbortController();
  activeSessions.set(scopedKey(userId, s.sessionId), ac);
  void pushSessionStatus(s.sessionId, userId);

  const settings = await loadSettings(spindle, userId);
  const systemMsg = await buildSessionSystemMessage(c, s, settings, userId);
  const conv: LlmMessage[] = [systemMsg, ...s.llmHistory];
  applyJailbreakNonSystem(conv, settings);

  const assistantId = makeId("msg");
  const assistant: ChatAssistantMessage = { id: assistantId, role: "assistant", ts: Date.now(), turn: 0, blocks: [], status: "streaming" };
  s.messages.push(assistant);

  const hasCharacter = s.characterId !== null;
  const tools = makeInitialToolSchemas(hasCharacter);
  const deferredToolSchemas = makeDeferredToolSchemaMap(hasCharacter);
  const dispatch = makeToolDispatch();
  const provider = await resolveProviderForConnection(s.connectionId, userId);
  const samplerParams = buildSamplerParams(settings.samplers, settings.parallelToolCalls, provider);
  let currentTextBlock: AssistantBlock & { type: "text" } | null = null;
  let currentReasoningBlock: AssistantBlock & { type: "reasoning" } | null = null;
  const toolBlocks = new Map<string, AssistantBlock & { type: "tool" }>();
  let lastTurn = 0;
  let errored = false;

  try {
    for await (const ev of runAgent({
      spindle, userId, sessionId: s.sessionId, characterId: s.characterId, assistantMessageId: assistantId,
      pinnedChatId: s.pinnedChatId ?? null,
      conversation: conv, tools, deferredToolSchemas, dispatch,
      ...(s.connectionId ? { connectionId: s.connectionId } : {}),
      parameters: samplerParams,
      ...(settings.samplers.contextSize !== null ? { contextTokens: settings.samplers.contextSize } : {}),
      toolOutputCapTokens: resolveToolOutputCapTokens(settings),
      tokenizerModelId: await resolveModelForConnection(s.connectionId, userId),
      maxTurns: DEFAULT_MAX_TURNS_PER_MESSAGE, startingTurn: lastTurn,
      cacheMode: settings.cacheMode, tpmLimit: settings.tpmLimit, signal: ac.signal,
      callFrontend: (op, args, timeoutMs) => callFrontend(userId, op, args, timeoutMs),
    })) {
      send({ type: "chat_event", sessionId: s.sessionId, event: ev }, userId);
      switch (ev.type) {
        case "turn_started":
          assistant.turn = ev.turn; lastTurn = ev.turn;
          currentTextBlock = null; currentReasoningBlock = null;
          break;
        case "llm_token":
          if (!currentTextBlock) { currentTextBlock = { type: "text", content: ev.token }; assistant.blocks.push(currentTextBlock); }
          else currentTextBlock.content += ev.token;
          break;
        case "llm_reasoning":
          if (!currentReasoningBlock) { currentReasoningBlock = { type: "reasoning", content: ev.token }; assistant.blocks.push(currentReasoningBlock); }
          else currentReasoningBlock.content += ev.token;
          break;
        case "tool_started":
          currentTextBlock = null; currentReasoningBlock = null;
          {
            const block: AssistantBlock & { type: "tool" } = { type: "tool", call_id: ev.call_id, name: ev.name, args: ev.args, edit_ids: [] };
            assistant.blocks.push(block); toolBlocks.set(ev.call_id, block);
          }
          break;
        case "tool_finished": {
          const block = toolBlocks.get(ev.call_id);
          if (block) {
            block.result = ev.result;
            block.is_error = ev.is_error;
            block.edit_ids = [...ev.edit_ids];
          }
          break;
        }
        case "edit_logged":
          // A character-scoped edit in a no-character session is nonsensical
          // (the char tools are filtered out). Non-character scopes
          // (persona/chat/preset, e.g. create persona) are valid without a
          // character and must still file into their own ledger.
          if (s.characterId === null && ev.entry.scope.kind === "character") break;
          s.edits.push(ev.entry);
          void appendEntries(spindle, ev.entry.scope, [ev.entry], userId).catch((e) => log("warn", `ledger append failed: ${(e as Error).message}`));
          break;
        case "revert_logged": {
          if (s.characterId === null) break;
          // Agent-driven revert (revert_session_edits). Ledger persistence already
          // happened inside the tool; mirror into session.edits and notify
          // the frontend the same way user-driven workshop reverts do.
          if (ev.outcome.kind === "clean" || ev.outcome.kind === "noop_already_reverted") {
            const idsToMark = new Set<string>([ev.editId]);
            if (ev.outcome.kind === "clean" && ev.outcome.cascadedEditIds) {
              for (const c of ev.outcome.cascadedEditIds) idsToMark.add(c);
            }
            for (const e of s.edits) {
              if (idsToMark.has(e.id) && !e.reverted) { e.reverted = true; e.revertedAt = Date.now(); }
            }
          }
          send({ type: "edit_reverted", scope: characterScope(s.characterId), editId: ev.editId, outcome: ev.outcome }, userId);
          break;
        }
        case "edits_resynced": {
          if (s.characterId === null) break;
          const charId = s.characterId;
          // Squash mutated the ledger; push the fresh view so the workshop
          // Edits tab reflects the consolidated entries.
          void loadLedger(spindle, characterScope(charId), userId)
            .then((l) => send({ type: "scope_edits_pushed", scope: characterScope(charId), entries: entriesView(l) }, userId))
            .catch((e) => log("warn", `edits resync failed: ${(e as Error).message}`));
          break;
        }
        case "warning":
          assistant.blocks.push({ type: "warning", message: ev.message });
          break;
        case "turn_completed":
          assistant.finish_reason = ev.finish_reason;
          if (ev.usage) {
            assistant.usage = ev.usage;
            s.lastPromptTokens = ev.usage.prompt;
            emitContextUsage(s, resolveContextTokens(settings.samplers), userId);
          }
          if (ev.cleanedContent !== undefined) replaceAssistantTextBlocks(assistant, ev.cleanedContent);
          s.llmHistory = conv.slice(1);
          await saveSession(spindle, s, userId).catch((e) => log("warn", `mid-stream save failed: ${(e as Error).message}`));
          break;
        case "paused_for_input":
          assistant.status = "complete";
          break;
      }
    }
  } catch (err) {
    // The user-cancel path throws an AbortError up from runLlmStream / tool
    // dispatch, but the thrown shape varies per provider (DOMException, Error
    // with name="AbortError", custom strings). Check the caller's signal
    // directly: if it fired, treat as a clean stop, not an error toast.
    if (ac.signal.aborted) {
      assistant.status = "cancelled";
    } else {
      errored = true;
      assistant.status = "errored";
      const msg = (err as Error).message;
      log("error", `session ${s.sessionId} generation threw: ${msg}`);
      send({ type: "generation_error", sessionId: s.sessionId, error: msg }, userId);
    }
  }
  activeSessions.delete(scopedKey(userId, s.sessionId));
  s.llmHistory = conv.slice(1);
  if (ac.signal.aborted && !errored) assistant.status = "cancelled";
  await saveSession(spindle, s, userId);
  if (s.characterId !== null) {
    const squashed = await autosquashAndNotify(s, s.characterId, assistantId, userId);
    // Picker count (session_index.editCount) lives in s.edits.length. When
    // autosquash collapses N raw edits into 1 merged patch, the picker would
    // otherwise stay at N while the workshop modal shows 1.
    if (squashed) await saveSession(spindle, s, userId);
  }
  if (ac.signal.aborted) send({ type: "generation_cancelled", sessionId: s.sessionId }, userId);
  else if (!errored) {
    send({ type: "generation_done", sessionId: s.sessionId, turns: lastTurn }, userId);
    if (shouldAutoCompact(s, settings.samplers)) {
      void compactSession(s.sessionId, userId, "auto");
    }
  }
  void pushSessionStatus(s.sessionId, userId);
  void handleListSessions(undefined, userId);
}

// Collapse a single assistant message's edits to one patch per file. Fires
// when the agent loop pauses (paused_for_input) or is cancelled. Sealed
// patches (mid-message squash_session_edits) form boundaries that won't merge.
// Errors are swallowed: a failed squash leaves the timeline noisier but
// otherwise correct, so the message lifecycle shouldn't trip on it.
async function autosquashAndNotify(
  s: PersistedSession,
  characterId: string,
  assistantMessageId: string,
  userId: string,
): Promise<boolean> {
  try {
    const summary = await squashMessage(spindle, characterScope(characterId), assistantMessageId, userId, { sealed: false });
    if (summary.groupsMerged === 0) return false;
    const ledger = await loadLedger(spindle, characterScope(characterId), userId);
    const view = entriesView(ledger);
    let mutated = false;
    if (summary.absorbedIds.length > 0) {
      const absorbed = new Set(summary.absorbedIds);
      const before = s.edits.length;
      s.edits = s.edits.filter((e) => !absorbed.has(e.id));
      if (s.edits.length !== before) mutated = true;
      if (summary.newPatchIds.length > 0) {
        const newIds = new Set(summary.newPatchIds);
        for (const e of view) if (newIds.has(e.id)) { s.edits.push(e); mutated = true; }
      }
      // Rewrite tool-block edit_ids on the squashed message so the per-message
      // "Edits (N)" banner and its "Revert all" button still resolve to live
      // ledger patches. Without this, the banner shows 0 entries post-squash
      // and the agent's "revert what I just did" affordance silently no-ops.
      const msg = s.messages.find((m) => m.role === "assistant" && m.id === assistantMessageId);
      if (msg && msg.role === "assistant") {
        for (const block of msg.blocks) {
          if (block.type !== "tool" || block.edit_ids.length === 0) continue;
          const remapped: string[] = [];
          const seen = new Set<string>();
          let changed = false;
          for (const id of block.edit_ids) {
            const mapped = summary.absorbedToMerged.get(id) ?? id;
            if (mapped !== id) changed = true;
            if (!seen.has(mapped)) { seen.add(mapped); remapped.push(mapped); }
          }
          if (changed || remapped.length !== block.edit_ids.length) {
            block.edit_ids = remapped;
            mutated = true;
          }
        }
        // Frontend caches s.messages in state.messages, push a refresh so
        // the virtualizer re-renders bubbles with the remapped ids.
        if (mutated) send({ type: "session_truncated", sessionId: s.sessionId, messages: s.messages, edits: s.edits }, userId);
      }
    }
    send({ type: "scope_edits_pushed", scope: characterScope(characterId), entries: view }, userId);
    return mutated;
  } catch (err) {
    log("warn", `autosquash failed for ${characterId}/${assistantMessageId}: ${(err as Error).message}`);
    return false;
  }
}

// Userids seen by the worker for this process lifetime, so permission
// changes can fan out to every connected user.
const capturedUserIds = new Set<string>();

function broadcastMissingPermissions(missing: readonly string[]): void {
  const purposes: Record<string, string> = {};
  for (const p of missing) purposes[p] = PERMISSION_PURPOSE[p] ?? p;
  for (const userId of capturedUserIds) {
    try {
      send({ type: "notify_missing_permissions", missing, purposes }, userId);
    } catch (err) {
      log("warn", `permissions: sendToFrontend failed userId=${userId}: ${(err as Error).message}`);
    }
  }
}

// Dial-based bridge status. The dial outcome is ground truth: declared-perm
// state is misleading on its own (e.g. both sides revoking a perm leaves the
// host check passing because the owner's perm set ends up empty). After any
// perm change or fresh dial, look up the most recent dial failure per known
// phoneline and broadcast based on that.
async function broadcastBridgeStatusForUser(userId: string): Promise<void> {
  try {
    const { getAllDialFailures } = await import("./phoneline/registry");
    const failures = getAllDialFailures(userId);
    if (failures.length === 0) {
      send({ type: "notify_bridge_status", offline: false, missingPermissions: [] }, userId);
      return;
    }
    const first = failures[0]!;
    send({
      type: "notify_bridge_status",
      offline: true,
      missingPermissions: first.missingPerms,
      missingFor: first.missingFor,
    }, userId);
  } catch (err) {
    log("warn", `bridge_status: broadcastForUser failed userId=${userId}: ${(err as Error).message}`);
  }
}

function captureUserId(userId: string): void {
  if (capturedUserIds.has(userId)) return;
  capturedUserIds.add(userId);
  if (isPermissionsLoaded()) {
    const missing = getMissingPermissions();
    const purposes = getMissingPermissionPurposes();
    try {
      send({ type: "notify_missing_permissions", missing, purposes }, userId);
    } catch { /* */ }
    // Kick a dial so the bridge banner reflects ground truth rather than a
    // possibly-stale declared-perm heuristic. discoverProviders is cached
    // per-user, so this is cheap on subsequent calls.
    void (async () => {
      try {
        const { discoverProviders } = await import("./phoneline/registry");
        await discoverProviders(spindle, userId);
      } catch { /* dial errors are recorded inside discoverProviders */ }
      await broadcastBridgeStatusForUser(userId);
    })();
  }
  const warning = getHostVersionWarning();
  if (warning) {
    try {
      send({
        type: "host_version_warning",
        hostVersion: warning.hostVersion,
        minimum: warning.minimum,
        message: warning.message,
      }, userId);
    } catch { /* */ }
  }
}

void initPermissions({ info: (m) => log("info", m), warn: (m) => log("warn", m) });
void initHostVersionCheck({ info: (m) => log("info", m), warn: (m) => log("warn", m) });

// On-request probe other extensions dial after their own perm change. The
// host inheritance check runs first (so the caller observes its own missing
// perms if any), and the handler treats any successful invocation as a
// signal that the caller's perm set may have shifted, triggering our own
// re-dial so our banner picks up new failures on the outbound direction.
try {
  spindle.rpcPool.handle("phoneline_probe", async () => {
    void (async () => {
      try {
        const { invalidate, discoverProviders } = await import("./phoneline/registry");
        for (const userId of capturedUserIds) {
          invalidate(userId);
          await discoverProviders(spindle, userId);
          await broadcastBridgeStatusForUser(userId);
        }
      } catch (err) {
        log("warn", `phoneline_probe re-dial side effect failed: ${(err as Error).message}`);
      }
    })();
    return { ok: true };
  });
} catch (err) {
  log("warn", `phoneline_probe handle failed: ${(err as Error).message}`);
}

// On any perm change: broadcast the required-perms modal state, then
// re-dial every known phoneline. Dial outcome is ground truth for the
// bridge banner (declared-perm heuristics false-positive when both sides
// revoke the same perm and the host check trivially passes on an empty
// owner set).
subscribeToMissingChanges((missing) => {
  broadcastMissingPermissions(missing);
  if (missing.length > 0) {
    log("warn", `permissions.changed: broadcast notify_missing_permissions to ${capturedUserIds.size} user(s) missing=[${missing.join(",")}]`);
  } else {
    log("info", `permissions.changed: all required perms granted, broadcast empty set to ${capturedUserIds.size} user(s) to auto-dismiss`);
  }
  void (async () => {
    try {
      const { invalidate, discoverProviders } = await import("./phoneline/registry");
      for (const userId of capturedUserIds) {
        invalidate(userId);
        await discoverProviders(spindle, userId);
        await broadcastBridgeStatusForUser(userId);
      }
    } catch (err) {
      log("warn", `phoneline re-dial on perm change failed: ${(err as Error).message}`);
    }
  })();
});

spindle.onFrontendMessage(async (raw: unknown, userId: string) => {
  if (!userId) {
    log("warn", `dropped message without userId`);
    return;
  }
  captureUserId(userId);
  const msg = raw as FrontendToBackend;
  try {
    switch (msg.type) {
      case "list_characters": await handleListCharacters(userId); return;
      case "list_connections": await handleListConnections(userId); return;
      case "list_sessions": await handleListSessions(msg.characterId, userId); return;
      case "load_session": await handleLoadSession(msg.sessionId, userId); return;
      case "start_session": void handleStartSession(msg.sessionId, msg.characterId, msg.connectionId, userId); return;
      case "send_message": void handleSendMessage(msg.sessionId, msg.userMessageId, msg.content, msg.connectionId, userId); return;
      case "continue_session": void handleContinueSession(msg.sessionId, msg.connectionId, userId); return;
      case "cancel_generation": handleCancelGeneration(msg.sessionId, userId); return;
      case "delete_session": await handleDeleteSession(msg.sessionId, userId); return;
      case "export_session_markdown": await handleExportSessionMarkdown(msg.sessionId, userId); return;
      case "list_character_edits": await handleListCharacterEdits(characterScope(msg.characterId), userId); return;
      case "revert_edit": await handleRevertEdit(msg.scope ?? characterScope(msg.characterId), msg.editId, msg.force === true, userId); return;
      case "revert_edits_bulk": await handleRevertEditsBulk(msg.scope ?? characterScope(msg.characterId), msg.editIds, userId); return;
      case "revert_session": await handleRevertSession(msg.sessionId, userId); return;
      case "edit_user_message": void handleEditUserMessage(msg.sessionId, msg.messageId, msg.newContent, msg.editsAction, msg.connectionId, userId); return;
      case "regenerate_assistant_message": void handleRegenerateAssistant(msg.sessionId, msg.assistantMessageId, msg.editsAction, msg.connectionId, userId); return;
      case "delete_message": void handleDeleteMessage(msg.sessionId, msg.messageId, msg.editsAction, userId); return;
      case "free_tool_result": void handleFreeToolResult(msg.sessionId, msg.callId, userId); return;
      case "list_chats": await handleListChats(msg.characterId, msg.sessionId, userId); return;
      case "set_pinned_chat": await handleSetPinnedChat(msg.sessionId, msg.chatId, userId); return;
      case "get_settings": await handleGetSettings(userId); return;
      case "update_settings": await handleUpdateSettings(msg.persona, msg.systemPromptOverride, msg.samplers, msg.jailbreak, msg.jailbreakPlacement, msg.workspaceCapBytes, msg.toolOutputCapTokens, msg.cacheMode ?? "full", msg.parallelToolCalls ?? true, msg.tpmLimit ?? null, userId); return;
      case "get_ui_prefs": await handleGetUiPrefs(userId); return;
      case "update_ui_prefs": await handleUpdateUiPrefs(msg.connectionId, msg.lastSessionId, userId); return;
      case "compact_session": void compactSession(msg.sessionId, userId, "manual"); return;
      case "list_characters_storage": await handleListCharactersStorage(userId); return;
      case "squash_character": await handleSquashCharacter(msg.scope ?? characterScope(msg.characterId), userId); return;
      case "revert_character_all": await handleRevertCharacterAll(msg.scope ?? characterScope(msg.characterId), userId); return;
      case "revert_all_characters": await handleRevertAllCharacters(msg.scopes ?? msg.characterIds.map(characterScope), userId); return;
      case "load_character_workshop": await handleLoadCharacterWorkshop(msg.scope ?? characterScope(msg.characterId), userId); return;
      case "ws_list": await handleWsList(msg.path, userId); return;
      case "ws_read_text": await handleWsReadText(msg.path, userId); return;
      case "ws_write_text": await handleWsWriteText(msg.path, msg.content, userId); return;
      case "ws_duplicate": await handleWsDuplicate(msg.path, userId); return;
      case "ws_upload_binary": await handleWsUploadBinary(msg.path, msg.dataBase64, userId); return;
      case "ws_upload_part": await handleWsUploadPart(msg.transferId, msg.path, msg.dataBase64, msg.index, msg.total, userId); return;
      case "ws_delete": await handleWsDelete(msg.path, msg.recursive, userId); return;
      case "ws_move": await handleWsMove(msg.from, msg.to, userId); return;
      case "ws_mkdir": await handleWsMkdir(msg.path, userId); return;
      case "ws_download": await handleWsDownload(msg.path, userId); return;
      case "ws_download_zip": await handleWsDownloadZip(msg.paths, userId); return;
      case "get_phoneline_pairings": await handleGetPhonelinePairings(userId); return;
      case "set_phoneline_pairing": await handleSetPhonelinePairing(userId, msg.identifier, msg.allowed); return;
      case "revoke_phoneline_pairing": await handleRevokePhonelinePairing(userId, msg.identifier); return;
      case "frontend_rpc_response": resolveFrontendRpc(msg.rpcId, userId, msg.result, msg.error); return;
      default:
        log("warn", `unknown frontend message type=${(msg as { type?: string }).type ?? "?"}`);
    }
  } catch (err) {
    log("error", `frontend handler error: ${(err as Error).message}`);
  }
});

log("info", "lumiagent backend ready (v2.0.1 chat/diff/edit-log)");
