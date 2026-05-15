import type { LlmMessage, LlmMessagePart, ToolCall, ToolResult } from "../types";

const MAX_RESULT_CHARS = 48_000;

// Anthropic 400s ("text content blocks must be non-empty") on empty or
// whitespace-only text/tool_result blocks and on an assistant message with no
// blocks. History is reused across providers, so one bad block poisons every
// later strict-provider call in the session.
const EMPTY_BLOCK_PLACEHOLDER = "(no output)";

function clipStructured(s: string): string | null {
  if (s.length <= MAX_RESULT_CHARS) return s;
  const trimmed = s.trimStart();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      let trimmedArrayKey: string | undefined;
      let originalLen = 0;
      for (const k of ["hits", "entries", "scripts", "top"]) {
        const v = o[k];
        if (Array.isArray(v)) {
          originalLen = v.length;
          const target = Math.max(10, Math.floor(v.length * (MAX_RESULT_CHARS / s.length) * 0.9));
          o[k] = v.slice(0, target);
          trimmedArrayKey = k;
          break;
        }
      }
      if (trimmedArrayKey) {
        o["_truncated_by_clipper"] = { key: trimmedArrayKey, original_count: originalLen, returned: (o[trimmedArrayKey] as readonly unknown[]).length, hint: "increase max_matches / top_n / pagination is upstream; this hard cap stops oversized tool results" };
        const out = JSON.stringify(o, null, 2);
        if (out.length <= MAX_RESULT_CHARS) return out;
      }
    }
  } catch { /* not JSON */ }
  return null;
}

function clip(s: string): string {
  if (s.length <= MAX_RESULT_CHARS) return s;
  const structured = clipStructured(s);
  if (structured !== null) return structured;
  const head = s.slice(0, MAX_RESULT_CHARS - 200);
  const tail = s.slice(s.length - 100);
  return `${head}\n[... ${s.length - MAX_RESULT_CHARS + 300} chars truncated ...]\n${tail}`;
}

// DeepSeek thinking-mode rejects continuations whose assistant turn is missing
// the reasoning that produced its tool calls. Other providers ignore the field.
export function encodeAssistantTurn(content: string, toolCalls: readonly ToolCall[], reasoning?: string): LlmMessage {
  const parts: LlmMessagePart[] = [];
  if (content.trim().length > 0) parts.push({ type: "text", text: content });
  for (const tc of toolCalls) {
    parts.push({ type: "tool_use", id: tc.call_id, name: tc.name, input: tc.args ?? {}, ...(tc.thought_signature ? { thought_signature: tc.thought_signature } : {}) });
  }
  // A turn with only whitespace prose and no tool calls would otherwise emit
  // an empty assistant message.
  if (parts.length === 0) parts.push({ type: "text", text: EMPTY_BLOCK_PLACEHOLDER });
  return { role: "assistant", content: parts, ...(reasoning ? { reasoning_content: reasoning } : {}) };
}

export function encodeToolResults(results: readonly ToolResult[]): LlmMessage {
  const parts: LlmMessagePart[] = results.map((r) => {
    const clipped = clip(r.content);
    return {
      type: "tool_result",
      tool_use_id: r.call_id,
      content: clipped.trim().length > 0 ? clipped : EMPTY_BLOCK_PLACEHOLDER,
      ...(r.is_error ? { is_error: true } : {}),
    };
  });
  return { role: "user", content: parts };
}
