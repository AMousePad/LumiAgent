import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  text: z.string().optional(),
  chat_id: z.string().optional(),
  model: z.string().optional(),
}).strict().refine((v) => !(v.text !== undefined && v.chat_id !== undefined), {
  message: "pass either `text` or `chat_id`, not both. Omit both to use the pinned chat.",
});

export const countTokensTool = defineTool({
  name: "count_tokens",
  description: "Server-side token count using the active model's real tokenizer. Pass `text` for an arbitrary string or `chat_id` for a stored chat (omit chat_id to use the pinned chat). Optional `model` overrides the tokenizer. Returns { total_tokens, model, tokenizer_name, approximate }.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Arbitrary text to tokenize." },
      chat_id: { type: "string", description: "Chat to count. Defaults to pinned chat when neither text nor chat_id is given." },
      model: { type: "string", description: "Override the tokenizer with a specific model id." },
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
