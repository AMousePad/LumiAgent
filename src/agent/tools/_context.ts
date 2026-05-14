import type { SpindleAPI } from "lumiverse-spindle-types";
import type { EditRecord, RevertOutcomeWire } from "../../types";

export interface ToolCtx {
  readonly spindle: SpindleAPI;
  readonly userId: string;
  readonly sessionId: string;
  readonly characterId: string;
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
