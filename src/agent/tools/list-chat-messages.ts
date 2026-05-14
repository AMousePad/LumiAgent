import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const CHAT_LIST_SNIPPET_CHARS = 80;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const listChatMessagesTool = defineTool({
  name: "list_chat_messages",
  description: "Skim a chat's messages as metadata only: idx, id, role, char count, and an 80-char snippet per message. Cheap on tokens. Use for picking which specific messages to read in full afterwards. Omit chat_id to use the pinned chat.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Optional. Omit to use the pinned chat." },
      offset: { type: "number", description: "0-indexed start, default 0" },
      limit: { type: "number", description: "Default 200, cap 2000" },
    },
    required: [],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    let chatId = input.chat_id;
    if (!chatId) {
      if (!ctx.pinnedChatId) return { content: "Error: No chat_id provided and no chat is pinned. Either pass chat_id or have the user pin a chat.", isError: true };
      chatId = ctx.pinnedChatId;
    }
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.min(2000, Math.max(1, Math.floor(input.limit ?? 200)));
    const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
    if (!chat) return { content: `Error: chat ${chatId} not found`, isError: true };
    const all = await ctx.spindle.chat.getMessages(chatId);
    const slice = all.slice(offset, offset + limit);
    const entries = slice.map((m, i) => ({
      idx: offset + i,
      id: m.id,
      role: m.role,
      chars: m.content.length,
      snippet: m.content.length > CHAT_LIST_SNIPPET_CHARS
        ? m.content.slice(0, CHAT_LIST_SNIPPET_CHARS - 1) + "…"
        : m.content,
    }));
    const payload = JSON.stringify({
      chat_id: chatId,
      chat_name: chat.name,
      total: all.length,
      offset,
      returned: entries.length,
      entries,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `list_chat_messages:${chatId}`);
    return { content: out };
  },
});
