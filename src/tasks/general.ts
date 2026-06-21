import { fillPrompt } from "../agent/prompts/_fill";
import builtinBody from "../agent/prompts/claude/tasks/general/builtin_body.txt";
import chatSectionBody from "../agent/prompts/claude/tasks/general/chat_section.txt";
import addressingBody from "../agent/prompts/claude/tasks/general/addressing_section.txt";
import whenToStopBody from "../agent/prompts/claude/tasks/general/when_to_stop.txt";
import agentNotesTemplate from "../agent/prompts/claude/tasks/general/agent_notes_section.txt";
import deferredToolsTemplate from "../agent/prompts/claude/tasks/general/deferred_tools_section.txt";
import contextNoteTemplate from "../agent/prompts/claude/tasks/general/context_note.txt";
import externalSurfacesPreamble from "../agent/prompts/claude/tasks/general/external_surfaces_preamble.txt";

export interface ExternalProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly surfaces: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly scope: "global" | "per_character";
  }>;
}

export interface GeneralPromptParams {
  readonly persona: string;
  // null → use the built-in technical body. Non-null replaces only the body;
  // the chat / external / extension-contributed sections are still appended.
  readonly systemPromptOverride: string | null;
  // Snapshot of workspace/agent/agent.md captured at session start. Frozen
  // across the session so mid-session edits don't break the prompt cache;
  // changes only land when the user starts a new chat or tells the agent to
  // re-read the file.
  readonly agentNotes: string | null;
  // Names of tools whose schemas are NOT shipped in the initial tools list.
  // The model must call tool_search to fetch their schemas before invoking
  // them. Empty array disables the deferred-tools announcement.
  readonly deferredToolNames: readonly string[];
}

export function buildGeneralSystemPrompt(params: GeneralPromptParams): string {
  // Single stable string regardless of pin state. The agent learns the live
  // pin status by calling `read_chat_messages` (no chat_id), which returns
  // either the pinned chat's messages or `{pinned: false}` so the agent can
  // tell the user to pin. Hard-coding the section means pin/unpin doesn't
  // invalidate the prompt cache.
  const chatSection = `\n\n${chatSectionBody}`;

  // Agent notes snapshot. Captured once at session start so the prompt cache
  // doesn't break when the file changes mid-session. Edits via the workshop
  // only land in NEW sessions, or when the user explicitly tells the agent
  // to re-read \`workspace/agent/agent.md\`.
  const agentNotesSection = params.agentNotes && params.agentNotes.trim().length > 0
    ? `\n\n${fillPrompt(agentNotesTemplate, { NOTES: params.agentNotes.trim() })}`
    : "";

  const deferredToolsSection = params.deferredToolNames.length === 0
    ? ""
    : `\n\n${fillPrompt(deferredToolsTemplate, { TOOL_LIST: params.deferredToolNames.map((n) => `- ${n}`).join("\n") })}`;

  const personaBlock = params.persona && params.persona.trim().length > 0
    ? `${params.persona.trim()}\n\n---\n\n`
    : "";

  // Character-agnostic so the cached prefix is identical across every session
  // and every focused character. The live focus (and any per-character
  // extension guidance / external surfaces) arrives as a "[Context update ...]"
  // note in the conversation, emitted by the send path when focus or pin
  // changes, so switching characters never invalidates this prefix.
  const addressingSection = `\n\n${addressingBody}`;

  const body = params.systemPromptOverride !== null && params.systemPromptOverride.trim().length > 0
    ? params.systemPromptOverride
    : BUILTIN_PROMPT_BODY;

  return `${personaBlock}${body}${chatSection}${addressingSection}${agentNotesSection}${deferredToolsSection}\n\n${whenToStopBody}`;
}

export interface ContextNoteParams {
  // "" when no character is focused.
  readonly characterName: string;
  readonly characterId: string | null;
  readonly pinnedChat: boolean;
  readonly externalProviders: readonly ExternalProviderSummary[];
  // Concatenated phone-line `system_prompt` contributions for the focused
  // character. Empty string when none contributed.
  readonly extensionSystemPrompts: string;
}

// One-shot note appended to llmHistory (NOT the cached system prompt) when
// focus or pin changes, so the agent learns the new state without invalidating
// the cached prefix. Kept terse: the head line plus only the per-character
// guidance that has no static home.
export function buildContextNote(params: ContextNoteParams): string {
  const focus = params.characterName.trim().length > 0
    ? `focused on "${params.characterName}"${params.characterId ? ` (id \`${params.characterId}\`)` : ""}`
    : "not focused on any character";
  const pin = params.pinnedChat ? "A chat is pinned." : "No chat is pinned.";
  const parts = [fillPrompt(contextNoteTemplate, { FOCUS: focus, PIN: pin })];
  if (params.extensionSystemPrompts.trim().length > 0) parts.push(params.extensionSystemPrompts.trim());
  if (params.externalProviders.length > 0) {
    const lines = params.externalProviders.flatMap((p) =>
      p.surfaces.map((s) => `- \`${s.id}\` (${s.scope}): ${s.label}. ${s.description.slice(0, 240)}${s.description.length > 240 ? "..." : ""}`),
    );
    parts.push(fillPrompt(externalSurfacesPreamble, { LINES: lines.join("\n") }));
  }
  return parts.join("\n\n");
}

export const BUILTIN_PROMPT_BODY = builtinBody;
