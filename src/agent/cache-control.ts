import type { LlmMessage } from "../types";

const LAG_USER_TURNS = 2;

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

// Rolling breakpoint on the (current - LAG_USER_TURNS)-th user turn. Active
// only in "full" mode. Skipped in "off" and "system_only".
export function withRollingCacheBreakpoint(conv: LlmMessage[], mode: CacheMode): LlmMessage[] {
  if (mode !== "full") return conv;

  const userIdxs: number[] = [];
  for (let i = 0; i < conv.length; i++) {
    if (conv[i]!.role === "user" && !isPureToolResult(conv[i]!)) userIdxs.push(i);
  }
  if (userIdxs.length <= LAG_USER_TURNS) return conv;

  const targetIdx = userIdxs[userIdxs.length - 1 - LAG_USER_TURNS]!;
  const out = conv.slice();
  out[targetIdx] = stampCacheControl(out[targetIdx]!);
  return out;
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
