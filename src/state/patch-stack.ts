import { createPatch, applyPatch } from "diff";
import type { EditSurface, ScopeRef } from "../types";

// Per-field patch-stack storage for the edit ledger. One FileState per touched
// field; each agent edit appends a Patch. External drift (an edit that
// bypassed the agent) is caught by hash mismatch on the next agent edit or
// workshop-open scan, and folded in as an "external" patch so the workshop UI
// sees every change that ever touched the field.

export type PatchAuthor = "agent" | "external" | "manual";

export interface FileKey {
  readonly surface: EditSurface;
  readonly surfaceId: string;
  readonly field: string;
}

export type PatchMode = "diff" | "literal";

export interface Patch {
  readonly id: string;
  readonly author: PatchAuthor;
  readonly sessionId: string | null;
  readonly toolCallId: string | null;
  readonly ts: number;
  // For mode "diff": unified-diff string. For "literal": the full post-patch
  // text. Literal mode kicks in for very short single-line fields where the
  // unified-diff envelope dwarfs the content (see TINY_LIMIT below).
  readonly mode: PatchMode;
  readonly body: string;
  readonly hashBefore: string;
  readonly hashAfter: string;
  readonly description: string;
  readonly toolName?: string;
  readonly assistantMessageId?: string;
  readonly turn?: number;
  reverted: boolean;
  revertedAt?: number;
  // True once a squash has consolidated this patch into a "phase boundary"
  // (either via mid-message squash_session_edits, or any future explicit seal).
  // Autosquash never merges across a sealed patch; the agent uses this to
  // commit intermediate phases of a multi-step task.
  sealed?: boolean;
}

export interface FileState {
  readonly key: FileKey;
  readonly surfaceLabel: string;
  base: string;
  baseAt: number;
  baseHash: string;
  patches: Patch[];
  expectedHash: string;
}

// jsdiff's applyPatch fuzz: context lines may drift by up to N lines and the
// patch still applies. Absorbs the most common "another patch changed nearby
// lines but not the ones we touched" case. Higher fuzz risks mis-applying;
// 2 matches `patch -p1` defaults.
export const APPLY_FUZZ = 2;

// Threshold below which we store the raw post-patch text instead of a unified
// diff. Saves bytes on name/tag-style fields where the diff envelope is bigger
// than the content. Single-line only; multi-line content always uses a diff
// so revert/replay semantics stay uniform.
const TINY_LIMIT = 80;

function isSingleLine(s: string): boolean {
  return !s.includes("\n");
}

// SHA-256 over UTF-8 bytes. Uses Bun.CryptoHasher when available (backend),
// falls back to Web Crypto for any browser/test path that imports this file.
// Synchronous on Bun; async path is unused in production but kept for safety.
export function sha256(text: string): string {
  const g = globalThis as { Bun?: { CryptoHasher: new (alg: string) => { update(s: string): void; digest(enc: string): string } } };
  if (g.Bun?.CryptoHasher) {
    const h = new g.Bun.CryptoHasher("sha256");
    h.update(text);
    return h.digest("hex");
  }
  throw new Error("sha256 requires Bun.CryptoHasher; web fallback not implemented");
}

export function fileKeyString(k: FileKey): string {
  return `${k.surface}:${k.surfaceId}:${k.field}`;
}

export function parseFileKey(s: string): FileKey {
  const i = s.indexOf(":");
  const j = s.indexOf(":", i + 1);
  if (i < 0 || j < 0) throw new Error(`bad fileKey ${s}`);
  return { surface: s.slice(0, i) as EditSurface, surfaceId: s.slice(i + 1, j), field: s.slice(j + 1) };
}

function makePatchId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Build a Patch object from before/after text. Picks diff-mode or literal-mode
// based on size. The caller supplies provenance (author, session, etc).
export function buildPatch(args: {
  before: string;
  after: string;
  author: PatchAuthor;
  sessionId: string | null;
  toolCallId: string | null;
  description: string;
  id?: string;
  ts?: number;
  toolName?: string;
  assistantMessageId?: string;
  turn?: number;
  sealed?: boolean;
}): Patch {
  const { before, after } = args;
  const hashBefore = sha256(before);
  const hashAfter = sha256(after);
  const tiny = after.length <= TINY_LIMIT && before.length <= TINY_LIMIT && isSingleLine(before) && isSingleLine(after);
  const mode: PatchMode = tiny ? "literal" : "diff";
  const body = tiny ? after : createPatch("field", before, after, "", "");
  return {
    id: args.id ?? makePatchId(),
    author: args.author,
    sessionId: args.sessionId,
    toolCallId: args.toolCallId,
    ts: args.ts ?? Date.now(),
    mode,
    body,
    hashBefore,
    hashAfter,
    description: args.description,
    ...(args.toolName !== undefined ? { toolName: args.toolName } : {}),
    ...(args.assistantMessageId !== undefined ? { assistantMessageId: args.assistantMessageId } : {}),
    ...(args.turn !== undefined ? { turn: args.turn } : {}),
    reverted: false,
    ...(args.sealed === true ? { sealed: true } : {}),
  };
}

// Apply a single patch to `prev`. Returns the new text, or null on conflict.
// Literal-mode patches always succeed (the body IS the new text).
// `fuzz` controls jsdiff's context-line tolerance. Default APPLY_FUZZ for
// forward replay where small drift should still apply; cascade detection
// passes 0 so any context mismatch forces an explicit cascade-revert instead
// of silently mis-applying onto wrong lines.
export function applySinglePatch(prev: string, patch: Patch): string | null {
  if (patch.mode === "literal") return patch.body;
  const res = applyPatch(prev, patch.body, { fuzzFactor: APPLY_FUZZ });
  if (res === false) return null;
  return res;
}

export interface ApplyOutcome {
  readonly text: string | null;
  readonly conflictAt: string | null;
}

// Replay all non-reverted patches over `base` in order. Stops at the first
// conflict and reports which patch failed. Reverted patches are skipped.
export function applyPatches(base: string, patches: readonly Patch[]): ApplyOutcome {
  let cur = base;
  for (const p of patches) {
    if (p.reverted) continue;
    const next = applySinglePatch(cur, p);
    if (next === null) return { text: null, conflictAt: p.id };
    cur = next;
  }
  return { text: cur, conflictAt: null };
}

export interface RecordAgentEditInput {
  readonly key: FileKey;
  readonly surfaceLabel: string;
  readonly live: string;
  readonly next: string;
  readonly author: PatchAuthor;
  readonly sessionId: string | null;
  readonly toolCallId: string | null;
  readonly description: string;
  readonly id?: string;
  readonly ts?: number;
  readonly toolName?: string;
  readonly assistantMessageId?: string;
  readonly turn?: number;
}

export interface RecordAgentEditResult {
  readonly file: FileState;
  readonly appended: readonly Patch[];
}

// Record an agent (or manual) edit on `file`. If `live` doesn't match the
// file's `expectedHash`, an external edit happened since the last write;
// fold it in as an external patch first, then append the agent patch. If
// `file` is undefined, this is the first touch — seed a FileState with `live`
// as the base.
export function recordEdit(
  existing: FileState | undefined,
  input: RecordAgentEditInput,
): RecordAgentEditResult {
  const liveHash = sha256(input.live);
  const appended: Patch[] = [];

  let file: FileState;
  if (!existing) {
    file = {
      key: input.key,
      surfaceLabel: input.surfaceLabel,
      base: input.live,
      baseAt: Date.now(),
      baseHash: liveHash,
      patches: [],
      expectedHash: liveHash,
    };
  } else {
    file = existing;
    if (liveHash !== file.expectedHash) {
      const reconstructed = applyPatches(file.base, file.patches);
      if (reconstructed.text !== null) {
        const ext = buildPatch({
          before: reconstructed.text,
          after: input.live,
          author: "external",
          sessionId: null,
          toolCallId: null,
          description: "external edit",
        });
        file.patches.push(ext);
        appended.push(ext);
        file.expectedHash = liveHash;
      } else {
        // Reconstruction failed: the ledger can't replay cleanly. Rebase by
        // resetting base to live so future edits stay consistent. Prior
        // patches stay for forensic visibility but get marked reverted so
        // they don't poison replay.
        for (const p of file.patches) { p.reverted = true; p.revertedAt = Date.now(); }
        file.base = input.live;
        file.baseHash = liveHash;
        file.expectedHash = liveHash;
      }
    }
  }

  const p = buildPatch({
    before: input.live,
    after: input.next,
    author: input.author,
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    description: input.description,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.ts !== undefined ? { ts: input.ts } : {}),
    ...(input.toolName !== undefined ? { toolName: input.toolName } : {}),
    ...(input.assistantMessageId !== undefined ? { assistantMessageId: input.assistantMessageId } : {}),
    ...(input.turn !== undefined ? { turn: input.turn } : {}),
  });
  file.patches.push(p);
  file.expectedHash = p.hashAfter;
  appended.push(p);
  return { file, appended };
}

export type RevertOutcome =
  | { kind: "clean"; recomputed: string; cascaded: readonly string[] }
  | { kind: "noop"; reason: "already_reverted" | "patch_not_found" }
  | { kind: "external_diverged"; liveHash: string; expectedHash: string };

// Strip every `reverted: true` patch from `file.patches`. Caller must have
// already replayed (via tryRevert or equivalent) so file.expectedHash is up
// to date. Reverts are permanent; we don't keep them in the ledger.
// Returns the removed patch ids so callers can propagate them to listeners
// (chat-thread mirrors, etc).
export function purgeRevertedPatches(file: FileState): readonly string[] {
  const removed: string[] = [];
  const kept: Patch[] = [];
  for (const p of file.patches) {
    if (p.reverted) removed.push(p.id);
    else kept.push(p);
  }
  if (removed.length > 0) file.patches = kept;
  return removed;
}

// Drop a patch from the stack. If later patches depended on the reverted
// content and can't replay cleanly even with fuzz, cascade-revert them too
// (their context no longer exists, so the change they intended is undefined).
// Returns the recomputed text plus the list of cascaded patch ids so the UI
// can show "reverted X plus N dependent edits". Modelled on `git revert`
// against a chain where reverting an ancestor naturally invalidates descendants
// that touch the same lines.
//
// `live` is the current spindle value; if it doesn't match expectedHash an
// external edit slipped in and we bail with external_diverged so the caller
// can fold that in first (recordExternalDrift) before re-trying.
export function tryRevert(file: FileState, patchId: string, live: string): RevertOutcome {
  const idx = file.patches.findIndex((p) => p.id === patchId);
  if (idx < 0) return { kind: "noop", reason: "patch_not_found" };
  const target = file.patches[idx]!;
  if (target.reverted) return { kind: "noop", reason: "already_reverted" };

  const liveHash = sha256(live);
  if (liveHash !== file.expectedHash) {
    return { kind: "external_diverged", liveHash, expectedHash: file.expectedHash };
  }

  const now = Date.now();
  target.reverted = true;
  target.revertedAt = now;

  const cascaded: string[] = [];
  let cur = file.base;
  for (const p of file.patches) {
    if (p.reverted) continue;
    // Same fuzz as forward replay so we don't false-positive cascade
    // independent edits whose context happened to include the reverted
    // region. A theoretical risk remains: a patch could fuzz-match onto
    // shifted lines after a dependency is gone. In practice the unified
    // diffs we produce have short context and the misapply ends up visible
    // in the workshop diff card.
    const next = applySinglePatch(cur, p);
    if (next === null) {
      p.reverted = true;
      p.revertedAt = now;
      cascaded.push(p.id);
      continue;
    }
    cur = next;
  }
  file.expectedHash = sha256(cur);
  return { kind: "clean", recomputed: cur, cascaded };
}

// Recompute the current value implied by base + live patches. Used by the
// external scanner and any caller that wants the "agent's view" of a field
// without consulting the spindle.
export function currentValue(file: FileState): string | null {
  const r = applyPatches(file.base, file.patches);
  return r.text;
}

// Append an external-drift patch when a passive scan finds the spindle value
// has diverged from `expectedHash`. Returns the appended patch, or null if
// nothing to do.
export function recordExternalDrift(file: FileState, live: string): Patch | null {
  const liveHash = sha256(live);
  if (liveHash === file.expectedHash) return null;
  const reconstructed = applyPatches(file.base, file.patches);
  const before = reconstructed.text ?? file.base;
  const p = buildPatch({
    before,
    after: live,
    author: "external",
    sessionId: null,
    toolCallId: null,
    description: "external edit",
  });
  file.patches.push(p);
  file.expectedHash = liveHash;
  return p;
}

// For the workshop UI: reconstruct the before/after text pair for a single
// patch by replaying everything up to (and including) it. `before` = state
// just before the patch was applied; `after` = state after. Reverted patches
// upstream are skipped so the user sees the timeline as it currently stands.
export interface PatchSlice {
  readonly before: string;
  readonly after: string;
}

export function sliceForPatch(file: FileState, patchId: string): PatchSlice | null {
  let cur = file.base;
  for (const p of file.patches) {
    if (p.id === patchId) {
      const after = applySinglePatch(cur, p);
      if (after === null) return null;
      return { before: cur, after };
    }
    if (p.reverted) continue;
    const next = applySinglePatch(cur, p);
    if (next === null) return null;
    cur = next;
  }
  return null;
}

// Structural patches (create/delete of whole entities) live alongside the
// per-field patches but don't follow the same replay semantics — there's
// nothing to diff. They mirror today's EditCreate/EditDelete and are kept as
// DTO snapshots for revert.
export interface StructuralPatch {
  readonly id: string;
  readonly op: "create" | "delete";
  readonly surface: "world_book_entry" | "regex_script" | "alternate_greeting" | "persona";
  readonly surfaceId: string;
  readonly surfaceLabel: string;
  readonly snapshot: unknown;
  readonly author: PatchAuthor;
  readonly sessionId: string | null;
  readonly toolCallId: string | null;
  readonly ts: number;
  reverted: boolean;
  revertedAt?: number;
}

// version 3 = scope-addressed. v2 (characterId-only) is migrated on load.
export interface ScopedLedgerV2 {
  readonly version: 3;
  readonly scope: ScopeRef;
  files: FileState[];
  structural: StructuralPatch[];
}

export function emptyLedgerV2(scope: ScopeRef): ScopedLedgerV2 {
  return { version: 3, scope, files: [], structural: [] };
}

export interface SquashGroupResult {
  readonly merged: Patch;
  readonly absorbedIds: readonly string[];
}

// Merge a contiguous run of patches (positions [start, end] inclusive in
// file.patches) into one. The merged patch's diff goes from the state just
// before file.patches[start] to the state just after file.patches[end],
// computed with reverted patches skipped per normal replay semantics. The
// absorbed patches are removed from the list. Returns null if the range
// can't be replayed.
export function squashRange(
  file: FileState,
  start: number,
  end: number,
  opts: { sealed?: boolean; description?: string; assistantMessageId?: string; toolName?: string; sessionId?: string | null; toolCallId?: string | null },
): SquashGroupResult | null {
  if (start < 0 || end >= file.patches.length || start > end) return null;
  if (start === end) {
    const only = file.patches[start]!;
    if (opts.sealed === true && only.sealed !== true) only.sealed = true;
    return { merged: only, absorbedIds: [only.id] };
  }
  // Replay base..start-1 to get "before"; base..end (skipping reverted) to get "after".
  let before = file.base;
  for (let i = 0; i < start; i++) {
    const p = file.patches[i]!;
    if (p.reverted) continue;
    const next = applySinglePatch(before, p);
    if (next === null) return null;
    before = next;
  }
  let after = before;
  for (let i = start; i <= end; i++) {
    const p = file.patches[i]!;
    if (p.reverted) continue;
    const next = applySinglePatch(after, p);
    if (next === null) return null;
    after = next;
  }
  const absorbed = file.patches.slice(start, end + 1);
  const absorbedIds = absorbed.map((p) => p.id);
  const first = absorbed[0]!;
  const last = absorbed[absorbed.length - 1]!;
  const merged = buildPatch({
    before,
    after,
    author: "agent",
    sessionId: opts.sessionId ?? first.sessionId,
    toolCallId: opts.toolCallId ?? null,
    description: opts.description ?? first.description,
    ts: last.ts,
    ...(opts.toolName !== undefined ? { toolName: opts.toolName } : first.toolName !== undefined ? { toolName: first.toolName } : {}),
    ...(opts.assistantMessageId !== undefined ? { assistantMessageId: opts.assistantMessageId } : first.assistantMessageId !== undefined ? { assistantMessageId: first.assistantMessageId } : {}),
    ...(first.turn !== undefined ? { turn: first.turn } : {}),
    ...(opts.sealed === true ? { sealed: true } : {}),
  });
  file.patches.splice(start, end - start + 1, merged);
  return { merged, absorbedIds };
}

// Squash all contiguous runs in `file.patches` of agent-authored, non-sealed
// patches that share the same assistantMessageId. External-authored patches
// and sealed patches act as boundaries, splitting runs. Reverted patches stay
// in the run (squashRange replays them as no-ops, then drops them since
// they're absorbed into the merged patch).
export function squashByMessage(
  file: FileState,
  assistantMessageId: string,
  opts: { sealed?: boolean } = {},
): readonly SquashGroupResult[] {
  const out: SquashGroupResult[] = [];
  // Walk right-to-left so splices don't invalidate earlier indices.
  let i = file.patches.length - 1;
  while (i >= 0) {
    const p = file.patches[i]!;
    if (p.author !== "agent" || p.assistantMessageId !== assistantMessageId || p.sealed === true) {
      i--; continue;
    }
    // Find the start of the run.
    let start = i;
    while (start - 1 >= 0) {
      const q = file.patches[start - 1]!;
      if (q.author !== "agent" || q.assistantMessageId !== assistantMessageId || q.sealed === true) break;
      start--;
    }
    if (start < i) {
      const res = squashRange(file, start, i, opts);
      if (res) out.push(res);
    } else if (opts.sealed === true) {
      // Single-patch "run". Still seal it so subsequent autosquash respects the boundary.
      p.sealed = true;
      out.push({ merged: p, absorbedIds: [p.id] });
    }
    i = start - 1;
  }
  return out;
}
