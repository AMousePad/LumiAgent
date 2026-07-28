import type { SpindleAPI } from "lumiverse-spindle-types";
import type {
  EditLogEntry,
  EditRecord,
  EditEdit,
  EditCreate,
  EditDelete,
  EditExternal,
  FileTimeline,
  EditSurface,
} from "../types";
import { fileKeyOf, scopeKeyString } from "../types";
import type { ScopeKind, ScopeRef } from "../types";
import {
  type ScopedLedgerV2,
  type FileKey,
  type FileState,
  type Patch,
  type StructuralPatch,
  type SquashGroupResult,
  emptyLedgerV2,
  currentValue,
  purgeRevertedPatches,
  recordEdit,
  sha256,
  sliceForPatch,
  fileKeyString,
  squashByMessage,
} from "./patch-stack";

const LEDGER_DIR = "ledgers";

// Per-field patch stacks plus a structural list for create/delete and a side
// list for external-surface edits (the spindle bridge owns that surface's
// concurrency, so they don't slot into FileState cleanly).
export interface ScopedLedger extends ScopedLedgerV2 {
  externalEdits: EditLogEntry[];
}

interface PersistedV3 {
  version: 3;
  scope: ScopeRef;
  files: FileState[];
  structural: StructuralPatch[];
  externalEdits: EditLogEntry[];
}

// Pre-scope on-disk shape. Only ever read during the one-way v2->v3 migration
// of a character ledger; never written.
interface LegacyPersistedV2 {
  version: 2;
  characterId: string;
  files: FileState[];
  structural: StructuralPatch[];
  externalEdits?: EditLogEntry[];
}

export function ledgerPath(scope: ScopeRef): string {
  return `${LEDGER_DIR}/${scope.kind}/${scope.id}.json`;
}

function legacyPath(characterId: string): string {
  return `${LEDGER_DIR}/${characterId}.json`;
}

const ledgerCache = new Map<string, ScopedLedger>();

function cacheKey(userId: string, scope: ScopeRef): string {
  return `${userId}:${scopeKeyString(scope)}`;
}

function emptyLedger(scope: ScopeRef): ScopedLedger {
  return { ...emptyLedgerV2(scope), externalEdits: [] };
}

const inflightLoads = new Map<string, Promise<ScopedLedger>>();
const inflightAppends = new Map<string, number>();
interface MutationLock {
  tail: Promise<void>;
  pending: number;
}
const mutationLocks = new Map<string, MutationLock>();
const LEDGER_CACHE_MAX = 512;

async function withScopeMutation<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let lock = mutationLocks.get(key);
  if (!lock) {
    lock = { tail: Promise.resolve(), pending: 0 };
    mutationLocks.set(key, lock);
  }
  const previous = lock.tail;
  let release!: () => void;
  lock.tail = new Promise<void>((resolve) => { release = resolve; });
  lock.pending++;
  await previous.catch(() => { /* an earlier mutation already reported its own failure */ });
  try {
    return await fn();
  } finally {
    lock.pending--;
    release();
    if (lock.pending === 0 && mutationLocks.get(key) === lock) mutationLocks.delete(key);
  }
}

function containsEntryId(ledger: ScopedLedger, id: string): boolean {
  for (const file of ledger.files) {
    if (file.patches.some((patch) => patch.id === id)) return true;
  }
  if (ledger.structural.some((patch) => patch.id === id)) return true;
  return ledger.externalEdits.some((entry) => entry.id === id);
}

// Bound the read-through cache over a long-lived (possibly multi-user shared)
// worker. Never evict an entry with an in-flight load or append (forking a
// second object for a held scope would reintroduce the cold-cache lost-update),
// and every mutation persists so an evicted idle scope reloads current state.
function pruneLedgerCache(): void {
  if (ledgerCache.size <= LEDGER_CACHE_MAX) return;
  for (const key of ledgerCache.keys()) {
    if (ledgerCache.size <= LEDGER_CACHE_MAX) break;
    if (
      inflightLoads.has(key)
      || (inflightAppends.get(key) ?? 0) > 0
      || (mutationLocks.get(key)?.pending ?? 0) > 0
    ) continue;
    ledgerCache.delete(key);
  }
}

export async function loadLedger(spindle: SpindleAPI, scope: ScopeRef, userId: string): Promise<ScopedLedger> {
  const k = cacheKey(userId, scope);
  const cached = ledgerCache.get(k);
  if (cached) return cached;
  // Dedupe concurrent first-loads of the same scope. A turn emitting several
  // edits to one cold (un-prewarmed, e.g. non-character) scope fires overlapping
  // appendEntries that would each load a SEPARATE object and lose all but the
  // last write, so share one in-flight load and one object.
  const inflight = inflightLoads.get(k);
  if (inflight) return inflight;
  const load = (async (): Promise<ScopedLedger> => {
    const p = ledgerPath(scope);
    let persisted = await spindle.userStorage.getJson<PersistedV3 | null>(p, { fallback: null, userId });

    // One-way migration: a character whose ledger predates scope-addressing
    // still lives at the flat legacy path. Rewrap (lossless, no patch replay),
    // write the new path, then drop the legacy file. New path is authoritative
    // the instant it's written, so legacy removal is best-effort.
    if ((!persisted || persisted.version !== 3) && scope.kind === "character") {
      const legacy = await spindle.userStorage.getJson<LegacyPersistedV2 | null>(
        legacyPath(scope.id),
        { fallback: null, userId },
      );
      if (legacy && legacy.version === 2) {
        const migrated: PersistedV3 = {
          version: 3,
          scope,
          files: legacy.files,
          structural: legacy.structural,
          externalEdits: legacy.externalEdits ?? [],
        };
        await spindle.userStorage.write(p, JSON.stringify(migrated), userId);
        try { await spindle.userStorage.delete(legacyPath(scope.id), userId); } catch { /* orphan legacy is harmless */ }
        persisted = migrated;
      }
    }

    const ledger: ScopedLedger = !persisted || persisted.version !== 3
      ? emptyLedger(scope)
      : {
          version: 3,
          scope,
          files: persisted.files,
          structural: persisted.structural,
          externalEdits: persisted.externalEdits ?? [],
        };
    ledgerCache.set(k, ledger);
    pruneLedgerCache();
    return ledger;
  })();
  inflightLoads.set(k, load);
  try { return await load; }
  finally { inflightLoads.delete(k); }
}

async function persistLedger(spindle: SpindleAPI, ledger: ScopedLedger, userId: string): Promise<void> {
  const out: PersistedV3 = {
    version: 3,
    scope: ledger.scope,
    files: ledger.files,
    structural: ledger.structural,
    externalEdits: ledger.externalEdits,
  };
  // Avoid setJson's default indent: 2 to keep ledger files small.
  await spindle.userStorage.write(ledgerPath(ledger.scope), JSON.stringify(out), userId);
}

function findFile(ledger: ScopedLedger, key: FileKey): FileState | undefined {
  const ks = fileKeyString(key);
  return ledger.files.find((f) => fileKeyString(f.key) === ks);
}

function upsertFile(ledger: ScopedLedger, file: FileState): void {
  const ks = fileKeyString(file.key);
  const i = ledger.files.findIndex((f) => fileKeyString(f.key) === ks);
  if (i < 0) ledger.files.push(file);
  else ledger.files[i] = file;
}

type StructuralSurface = StructuralPatch["surface"];
const STRUCTURAL_SURFACES: ReadonlySet<string> = new Set<StructuralSurface>([
  "world_book_entry", "world_book", "regex_script", "alternate_greeting", "alternate_field_variant", "persona", "preset", "preset_block",
]);

function structuralFromEntry(e: EditLogEntry, r: EditCreate | EditDelete): StructuralPatch | null {
  if (!STRUCTURAL_SURFACES.has(r.surface)) {
    return null;
  }
  return {
    id: e.id,
    op: r.op,
    surface: r.surface as StructuralSurface,
    surfaceId: r.surfaceId,
    surfaceLabel: r.surfaceLabel,
    snapshot: r.snapshot,
    author: "agent",
    sessionId: e.sessionId,
    toolCallId: e.toolCallId,
    ts: e.ts,
    reverted: e.reverted,
    ...(e.revertedAt !== undefined ? { revertedAt: e.revertedAt } : {}),
  };
}

// Fold a freshly-emitted EditLogEntry into the v2 ledger. For "edit" ops on
// non-external surfaces we route through patch-stack; create/delete go to
// the structural list; external edits stay on their own list.
export async function appendEntries(
  spindle: SpindleAPI,
  scope: ScopeRef,
  entries: readonly EditLogEntry[],
  userId: string,
): Promise<void> {
  if (entries.length === 0) return;
  // Hold a ref for this scope so a concurrent loadLedger's prune can't evict the
  // ledger object we're about to mutate+persist (which would fork a second copy
  // and lose this update).
  const ck = cacheKey(userId, scope);
  inflightAppends.set(ck, (inflightAppends.get(ck) ?? 0) + 1);
  try {
    await withScopeMutation(ck, async () => {
      const ledger = await loadLedger(spindle, scope, userId);
      let changed = false;
      try {
        for (const e of entries) {
          // Stable ids make an ambiguous write retry safe: if the first write
          // reached disk but its acknowledgement was lost, the retry is a no-op.
          if (containsEntryId(ledger, e.id)) continue;
          const r = e.record;
          if (r.op === "edit" && r.surface !== "external") {
            const key: FileKey = { surface: r.surface, surfaceId: r.surfaceId, field: r.field };
            const existing = findFile(ledger, key);
            const result = recordEdit(existing, {
              key,
              surfaceLabel: r.surfaceLabel,
              live: r.before,
              next: r.after,
              author: "agent",
              sessionId: e.sessionId,
              toolCallId: e.toolCallId,
              description: e.toolName,
              id: e.id,
              ts: e.ts,
              toolName: e.toolName,
              ...(e.assistantMessageId !== undefined ? { assistantMessageId: e.assistantMessageId } : {}),
              turn: e.turn,
              ...(r.valueEncoding !== undefined ? { valueEncoding: r.valueEncoding } : {}),
            });
            // Skip a brand-new file that a no-op edit left empty: nothing to track.
            if (!existing && result.file.patches.length === 0) continue;
            upsertFile(ledger, result.file);
            changed = true;
          } else if (r.op === "create" || r.op === "delete") {
            const sp = structuralFromEntry(e, r);
            if (sp) {
              ledger.structural.push(sp);
              changed = true;
            }
          } else {
            // External edit: keep the raw entry; bridge owns concurrency.
            ledger.externalEdits.push({ ...e });
            changed = true;
          }
        }
        if (changed) await persistLedger(spindle, ledger, userId);
      } catch (err) {
        // userStorage.write may have committed and then lost its acknowledgement.
        // Evict so a stable-id retry reloads disk and reconciles whichever
        // outcome won. Do not restore a stale snapshot over concurrent callers
        // that still hold and may have mutated this shared ledger object.
        ledgerCache.delete(ck);
        throw err;
      }
    });
  } finally {
    const n = (inflightAppends.get(ck) ?? 1) - 1;
    if (n <= 0) inflightAppends.delete(ck); else inflightAppends.set(ck, n);
  }
}

export async function persistLedgerNow(spindle: SpindleAPI, ledger: ScopedLedger, userId: string): Promise<void> {
  await persistLedger(spindle, ledger, userId);
}

// Remove a write-ahead entry that was staged but whose host mutation did not
// survive. Unlike generic id purging, this repairs the FileState invariant:
// expectedHash must describe base + remaining patches, and a first-touch file
// must disappear when its only staged patch is discarded.
//
// Only the latest patch in a field may be discarded. A later patch means
// another writer built on this stage; silently removing its ancestor would
// corrupt replay, so leave it intact and surface a cleanup failure instead.
export async function discardStagedEntry(
  spindle: SpindleAPI,
  entry: EditLogEntry,
  userId: string,
): Promise<boolean> {
  const scope = entry.scope;
  const ck = cacheKey(userId, scope);
  return withScopeMutation(ck, async () => {
    const ledger = await loadLedger(spindle, scope, userId);
    const record = entry.record;
    let changed = false;

    if (record.op === "edit" && record.surface !== "external") {
      const key: FileKey = {
        surface: record.surface,
        surfaceId: record.surfaceId,
        field: record.field,
      };
      const existing = findFile(ledger, key);
      if (!existing) return false;
      // Compute the repaired FileState synchronously off to the side, then
      // replace/remove it in the shared ledger before persistence. Completion
      // never swaps an older whole-ledger snapshot over outside-lock work.
      const file = structuredClone(existing);
      const index = file.patches.findIndex((patch) => patch.id === entry.id);
      if (index < 0) return false;
      if (index !== file.patches.length - 1) {
        throw new Error(`staged edit ${entry.id} is no longer the latest patch`);
      }
      file.patches.pop();
      if (file.patches.length === 0) {
        ledger.files = ledger.files.filter((candidate) => candidate !== existing);
      } else {
        const current = currentValue(file);
        if (current === null) {
          throw new Error(`could not recompute ledger state after discarding staged edit ${entry.id}`);
        }
        file.expectedHash = sha256(current);
        upsertFile(ledger, file);
      }
      changed = true;
    } else if (record.op === "create" || record.op === "delete") {
      const index = ledger.structural.findIndex((patch) => patch.id === entry.id);
      if (index < 0) return false;
      if (index !== ledger.structural.length - 1) {
        throw new Error(`staged edit ${entry.id} is no longer the latest structural patch`);
      }
      ledger.structural.splice(index, 1);
      changed = true;
    } else {
      const index = ledger.externalEdits.findIndex((candidate) => candidate.id === entry.id);
      if (index < 0) return false;
      if (index !== ledger.externalEdits.length - 1) {
        throw new Error(`staged edit ${entry.id} is no longer the latest external edit`);
      }
      ledger.externalEdits.splice(index, 1);
      changed = true;
    }

    if (!changed) return false;
    try {
      await persistLedger(spindle, ledger, userId);
      return true;
    } catch (err) {
      ledgerCache.delete(ck);
      throw err;
    }
  });
}

// Permanently drop the listed entries from the ledger. Used after revert
// succeeds: we don't keep `reverted: true` shadow rows around. Returns the
// ids that were actually removed (subset of input — ids not present in the
// ledger are silently skipped). Callers persist if anything changed.
export function purgeIdsInMemory(
  ledger: ScopedLedger,
  ids: readonly string[],
): readonly string[] {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const removed: string[] = [];
  for (const f of ledger.files) {
    const kept: Patch[] = [];
    for (const p of f.patches) {
      if (idSet.has(p.id)) removed.push(p.id);
      else kept.push(p);
    }
    if (kept.length !== f.patches.length) f.patches = kept;
  }
  if (ledger.structural.length > 0) {
    const kept: StructuralPatch[] = [];
    for (const s of ledger.structural) {
      if (idSet.has(s.id)) removed.push(s.id);
      else kept.push(s);
    }
    if (kept.length !== ledger.structural.length) ledger.structural = kept;
  }
  if (ledger.externalEdits.length > 0) {
    const kept: EditLogEntry[] = [];
    for (const e of ledger.externalEdits) {
      if (idSet.has(e.id)) removed.push(e.id);
      else kept.push(e);
    }
    if (kept.length !== ledger.externalEdits.length) ledger.externalEdits = kept;
  }
  return removed;
}

export async function purgeIds(
  spindle: SpindleAPI,
  scope: ScopeRef,
  ids: readonly string[],
  userId: string,
): Promise<readonly string[]> {
  if (ids.length === 0) return [];
  const ledger = await loadLedger(spindle, scope, userId);
  const removed = purgeIdsInMemory(ledger, ids);
  if (removed.length > 0) await persistLedger(spindle, ledger, userId);
  return removed;
}

// Drop every patch / structural / external entry currently flagged reverted.
// Used to clean up after a revert flow where tryRevert/markReverted has
// already marked the ledger but we haven't yet persisted.
export function purgeAllRevertedInMemory(ledger: ScopedLedger): readonly string[] {
  const removed: string[] = [];
  for (const f of ledger.files) {
    const ids = purgeRevertedPatches(f);
    removed.push(...ids);
  }
  if (ledger.structural.some((s) => s.reverted)) {
    const kept: StructuralPatch[] = [];
    for (const s of ledger.structural) {
      if (s.reverted) removed.push(s.id);
      else kept.push(s);
    }
    ledger.structural = kept;
  }
  if (ledger.externalEdits.some((e) => e.reverted)) {
    const kept: EditLogEntry[] = [];
    for (const e of ledger.externalEdits) {
      if (e.reverted) removed.push(e.id);
      else kept.push(e);
    }
    ledger.externalEdits = kept;
  }
  return removed;
}

// Reconstruct an EditLogEntry view for a single patch. The frontend's diff
// modal already takes (before, after) strings, so synthesizing the v1 shape
// keeps the UI unchanged.
function synthesizeFromPatch(file: FileState, p: Patch, scope: ScopeRef): EditLogEntry | null {
  const slice = sliceForPatch(file, p.id);
  if (!slice) return null;
  const record: EditEdit = {
    op: "edit",
    surface: file.key.surface as Exclude<EditSurface, "external">,
    surfaceId: file.key.surfaceId,
    surfaceLabel: file.surfaceLabel,
    field: file.key.field,
    before: slice.before,
    after: slice.after,
  };
  return {
    id: p.id,
    ts: p.ts,
    sessionId: p.sessionId ?? "",
    scope,
    ...(p.assistantMessageId !== undefined ? { assistantMessageId: p.assistantMessageId } : {}),
    toolCallId: p.toolCallId ?? "",
    toolName: p.toolName ?? p.description,
    turn: p.turn ?? 0,
    record,
    reverted: p.reverted,
    ...(p.revertedAt !== undefined ? { revertedAt: p.revertedAt } : {}),
  };
}

function synthesizeFromStructural(s: StructuralPatch, scope: ScopeRef): EditLogEntry {
  const record: EditCreate | EditDelete = s.op === "create"
    ? {
        op: "create",
        surface: s.surface,
        surfaceId: s.surfaceId,
        surfaceLabel: s.surfaceLabel,
        snapshot: s.snapshot as EditCreate["snapshot"],
      }
    : {
        op: "delete",
        surface: s.surface,
        surfaceId: s.surfaceId,
        surfaceLabel: s.surfaceLabel,
        snapshot: s.snapshot as EditDelete["snapshot"],
      };
  return {
    id: s.id,
    ts: s.ts,
    sessionId: s.sessionId ?? "",
    scope,
    toolCallId: s.toolCallId ?? "",
    toolName: s.op,
    turn: 0,
    record,
    reverted: s.reverted,
    ...(s.revertedAt !== undefined ? { revertedAt: s.revertedAt } : {}),
  };
}

// Project the v2 ledger to a chronological EditLogEntry[] for the workshop.
export function entriesView(ledger: ScopedLedger): EditLogEntry[] {
  const out: EditLogEntry[] = [];
  for (const f of ledger.files) {
    for (const p of f.patches) {
      // Hide no-op patches (before === after). Prevention stops new ones;
      // this also clears legacy empties persisted before that landed.
      if (p.hashBefore === p.hashAfter) continue;
      const e = synthesizeFromPatch(f, p, ledger.scope);
      if (e) out.push(e);
    }
  }
  for (const s of ledger.structural) {
    out.push(synthesizeFromStructural(s, ledger.scope));
  }
  for (const e of ledger.externalEdits) {
    out.push({ ...e });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

export function findEntry(ledger: ScopedLedger, editId: string): EditLogEntry | null {
  for (const f of ledger.files) {
    for (const p of f.patches) {
      if (p.id === editId) return synthesizeFromPatch(f, p, ledger.scope);
    }
  }
  for (const s of ledger.structural) {
    if (s.id === editId) return synthesizeFromStructural(s, ledger.scope);
  }
  for (const e of ledger.externalEdits) {
    if (e.id === editId) return { ...e };
  }
  return null;
}

// Locate the (file, patch) pair for an edit id, if it's a field edit.
export function findPatch(ledger: ScopedLedger, editId: string): { file: FileState; patch: Patch } | null {
  for (const f of ledger.files) {
    for (const p of f.patches) {
      if (p.id === editId) return { file: f, patch: p };
    }
  }
  return null;
}

export function findStructural(ledger: ScopedLedger, editId: string): StructuralPatch | null {
  return ledger.structural.find((s) => s.id === editId) ?? null;
}

export function findExternal(ledger: ScopedLedger, editId: string): EditLogEntry | null {
  return ledger.externalEdits.find((e) => e.id === editId) ?? null;
}

// Group ledger view into per-file timelines (for the workshop "by file" tab).
export function groupByFile(ledger: ScopedLedger): FileTimeline[] {
  const view = entriesView(ledger);
  const groups = new Map<string, EditLogEntry[]>();
  for (const e of view) {
    const k = fileKeyOf(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const out: FileTimeline[] = [];
  for (const [fileKey, entries] of groups) {
    entries.sort((a, b) => a.ts - b.ts);
    const first = entries[0]!;
    const r = first.record;
    const surface = r.surface as EditSurface;
    const surfaceId = "surfaceId" in r ? r.surfaceId : "";
    const surfaceLabel = "surfaceLabel" in r ? r.surfaceLabel : "";
    const field = r.op === "edit" ? r.field : null;
    let live = 0; let reverted = 0;
    for (const e of entries) { if (e.reverted) reverted++; else live++; }
    out.push({ fileKey, surface, surfaceId, surfaceLabel, field, entries, liveEditCount: live, revertedEditCount: reverted });
  }
  out.sort((a, b) => {
    if (a.liveEditCount !== b.liveEditCount) return b.liveEditCount - a.liveEditCount;
    const aLast = a.entries[a.entries.length - 1]!.ts;
    const bLast = b.entries[b.entries.length - 1]!.ts;
    return bLast - aLast;
  });
  return out;
}

export interface SquashSummary {
  readonly filesTouched: number;
  readonly groupsMerged: number;
  readonly absorbedIds: readonly string[];
  readonly newPatchIds: readonly string[];
  // Maps every absorbed (now-gone) id to the merged patch id that replaced
  // it. Lets callers rewrite frontend-facing edit_ids so post-squash revert
  // UI still resolves to a live ledger entry.
  readonly absorbedToMerged: ReadonlyMap<string, string>;
}

// Squash every contiguous run of agent patches sharing the given
// assistantMessageId. Use this at end-of-message to collapse the dozen
// micro-edits a single response can rack up into one per file.
// `seal=true` is for the mid-message squash tool: the resulting patches
// become boundary markers that the end-of-message autosquash won't merge
// across.
export async function squashMessage(
  spindle: SpindleAPI,
  scope: ScopeRef,
  assistantMessageId: string,
  userId: string,
  opts: { sealed?: boolean } = {},
): Promise<SquashSummary> {
  const ledger = await loadLedger(spindle, scope, userId);
  const absorbedIds: string[] = [];
  const newPatchIds: string[] = [];
  const absorbedToMerged = new Map<string, string>();
  let filesTouched = 0;
  let groupsMerged = 0;
  let changed = false;
  for (const f of ledger.files) {
    const res = squashByMessage(f, assistantMessageId, opts);
    if (res.length === 0) continue;
    let actuallyMerged = 0;
    for (const r of res) {
      if (r.merged === null) {
        // Run collapsed to no net change: every absorbed id is gone, no
        // replacement patch. Surface them so the frontend drops the rows.
        for (const id of r.absorbedIds) absorbedIds.push(id);
        actuallyMerged++;
        changed = true;
      } else if (r.absorbedIds.length > 1) {
        const mergedId = r.merged.id;
        for (const id of r.absorbedIds) {
          if (id === mergedId) continue;
          absorbedIds.push(id);
          absorbedToMerged.set(id, mergedId);
        }
        newPatchIds.push(mergedId);
        actuallyMerged++;
        changed = true;
      } else if (opts.sealed === true) {
        // Seal-only flip on a single patch.
        changed = true;
      }
    }
    if (actuallyMerged > 0) {
      filesTouched++;
      groupsMerged += actuallyMerged;
    }
  }
  if (changed) await persistLedger(spindle, ledger, userId);
  return { filesTouched, groupsMerged, absorbedIds, newPatchIds, absorbedToMerged };
}

export type { SquashGroupResult };

export function dropCache(scope: ScopeRef, userId?: string): void {
  if (userId) {
    ledgerCache.delete(cacheKey(userId, scope));
    return;
  }
  const suffix = `:${scopeKeyString(scope)}`;
  for (const k of ledgerCache.keys()) {
    if (k.endsWith(suffix)) ledgerCache.delete(k);
  }
}

// External-surface edits aren't in patch-stack, so a "later edits on the same
// file" check stays useful only for backwards compatibility with the existing
// revert flow. We keep the function as a no-op for v2 (cascade is handled
// inside patch-stack on revert).
export function laterEditsOnSameFile(_ledger: ScopedLedger, _editId: string): EditLogEntry[] {
  return [];
}

// Enumerate persisted ledger directories when an operation must span entities
// instead of following the current focus (bulk tag edits can touch hundreds of
// character scopes in one call).
const LEDGER_SCOPE_KINDS: readonly ScopeKind[] = [
  "character",
  "persona",
  "chat",
  "databank",
  "preset",
  "world_book",
  "regex_script",
  "global_addon",
  "variables",
  "images",
];

export async function listScopeLedgers(
  spindle: SpindleAPI,
  userId: string,
  kinds: readonly ScopeKind[] = LEDGER_SCOPE_KINDS,
): Promise<Array<{ scope: ScopeRef; ledger: ScopedLedger }>> {
  const out: Array<{ scope: ScopeRef; ledger: ScopedLedger }> = [];
  const seen = new Set<string>();
  for (const kind of kinds) {
    let names: string[] = [];
    try { names = await spindle.userStorage.list(`${LEDGER_DIR}/${kind}/`, userId); } catch { /* no dir yet */ }
    for (const rel of names) {
      const base = rel.split(/[\\/]/).pop() ?? "";
      if (!base.endsWith(".json")) continue;
      const id = base.slice(0, -5);
      const scope: ScopeRef = { kind, id };
      const key = scopeKeyString(scope);
      if (seen.has(key)) continue;
      seen.add(key);
      const ledger = await loadLedger(spindle, scope, userId).catch(() => null);
      if (ledger) out.push({ scope, ledger });
    }
  }

  // A character ledger written before scope-addressed storage lives directly
  // under `ledgers/<characterId>.json`. userStorage.list is non-recursive, so
  // enumerate those flat files when character scopes are requested and route
  // each through loadLedger's one-way migration. Without this pass, a global
  // list/revert can only discover legacy history after that character happens
  // to become focused.
  if (kinds.includes("character")) {
    let legacyNames: string[] = [];
    try { legacyNames = await spindle.userStorage.list(`${LEDGER_DIR}/`, userId); } catch { /* no dir yet */ }
    for (const rel of legacyNames) {
      const prefix = `${LEDGER_DIR}/`;
      const normalisedRel = rel.replace(/\\/g, "/");
      const relative = normalisedRel.startsWith(prefix) ? normalisedRel.slice(prefix.length) : normalisedRel;
      const base = relative.replace(/\/$/, "");
      if (base.includes("/") || !base.endsWith(".json")) continue;
      const id = base.slice(0, -5);
      const scope: ScopeRef = { kind: "character", id };
      const key = scopeKeyString(scope);
      if (seen.has(key)) continue;
      seen.add(key);
      const ledger = await loadLedger(spindle, scope, userId).catch(() => null);
      if (ledger) out.push({ scope, ledger });
    }
  }
  return out;
}

export async function listNonCharacterScopeLedgers(
  spindle: SpindleAPI,
  userId: string,
): Promise<Array<{ scope: ScopeRef; ledger: ScopedLedger }>> {
  return listScopeLedgers(
    spindle,
    userId,
    LEDGER_SCOPE_KINDS.filter((kind) => kind !== "character"),
  );
}

// Re-export the entry record types for callers that used to import them via
// this module under the v1 shape. Avoids touching every import site.
export type { EditEdit, EditCreate, EditDelete, EditExternal };
