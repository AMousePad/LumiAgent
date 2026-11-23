import { z } from "zod";
import { defineTool } from "./_framework";
import { CHAT_ID_ARG, resolveChat } from "./_chat";
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
      chat_id: { type: "string", description: CHAT_ID_ARG },
      message_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_IDS, description: "Message ids from chats(action=messages) or chats(action=read)." },
      hidden: { type: "boolean", description: "true hides, false restores." },
    },
    required: ["message_ids", "hidden"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chatId, source } = resolved;
    const all = await ctx.spindle.chat.getMessages(chatId);
    const known = new Set(all.map((m) => m.id));
    const missing = input.message_ids.filter((id) => !known.has(id));
    if (missing.length > 0) return { content: `Error: [PATH_NOT_FOUND] ${missing.length} id(s) are not in chat ${chatId}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}. Nothing was changed. Get ids from chats(action=messages, chat_id="${chatId}").`, isError: true };
    const ids = [...new Set(input.message_ids)];
    try {
      if (ids.length === 1) await ctx.spindle.chat.setMessageHidden(chatId, ids[0]!, input.hidden);
      else await ctx.spindle.chat.setMessagesHidden(chatId, ids, input.hidden);
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true };
    }
    return { content: JSON.stringify({ chat_id: chatId, chat_source: source, hidden: input.hidden, count: ids.length, message_ids: ids, note: `Outside Workshop undo. To reverse call chats(action=hide, hidden=${!input.hidden}) with the same ids.` }, null, 2) };
  },
});
