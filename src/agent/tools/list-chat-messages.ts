import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { CHAT_ID_ARG, messageWindow, preview, resolveChat, windowNote } from "./_chat";
import description from "../prompts/claude/tools/list-chat-messages/description.txt";

const CHAT_LIST_SNIPPET_CHARS = 80;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  last: z.number().optional(),
});

export const listChatMessagesTool = defineTool({
  name: "list_chat_messages",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      offset: { type: "number", description: "Start index, oldest is 0. Negative counts from the end: -5 starts at the 5th newest." },
      limit: { type: "number", description: `Max messages. Default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}.` },
      last: { type: "number", description: "Return the newest N messages. Overrides offset and limit." },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    const all = await ctx.spindle.chat.getMessages(chatId);
    const { start, end } = messageWindow(all.length, input, DEFAULT_LIMIT, MAX_LIMIT);
    const entries = all.slice(start, end).map((m, i) => ({
      idx: start + i,
      id: m.id,
      role: m.role,
      speaker_name: m.name,
      ...((m as { hidden?: boolean }).hidden ? { hidden: true } : {}),
      chars: m.content.length,
      snippet: preview(m.content, CHAT_LIST_SNIPPET_CHARS),
    }));
    const note = windowNote("messages", all.length, start, end);
    const payload = JSON.stringify({
      chat_id: chatId,
      chat_name: chat.name,
      chat_source: source,
      total: all.length,
      offset: start,
      returned: entries.length,
      ...(note ? { note } : {}),
      entries,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `list_chat_messages:${chatId}`);
    return { content: out };
  },
});
