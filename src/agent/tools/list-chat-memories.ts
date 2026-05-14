import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  chat_id: z.string().optional(),
  top_k: z.number().int().min(1).max(50).optional(),
}).strict();

export const listChatMemoriesTool = defineTool({
  name: "list_chat_memories",
  description: `Lists the top-K vector-retrieved memory chunks for a chat.

Usage:
- Returns the same chunks Lumiverse would inject into the prompt under chat memory.
- Response includes { chunks, formatted, count, enabled, settingsSource }.
- Defaults to pinned chat.
- Use to understand what historical context is being surfaced into the current generation.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Defaults to pinned chat." },
      top_k: { type: "number", description: "How many chunks to retrieve. Default depends on Lumiverse settings." },
    },
    required: [],
  },
  defaultSensitivity: "insensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) return { content: JSON.stringify({ error: "no chat_id and no pinned chat" }), isError: true };
    try {
      const result = await ctx.spindle.chats.getMemories(chatId, {
        ...(input.top_k !== undefined ? { topK: input.top_k } : {}),
        userId: ctx.userId,
      });
      const out = JSON.stringify({ chat_id: chatId, ...result }, null, 2);
      return { content: await spillOrReturn(ctx, out, `list_chat_memories(${chatId})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
