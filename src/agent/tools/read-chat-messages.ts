import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { markReadWithHash } from "./_gates";
import { CHAT_ID_ARG, messagePath, messageWindow, resolveChat, windowNote } from "./_chat";
import { groupCharacterIds, isGroupChat } from "../../state/chat-catalog";
import description from "../prompts/claude/tools/read-chat-messages/description.txt";

const CHAT_MESSAGES_DEFAULT_LIMIT = 100;
const CHAT_MESSAGES_MAX_LIMIT = 500;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  last: z.number().optional(),
});

function outcomeOf(extra: unknown): { finish_reason?: string; generation_error?: string } {
  const outcome = (extra as { generationOutcome?: unknown } | undefined)?.generationOutcome;
  if (!outcome || typeof outcome !== "object") return {};
  const o = outcome as { finish_reason?: unknown; error?: unknown };
  return {
    ...(typeof o.finish_reason === "string" && o.finish_reason ? { finish_reason: o.finish_reason } : {}),
    ...(typeof o.error === "string" && o.error ? { generation_error: o.error } : {}),
  };
}

export const readChatMessagesTool = defineTool({
  name: "read_chat_messages",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      offset: { type: "number", description: "Start index, oldest is 0. Negative counts from the end: -5 starts at the 5th newest." },
      limit: { type: "number", description: `Max messages. Default ${CHAT_MESSAGES_DEFAULT_LIMIT}, cap ${CHAT_MESSAGES_MAX_LIMIT}.` },
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
    const { start, end } = messageWindow(all.length, input, CHAT_MESSAGES_DEFAULT_LIMIT, CHAT_MESSAGES_MAX_LIMIT);
    const messages = all.slice(start, end).map((m, i) => {
      const path = messagePath(chatId, m.id);
      // Every row is the full active swipe, so it satisfies the edit gate without a second read.
      markReadWithHash(ctx, path, m.content);
      return {
        idx: start + i,
        id: m.id,
        path,
        role: m.role,
        speaker_name: m.name,
        ...((m as { hidden?: boolean }).hidden ? { hidden: true } : {}),
        content: m.content,
        swipe_count: m.swipes.length,
        active_swipe: m.swipe_id,
        ...outcomeOf(m.extra),
      };
    });
    const note = windowNote("read", all.length, start, end);
    const payload = JSON.stringify({
      chat_id: chatId,
      chat_name: chat.name,
      chat_source: source,
      is_group: isGroupChat(chat),
      character_ids: isGroupChat(chat) ? groupCharacterIds(chat) : [chat.character_id],
      total: all.length,
      offset: start,
      returned: messages.length,
      ...(note ? { note } : {}),
      edit_hint: "Each row was read in full: edit or rewrite its path directly, no extra read needed.",
      messages,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `read_chat_messages:${chatId}`, "For only the newest messages re-call with last=3. To find text use chats(action=search).");
    return { content: out };
  },
});
