import type {
  ToolSchemaDTO,
  ToolCallDTO,
  WorldBookEntryDTO,
  WorldBookDTO,
  RegexScriptDTO,
  PersonaDTO,
  UserPresetDTO,
  PromptBlockDTO,
} from "lumiverse-spindle-types";

export type LlmMessagePart =
  | { type: "text"; text: string; cache_control?: Record<string, unknown> }
  | { type: "image"; data: string; mime_type: string; cache_control?: Record<string, unknown> }
  | { type: "audio"; data: string; mime_type: string; cache_control?: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; cache_control?: Record<string, unknown>; thought_signature?: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean; cache_control?: Record<string, unknown> };

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmMessagePart[];
  name?: string;
  reasoning_content?: string;
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  readonly content: string;
  readonly activeForm: string;
  readonly status: TodoStatus;
}
export type ToolSchema = ToolSchemaDTO;
export type ToolCall = ToolCallDTO & { thought_signature?: string };

export interface ToolResult {
  readonly call_id: string;
  readonly name: string;
  readonly content: string;
  readonly is_error?: boolean | undefined;
}

// Ledger filing scope. Phase 0 only ever produces "character"; the other
// kinds are filing drawers for non-character surfaces added in later phases.
// variables/images are singleton pseudo-scopes (id is a fixed constant).
export type ScopeKind = "character" | "persona" | "chat" | "databank" | "preset" | "world_book" | "regex_script" | "variables" | "images";

export interface ScopeRef {
  readonly kind: ScopeKind;
  readonly id: string;
}

export function characterScope(id: string): ScopeRef {
  return { kind: "character", id };
}

export function scopeKeyString(s: ScopeRef): string {
  return `${s.kind}:${s.id}`;
}

export function parseScopeKey(s: string): ScopeRef {
  const i = s.indexOf(":");
  if (i < 0) throw new Error(`bad scope key ${s}`);
  return { kind: s.slice(0, i) as ScopeKind, id: s.slice(i + 1) };
}

export type EditSurface =
  | "character_field"
  | "alternate_greeting"
  | "world_book_entry"
  | "regex_script"
  | "extension"
  | "persona_field"
  | "chat_message"
  | "preset_block"
  | "preset"
  | "world_book"
  | "persona"
  | "external";

// Cascade snapshots: deleting a book/preset also drops its children, so the
// structural snapshot carries the whole subtree for a faithful revert.
export interface WorldBookSnapshot {
  readonly book: WorldBookDTO;
  readonly entries: readonly WorldBookEntryDTO[];
}
export interface PresetSnapshot {
  readonly preset: UserPresetDTO;
  readonly blocks: readonly PromptBlockDTO[];
}

export type StructuralSnapshot =
  | WorldBookEntryDTO
  | RegexScriptDTO
  | PersonaDTO
  | WorldBookSnapshot
  | PresetSnapshot
  | PromptBlockDTO
  | { greeting: string };

export interface EditEdit {
  readonly op: "edit";
  readonly surface: Exclude<EditSurface, "external">;
  readonly surfaceId: string;
  readonly surfaceLabel: string;
  readonly field: string;
  readonly before: string;
  readonly after: string;
  // Filing scope. Absent = the session's character (back-compat default).
  // Non-character surfaces set this so the edit pipeline files into the
  // right per-object ledger.
  readonly scope?: ScopeRef;
}

export interface EditCreate {
  readonly op: "create";
  readonly surface: Exclude<EditSurface, "character_field" | "extension">;
  readonly surfaceId: string;
  readonly surfaceLabel: string;
  readonly snapshot: StructuralSnapshot;
  readonly scope?: ScopeRef;
}

export interface EditDelete {
  readonly op: "delete";
  readonly surface: Exclude<EditSurface, "character_field" | "extension">;
  readonly surfaceId: string;
  readonly surfaceLabel: string;
  readonly snapshot: StructuralSnapshot | { greeting: string; index: number };
  readonly scope?: ScopeRef;
}

export interface EditExternal {
  readonly op: "edit";
  readonly surface: "external";
  readonly providerId: string;
  readonly providerName: string;
  readonly externalSurfaceId: string;
  readonly itemId: string;
  readonly surfaceLabel: string;
  readonly field: string;
  readonly before: string;
  readonly after: string;
  readonly surfaceId: string;
  readonly scope?: ScopeRef;
}

export type EditRecord = EditEdit | EditCreate | EditDelete | EditExternal;

export interface EditLogEntry {
  readonly id: string;
  readonly ts: number;
  readonly sessionId: string;
  readonly scope: ScopeRef;
  readonly assistantMessageId?: string | undefined;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly turn: number;
  readonly record: EditRecord;
  reverted: boolean;
  revertedAt?: number | undefined;
}

export function fileKeyOf(e: EditLogEntry): string {
  const r = e.record;
  if (r.op === "edit") return `${r.surface}:${r.surfaceId}:${r.field}`;
  return `${r.surface}:${r.surfaceId}`;
}

export interface FileTimeline {
  readonly fileKey: string;
  readonly surface: EditSurface;
  readonly surfaceId: string;
  readonly surfaceLabel: string;
  readonly field: string | null;
  readonly entries: readonly EditLogEntry[]; // chronological
  readonly liveEditCount: number;
  readonly revertedEditCount: number;
}

export type RevertOutcomeWire =
  | { kind: "clean"; editId: string; cascadedEditIds?: readonly string[] | undefined }
  | { kind: "noop_already_reverted"; editId: string }
  | { kind: "superseded"; editId: string; laterEditIds: readonly string[] }
  | { kind: "external_diverged"; editId: string; currentSample: string; expectedSample: string }
  | { kind: "failed"; editId: string; error: string };

export interface ChatUserMessage {
  readonly id: string;
  readonly role: "user";
  readonly ts: number;
  readonly content: string;
}

export type AssistantBlock =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool"; call_id: string; name: string; args: Record<string, unknown>; result?: string | undefined; is_error?: boolean | undefined; edit_ids: readonly string[]; freed?: boolean }
  | { type: "warning"; message: string };

export interface ChatAssistantMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly ts: number;
  turn: number;
  blocks: AssistantBlock[];
  finish_reason?: string;
  usage?: { prompt: number; completion: number; total: number; estimated?: boolean } | undefined;
  status: "streaming" | "complete" | "cancelled" | "errored";
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage;

export interface SessionSummaryWire {
  readonly sessionId: string;
  readonly characterId: string | null;
  readonly characterName: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly messageCount: number;
  readonly editCount: number;
  readonly revertedEditCount: number;
  readonly isActive: boolean;
}

export interface CharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly avatar_path?: string | undefined;
  readonly world_book_ids: readonly string[];
  readonly regex_script_count: number;
  readonly chat_count: number;
}

export interface ConnectionSummary {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly is_default: boolean;
}

export interface ChatSummary {
  readonly id: string;
  readonly characterId: string;
  readonly name: string;
  readonly updatedAt: number;
  readonly createdAt: number;
  readonly isActive: boolean;
  readonly isPinned: boolean;
}

export type PausedReason = "no_tool_calls" | "loop_detected" | "max_turns" | "max_tokens";

export type SessionPhase = "idle" | "generating" | "compacting";

// Backend-authoritative view of a session's generation state. The frontend
// renders the composer button and switch locks purely from this, never from
// inferred local flags, so a reload mid-generation stays correct.
export interface SessionStatusWire {
  readonly sessionId: string;
  readonly phase: SessionPhase;
  readonly lastMessageRole: "user" | "assistant" | null;
  readonly lastAssistantStatus: "streaming" | "complete" | "cancelled" | "errored" | null;
  // Last message is an assistant message with no usable content (no
  // non-whitespace text and no tool calls). The recover-send target.
  readonly lastAssistantEmpty: boolean;
  readonly lastAssistantId: string | null;
  readonly promptTokens: number;
  readonly contextTokens: number;
}

export type AgentEvent =
  | { type: "turn_started"; turn: number; assistantMessageId: string }
  | { type: "llm_token"; token: string }
  | { type: "llm_reasoning"; token: string }
  | { type: "tool_started"; call_id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_finished"; call_id: string; result: string; is_error: boolean; edit_ids: readonly string[] }
  | { type: "edit_logged"; entry: EditLogEntry }
  | { type: "revert_logged"; editId: string; outcome: RevertOutcomeWire }
  | { type: "edits_resynced" }
  | { type: "turn_completed"; turn: number; finish_reason: string; usage?: { prompt: number; completion: number; total: number; estimated?: boolean } | undefined; cleanedContent?: string | undefined }
  | { type: "paused_for_input"; reason: PausedReason; detail?: string | undefined }
  | { type: "warning"; message: string };

export type FrontendToBackend =
  | { type: "list_characters" }
  | { type: "list_connections" }
  | { type: "list_sessions"; characterId?: string | null | undefined }
  | { type: "load_session"; sessionId: string }
  | { type: "start_session"; sessionId: string; characterId: string | null; connectionId?: string | undefined }
  | { type: "send_message"; sessionId: string; userMessageId: string; content: string; connectionId?: string | undefined }
  | { type: "continue_session"; sessionId: string; connectionId?: string | undefined }
  | { type: "cancel_generation"; sessionId: string }
  | { type: "delete_session"; sessionId: string }
  | { type: "export_session_markdown"; sessionId: string }
  | { type: "list_character_edits"; characterId: string }
  | { type: "revert_edit"; characterId: string; editId: string; force?: boolean | undefined; sessionId?: string | undefined; scope?: ScopeRef }
  | { type: "revert_edits_bulk"; characterId: string; editIds: readonly string[]; sessionId?: string | undefined; scope?: ScopeRef }
  | { type: "revert_session"; sessionId: string }
  | { type: "edit_user_message"; sessionId: string; messageId: string; newContent: string; editsAction: "keep" | "revert"; connectionId?: string | undefined }
  | { type: "regenerate_assistant_message"; sessionId: string; assistantMessageId: string; editsAction: "keep" | "revert"; connectionId?: string | undefined }
  | { type: "delete_message"; sessionId: string; messageId: string; editsAction: "keep" | "revert" }
  | { type: "free_tool_result"; sessionId: string; callId: string }
  | { type: "list_chats"; characterId: string; sessionId?: string | undefined }
  | { type: "set_pinned_chat"; sessionId: string; chatId: string | null }
  | { type: "get_settings" }
  | { type: "update_settings"; persona: string; systemPromptOverride: string | null; samplers: Readonly<Record<string, number | null>>; jailbreak: string; jailbreakPlacement: "system_suffix" | "user_suffix" | "assistant_prefill"; workspaceCapBytes: number | null; toolOutputCapTokens: number | null; cacheMode?: "off" | "system_only" | "full"; parallelToolCalls?: boolean; tpmLimit?: number | null; debugLogging?: boolean }
  | { type: "get_ui_prefs" }
  | { type: "update_ui_prefs"; connectionId: string | null; lastSessionId: string | null }
  | { type: "ws_list"; path: string }
  | { type: "ws_read_text"; path: string }
  | { type: "ws_write_text"; path: string; content: string }
  | { type: "ws_duplicate"; path: string }
  | { type: "ws_upload_binary"; path: string; dataBase64: string }
  | { type: "ws_upload_part"; transferId: string; path: string; dataBase64: string; index: number; total: number }
  | { type: "ws_delete"; path: string; recursive: boolean }
  | { type: "ws_move"; from: string; to: string }
  | { type: "ws_mkdir"; path: string }
  | { type: "ws_download"; path: string }
  | { type: "ws_download_zip"; paths: readonly string[] }
  | { type: "compact_session"; sessionId: string }
  | { type: "list_characters_storage" }
  | { type: "squash_character"; characterId: string; scope?: ScopeRef }
  | { type: "revert_character_all"; characterId: string; scope?: ScopeRef }
  | { type: "revert_all_characters"; characterIds: readonly string[]; scopes?: readonly ScopeRef[] }
  | { type: "load_character_workshop"; characterId: string; scope?: ScopeRef }
  | { type: "get_phoneline_pairings" }
  | { type: "set_phoneline_pairing"; identifier: string; allowed: boolean }
  | { type: "revoke_phoneline_pairing"; identifier: string }
  | { type: "frontend_rpc_response"; rpcId: string; result?: unknown; error?: string };

export type BackendToFrontend =
  | { type: "characters_pushed"; characters: readonly CharacterSummary[] }
  | { type: "connections_pushed"; connections: readonly ConnectionSummary[] }
  | { type: "sessions_pushed"; sessions: readonly SessionSummaryWire[] }
  | { type: "session_started"; sessionId: string; characterId: string | null; characterName: string; createdAt: number }
  | { type: "session_loaded"; sessionId: string; characterId: string | null; characterName: string; createdAt: number; messages: readonly ChatMessage[]; edits: readonly EditLogEntry[]; status: SessionStatusWire }
  | { type: "session_status"; status: SessionStatusWire }
  | { type: "session_deleted"; sessionId: string }
  | { type: "session_markdown_ready"; sessionId: string; filename: string; content: string }
  | { type: "session_markdown_error"; sessionId: string; error: string }
  | { type: "session_reverted"; sessionId: string; entriesRestored: number; entriesFailed: number; scriptsRestored: number; scriptsFailed: number }
  | { type: "scope_edits_pushed"; scope: ScopeRef; entries: readonly EditLogEntry[] }
  | { type: "chat_event"; sessionId: string; event: AgentEvent }
  | { type: "generation_done"; sessionId: string; turns: number }
  | { type: "generation_error"; sessionId: string; error: string }
  | { type: "generation_cancelled"; sessionId: string }
  | { type: "edit_reverted"; scope: ScopeRef; editId: string; outcome: RevertOutcomeWire }
  | { type: "edits_reverted_bulk"; scope: ScopeRef; outcomes: ReadonlyArray<{ editId: string; outcome: RevertOutcomeWire }> }
  | { type: "session_truncated"; sessionId: string; messages: readonly ChatMessage[]; edits: readonly EditLogEntry[] }
  | { type: "chats_pushed"; characterId: string; chats: readonly ChatSummary[]; pinnedChatId: string | null }
  | { type: "pinned_chat_set"; sessionId: string; chatId: string | null }
  | { type: "settings_pushed"; persona: string; systemPromptOverride: string | null; defaultPersona: string; defaultSystemPromptBody: string; samplers: Readonly<Record<string, number | null>>; jailbreak: string; jailbreakPlacement: "system_suffix" | "user_suffix" | "assistant_prefill"; workspaceCapBytes: number | null; workspaceCapDefaultBytes: number; workspaceFileCapBytes: number; toolOutputCapTokens: number | null; toolOutputCapDefaultTokens: number; cacheMode: "off" | "system_only" | "full"; parallelToolCalls: boolean; tpmLimit: number | null; debugLogging: boolean }
  | { type: "ui_prefs_pushed"; connectionId: string | null; lastSessionId: string | null }
  | { type: "ws_listed"; path: string; entries: readonly WorkspaceEntry[] }
  | { type: "ws_text_pushed"; path: string; content: string; sizeBytes: number }
  | { type: "ws_changed" }
  | { type: "ws_download_ready"; path: string; dataBase64: string; mimeType: string }
  | { type: "ws_zip_ready"; dataBase64: string; filename: string }
  | { type: "ws_error"; error: string }
  | { type: "context_usage"; sessionId: string; promptTokens: number; contextTokens: number; percentUsed: number }
  | { type: "compaction_started"; sessionId: string }
  | { type: "compaction_completed"; sessionId: string; handoffPath: string; promptTokens: number; contextTokens: number }
  | { type: "characters_storage_pushed"; entries: readonly CharacterStorageEntry[]; workspaceUsedBytes: number; workspaceCapBytes: number }
  | { type: "scope_squashed"; scope: ScopeRef; ledgerCleared: boolean }
  | { type: "phoneline_pairings_pushed"; pairings: ReadonlyArray<{ identifier: string; displayName: string; allowed: boolean; decidedAt: number }> }
  | { type: "notify_missing_permissions"; missing: readonly string[]; purposes: Readonly<Record<string, string>> }
  | { type: "notify_bridge_status"; offline: boolean; missingPermissions: readonly string[]; missingFor?: string }
  | { type: "host_version_warning"; hostVersion: string | null; minimum: string; message: string }
  | { type: "frontend_rpc_request"; rpcId: string; op: string; args: unknown };

export interface CharacterStorageEntry {
  readonly characterId: string;
  readonly characterName: string;
  readonly editCount: number;
  readonly liveEditCount: number;
  readonly ledgerBytes: number;
  // Present for non-character scopes (persona/chat). Absent => character,
  // in which case characterId/characterName carry the identity (back-compat).
  readonly scope?: ScopeRef;
  readonly label?: string;
  // Character scopes only: chats for the character and total messages across
  // all of them. Absent for non-character scopes and the synthetic active row.
  readonly chatCount?: number;
  readonly msgCount?: number;
  // world_book scopes only: set when the book is a persona's
  // attached_world_book_id, so the selector bundles it under that persona
  // instead of a standalone Lorebooks entry.
  readonly attachedToPersona?: { readonly id: string; readonly name: string };
}

export interface WorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly isSystem?: boolean | undefined;
  readonly isDirectory: boolean;
  readonly sizeBytes: number;
  readonly modifiedAt: string | null;
}
