import { ToolRegistry } from "./_framework";

import { applyGlossaryTool } from "./apply-glossary";
import { askUserQuestionTool } from "./ask-user-question";
import { auditCardCoverageTool } from "./audit-card-coverage";
import { characterExtensionStatsTool } from "./character-extension-stats";
import { characterFieldStatsTool } from "./character-field-stats";
import { chatStatsTool } from "./chat-stats";
import { countCjkCharsTool } from "./count-cjk-chars";
import { createAlternateGreetingTool } from "./create-alternate-greeting";
import { createRegexScriptTool } from "./create-regex-script";
import { createWorldBookEntryTool } from "./create-world-book-entry";
import { customToolDeleteTool } from "./custom-tool-delete";
import { customToolListTool } from "./custom-tool-list";
import { customToolRunTool } from "./custom-tool-run";
import { customToolSaveTool } from "./custom-tool-save";
import { deleteAlternateGreetingTool } from "./delete-alternate-greeting";
import { deleteRegexScriptTool } from "./delete-regex-script";
import { deleteWorldBookEntryTool } from "./delete-world-book-entry";
import { editAlternateGreetingTool } from "./edit-alternate-greeting";
import { editCharacterExtensionTool } from "./edit-character-extension";
import { editCharacterFieldTool } from "./edit-character-field";
import { editExternalItemTool } from "./edit-external-item";
import { editRegexScriptFieldTool } from "./edit-regex-script-field";
import { editWorldBookEntryTool } from "./edit-world-book-entry";
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
import { fsZipTool } from "./fs-zip";
import { grepCardTool } from "./grep-card";
import { grepTool } from "./grep";
import { grepChatMessagesTool } from "./grep-chat-messages";
import { inspectTool } from "./inspect";
import { listTool } from "./list";
import { rewriteTool } from "./rewrite";
import { setTool } from "./set";
import { listAlternateGreetingsTool } from "./list-alternate-greetings";
import { listChatMessagesTool } from "./list-chat-messages";
import { listChatsForCharacterTool } from "./list-chats-for-character";
import { listExtensionKeysTool } from "./list-extension-keys";
import { listExternalItemsTool } from "./list-external-items";
import { listExternalProvidersTool } from "./list-external-providers";
import { listMyEditsTool } from "./list-my-edits";
import { listRegexScriptsTool } from "./list-regex-scripts";
import { listWorldBookEntriesTool } from "./list-world-book-entries";
import { listWorldBooksTool } from "./list-world-books";
import { markToolResultsTool } from "./mark-tool-results";
import { randomPickTool } from "./random-pick";
import { readAlternateGreetingTool } from "./read-alternate-greeting";
import { readTool } from "./read";
import { readCharacterExtensionTool } from "./read-character-extension";
import { readCharacterFieldTool } from "./read-character-field";
import { readChatMessagesTool } from "./read-chat-messages";
import { readExternalItemTool } from "./read-external-item";
import { readPinnedChatMessagesTool } from "./read-pinned-chat-messages";
import { readRegexScriptFieldTool } from "./read-regex-script-field";
import { readRegexScriptMetaTool } from "./read-regex-script-meta";
import { readWorldBookEntryTool } from "./read-world-book-entry";
import { regexScriptStatsTool } from "./regex-script-stats";
import { regexScriptsOverviewTool } from "./regex-scripts-overview";
import { revertMyEditsTool } from "./revert-my-edits";
import { rewriteAlternateGreetingTool } from "./rewrite-alternate-greeting";
import { rewriteWorldBookEntryTool } from "./rewrite-world-book-entry";
import { rollDiceTool } from "./roll-dice";
import { squashMyEditsTool } from "./squash-my-edits";
import { surveyCjkTool } from "./survey-cjk";
import { testRegexTool } from "./test-regex";
import { translateCardStringsTool } from "./translate-card-strings";
import { tmpGrepTool } from "./tmp-grep";
import { tmpListTool } from "./tmp-list";
import { tmpReadTool } from "./tmp-read";
import { tmpStatTool } from "./tmp-stat";
import { updateCharacterTool } from "./update-character";
import { updateCharacterExtensionTool } from "./update-character-extension";
import { updateExternalItemTool } from "./update-external-item";
import { updateRegexScriptTool } from "./update-regex-script";
import { updateWorldBookEntryTool } from "./update-world-book-entry";
import { worldBookEntryStatsTool } from "./world-book-entry-stats";
import { worldBookStatsTool } from "./world-book-stats";

import { countTokensTool } from "./count-tokens";
import { dryRunPromptTool } from "./dry-run-prompt";
import { getActiveChatTool } from "./get-active-chat";
import { getActiveRegexScriptsTool } from "./get-active-regex-scripts";
import { getActivatedWorldInfoTool } from "./get-activated-world-info";
import { getChatMemoriesTool } from "./get-chat-memories";
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
const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  // Legacy per-surface tools, superseded by path-based read/edit/rewrite/set
  "character_extension_stats", "character_field_stats", "regex_script_stats",
  "world_book_entry_stats", "world_book_stats", "regex_scripts_overview",
  "list_world_books", "list_world_book_entries", "list_regex_scripts",
  "list_alternate_greetings", "list_extension_keys", "grep_card",
  "read_alternate_greeting", "read_character_extension", "read_character_field",
  "read_regex_script_field", "read_regex_script_meta", "read_world_book_entry",
  "edit_alternate_greeting", "edit_character_extension", "edit_character_field",
  "edit_regex_script_field", "edit_world_book_entry",
  "rewrite_alternate_greeting", "rewrite_world_book_entry",
  "update_character_extension", "update_regex_script", "update_world_book_entry",
  // Lumiverse-state inspectors (keep dry_run_prompt as the anchor)
  "count_tokens", "resolve_macros",
  "list_variables", "read_variable",
  "get_activated_world_info", "get_active_regex_scripts", "get_chat_memories",
  "list_personas", "read_persona", "read_persona_world_book",
  "list_databanks", "read_databank", "list_databank_documents", "read_databank_document",
  "list_connections", "read_connection",
  "get_active_chat", "get_user_info", "get_lumiverse_version",
  // Chat reading (niche during card editing)
  "chat_stats", "list_chat_messages", "grep_chat_messages",
  "list_chats_for_character", "read_chat_messages", "read_pinned_chat_messages",
  // Custom tools authoring (custom_tool_run stays loaded)
  "custom_tool_save", "custom_tool_list", "custom_tool_delete",
  // Random + niche utilities
  "random_pick", "roll_dice",
  "mark_tool_results", "count_cjk_chars", "test_regex",
  // External-provider bridge
  "list_external_providers", "list_external_items", "read_external_item",
  "edit_external_item", "update_external_item",
  // Bulk char-card mutators
  "create_alternate_greeting", "create_regex_script", "create_world_book_entry",
  "delete_alternate_greeting", "delete_regex_script", "delete_world_book_entry",
  "update_character",
  // Translation helper (legacy, predates path-based + apply_glossary)
  "translate_card_strings",
  // Mid-task user prompt, rare. Defer.
  "ask_user_question",
]);

export function isDeferredTool(name: string): boolean {
  return DEFERRED_TOOL_NAMES.has(name);
}

export function listDeferredToolNames(): readonly string[] {
  // Stable sort so callers (system prompt, tool_search keyword scoring,
  // tests) see a deterministic order across runs.
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
  "fs_list", "fs_read", "fs_stat",
  // Legacy per-surface reads
  "read_character_field", "read_alternate_greeting", "read_character_extension",
  "read_world_book_entry", "read_regex_script_field", "read_regex_script_meta",
  "list_world_books", "list_world_book_entries", "list_regex_scripts",
  "list_alternate_greetings", "list_extension_keys",
  "character_field_stats", "character_extension_stats", "regex_script_stats",
  "world_book_entry_stats", "world_book_stats", "regex_scripts_overview",
  "grep_card",
  // Chat reads
  "chat_stats", "list_chat_messages", "grep_chat_messages",
  "list_chats_for_character", "read_chat_messages", "read_pinned_chat_messages",
  // Lumiverse-state inspectors
  "dry_run_prompt", "resolve_macros", "count_tokens",
  "list_variables", "read_variable",
  "get_activated_world_info", "get_active_regex_scripts", "get_chat_memories",
  "list_personas", "read_persona", "read_persona_world_book",
  "list_databanks", "read_databank", "list_databank_documents", "read_databank_document",
  "list_connections", "read_connection",
  "get_active_chat", "get_user_info", "get_lumiverse_version",
  // Ledger reads
  "list_my_edits",
  // External-provider reads
  "list_external_providers", "list_external_items", "read_external_item",
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
  // Compact metadata / list / search outputs.
  inspect: 12_000,
  list: 20_000,
  grep: 30_000,
  survey_cjk: 25_000,
  apply_glossary: 30_000,
  // Edit / rewrite / set return small structured patches. JSON can grow on
  // big hunks but 20k is plenty for diff payloads.
  edit: 20_000,
  rewrite: 20_000,
  set: 20_000,
  // Legacy stats, tiny by design. A runaway extension count could still
  // swell character_extension_stats, so cap at 8k.
  character_extension_stats: 8_000,
  character_field_stats: 8_000,
  regex_script_stats: 8_000,
  world_book_entry_stats: 8_000,
  world_book_stats: 8_000,
  regex_scripts_overview: 20_000,
  // Legacy grep mirrors the new `grep` budget.
  grep_card: 30_000,
  // tmp_grep results can be big. 30k forces the agent to paginate.
  tmp_grep: 30_000,
};

export function maxResultSizeCharsFor(name: string): number | null {
  return PER_TOOL_RESULT_CAP_CHARS[name] ?? null;
}

registry.register(applyGlossaryTool);
registry.register(askUserQuestionTool);
registry.register(auditCardCoverageTool);
registry.register(readTool);
registry.register(editTool);
registry.register(rewriteTool);
registry.register(setTool);
registry.register(inspectTool);
registry.register(listTool);
registry.register(grepTool);
registry.register(characterExtensionStatsTool);
registry.register(characterFieldStatsTool);
registry.register(chatStatsTool);
registry.register(countCjkCharsTool);
registry.register(createAlternateGreetingTool);
registry.register(createRegexScriptTool);
registry.register(createWorldBookEntryTool);
registry.register(customToolDeleteTool);
registry.register(customToolListTool);
registry.register(customToolRunTool);
registry.register(customToolSaveTool);
registry.register(deleteAlternateGreetingTool);
registry.register(deleteRegexScriptTool);
registry.register(deleteWorldBookEntryTool);
registry.register(editAlternateGreetingTool);
registry.register(editCharacterExtensionTool);
registry.register(editCharacterFieldTool);
registry.register(editExternalItemTool);
registry.register(editRegexScriptFieldTool);
registry.register(editWorldBookEntryTool);
registry.register(finishTool);
registry.register(fsDeleteTool);
registry.register(fsEditTool);
registry.register(fsListTool);
registry.register(fsMkdirTool);
registry.register(fsMoveTool);
registry.register(fsReadTool);
registry.register(fsStatTool);
registry.register(fsUnzipTool);
registry.register(fsWriteTool);
registry.register(fsZipTool);
registry.register(grepCardTool);
registry.register(grepChatMessagesTool);
registry.register(listAlternateGreetingsTool);
registry.register(listChatMessagesTool);
registry.register(listChatsForCharacterTool);
registry.register(listExtensionKeysTool);
registry.register(listExternalItemsTool);
registry.register(listExternalProvidersTool);
registry.register(listMyEditsTool);
registry.register(listRegexScriptsTool);
registry.register(listWorldBookEntriesTool);
registry.register(listWorldBooksTool);
registry.register(markToolResultsTool);
registry.register(randomPickTool);
registry.register(readAlternateGreetingTool);
registry.register(readCharacterExtensionTool);
registry.register(readCharacterFieldTool);
registry.register(readChatMessagesTool);
registry.register(readExternalItemTool);
registry.register(readPinnedChatMessagesTool);
registry.register(readRegexScriptFieldTool);
registry.register(readRegexScriptMetaTool);
registry.register(readWorldBookEntryTool);
registry.register(regexScriptStatsTool);
registry.register(regexScriptsOverviewTool);
registry.register(revertMyEditsTool);
registry.register(rewriteAlternateGreetingTool);
registry.register(rewriteWorldBookEntryTool);
registry.register(rollDiceTool);
registry.register(squashMyEditsTool);
registry.register(surveyCjkTool);
registry.register(testRegexTool);
registry.register(translateCardStringsTool);
registry.register(tmpGrepTool);
registry.register(tmpListTool);
registry.register(tmpReadTool);
registry.register(tmpStatTool);
registry.register(updateCharacterTool);
registry.register(updateCharacterExtensionTool);
registry.register(updateExternalItemTool);
registry.register(updateRegexScriptTool);
registry.register(updateWorldBookEntryTool);
registry.register(worldBookEntryStatsTool);
registry.register(worldBookStatsTool);

registry.register(countTokensTool);
registry.register(dryRunPromptTool);
registry.register(getActiveChatTool);
registry.register(getActiveRegexScriptsTool);
registry.register(getActivatedWorldInfoTool);
registry.register(getChatMemoriesTool);
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
