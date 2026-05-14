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
  chat_id: z.string().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const readChatMessagesTool = defineTool({
  name: "read_chat_messages",
  description: `Reads messages from a chat by id, or from the pinned chat if no id is given.

Usage:
- Omit \`chat_id\` (or pass \`"pinned"\`) to read the user's pinned chat. The pin is set via the chat-pin button next to the character selector.
- Pass an explicit chat id from \`list_chats_for_character\` to read a non-pinned chat.
- Returns messages in chronological order with role / content / send_date / swipe metadata. Active swipe is the \`content\` field; other swipes live on \`swipes[]\`.
- Default limit 100, cap 500. Most chats fit in one call.
- If \`chat_id\` is "pinned" but no chat is pinned, returns \`{pinned: false, note}\` and the agent should ask the user to pin one.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat id, or 'pinned' / omitted for the pinned chat" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
    required: [],
  },
  defaultSensitivity: "sensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const requested = input.chat_id;
    if (requested === undefined || requested === "pinned") {
      if (!ctx.pinnedChatId) {
        return { content: JSON.stringify({ pinned: false, note: "No chat is pinned to this session. Tell the user to click the chat-pin button next to the character selector and choose a chat to give you message context." }) };
      }
      return readChatMessagesImpl(ctx, ctx.pinnedChatId, input.offset, input.limit);
    }
    return readChatMessagesImpl(ctx, requested, input.offset, input.limit);
  },
});
