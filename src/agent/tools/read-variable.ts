import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/read-variable/description.txt";
import argScope from "../prompts/claude/tools/read-variable/arg_scope.txt";
import argKey from "../prompts/claude/tools/read-variable/arg_key.txt";
import argChatId from "../prompts/claude/tools/read-variable/arg_chat_id.txt";

const inputSchema = z.object({
  scope: z.enum(["chat", "local", "global", "macro"]),
  key: z.string().min(1),
  chat_id: z.string().optional(),
}).strict();

export const readVariableTool = defineTool({
  name: "read_variable",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["chat", "local", "global", "macro"], description: argScope },
      key: { type: "string", description: argKey },
      chat_id: { type: "string", description: argChatId },
    },
    required: ["scope", "key"],
  },
  execute: async (input, ctx) => {
    try {
      if (input.scope === "global") {
        const exists = await ctx.spindle.variables.global.has(input.key, ctx.userId);
        if (!exists) return { content: JSON.stringify({ scope: "global", key: input.key, exists: false }) };
        const value = await ctx.spindle.variables.global.get(input.key, ctx.userId);
        return { content: JSON.stringify({ scope: "global", key: input.key, exists: true, value }, null, 2) };
      }
      const chatId = input.chat_id ?? ctx.pinnedChatId;
      if (!chatId) return { content: JSON.stringify({ error: `${input.scope} variables need a chat_id and no chat is pinned` }), isError: true };
      if (input.scope === "macro") {
        // chat.metadata.macro_variables is { local: {...}, global: {...} }.
        // Accept either dotted form ("local.foo" / "global.foo") or a bare
        // name (search both sub-bags, local-wins on collision to match the
        // Lumiverse macro resolver's precedence).
        const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
        const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
        const raw = meta["macro_variables"];
        const bag = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
        const local = (bag.local && typeof bag.local === "object" && !Array.isArray(bag.local)) ? bag.local as Record<string, unknown> : {};
        const global = (bag.global && typeof bag.global === "object" && !Array.isArray(bag.global)) ? bag.global as Record<string, unknown> : {};
        let resolved: unknown;
        let found = false;
        const dotted = /^(local|global)\.(.+)$/.exec(input.key);
        if (dotted) {
          const target = dotted[1] === "local" ? local : global;
          if (dotted[2]! in target) { resolved = target[dotted[2]!]; found = true; }
        } else {
          if (input.key in local) { resolved = local[input.key]; found = true; }
          else if (input.key in global) { resolved = global[input.key]; found = true; }
        }
        if (!found) return { content: JSON.stringify({ scope: "macro", chat_id: chatId, key: input.key, exists: false }) };
        const value = typeof resolved === "string" ? resolved : JSON.stringify(resolved);
        return { content: JSON.stringify({ scope: "macro", chat_id: chatId, key: input.key, exists: true, value }, null, 2) };
      }
      const surface = input.scope === "chat" ? ctx.spindle.variables.chat : ctx.spindle.variables.local;
      const exists = await surface.has(chatId, input.key);
      if (!exists) return { content: JSON.stringify({ scope: input.scope, chat_id: chatId, key: input.key, exists: false }) };
      const value = await surface.get(chatId, input.key);
      return { content: JSON.stringify({ scope: input.scope, chat_id: chatId, key: input.key, exists: true, value }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
