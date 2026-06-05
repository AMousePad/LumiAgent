import { ToolRegistry } from "./_framework";

import { applyGlossaryTool } from "./apply-glossary";
import { askUserQuestionTool } from "./ask-user-question";
import { assetDeleteTool } from "./asset-delete";
import { assetRenameTool } from "./asset-rename";
import { auditCardCoverageTool } from "./audit-card-coverage";
import { chatStatsTool } from "./chat-stats";
import { countCjkCharsTool } from "./count-cjk-chars";
import { createTool } from "./create";
import { deleteTool } from "./delete";
import { customToolDeleteTool } from "./custom-tool-delete";
import { customToolListTool } from "./custom-tool-list";
import { customToolRunTool } from "./custom-tool-run";
import { customToolSaveTool } from "./custom-tool-save";
import { editExternalTool } from "./edit-external";
import { editTool } from "./edit";
import { finishTool } from "./finish";
import { fsDeleteTool } from "./fs-delete";
import { fsEditTool } from "./fs-edit";
import { fsListTool } from "./fs-list";
import { fsMkdirTool } from "./fs-mkdir";
import { fsMoveTool } from "./fs-move";
import { fsReadTool } from "./fs-read";
import { fsStatTool } from "./fs-stat";
import { fsUnzipTool } from "./fs-unzip";
import { fsWriteTool } from "./fs-write";
import { viewImageTool } from "./view-image";
import { webSearchTool } from "./web-search";
import { webFetchTool } from "./web-fetch";
import { fsZipTool } from "./fs-zip";
import { grepTool } from "./grep";
import { grepChatMessagesTool } from "./grep-chat-messages";
import { grepExternalTool } from "./grep-external";
import { inspectTool } from "./inspect";
import { listTool } from "./list";
import { rewriteTool } from "./rewrite";
import { setTool } from "./set";
import { setChatVariableTool } from "./set-chat-variable";
import { setDefaultVariablesTextTool } from "./set-default-variables-text";
import { setToggleTool } from "./set-toggle";
import { listCharactersTool } from "./list-characters";
import { listChatMessagesTool } from "./list-chat-messages";
import { listChatsForCharacterTool } from "./list-chats-for-character";
import { listExternalTool } from "./list-external";
import { listSessionEditsTool } from "./list-session-edits";
import { moduleAttachTool } from "./module-attach";
import { moduleDetachTool } from "./module-detach";
import { randomPickTool } from "./random-pick";
import { readTool } from "./read";
import { readChatMessagesTool } from "./read-chat-messages";
import { readExternalTool } from "./read-external";
import { revertSessionEditsTool } from "./revert-session-edits";
import { rollDiceTool } from "./roll-dice";
import { squashSessionEditsTool } from "./squash-session-edits";
import { surveyCjkTool } from "./survey-cjk";
import { testRegexTool } from "./test-regex";
import { translateCardStringsTool } from "./translate-card-strings";
import { tmpGrepTool } from "./tmp-grep";
import { tmpListTool } from "./tmp-list";
import { tmpReadTool } from "./tmp-read";
import { tmpStatTool } from "./tmp-stat";
import { updateCharacterTool } from "./update-character";
import { updateExternalTool } from "./update-external";
import { updateRegexScriptTool } from "./update-regex-script";
import { updateWorldBookEntryTool } from "./update-world-book-entry";

import { countTokensTool } from "./count-tokens";
import { dryRunPromptTool } from "./dry-run-prompt";
import { getActiveChatTool } from "./get-active-chat";
import { listActiveRegexScriptsTool } from "./list-active-regex-scripts";
import { listActivatedWorldInfoTool } from "./list-activated-world-info";
import { listChatMemoriesTool } from "./list-chat-memories";
import { getLumiverseVersionTool } from "./get-lumiverse-version";
import { getUserInfoTool } from "./get-user-info";
import { listConnectionsTool } from "./list-connections";
import { listDatabankDocumentsTool } from "./list-databank-documents";
import { listDatabanksTool } from "./list-databanks";
import { listPersonasTool } from "./list-personas";
import { listVariablesTool } from "./list-variables";
import { readConnectionTool } from "./read-connection";
import { readDatabankTool } from "./read-databank";
import { readDatabankDocumentTool } from "./read-databank-document";
import { readPersonaTool } from "./read-persona";
import { readPersonaWorldBookTool } from "./read-persona-world-book";
import { readVariableTool } from "./read-variable";
import { resolveMacrosTool } from "./resolve-macros";
import { todoWriteTool } from "./todo-write";
import { toolSearchTool } from "./tool-search";

export const registry = new ToolRegistry();

// Tools listed here ship by NAME only in the initial system prompt.
// Their full schemas are fetched on demand via `tool_search`. Add a name
// here to defer. Remove to make a tool always-loaded. tool_search itself
// is never deferred (the model needs it to discover the rest).
// A tool belongs here only if it's GENUINELY RARE during a normal card-edit
// session. Anything the agent reaches for as a reflex (authoring, randomising,
// the core writes) must stay loaded — paying a tool_search round-trip every
// time defeats the purpose.
const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  // Lumiverse-state inspectors. Mostly diagnostic; dry_run_prompt stays the anchor.
  "count_tokens", "resolve_macros",
  "list_variables", "read_variable",
  "list_activated_world_info", "list_active_regex_scripts", "list_chat_memories",
  "list_personas", "read_persona", "read_persona_world_book",
  "list_databanks", "read_databank", "list_databank_documents", "read_databank_document",
  "list_connections", "read_connection",
  "get_active_chat", "get_user_info", "get_lumiverse_version",
  // Chat reading is niche unless the user pins a chat; on a pin the agent
  // discovers these via the chat section in the system prompt.
  "chat_stats", "list_chat_messages", "grep_chat_messages",
  "list_chats_for_character", "read_chat_messages",
  // Custom-tool authoring. custom_tool_run stays loaded; saved recipes are rare.
  "custom_tool_save", "custom_tool_list", "custom_tool_delete",
  // Genuinely-niche utilities.
  "roll_dice", "count_cjk_chars", "test_regex",
  // Mid-task user prompt, rare.
  "ask_user_question",
  // LumiRealm-specific mutations. Each is rare per session; deferred until
  // the agent confirms the user is on a LumiRealm-imported card / module.
  "asset_rename", "asset_delete",
  "module_attach", "module_detach",
  "set_toggle", "set_chat_variable", "set_default_variables_text",
]);

export function isDeferredTool(name: string): boolean {
  return DEFERRED_TOOL_NAMES.has(name);
}

export function listDeferredToolNames(): readonly string[] {
  return [...DEFERRED_TOOL_NAMES].sort();
}

// Read-only tools that never write spindle/userStorage and never push to the
// edit ledger. Treated as concurrency-safe by the loop: consecutive calls run
// in parallel batches (cap 5). Anything not listed runs serially, the safe
// default for any tool that mutates state.
const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  // Path-based reads
  "read", "inspect", "list", "grep",
  // Multi-surface / completion-gate readers
  "audit_card_coverage", "survey_cjk",
  // Tmp handle reads
  "tmp_stat", "tmp_list", "tmp_read", "tmp_grep",
  // Workspace reads
  "fs_list", "fs_read", "fs_stat", "view_image",
  // Chat reads
  "chat_stats", "list_chat_messages", "grep_chat_messages",
  "list_chats_for_character", "read_chat_messages",
  // Character discovery
  "list_characters",
  // Lumiverse-state inspectors
  "dry_run_prompt", "resolve_macros", "count_tokens",
  "list_variables", "read_variable",
  "list_activated_world_info", "list_active_regex_scripts", "list_chat_memories",
  "list_personas", "read_persona", "read_persona_world_book",
  "list_databanks", "read_databank", "list_databank_documents", "read_databank_document",
  "list_connections", "read_connection",
  "get_active_chat", "get_user_info", "get_lumiverse_version",
  // Ledger reads
  "list_session_edits",
  // External-provider reads
  "list_external", "read_external", "grep_external",
  // Custom tools authoring. List only, save/delete are writes.
  "custom_tool_list",
  // Stateless utilities
  "count_cjk_chars", "test_regex",
  // tool_search reads the registry, no mutation
  "tool_search",
]);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(name);
}

// Per-tool result-size caps in characters. Tools whose body already spills
// (read, audit_card_coverage, dry_run_prompt, fs_read) map to Infinity so we
// don't double-spill. Anything not listed falls through to the global
// toolOutputCapTokens setting.
const PER_TOOL_RESULT_CAP_CHARS: Readonly<Record<string, number>> = {
  // Spill internally already. Skip the loop's secondary cap.
  read: Number.POSITIVE_INFINITY,
  audit_card_coverage: Number.POSITIVE_INFINITY,
  dry_run_prompt: Number.POSITIVE_INFINITY,
  fs_read: Number.POSITIVE_INFINITY,
  web_search: Number.POSITIVE_INFINITY,
  web_fetch: Number.POSITIVE_INFINITY,
  // Compact metadata / list / search outputs.
  inspect: 12_000,
  list: 20_000,
  grep: 30_000,
  grep_external: 30_000,
  survey_cjk: 25_000,
  apply_glossary: 30_000,
  // Edit / rewrite / set return small structured patches. JSON can grow on
  // big hunks but 20k is plenty for diff payloads.
  edit: 20_000,
  rewrite: 20_000,
  set: 20_000,
  // tmp_grep results can be big. 30k forces the agent to paginate.
  tmp_grep: 30_000,
};

export function maxResultSizeCharsFor(name: string): number | null {
  return PER_TOOL_RESULT_CAP_CHARS[name] ?? null;
}

registry.register(applyGlossaryTool);
registry.register(askUserQuestionTool);
registry.register(assetDeleteTool);
registry.register(assetRenameTool);
registry.register(auditCardCoverageTool);
registry.register(readTool);
registry.register(editTool);
registry.register(rewriteTool);
registry.register(setTool);
registry.register(inspectTool);
registry.register(listTool);
registry.register(grepTool);
registry.register(chatStatsTool);
registry.register(countCjkCharsTool);
registry.register(createTool);
registry.register(deleteTool);
registry.register(customToolDeleteTool);
registry.register(customToolListTool);
registry.register(customToolRunTool);
registry.register(customToolSaveTool);
registry.register(editExternalTool);
registry.register(finishTool);
registry.register(fsDeleteTool);
registry.register(fsEditTool);
registry.register(fsListTool);
registry.register(fsMkdirTool);
registry.register(fsMoveTool);
registry.register(fsReadTool);
registry.register(viewImageTool);
registry.register(webSearchTool);
registry.register(webFetchTool);
registry.register(fsStatTool);
registry.register(fsUnzipTool);
registry.register(fsWriteTool);
registry.register(fsZipTool);
registry.register(grepChatMessagesTool);
registry.register(grepExternalTool);
registry.register(listCharactersTool);
registry.register(listChatMessagesTool);
registry.register(listChatsForCharacterTool);
registry.register(listExternalTool);
registry.register(listSessionEditsTool);
registry.register(moduleAttachTool);
registry.register(moduleDetachTool);
registry.register(randomPickTool);
registry.register(readChatMessagesTool);
registry.register(readExternalTool);
registry.register(revertSessionEditsTool);
registry.register(rollDiceTool);
registry.register(setChatVariableTool);
registry.register(setDefaultVariablesTextTool);
registry.register(setToggleTool);
registry.register(squashSessionEditsTool);
registry.register(surveyCjkTool);
registry.register(testRegexTool);
registry.register(translateCardStringsTool);
registry.register(tmpGrepTool);
registry.register(tmpListTool);
registry.register(tmpReadTool);
registry.register(tmpStatTool);
registry.register(updateCharacterTool);
registry.register(updateExternalTool);
registry.register(updateRegexScriptTool);
registry.register(updateWorldBookEntryTool);

registry.register(countTokensTool);
registry.register(dryRunPromptTool);
registry.register(getActiveChatTool);
registry.register(listActiveRegexScriptsTool);
registry.register(listActivatedWorldInfoTool);
registry.register(listChatMemoriesTool);
registry.register(getLumiverseVersionTool);
registry.register(getUserInfoTool);
registry.register(listConnectionsTool);
registry.register(listDatabankDocumentsTool);
registry.register(listDatabanksTool);
registry.register(listPersonasTool);
registry.register(listVariablesTool);
registry.register(readConnectionTool);
registry.register(readDatabankTool);
registry.register(readDatabankDocumentTool);
registry.register(readPersonaTool);
registry.register(readPersonaWorldBookTool);
registry.register(readVariableTool);
registry.register(resolveMacrosTool);
registry.register(todoWriteTool);
registry.register(toolSearchTool);
