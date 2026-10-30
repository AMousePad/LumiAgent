import { z } from "zod";
import { defineTool, type ToolRegistry } from "./_framework";
import type { ToolCtx } from "./_context";
import { readBudgetChars, spillOrReturn } from "./_io";

interface ToolGroup {
  name: string;
  description: string;
  actions: Record<string, string>;
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    name: "chats",
    description:
      "Find and inspect solo or group chats. active returns the host active chat, list searches the library, for_character uses the focused or explicit character. messages gives snippets, read gives full messages, search uses a regex, stats summarizes size and speakers. Message actions use chat_id or the pinned chat. Offsets count messages, not lines. Reads do not select or pin a chat.",
    actions: {
      active: "get_active_chat",
      list: "list_chats",
      for_character: "list_chats_for_character",
      messages: "list_chat_messages",
      read: "read_chat_messages",
      search: "grep_chat_messages",
      stats: "chat_stats",
    },
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
      "List identities, read one by persona_id or which=active/default, inspect its world book, or switch the active identity. Read includes attached add-on IDs and content. World-book inspection returns metadata, use list with wb/<id> for entries. Switching is user-wide, outside Workshop undo.",
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
      "List, read or set variables. chat/local are chat-scoped, global is user-wide, macro reads macro overrides with local./global. key prefixes. Non-global scopes require chat_id or a pinned chat. set accepts chat/local/global and exactly one of a string value or clear=true. Macro writes use set_chat_variable or set_toggle. Variable changes are outside Workshop undo.",
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
    for (const { action, tool } of entries) {
      for (const [key, value] of Object.entries(
        tool.jsonSchema.properties as Record<string, any>,
      )) {
        if (!properties[key])
          properties[key] = {
            ...value,
            description: canonicalToolReferences(value.description ?? ""),
          };
        else {
          for (const constraint of [
            "enum",
            "minimum",
            "maximum",
            "minLength",
            "maxLength",
            "default",
          ]) {
            if (
              JSON.stringify(properties[key][constraint]) !==
              JSON.stringify(value[constraint])
            )
              delete properties[key][constraint];
          }
        }
      }
    }
    const inputSchema = z
      .record(z.string(), z.unknown())
      .superRefine((input, ctx) => {
        const entry = entries.find((e) => e.action === input.action);
        if (!entry) {
          ctx.addIssue({
            code: "custom",
            path: ["action"],
            message: `Choose ${entries.map((e) => e.action).join(", ")}`,
          });
          return;
        }
        const { action: _, ...args } = input;
        const allowed = new Set(
          Object.keys(entry.tool.jsonSchema.properties as object),
        );
        for (const key of Object.keys(args))
          if (!allowed.has(key))
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: `Argument is not used by action=${entry.action}`,
            });
        const parsed = entry.tool.inputSchema.safeParse(args);
        if (!parsed.success)
          for (const issue of parsed.error.issues)
            ctx.addIssue({
              code: "custom",
              path: issue.path,
              message: issue.message,
            });
      });
    const safe = (input: Record<string, unknown>) => {
      const entry = entries.find((e) => e.action === input.action);
      if (!entry) return false;
      const { action: _, ...args } = input;
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
        requiresCharacter: entries.every(
          (e) => e.tool.requiresCharacter === true,
        ),
        isConcurrencySafe: safe,
        execute: async (input, ctx) => {
          const entry = entries.find((e) => e.action === input.action)!;
          const { action: _, ...args } = input;
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
                result.content,
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
