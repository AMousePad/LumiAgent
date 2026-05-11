import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import type { ToolCtx } from "./_context";
import type { ToolResult } from "./_framework";

const CHAT_MESSAGES_DEFAULT_LIMIT = 100;
const CHAT_MESSAGES_MAX_LIMIT = 500;
const CHAT_MESSAGE_PREVIEW_CHARS = 1200;

export async function readChatMessagesImpl(
  ctx: ToolCtx,
  chatId: string,
  offsetIn: number | undefined,
  limitIn: number | undefined,
): Promise<ToolResult> {
  const offset = Math.max(0, Math.floor(offsetIn ?? 0));
  const limit = Math.min(CHAT_MESSAGES_MAX_LIMIT, Math.max(1, Math.floor(limitIn ?? CHAT_MESSAGES_DEFAULT_LIMIT)));
  const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
  if (!chat) return { content: `Error: chat ${chatId} not found`, isError: true };
  const all = await ctx.spindle.chat.getMessages(chatId);
  const slice = all.slice(offset, offset + limit);
  const messages = slice.map((m, i) => {
    const content = m.content.length > CHAT_MESSAGE_PREVIEW_CHARS
      ? `${m.content.slice(0, CHAT_MESSAGE_PREVIEW_CHARS)} […${m.content.length - CHAT_MESSAGE_PREVIEW_CHARS} more chars…]`
      : m.content;
    return {
      idx: offset + i,
      id: m.id,
      role: m.role,
      content,
      swipe_count: m.swipes.length,
      active_swipe: m.swipe_id,
    };
  });
  const payload = JSON.stringify({
    chat_id: chatId,
    chat_name: chat.name,
    total: all.length,
    offset,
    returned: messages.length,
    truncated_per_message: CHAT_MESSAGE_PREVIEW_CHARS,
    messages,
  }, null, 2);
  const out = await spillOrReturn(ctx, payload, `read_chat_messages:${chatId}`, "If you only need a few specific messages, narrow the offset/limit. For search, use grep_chat_messages instead.");
  return { content: out };
}

const inputSchema = z.object({
  chat_id: z.string().min(1),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const readChatMessagesTool = defineTool({
  name: "read_chat_messages",
  description: "Read messages from a SPECIFIC chat by id. Prefer `read_pinned_chat_messages` for the pinned chat. Use this when you've discovered another chat via `list_chats_for_character` and the user has authorised reading it.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
    required: ["chat_id"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => readChatMessagesImpl(ctx, input.chat_id, input.offset, input.limit),
});
