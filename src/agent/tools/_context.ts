import type { SpindleAPI } from "lumiverse-spindle-types";
import type { EditRecord, RevertOutcomeWire } from "../../types";
import { ErrorCode, codedError } from "./_error_codes";

export interface ToolCtx {
  readonly spindle: SpindleAPI;
  readonly userId: string;
  readonly sessionId: string;
  // The session's focused character, or null in All Characters mode.
  // Tools that need a character resolve via resolveCharacterTarget(ctx, explicit?)
  // which honours an explicit input.character_id and falls back to focus.
  readonly characterId: string | null;
  // Id of the assistant message that owns this run. Set by the agent loop.
  // Tools that need to scope work to "this response" (revert_session_edits,
  // squash_session_edits) read it. Empty string only in synthetic/test contexts.
  readonly assistantMessageId: string;
  readonly pinnedChatId: string | null;
  readonly signal: AbortSignal;
  readonly contextTokens: number;
  readonly recentReads: RecentReadsCache;
  setFinished(summary: string): void;
  pushEdit(record: EditRecord): void;
  // The agent reverted one of its prior edits through a tool. The loop turns
  // these into revert_logged events the backend converts into edit_reverted
  // wire messages (same plumbing as user-driven workshop reverts).
  pushRevert(editId: string, outcome: RevertOutcomeWire): void;
  // The agent ran a squash. The loop emits an edits_resynced event the
  // backend uses to push the fresh ledger view to the frontend.
  pushLedgerResync(): void;
  // tool_search calls this to register newly-discovered deferred tools so the
  // loop expands the tools list passed to runLlmStream on subsequent turns.
  // Tools that ignore deferred state can leave this unset.
  discoverTools?(names: readonly string[]): void;
  // Backend-frontend RPC. Used by tools that need a browser-only capability
  // the sandboxed backend lacks (e.g. Chrome's built-in Translator API).
  // Resolves with the frontend's response or rejects on timeout/error.
  callFrontend?(op: string, args: unknown, timeoutMs?: number): Promise<unknown>;
}

interface RecentRead { readonly ts: number; readonly hash: string | null; }

export class RecentReadsCache {
  private readonly entries = new Map<string, RecentRead>();

  record(key: string, hash?: string): void {
    this.entries.set(key, { ts: Date.now(), hash: hash ?? null });
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  ageMs(key: string): number | null {
    const t = this.entries.get(key);
    return t === undefined ? null : Date.now() - t.ts;
  }

  getHash(key: string): string | null {
    return this.entries.get(key)?.hash ?? null;
  }

  // Update the cached hash without resetting the timestamp. Called after a
  // successful write so consecutive edits to the same path see the post-write
  // hash and don't trip the freshness check.
  updateHash(key: string, hash: string): void {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.set(key, { ts: existing.ts, hash });
  }

  forget(key: string): void {
    this.entries.delete(key);
  }
}

// Thrown when a tool needs a character/chat but none was passed explicitly and
// none is focused on the session. Callers map it to a [NO_TARGET] result via
// noTargetResult so the agent learns to pass an id or focus one.
export class NoTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoTargetError";
  }
}

// Resolve a character target: explicit input wins, else the session focus,
// else NoTargetError. Whole-card tools that can run in All Characters mode
// call this so an explicit character_id addresses any card while the common
// focused case stays a no-op default (no extra tool call to discover the id).
export function resolveCharacterTarget(ctx: ToolCtx, explicit?: string | null): string {
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  if (ctx.characterId !== null && ctx.characterId.length > 0) return ctx.characterId;
  throw new NoTargetError(
    "no character target. Pass `character_id` explicitly, or have the user focus a character via the picker. Use `list_characters` to enumerate ids.",
  );
}

// Chat-bound variant: explicit chat_id wins, else the session's pinned chat,
// else NoTargetError.
export function resolveChatTarget(ctx: ToolCtx, explicit?: string | null): string {
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  if (ctx.pinnedChatId !== null && ctx.pinnedChatId.length > 0) return ctx.pinnedChatId;
  throw new NoTargetError(
    "no chat target. Pass `chat_id` explicitly, or have the user pin a chat. Use `list_chats_for_character` to enumerate ids.",
  );
}

// Map a NoTargetError to its coded result; rethrow anything else. Lets a tool's
// catch block do `const nt = noTargetResult(err); if (nt) return nt;`.
export function noTargetResult(err: unknown): { content: string; isError: true } | null {
  if (err instanceof NoTargetError) return { content: codedError(ErrorCode.NO_TARGET, err.message), isError: true };
  return null;
}
