import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { resolveChat } from "./_chat";
import { readAllStores, VAR_STORES, type VarStore } from "./_variables";
import description from "../prompts/claude/tools/list-variables/description.txt";
import argScope from "../prompts/claude/tools/list-variables/arg_scope.txt";
import argChatId from "../prompts/claude/tools/list-variables/arg_chat_id.txt";

const inputSchema = z.object({
  scope: z.enum(["chat", "local", "global", "macro", "all"]).optional(),
  chat_id: z.string().optional(),
}).strict();

export const listVariablesTool = defineTool({
  name: "list_variables",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["all", "chat", "global", "local"], description: argScope },
      chat_id: { type: "string", description: argChatId },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    try {
      const stores = await readAllStores(ctx, chat);
      const head = { chat_id: chatId, chat_name: chat.name, chat_source: source };
      const scope = input.scope ?? "all";
      let body: Record<string, unknown>;
      if (scope === "chat" || scope === "global" || scope === "local") {
        const info = VAR_STORES[scope];
        body = {
          ...head, scope, store: info.store, read_by: info.read_by, count: Object.keys(stores[scope]).length, variables: stores[scope],
          ...(scope === "global" && Object.keys(stores.user_level).length > 0
            ? { user_level_store: stores.user_level, user_level_note: "Legacy user-level values. {{getgvar}} does not read them, it reads the per-chat values above." } : {}),
        };
      } else if (scope === "macro") {
        // Kept for older prompts: the two macro_variables sub-stores flattened with a prefix.
        const variables = Object.fromEntries([
          ...Object.entries(stores.local).map(([k, v]) => [`local.${k}`, v] as const),
          ...Object.entries(stores.global).map(([k, v]) => [`global.${k}`, v] as const),
        ]);
        body = { ...head, scope, store: "chat.metadata.macro_variables", count: Object.keys(variables).length, variables };
      } else {
        const shown = (["chat", "global", "local", "user_level"] as VarStore[]).filter((s) => s === "chat" || s === "global" || Object.keys(stores[s]).length > 0);
        body = {
          ...head, scope: "all",
          count: shown.reduce((n, s) => n + Object.keys(stores[s]).length, 0),
          stores: Object.fromEntries(shown.map((s) => [s, { store: VAR_STORES[s].store, read_by: VAR_STORES[s].read_by, count: Object.keys(stores[s]).length, variables: stores[s] }])),
        };
      }
      return { content: await spillOrReturn(ctx, JSON.stringify(body, null, 2), `list_variables(${scope})`) };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] listing variables of chat ${chatId} failed: ${(err as Error).message}`, isError: true };
    }
  },
});
