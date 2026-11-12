import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/hide-chat-messages/description.txt";

const MAX_IDS = 500;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  message_ids: z.array(z.string().min(1)).min(1).max(MAX_IDS),
  hidden: z.boolean(),
}).strict();

export const hideChatMessagesTool = defineTool({
  name: "hide_chat_messages",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Defaults to the pinned chat." },
      message_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_IDS, description: "Message ids from chats(action=messages)." },
      hidden: { type: "boolean", description: "true hides, false restores." },
    },
    required: ["message_ids", "hidden"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = input.chat_id && input.chat_id !== "pinned" ? input.chat_id : ctx.pinnedChatId;
    if (!chatId) return { content: "Error: [NO_TARGET] No chat_id provided and no chat is pinned. Either pass chat_id or have the user pin a chat.", isError: true };
    const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
    if (!chat) return { content: `Error: chat ${chatId} not found`, isError: true };
    const all = await ctx.spindle.chat.getMessages(chatId);
    const known = new Set(all.map((m) => m.id));
    const missing = input.message_ids.filter((id) => !known.has(id));
    if (missing.length > 0) return { content: `Error: [INVALID_INPUT] ${missing.length} id(s) are not in chat ${chatId}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}`, isError: true };
    const ids = [...new Set(input.message_ids)];
    try {
      if (ids.length === 1) await ctx.spindle.chat.setMessageHidden(chatId, ids[0]!, input.hidden);
      else await ctx.spindle.chat.setMessagesHidden(chatId, ids, input.hidden);
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true };
    }
    return { content: JSON.stringify({ chat_id: chatId, hidden: input.hidden, count: ids.length, message_ids: ids }, null, 2) };
  },
});
