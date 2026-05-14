import type { LlmMessage } from "../types";

// Anchor on the latest-but-one user turn. Anthropic pays write premium on
// the small per-turn delta, in exchange for almost everything staying cached.
const LAG_USER_TURNS = 1;

// Anchoring at-or-after a freed stub would write a cache snapshot that
// diverges from the un-mutated prefix earlier sends cached.
const FREED_STUB_PREFIX = "[freed:";

export type CacheMode = "off" | "system_only" | "full";

// Marker on the system message. Active in "system_only" and "full" modes.
export function systemMessageWithCache(text: string, mode: CacheMode): LlmMessage {
  if (mode === "off") {
    return { role: "system", content: text };
  }
  return {
    role: "system",
    content: [{ type: "text", text, cache_control: { type: "ephemeral", ttl: "1h" } }],
  };
}

// Rolling breakpoint on the (current - LAG_USER_TURNS)-th user turn, or
// earlier if a freed stub forces the anchor back. Active only in "full".
export function withRollingCacheBreakpoint(conv: LlmMessage[], mode: CacheMode): LlmMessage[] {
  if (mode !== "full") return conv;

  const userIdxs: number[] = [];
  for (let i = 0; i < conv.length; i++) {
    if (conv[i]!.role === "user" && !isPureToolResult(conv[i]!)) userIdxs.push(i);
  }
  if (userIdxs.length <= LAG_USER_TURNS) return conv;

  let candidateUserIdx = userIdxs.length - 1 - LAG_USER_TURNS;

  // Anchor must sit strictly before any freed stub so the cache write
  // captures only bytes that won't mutate later.
  const earliestFreedConvIdx = findEarliestFreedConvIdx(conv);
  if (earliestFreedConvIdx >= 0) {
    let cap = -1;
    for (let j = 0; j < userIdxs.length; j++) {
      if (userIdxs[j]! < earliestFreedConvIdx) cap = j;
      else break;
    }
    if (cap < 0) return conv;
    candidateUserIdx = Math.min(candidateUserIdx, cap);
  }

  const targetIdx = userIdxs[candidateUserIdx]!;
  const out = conv.slice();
  out[targetIdx] = stampCacheControl(out[targetIdx]!);
  return out;
}

function findEarliestFreedConvIdx(conv: readonly LlmMessage[]): number {
  for (let i = 0; i < conv.length; i++) {
    const m = conv[i]!;
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "tool_result" && p.content.startsWith(FREED_STUB_PREFIX)) return i;
    }
  }
  return -1;
}

function isPureToolResult(m: LlmMessage): boolean {
  if (typeof m.content === "string") return false;
  return m.content.length > 0 && m.content.every((p) => p.type === "tool_result");
}

function stampCacheControl(m: LlmMessage): LlmMessage {
  if (typeof m.content === "string") {
    return {
      ...m,
      content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral", ttl: "1h" } }],
    };
  }
  if (m.content.length === 0) return m;
  const parts = m.content.slice();
  const last = parts[parts.length - 1]!;
  parts[parts.length - 1] = { ...last, cache_control: { type: "ephemeral", ttl: "1h" } };
  return { ...m, content: parts };
}
