import { writeTmp, readTmp } from "../../state/tmp-store";
import type { ToolCtx } from "./_context";

export async function stashDraft(ctx: ToolCtx, origin: string, payload: string): Promise<string> {
  const info = await writeTmp(ctx.spindle, ctx.sessionId, ctx.userId, payload, `draft:${origin}`);
  return info.handle;
}

export async function loadDraft(ctx: ToolCtx, handle: string): Promise<string | null> {
  return readTmp(ctx.spindle, ctx.sessionId, ctx.userId, handle);
}

export function draftReuseNote(handle: string, chars: number, paramName: string): string {
  return `Your ${paramName} payload (${chars} chars) is saved at draft handle '${handle}'. To retry without re-emitting it, call this tool again with ${paramName}_handle='${handle}' instead of ${paramName}. The handle lives in the session's tmp store, LRU-evicted (cap 50 files / 30 MB per user) or cleared on session delete.`;
}
