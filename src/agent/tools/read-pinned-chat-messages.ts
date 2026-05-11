import { z } from "zod";
import { defineTool } from "./_framework";
import { readChatMessagesImpl } from "./read-chat-messages";

const inputSchema = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const readPinnedChatMessagesTool = defineTool({
  name: "read_pinned_chat_messages",
  description: "Read messages from the user's PINNED chat for this session. The user has explicitly selected this chat via the chat-pin button. Returns messages in chronological order with role / content / send_date / per-message metadata. Use this when the user references 'this chat', 'the conversation', or asks about prompt outputs / character behavior in-context.\n\nIf no chat is pinned, this returns an empty result with a note. Tell the user to pin one via the UI.\n\nReturns up to `limit` messages from `offset` (most chats are <100 messages so the default usually fits). The active swipe is what's returned as `content`; non-active swipes are available in `swipes[]`.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      offset: { type: "number", description: "0-indexed start, default 0" },
      limit: { type: "number", description: "max messages, default 100, cap 500" },
    },
    required: [],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    if (!ctx.pinnedChatId) {
      return { content: JSON.stringify({ pinned: false, note: "No chat is pinned to this session. Tell the user to click the chat-pin button next to the character selector and choose a chat to give you message context." }) };
    }
    return readChatMessagesImpl(ctx, ctx.pinnedChatId, input.offset, input.limit);
  },
});
