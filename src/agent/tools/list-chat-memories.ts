import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { CHAT_ID_ARG, NO_CHAT_TARGET, resolveChatId } from "./_chat";
import description from "../prompts/claude/tools/list-chat-memories/description.txt";
import argTopK from "../prompts/claude/tools/list-chat-memories/arg_top_k.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
  top_k: z.number().int().min(1).max(50).optional(),
}).strict();

export const listChatMemoriesTool = defineTool({
  name: "list_chat_memories",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      top_k: { type: "number", description: argTopK },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const target = await resolveChatId(ctx, input.chat_id);
    if (!target) return { content: NO_CHAT_TARGET, isError: true };
    const chatId = target.chatId;
    try {
      const result = await ctx.spindle.chats.getMemories(chatId, {
        ...(input.top_k !== undefined ? { topK: input.top_k } : {}),
        userId: ctx.userId,
      });
      const out = JSON.stringify({ chat_id: chatId, chat_source: target.source, ...result }, null, 2);
      return { content: await spillOrReturn(ctx, out, `list_chat_memories(${chatId})`) };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] reading chat memory of ${chatId} failed: ${(err as Error).message}`, isError: true };
    }
  },
});
