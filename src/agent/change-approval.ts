export type ChangeApprovalAction = "create" | "update" | "delete" | "move" | "write";
export type ChangeApprovalSeverity = "change" | "destructive";

export interface ChangeImpact {
  readonly action: ChangeApprovalAction;
  readonly severity: ChangeApprovalSeverity;
  readonly target: string;
  readonly summary: string;
}

export type ChangeApprovalPolicy =
  | { readonly kind: "none" }
  | { readonly kind: "delegate" }
  | { readonly kind: "required"; readonly impact: ChangeImpact };

// Explicit control-plane operations that do not change user-authored card,
// chat, lorebook, extension, external-provider, or workspace state. New tools
// default to approval until deliberately added here.
const NO_CHANGE_TOOLS: ReadonlySet<string> = new Set([
  "ask_user_question",
  "audit_card_coverage",
  "chat_stats",
  "count_cjk_chars",
  "count_tokens",
  "custom_tool_list",
  "dry_run_prompt",
  "finish",
  "fs_list",
  "fs_read",
  "fs_stat",
  "get_active_chat",
  "get_lumiverse_version",
  "get_user_info",
  "grep",
  "grep_chat_messages",
  "grep_external",
  "inspect",
  "list",
  "list_active_regex_scripts",
  "list_activated_world_info",
  "list_characters",
  "list_chat_memories",
  "list_chat_messages",
  "list_chat_world_books",
  "list_chats_for_character",
  "list_connections",
  "list_databank_documents",
  "list_databanks",
  "list_external",
  "list_personas",
  "list_session_edits",
  "list_variables",
  "random_pick",
  "read",
  "read_chat_messages",
  "read_connection",
  "read_databank",
  "read_databank_document",
  "read_external",
  "read_persona",
  "read_persona_world_book",
  "read_variable",
  "resolve_macros",
  "roll_dice",
  "survey_cjk",
  "test_regex",
  "tmp_grep",
  "tmp_list",
  "tmp_read",
  "tmp_stat",
  "todo_write",
  "tool_search",
  "view_image",
]);

const DELETE_TOOLS: ReadonlySet<string> = new Set([
  "asset_delete",
  "custom_tool_delete",
  "delete",
  "fs_delete",
  "module_detach",
  "revert_session_edits",
]);

const CREATE_TOOLS: ReadonlySet<string> = new Set([
  "create",
  "fs_mkdir",
  "module_attach",
]);

const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "fs_edit",
  "fs_unzip",
  "fs_write",
  "fs_zip",
  "web_fetch",
  "web_search",
]);

const MOVE_TOOLS: ReadonlySet<string> = new Set([
  "asset_rename",
  "fs_move",
]);

const TOOL_LABELS: Readonly<Record<string, string>> = {
  apply_glossary: "Apply glossary replacements",
  attach_world_book: "Change a lorebook attachment",
  asset_delete: "Delete an asset",
  asset_rename: "Rename an asset",
  create: "Create card content",
  custom_tool_delete: "Delete a custom tool",
  custom_tool_save: "Save a custom tool",
  delete: "Delete card content",
  edit: "Edit card content",
  edit_external: "Edit external-provider content",
  fs_delete: "Delete a workspace item",
  fs_edit: "Edit a workspace file",
  fs_mkdir: "Create a workspace folder",
  fs_move: "Move a workspace item",
  fs_unzip: "Extract an archive into the workspace",
  fs_write: "Write a workspace file",
  fs_zip: "Create a workspace archive",
  module_attach: "Attach a module",
  module_detach: "Detach a module",
  revert_session_edits: "Revert prior agent changes",
  rewrite: "Rewrite card content",
  set: "Set card content",
  set_chat_variable: "Set a chat variable",
  set_default_variables_text: "Set default variables",
  set_toggle: "Change a card toggle",
  squash_session_edits: "Squash the edit ledger",
  translate_card_strings: "Apply card translations",
  update_character: "Update character metadata",
  update_external: "Update external-provider content",
  update_regex_script: "Update a regex script",
  update_world_book_entry: "Update a lorebook entry",
  web_fetch: "Save fetched content to the workspace",
  web_search: "Save search results to the workspace",
};

function stringField(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function compactJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

interface ApprovalTargetContext {
  readonly characterId?: string | null;
  readonly pinnedChatId?: string | null;
}

function resolveTarget(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  context: ApprovalTargetContext,
): string {
  const focusedCharacter = context.characterId && context.characterId.length > 0
    ? context.characterId
    : "(no focused character)";
  if (toolName === "fs_move") {
    const from = stringField(args, "from") ?? "(unknown)";
    const to = stringField(args, "to") ?? "(unknown)";
    return `${from} -> ${to}`;
  }
  if (toolName === "asset_rename") {
    const from = stringField(args, "old_name") ?? "(unknown)";
    const to = stringField(args, "new_name") ?? "(unknown)";
    return `${compactJson(args["source"]) ?? "(unknown source)"} / ${from} -> ${to}`;
  }
  if (toolName === "asset_delete") {
    return `${compactJson(args["source"]) ?? "(unknown source)"} / ${stringField(args, "asset_name") ?? "(unknown asset)"}`;
  }
  if (toolName === "attach_world_book") {
    const scope = stringField(args, "scope") ?? "scope";
    const contextualTarget = scope === "character"
      ? context.characterId
      : scope === "chat"
        ? context.pinnedChatId
        : "global";
    const target = stringField(args, "target_id") ?? contextualTarget ?? `(no active ${scope})`;
    const book = stringField(args, "world_book_id") ?? "(unknown lorebook)";
    return `${scope}:${target} / ${book}`;
  }
  if (toolName === "edit_external" || toolName === "update_external") {
    return [
      stringField(args, "surface_id") ?? "(unknown surface)",
      stringField(args, "item_id") ?? "(unknown item)",
      stringField(args, "field") ?? "(unknown field)",
    ].join("/");
  }
  if (toolName === "module_attach" || toolName === "module_detach") {
    return `${stringField(args, "character_id") ?? "(unknown character)"} / ${stringField(args, "module_id") ?? "(unknown module)"}`;
  }
  if (toolName === "set_chat_variable" || toolName === "set_toggle") {
    return `${stringField(args, "chat_id") ?? "(unknown chat)"} / ${stringField(args, "key") ?? "(unknown key)"}`;
  }
  if (toolName === "custom_tool_save") {
    const manifest = args["manifest"];
    if (manifest && typeof manifest === "object") {
      const name = (manifest as Record<string, unknown>)["name"];
      if (typeof name === "string" && name.length > 0) return name;
    }
  }
  if (toolName === "apply_glossary") {
    const character = stringField(args, "character_id") ?? focusedCharacter;
    const scopes = compactJson(args["scopes"]) ?? "[default scopes]";
    return `character:${character} / scopes:${scopes}`;
  }
  if (toolName === "translate_card_strings") {
    const from = stringField(args, "source_lang") ?? "?";
    const to = stringField(args, "target_lang") ?? "?";
    const include = compactJson(args["include"]) ?? "[default surfaces]";
    return `character:${focusedCharacter} / ${from}->${to} / surfaces:${include}`;
  }
  if (toolName === "update_character" || toolName === "set_default_variables_text") {
    return `character:${stringField(args, "character_id") ?? focusedCharacter}`;
  }
  if (toolName === "squash_session_edits") {
    return `character:${focusedCharacter} / current assistant edit ledger`;
  }

  for (const key of [
    "path",
    "save_to",
    "output",
    "dest_dir",
    "name",
    "asset_name",
    "target_id",
    "character_id",
    "chat_id",
    "world_book_id",
    "entry_id",
    "script_id",
    "module_id",
    "key",
  ]) {
    const hit = stringField(args, key);
    if (hit) return hit;
  }

  const source = compactJson(args["source"]);
  if (source) return source;
  const ids = compactJson(args["edit_ids"] ?? args["ids"] ?? args["paths"]);
  return ids ?? "(active target)";
}

function actionFor(toolName: string): ChangeApprovalAction {
  if (DELETE_TOOLS.has(toolName)) return "delete";
  if (CREATE_TOOLS.has(toolName)) return "create";
  if (MOVE_TOOLS.has(toolName)) return "move";
  if (WRITE_TOOLS.has(toolName)) return "write";
  return "update";
}

export function changeApprovalPolicyFor(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  context: ApprovalTargetContext = {},
): ChangeApprovalPolicy {
  if (toolName === "custom_tool_run") return { kind: "delegate" };
  if (NO_CHANGE_TOOLS.has(toolName)) return { kind: "none" };
  if ((toolName === "apply_glossary" || toolName === "translate_card_strings") && args["dry_run"] === true) {
    return { kind: "none" };
  }
  if ((toolName === "web_search" || toolName === "web_fetch") && stringField(args, "save_to") === null) {
    return { kind: "none" };
  }

  const action = actionFor(toolName);
  return {
    kind: "required",
    impact: {
      action,
      severity: action === "delete" ? "destructive" : "change",
      target: resolveTarget(toolName, args, context).slice(0, 500),
      summary: TOOL_LABELS[toolName] ?? `Run state-changing tool '${toolName}'`,
    },
  };
}

export function isExplicitNoChangeTool(toolName: string): boolean {
  return NO_CHANGE_TOOLS.has(toolName);
}
