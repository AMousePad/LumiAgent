import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  scope: z.enum(["chat", "local", "global", "macro"]),
  chat_id: z.string().optional(),
}).strict();

export const listVariablesTool = defineTool({
  name: "list_variables",
  description: "List all variables in a given scope. Scopes: `chat` (chat.metadata.chat_variables, persisted across generations, what Risu/LumiRealm Lua and triggers write via setvar / setChatVar), `macro` (chat.metadata.macro_variables, LumiRealm's macro-state store, separate path from chat_variables), `local` (chat-bound ephemeral runtime variables), `global` (user-level). Pass chat_id for chat/local/macro scopes (defaults to pinned chat).",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["chat", "local", "global", "macro"], description: "Variable scope to list." },
      chat_id: { type: "string", description: "Required for chat/local/macro scopes. Defaults to pinned chat." },
    },
    required: ["scope"],
  },
  execute: async (input, ctx) => {
    try {
      let map: Record<string, string>;
      if (input.scope === "global") {
        map = await ctx.spindle.variables.global.list(ctx.userId);
      } else {
        const chatId = input.chat_id ?? ctx.pinnedChatId;
        if (!chatId) return { content: JSON.stringify({ error: `${input.scope} variables need a chat_id and no chat is pinned` }), isError: true };
        if (input.scope === "macro") {
          // chat.metadata.macro_variables is a two-level bag in Lumiverse:
          // { local: { name: value, ... }, global: { name: value, ... } }
          // Flatten with `local.`/`global.` prefixes so the agent sees actual
          // variable names instead of literally "local" and "global".
          const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
          const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
          const raw = meta["macro_variables"];
          const bag = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
          const entries: [string, string][] = [];
          for (const subKey of ["local", "global"] as const) {
            const sub = bag[subKey];
            if (sub && typeof sub === "object" && !Array.isArray(sub)) {
              for (const [k, v] of Object.entries(sub as Record<string, unknown>)) {
                entries.push([`${subKey}.${k}`, typeof v === "string" ? v : JSON.stringify(v)]);
              }
            }
          }
          map = Object.fromEntries(entries);
        } else {
          map = input.scope === "chat"
            ? await ctx.spindle.variables.chat.list(chatId)
            : await ctx.spindle.variables.local.list(chatId);
        }
      }
      const out = JSON.stringify({ scope: input.scope, count: Object.keys(map).length, variables: map }, null, 2);
      return { content: await spillOrReturn(ctx, out, `list_variables(${input.scope})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
