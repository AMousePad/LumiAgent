import type { ChatMessage, LlmMessage, LlmMessagePart } from "../types";

const AUTO_FREE_LAG_USER_TURNS = 10;

export interface AutoFreeResult {
  readonly llmHistory: LlmMessage[];
  readonly messages: ChatMessage[];
  readonly freedCount: number;
  readonly freedBytes: number;
}

// Walks llmHistory and the user-visible thread together. For every tool_result
// older than (current user turn - AUTO_FREE_LAG_USER_TURNS), if the matching
// tool block is "insensitive" and not yet freed, replace the wire content with
// a stub and mark the assistant block freed. Returns fresh copies; inputs
// untouched.
export function applyAutoFree(
  llmHistory: LlmMessage[],
  messages: ChatMessage[],
  enabled: boolean,
  overrides?: Record<string, "sensitive" | "insensitive">,
): AutoFreeResult {
  if (!enabled) return { llmHistory, messages, freedCount: 0, freedBytes: 0 };

  const userTurnIdxs: number[] = [];
  for (let i = 0; i < llmHistory.length; i++) {
    if (llmHistory[i]!.role === "user" && !isPureToolResult(llmHistory[i]!)) userTurnIdxs.push(i);
  }
  if (userTurnIdxs.length <= AUTO_FREE_LAG_USER_TURNS) return { llmHistory, messages, freedCount: 0, freedBytes: 0 };

  // Cutoff is the position of the (current - LAG)th user turn. Everything at
  // or before this position is fair game.
  const cutoff = userTurnIdxs[userTurnIdxs.length - 1 - AUTO_FREE_LAG_USER_TURNS]!;

  const freedIds = new Set<string>();
  const sensitivityByCallId = new Map<string, "sensitive" | "insensitive">();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.type === "tool" && !b.freed) {
        const override = overrides?.[b.call_id];
        const sens = override ?? b.sensitivity ?? "insensitive";
        sensitivityByCallId.set(b.call_id, sens);
      }
    }
  }

  let freedBytes = 0;
  const newHistory = llmHistory.slice();
  for (let i = 0; i <= cutoff; i++) {
    const m = newHistory[i]!;
    if (m.role !== "user" || typeof m.content === "string") continue;
    const parts = m.content as LlmMessagePart[];
    let mutated = false;
    const nextParts = parts.map((p): LlmMessagePart => {
      if (p.type !== "tool_result") return p;
      const sens = sensitivityByCallId.get(p.tool_use_id);
      if (sens !== "insensitive") return p;
      if (p.content.startsWith("[freed:")) return p;
      const originalChars = p.content.length;
      freedBytes += originalChars;
      freedIds.add(p.tool_use_id);
      mutated = true;
      return {
        type: "tool_result",
        tool_use_id: p.tool_use_id,
        content: `[freed: tool result was ${originalChars} chars, auto-freed after ${AUTO_FREE_LAG_USER_TURNS} user turns. The model cannot reference this content. Re-call the tool if needed.]`,
        ...(p.is_error ? { is_error: true } : {}),
      };
    });
    if (mutated) newHistory[i] = { ...m, content: nextParts };
  }

  if (freedIds.size === 0) return { llmHistory, messages, freedCount: 0, freedBytes: 0 };

  const newMessages: ChatMessage[] = messages.map((m) => {
    if (m.role !== "assistant") return m;
    let touched = false;
    const nextBlocks = m.blocks.map((b) => {
      if (b.type === "tool" && freedIds.has(b.call_id) && !b.freed) {
        touched = true;
        return { ...b, freed: true };
      }
      return b;
    });
    if (!touched) return m;
    return { ...m, blocks: nextBlocks };
  });

  return { llmHistory: newHistory, messages: newMessages, freedCount: freedIds.size, freedBytes };
}

function isPureToolResult(m: LlmMessage): boolean {
  if (typeof m.content === "string") return false;
  return m.content.length > 0 && m.content.every((p) => p.type === "tool_result");
}
