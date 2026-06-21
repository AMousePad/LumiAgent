import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/count-tokens/description.txt";
import argText from "../prompts/claude/tools/count-tokens/arg_text.txt";
import argChatId from "../prompts/claude/tools/count-tokens/arg_chat_id.txt";
import argModel from "../prompts/claude/tools/count-tokens/arg_model.txt";

const inputSchema = z.object({
  text: z.string().optional(),
  chat_id: z.string().optional(),
  model: z.string().optional(),
}).strict().refine((v) => !(v.text !== undefined && v.chat_id !== undefined), {
  message: "pass either `text` or `chat_id`, not both. Omit both to use the pinned chat.",
});

export const countTokensTool = defineTool({
  name: "count_tokens",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: argText },
      chat_id: { type: "string", description: argChatId },
      model: { type: "string", description: argModel },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    try {
      const opts = {
        ...(input.model ? { model: input.model } : {}),
        userId: ctx.userId,
      };
      if (input.text !== undefined) {
        const r = await ctx.spindle.tokens.countText(input.text, opts);
        return { content: JSON.stringify(r, null, 2) };
      }
      const chatId = input.chat_id ?? ctx.pinnedChatId;
      if (!chatId) return { content: JSON.stringify({ error: "no text given and no pinned chat" }), isError: true };
      const r = await ctx.spindle.tokens.countChat(chatId, opts);
      return { content: JSON.stringify({ ...r, chat_id: chatId }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
