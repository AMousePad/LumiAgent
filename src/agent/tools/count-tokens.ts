import { z } from "zod";
import { defineTool } from "./_framework";
import { applyCharacterId, resolveRead } from "./_path_v2";
import description from "../prompts/claude/tools/count-tokens/description.txt";
import argText from "../prompts/claude/tools/count-tokens/arg_text.txt";
import argChatId from "../prompts/claude/tools/count-tokens/arg_chat_id.txt";
import argModel from "../prompts/claude/tools/count-tokens/arg_model.txt";

const inputSchema = z.object({
  path: z.string().optional(),
  character_id: z.string().optional(),
  text: z.string().optional(),
  chat_id: z.string().optional(),
  model: z.string().optional(),
}).strict().refine((v) => [v.path, v.text || undefined, v.chat_id].filter((x) => x !== undefined).length <= 1, {
  message: "pass one of `path`, `text` or `chat_id`. Omit all three to use the pinned chat.",
});

export const countTokensTool = defineTool({
  name: "count_tokens",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "A readable leaf such as char/description or wb/<entryId>/content. Counts the stored text exactly, no read needed." },
      character_id: { type: "string", description: "With a char/ path: which character. Defaults to the focused one." },
      text: { type: "string", description: argText },
      chat_id: { type: "string", description: argChatId },
      model: { type: "string", description: argModel },
    },
    required: [],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute: async (input, ctx) => {
    try {
      const opts = {
        ...(input.model ? { model: input.model } : {}),
        userId: ctx.userId,
      };
      if (input.path !== undefined) {
        const leaf = await resolveRead(ctx, input.character_id ? applyCharacterId(input.path, input.character_id) : input.path);
        const r = await ctx.spindle.tokens.countText(leaf.value, opts);
        return { content: JSON.stringify({ ...r, path: leaf.key, chars: leaf.value.length }, null, 2) };
      }
      if (input.text) {
        const r = await ctx.spindle.tokens.countText(input.text, opts);
        return { content: JSON.stringify(r, null, 2) };
      }
      const chatId = input.chat_id ?? ctx.pinnedChatId;
      if (!chatId) return { content: JSON.stringify({ error: "nothing to count: pass path, text or chat_id (no chat is pinned)" }), isError: true };
      const r = await ctx.spindle.tokens.countChat(chatId, opts);
      return { content: JSON.stringify({ ...r, chat_id: chatId }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
