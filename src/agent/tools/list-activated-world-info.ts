import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import description from "../prompts/claude/tools/list-activated-world-info/description.txt";
import argChatId from "../prompts/claude/tools/list-activated-world-info/arg_chat_id.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

export const listActivatedWorldInfoTool = defineTool({
  name: "list_activated_world_info",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: argChatId },
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
