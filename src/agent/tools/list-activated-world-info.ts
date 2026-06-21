import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

export const listActivatedWorldInfoTool = defineTool({
  name: "list_activated_world_info",
  description: `Lists world info entries that would activate for a chat at its current state.

Usage:
- Returns { id, comment, keys, source: 'keyword'|'vector', score?, bookId?, bookSource? } per entry. \`bookSource\` is the binding scope that contributed the entry's book: 'character'|'persona'|'chat'|'global' (narrowest wins). Also returns \`by_source\`, a count of entries per binding scope.
- Use to debug "is this lorebook entry actually firing?" (and "from which binding layer?") before reading the entry's content.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat to evaluate." },
    },
    required: [],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) return { content: JSON.stringify({ error: "no chat_id and no pinned chat" }), isError: true };
    try {
      const entries = await ctx.spindle.world_books.getActivated(chatId, ctx.userId);
      const bySource: Record<string, number> = {};
      for (const e of entries) {
        const k = e.bookSource ?? "unknown";
        bySource[k] = (bySource[k] ?? 0) + 1;
      }
      const out = JSON.stringify({ chat_id: chatId, count: entries.length, by_source: bySource, entries }, null, 2);
      return { content: await spillOrReturn(ctx, out, `list_activated_world_info(${chatId})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
