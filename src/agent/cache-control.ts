import type { LlmMessage } from "../types";

// Primary anchor on the latest-but-one user turn. Anthropic pays write
// premium on the small per-turn delta, in exchange for almost everything
// staying cached.
const LAG_USER_TURNS = 1;

// Deeper rolling anchors, measured as additional lag past LAG_USER_TURNS.
// Anchors at N-1, N-4, N-7. Sub-prefixes of the primary anchor, so the
// shared bytes write once (Anthropic dedupes cache_creation_input_tokens
// across markers within the same prefix). Each deeper anchor turns an
// edit-at-recent-turn from a full-prefix rebuild into a delta rebuild.
const ADDITIONAL_LAGS = [3, 6] as const;

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

// Rolling breakpoints on user turns N-1, N-4, N-7. A freed stub between
// anchors drops the ones past it, leaving the deeper survivors as live
// fallback cache hits. Active only in "full".
export function withRollingCacheBreakpoint(conv: LlmMessage[], mode: CacheMode): LlmMessage[] {
  if (mode !== "full") return conv;

  const userIdxs: number[] = [];
  for (let i = 0; i < conv.length; i++) {
    if (conv[i]!.role === "user" && !isPureToolResult(conv[i]!)) userIdxs.push(i);
  }
  if (userIdxs.length <= LAG_USER_TURNS) return conv;

  const primaryUserIdx = userIdxs.length - 1 - LAG_USER_TURNS;

  // Each anchor must sit strictly before any freed stub so the cache write
  // captures only bytes that won't mutate later. Anchors past the stub get
  // DROPPED, not clamped, so surviving deeper anchors keep their natural
  // positions instead of all collapsing onto the same fallback point.
  const earliestFreedConvIdx = findEarliestFreedConvIdx(conv);
  const isAlive = (userIdx: number): boolean => {
    if (userIdx < 0) return false;
    if (earliestFreedConvIdx < 0) return true;
    return userIdxs[userIdx]! < earliestFreedConvIdx;
  };

  const candidates: number[] = [];
  const pushIf = (idx: number): void => {
    if (!isAlive(idx)) return;
    if (!candidates.includes(idx)) candidates.push(idx);
  };
  pushIf(primaryUserIdx);
  for (const extra of ADDITIONAL_LAGS) pushIf(primaryUserIdx - extra);
  if (candidates.length === 0) return conv;

  const out = conv.slice();
  for (const userIdx of candidates) {
    const targetIdx = userIdxs[userIdx]!;
    out[targetIdx] = stampCacheControl(out[targetIdx]!);
  }
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
