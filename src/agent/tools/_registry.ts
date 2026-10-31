import { inspectThemeTool, editThemeTool, themeAssetsTool, themeArchiveTool, openThemeEditorTool } from "./theme-workbench";
import { inspectCacheTool, runCacheDiagnosticTool } from "./cache-diagnostics";
import { ToolRegistry } from "./_framework";
import { captureUiTool } from './capture-ui';
import { isPublicTool, isToolGroup, registerToolGroups } from './_tool-groups';
import { inspectCouncilTool, inspectDlcTool } from "./inspect-council-dlc";
import { memoryVaultLinkTools } from "./memory-vaults-links";

import { aboutMemoriaTool } from "./about-memoria";
import { mouseyDieTool } from "./mousey-die";
import { readTutorialScriptTool } from "./read-tutorial-script";
import { applyGlossaryTool } from "./apply-glossary";
import { askUserQuestionTool } from "./ask-user-question";
import { attachWorldBookTool } from "./attach-world-book";
import { listChatWorldBooksTool } from "./list-chat-world-books";
import { assetDeleteTool } from "./asset-delete";
import { assetRenameTool } from "./asset-rename";
import { auditCardCoverageTool } from "./audit-card-coverage";
import { bulkUpdateCharacterTagsTool } from "./bulk-update-character-tags";
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
import { fsCopyTool } from "./fs-copy";
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
import { generateImageTool } from "./generate-image";
import { getThemeTool } from "./get-theme";
import { setThemeTool } from "./set-theme";
import { installThemePackTool } from "./install-theme-pack";
import { listImageModelsTool } from "./list-image-models";
import { listImagesTool } from "./list-images";
import { listGlobalAddonsTool } from "./list-global-addons";
import { notifyUserTool } from "./notify-user";
import { switchPersonaTool } from "./switch-persona";
import { setMacroTool } from "./set-macro";
import { navigateUiTool } from "./navigate-ui";
import { memoryStatsTool } from "./memory-stats";
import { listMemoryEntitiesTool } from "./list-memory-entities";
import { rememberFactTool } from "./remember-fact";
import { updateMemoryEntityTool } from "./update-memory-entity";
import { setVariableTool } from "./set-variable";
import { manageDatabankTool } from "./manage-databank";
import { createCharacterTool } from "./create-character";
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
import { listChatsTool } from "./list-chats";
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
import { listMcpServersTool, getMcpServerTool, createMcpServerTool, connectMcpServerTool, listMcpToolsTool, callMcpToolTool } from "./mcp";

export const registry = new ToolRegistry();

const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "inspect_cache", "run_cache_diagnostic",
  "about_memoria", "read_tutorial_script", "mousey_die",
  "translate_card_strings", "count_cjk_chars", "bulk_update_character_tags",
  "asset_rename", "asset_delete", "module_attach", "module_detach",
  "set_default_variables_text", "create_mcp_server",
  "create_memory_vault", "rename_memory_vault", "attach_memory_link", "set_memory_link_enabled",
  "squash_session_edits", "notify_user",
]);

export function isDeferredTool(name: string): boolean {
  return DEFERRED_TOOL_NAMES.has(name);
}

export function listDeferredToolNames(): readonly string[] {
  return [...DEFERRED_TOOL_NAMES].filter(isPublicTool).sort();
}

// Read-only tools that never write spindle/userStorage and never push to the
// edit ledger. Treated as concurrency-safe by the loop: consecutive calls run
// in parallel batches (cap 5). Anything not listed runs serially, the safe
// default for any tool that mutates state.
const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  "inspect_cache",
  "inspect_council", "inspect_dlc", "list_memory_vaults", "read_memory_vault", "list_memory_links",
  "list_mcp_servers", "get_mcp_server", "list_mcp_tools",
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
  "list_chats", "list_chats_for_character", "read_chat_messages",
  // Character discovery
  "list_characters",
  // Lumiverse-state inspectors
  "dry_run_prompt", "resolve_macros", "count_tokens",
  "list_image_models", "list_images", "list_global_addons", "get_theme", "inspect_theme",
  "memory_stats", "list_memory_entities",
  "list_variables", "read_variable",
  "list_activated_world_info", "list_active_regex_scripts", "list_chat_memories",
  "list_chat_world_books",
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
  "count_cjk_chars", "test_regex", "about_memoria", "read_tutorial_script",
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
  inspect_cache: Number.POSITIVE_INFINITY,
  // Spill internally already. Skip the loop's secondary cap.
  read: Number.POSITIVE_INFINITY,
  audit_card_coverage: Number.POSITIVE_INFINITY,
  dry_run_prompt: Number.POSITIVE_INFINITY,
  fs_read: Number.POSITIVE_INFINITY,
  web_search: Number.POSITIVE_INFINITY,
  web_fetch: Number.POSITIVE_INFINITY,
  list_mcp_servers: Number.POSITIVE_INFINITY,
  get_mcp_server: Number.POSITIVE_INFINITY,
  create_mcp_server: Number.POSITIVE_INFINITY,
  connect_mcp_server: Number.POSITIVE_INFINITY,
  list_mcp_tools: Number.POSITIVE_INFINITY,
  call_mcp_tool: Number.POSITIVE_INFINITY,
  // Compact metadata / list / search outputs.
  inspect: 12_000,
  list: 20_000,
  grep: 30_000,
  grep_external: 30_000,
  survey_cjk: 25_000,
  // Provider parameter schemas are verbose.
  list_image_models: 25_000,
  list_images: 20_000,
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
  if (isToolGroup(name)) return Number.POSITIVE_INFINITY;
  return PER_TOOL_RESULT_CAP_CHARS[name] ?? null;
}

registry.register(inspectCacheTool);
registry.register(runCacheDiagnosticTool);
registry.register(inspectCouncilTool);
registry.register(inspectDlcTool);
for (const tool of memoryVaultLinkTools) registry.register(tool as import("./_framework").ToolDefinition);
registry.register(aboutMemoriaTool);
registry.register(listMcpServersTool);
registry.register(getMcpServerTool);
registry.register(createMcpServerTool);
registry.register(connectMcpServerTool);
registry.register(listMcpToolsTool);
registry.register(callMcpToolTool);
registry.register(mouseyDieTool);
registry.register(readTutorialScriptTool);
registry.register(applyGlossaryTool);
registry.register(askUserQuestionTool);
registry.register(attachWorldBookTool);
registry.register(listChatWorldBooksTool);
registry.register(assetDeleteTool);
registry.register(assetRenameTool);
registry.register(auditCardCoverageTool);
registry.register(bulkUpdateCharacterTagsTool);
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
registry.register(fsCopyTool);
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
registry.register(generateImageTool);
registry.register(getThemeTool);
registry.register(setThemeTool);
registry.register(installThemePackTool);
registry.register(inspectThemeTool);
registry.register(editThemeTool);
registry.register(themeAssetsTool);
registry.register(themeArchiveTool);
registry.register(openThemeEditorTool);
registry.register(listImageModelsTool);
registry.register(listImagesTool);
registry.register(listGlobalAddonsTool);
registry.register(notifyUserTool);
registry.register(switchPersonaTool);
registry.register(setMacroTool);
registry.register(navigateUiTool);
registry.register(memoryStatsTool);
registry.register(listMemoryEntitiesTool);
registry.register(rememberFactTool);
registry.register(updateMemoryEntityTool);
registry.register(setVariableTool);
registry.register(manageDatabankTool);
registry.register(createCharacterTool);
registry.register(grepChatMessagesTool);
registry.register(grepExternalTool);
registry.register(listCharactersTool);
registry.register(listChatMessagesTool);
registry.register(listChatsTool);
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
registry.register(captureUiTool);
registerToolGroups(registry, isReadOnlyTool);
