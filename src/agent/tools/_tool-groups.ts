import { z } from "zod";
import { defineTool, prepareToolArgs, type ToolRegistry } from "./_framework";
import type { ToolCtx } from "./_context";
import { readBudgetChars, spillOrReturn } from "./_io";

interface ToolGroup {
  name: string;
  description: string;
  actions: Record<string, string>;
  // action -> { supplied key: real key }. Applied only when the real key is absent.
  argAliases?: Record<string, Record<string, string>>;
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    name: "chats",
    description:
      "Find, read and manage solo or group chats. active returns the chat open in Lumiverse, list searches the library, for_character uses the focused or explicit character. messages gives snippets, read gives full messages with an editable path per row, search runs a regex over one chat or many (all_chats / character_id), stats summarizes size and speakers. rename changes the chat name. hide sets or clears the hidden (exclude) flag on message ids. delete_messages removes messages permanently and cannot be undone. chat_id is optional everywhere: omitted means the pinned chat, else the chat open in Lumiverse, and chat_source in the result says which. For the newest messages pass last=N to read or messages. Offsets count messages, not lines. Reads do not select or pin a chat. rename, hide and delete_messages are outside Workshop undo. Creating or branching a chat is not available.",
    actions: {
      active: "get_active_chat",
      list: "list_chats",
      for_character: "list_chats_for_character",
      messages: "list_chat_messages",
      read: "read_chat_messages",
      search: "grep_chat_messages",
      stats: "chat_stats",
      hide: "hide_chat_messages",
      rename: "rename_chat",
      delete_messages: "delete_chat_messages",
    },
    argAliases: { search: { query: "pattern" } },
  },
  {
    name: "connections",
    description:
      "List model connections or read one by connection_id. Returns configuration and has_api_key, never the API key. Use returned IDs for generation and prompt inspection.",
    actions: { list: "list_connections", read: "read_connection" },
  },
  {
    name: "personas",
    description:
      "List identities, read one by persona_id (id or name) or the one in use, inspect its world book, or switch the active identity. list flags the active and default persona. Read includes attached add-on IDs and content. World-book inspection returns metadata, use list with wb/<id> for entries. Switching is user-wide and revertable. Duplicate with create({path:\"persona\", value:{copy_of, name}}), make one the default with set({path:\"persona/<id>/is_default\", value:true}).",
    actions: {
      list: "list_personas",
      read: "read_persona",
      world_book: "read_persona_world_book",
      switch: "switch_persona",
    },
  },
  {
    name: "variables",
    description:
      "List, read or set the variables Lumiverse macros use. Every store is per chat: chat is what {{getchatvar}} reads and what Risu / LumiRealm setvar writes, global is what {{getgvar}} / {{getglobalvar}} reads in that chat. local ({{getvar}}) is rebuilt for every prompt from preset variables, so nothing saved under it reaches a prompt: change those with set on preset/<id>/var/<name>. chat_id is optional: omitted means the pinned chat, else the chat open in Lumiverse. read without a scope looks in every store and says where the key was found. set takes scope chat or global and exactly one of a string value or clear=true, and its result names the store and chat written. Changes are recorded in Workshop and can be reverted there.",
    actions: {
      list: "list_variables",
      read: "read_variable",
      set: "set_variable",
    },
  },
  {
    name: "databanks",
    description:
      "Browse RAG collections. list filters collections, read returns collection metadata, documents lists document metadata, document returns extracted text unless meta_only=true. Large text spills to tmp handles. Use manage_databank for mutations.",
    actions: {
      list: "list_databanks",
      read: "read_databank",
      documents: "list_databank_documents",
      document: "read_databank_document",
    },
  },
  {
    name: "mcp",
    description:
      "Use MCP servers configured in Lumiverse Settings. list finds server IDs, status reads a redacted profile, connect opens an existing server, tools returns exact remote names and input schemas, call invokes one. Read its schema before calling. Remote changes are outside Workshop undo. Never put credentials in tool arguments. Use create_mcp_server only to add a requested profile.",
    actions: {
      list: "list_mcp_servers",
      status: "get_mcp_server",
      connect: "connect_mcp_server",
      tools: "list_mcp_tools",
      call: "call_mcp_tool",
    },
  },
  {
    name: "workspace",
    description:
      "Manage workspace paths, relative to the Files-tab root without a workspace/ prefix. list/stat inspect, read returns paginated text, write creates text and parent folders, edit requires a recent read. copy preserves bytes and refuses existing destinations, move relocates, mkdir creates empty folders, delete removes, zip/unzip handle archives. These changes are outside Workshop undo.",
    actions: {
      list: "fs_list",
      stat: "fs_stat",
      read: "fs_read",
      write: "fs_write",
      edit: "fs_edit",
      copy: "fs_copy",
      move: "fs_move",
      mkdir: "fs_mkdir",
      delete: "fs_delete",
      zip: "fs_zip",
      unzip: "fs_unzip",
    },
  },
  {
    name: "workshop",
    description:
      "Inspect or undo recorded edits. list returns edit IDs, revert restores selected edits and refuses conflicting later changes, squash consolidates this response into one patch per field. Revert is scoped to this response unless allow_cross_session=true. Workspace, theme and remote MCP operations are outside this ledger.",
    actions: {
      list: "list_session_edits",
      revert: "revert_session_edits",
      squash: "squash_session_edits",
    },
  },
  {
    name: "custom_tools",
    description:
      "List, save or delete reusable tool recipes. save requires a manifest with name, description, params and steps. Execute recipes or inline steps with custom_tool_run. Recipe files are workspace content and are outside Workshop undo.",
    actions: {
      list: "custom_tool_list",
      save: "custom_tool_save",
      delete: "custom_tool_delete",
    },
  },
  {
    name: "external",
    description:
      "Access registered extension provider surfaces, including LumiRealm modules and triggers. Use the surface_id from the current provider catalog. list returns items, read returns an item or field, search scans string fields, edit requires a recent field read, update replaces a field. Provider permissions and edit recovery still apply.",
    actions: {
      list: "list_external",
      read: "read_external",
      search: "grep_external",
      edit: "edit_external",
      update: "update_external",
    },
  },
];

const aliases = new Map(
  TOOL_GROUPS.flatMap((group) =>
    Object.entries(group.actions).map(
      ([action, name]) => [name, { name: group.name, action }] as const,
    ),
  ),
);
aliases.set("get_theme", { name: "inspect_theme", action: "state" });
aliases.set("install_theme_pack", { name: "edit_theme", action: "" });
export const publicToolName = (name: string): string =>
  aliases.get(name)?.name ?? name;
export const isPublicTool = (name: string): boolean => !aliases.has(name);
export const isToolGroup = (name: string): boolean =>
  TOOL_GROUPS.some((group) => group.name === name);

export function canonicalToolReferences(text: string): string {
  return text.replace(/\b[a-z][a-z0-9_]+\b/g, (name) => {
    const alias = aliases.get(name);
    return alias
      ? alias.action
        ? `${alias.name}(action=${alias.action})`
        : alias.name
      : name;
  });
}

export function registerToolGroups(
  registry: ToolRegistry,
  readOnly: (name: string) => boolean,
): void {
  for (const group of TOOL_GROUPS) {
    const entries = Object.entries(group.actions).map(([action, name]) => {
      const tool = registry.get(name);
      if (!tool) throw new Error(`Missing grouped tool: ${name}`);
      return { action, tool };
    });
    const properties: Record<string, any> = {
      action: { type: "string", enum: entries.map((e) => e.action) },
    };
    const meanings = new Map<string, Array<{ action: string; text: string }>>();
    for (const { action, tool } of entries) {
      for (const [key, value] of Object.entries(
        tool.jsonSchema.properties as Record<string, any>,
      )) {
        const text = canonicalToolReferences(value.description ?? "").trim();
        if (!meanings.has(key)) meanings.set(key, []);
        meanings.get(key)!.push({ action, text });
        if (!properties[key]) properties[key] = { ...value, description: text };
        else {
          for (const constraint of [
            "enum",
            "minimum",
            "maximum",
            "minLength",
            "maxLength",
            "minItems",
            "maxItems",
            "default",
          ]) {
            if (
              JSON.stringify(properties[key][constraint]) !==
              JSON.stringify(value[constraint])
            )
              delete properties[key][constraint];
          }
          if (properties[key].type === "integer" && value.type === "number") properties[key].type = "number";
        }
      }
    }
    // First-seen-wins hid what a shared argument means for later actions, e.g. a negative offset on read.
    for (const [key, list] of meanings) {
      const byText = new Map<string, string[]>();
      for (const { action, text } of list) byText.set(text, [...(byText.get(text) ?? []), action]);
      if (byText.size < 2) continue;
      properties[key].description = [...byText]
        .filter(([text]) => text.length > 0)
        .map(([text, actions]) => `${actions.join("/")}: ${text}`)
        .join(" | ");
    }
    const isBlank = (value: unknown) =>
      value === undefined || value === null || value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);
    const usersOf = (key: string) =>
      entries.filter((e) => Object.hasOwn(e.tool.jsonSchema.properties as object, key)).map((e) => e.action);
    const describeIgnored = (key: string) =>
      properties[key] ? `${key} (used by action=${usersOf(key).join("/")})` : `${key} (not an argument of ${group.name})`;
    const acceptsLine = (tool: { jsonSchema: Record<string, unknown> }) => {
      const required = new Set((tool.jsonSchema.required as string[] | undefined) ?? []);
      return Object.keys(tool.jsonSchema.properties as object).map((k) => k + (required.has(k) ? "*" : "")).join(", ") || "no arguments";
    };
    // The merged schema shows every action's fields, so models routinely send
    // fields for other actions. Drop them instead of failing the whole call.
    const splitArgs = (input: Record<string, unknown>) => {
      const entry = entries.find((e) => e.action === input.action);
      if (!entry) return null;
      const { action: _, ...rest } = input;
      for (const [from, to] of Object.entries(group.argAliases?.[entry.action] ?? {})) {
        if (isBlank(rest[from]) || !isBlank(rest[to])) continue;
        rest[to] = rest[from];
        delete rest[from];
      }
      const allowed = new Set(Object.keys(entry.tool.jsonSchema.properties as object));
      const args: Record<string, unknown> = {};
      const ignored: string[] = [];
      const unknown: string[] = [];
      for (const [key, value] of Object.entries(rest)) {
        if (allowed.has(key)) args[key] = value;
        else if (properties[key]) ignored.push(key);
        else { args[key] = value; if (!isBlank(value)) unknown.push(key); }
      }
      return {
        entry,
        args: prepareToolArgs(entry.tool, args) as Record<string, unknown>,
        ignored,
        unknown,
      };
    };
    // Pipelines parse step output as JSON, so a JSON object gets a field instead of trailing text.
    const withIgnoredNote = (content: string, ignored: readonly string[]) => {
      if (ignored.length === 0) return content;
      const note = ignored.map(describeIgnored);
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          return JSON.stringify({ ...parsed, ignored_arguments: note }, null, 2);
      } catch { /* plain text result */ }
      return `${content}\n[${group.name}: ignored ${note.join(", ")}]`;
    };
    const inputSchema = z
      .record(z.string(), z.unknown())
      .superRefine((input, ctx) => {
        const split = splitArgs(input);
        if (!split) {
          ctx.addIssue({
            code: "custom",
            path: ["action"],
            message: `Choose ${entries.map((e) => e.action).join(", ")}`,
          });
          return;
        }
        const { entry, args, ignored, unknown } = split;
        const parsed = entry.tool.inputSchema.safeParse(args);
        if (!parsed.success) {
          for (const issue of parsed.error.issues)
            ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
          const dropped = [...ignored.filter((key) => !isBlank(input[key])), ...unknown].map(describeIgnored);
          ctx.addIssue({
            code: "custom",
            path: [`action=${entry.action}`],
            message: `accepts ${acceptsLine(entry.tool)} (* required).${dropped.length > 0 ? ` Not used by this action: ${dropped.join(", ")}.` : ""}`,
          });
        }
      });
    const safe = (input: Record<string, unknown>) => {
      const split = splitArgs(input);
      if (!split) return false;
      const { entry, args } = split;
      return (
        entry.tool.isConcurrencySafe?.(args) ??
        entry.tool.isReadOnly?.(args) ??
        readOnly(entry.tool.name)
      );
    };
    registry.register(
      defineTool({
        name: group.name,
        description:
          group.description +
          "\nActions and arguments (* required): " +
          entries
            .map(({ action, tool }) => {
              const required = new Set(
                (tool.jsonSchema.required as string[]) ?? [],
              );
              return `${action}(${Object.keys(
                tool.jsonSchema.properties as object,
              )
                .map((k) => k + (required.has(k) ? "*" : ""))
                .join(", ")})`;
            })
            .join("; ") +
          ". Pass only arguments for the chosen action.",
        inputSchema,
        jsonSchema: { type: "object", properties, required: ["action"] },
        normalizesOwnArgs: true,
        requiresCharacter: entries.every(
          (e) => e.tool.requiresCharacter === true,
        ),
        isConcurrencySafe: safe,
        execute: async (input, ctx) => {
          const { entry, args, ignored: otherAction, unknown } = splitArgs(input)!;
          // Strict tools already rejected unknown keys. The rest drop them silently, so report those too.
          const ignored = [...otherAction, ...unknown];
          const dispatch = (
            ctx as ToolCtx & {
              __dispatch?: Record<
                string,
                (
                  args: Record<string, unknown>,
                  ctx: ToolCtx,
                ) => Promise<{ content: string; isError?: boolean }>
              >;
            }
          ).__dispatch;
          if (!dispatch?.[entry.tool.name])
            return {
              content: "Error: grouped tool dispatch is unavailable.",
              isError: true,
            };
          const result = await dispatch[entry.tool.name]!(args, ctx);
          try {
            return {
              ...result,
              content: await spillOrReturn(
                ctx,
                withIgnoredNote(result.content, ignored),
                `${group.name}:${entry.action}`,
              ),
            };
          } catch {
            return {
              ...result,
              content:
                result.content.slice(0, readBudgetChars(ctx)) +
                "\n[Output truncated because scratch storage failed. The operation already completed. Do not repeat mutations to recover output.]",
            };
          }
        },
      }),
    );
  }
}
