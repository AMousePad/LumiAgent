import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

export const getActivatedWorldInfoTool = defineTool({
  name: "get_activated_world_info",
  description: "List the world info entries that WOULD activate (keyword + vector) for the chat at its current state. Returns { id, comment, keys, source: 'keyword'|'vector', score? } per entry. Use this to debug 'is this lorebook entry actually firing?' questions before reading the entry's content. Defaults to pinned chat.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat to evaluate. Defaults to pinned chat." },
    },
    required: [],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) return { content: JSON.stringify({ error: "no chat_id and no pinned chat" }), isError: true };
    try {
      const entries = await ctx.spindle.world_books.getActivated(chatId, ctx.userId);
      const out = JSON.stringify({ chat_id: chatId, count: entries.length, entries }, null, 2);
      return { content: await spillOrReturn(ctx, out, `get_activated_world_info(${chatId})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
