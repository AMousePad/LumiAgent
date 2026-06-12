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

function partsOf(content: string | LlmMessagePart[]): LlmMessagePart[] {
  if (typeof content === "string") return content.trim().length > 0 ? [{ type: "text", text: content }] : [];
  return content;
}

// Host OpenAI-compatible flattening emits a mixed user message's text BEFORE
// its role:tool messages, so merging into a tool_result turn orphans the tool_calls (400).
function hasToolResultPart(m: LlmMessage): boolean {
  return typeof m.content !== "string" && m.content.some((p) => p.type === "tool_result");
}

// Strict providers (OpenRouter, generic OpenAI-compatible) 400 on two
// consecutive same-role messages. Two paths produce them: an assistant_prefill
// jailbreak (a standalone assistant message before the model's first encoded
// turn) and a focus/pin context note (a user message pushed right before the
// user's turn). The direct Anthropic provider merges these upstream; others
// don't. Coalesce at wire-build time so the persisted conversation (and
// persistableHistory's prefill slice in backend.ts) stay untouched.
export function coalesceConsecutiveTurns(messages: readonly LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && (m.role === "user" || m.role === "assistant")
      && !hasToolResultPart(prev) && !hasToolResultPart(m)) {
      const parts = [...partsOf(prev.content), ...partsOf(m.content)];
      // Concatenate rather than pick: if both turns carry reasoning_content
      // (DeepSeek thinking), dropping either breaks the continuation contract.
      const reasoning = [prev.reasoning_content, m.reasoning_content].filter((r) => r && r.length > 0).join("") || undefined;
      out[out.length - 1] = {
        role: m.role,
        content: parts.length > 0 ? parts : [{ type: "text", text: EMPTY_BLOCK_PLACEHOLDER }],
        ...(reasoning ? { reasoning_content: reasoning } : {}),
      };
    } else {
      out.push(m);
    }
  }
  return out;
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
