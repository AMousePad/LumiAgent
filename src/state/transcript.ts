import type { LlmMessage, LlmMessagePart } from "../types";

// Plain-text rendering of model-facing history. Written to the tmp store at
// compaction time so the next agent can tmp_grep details the handoff dropped.
export function renderLlmHistoryTranscript(history: readonly LlmMessage[]): string {
  const lines: string[] = [];
  let n = 0;
  for (const m of history) {
    if (m.role === "system") continue;
    n++;
    const parts: LlmMessagePart[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const p of parts) {
      if (p.type === "text") {
        if (p.text.trim().length === 0) continue;
        lines.push(`### [${n}] ${m.role}`, p.text, "");
      } else if (p.type === "tool_use") {
        let args: string;
        try { args = JSON.stringify(p.input); } catch { args = "[unserializable args]"; }
        lines.push(`### [${n}] tool_call ${p.name} (${p.id})`, args, "");
      } else if (p.type === "tool_result") {
        lines.push(`### [${n}] tool_result ${p.tool_use_id}${p.is_error ? " ERROR" : ""}`, p.content, "");
      } else if (p.type === "image") {
        lines.push(`### [${n}] image ${p.path ?? p.mime_type}`, "");
      }
    }
  }
  return lines.join("\n");
}
