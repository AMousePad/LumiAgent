import { z } from "zod";
import { defineTool } from "./_framework";
import { CHAT_ID_ARG, resolveChat } from "./_chat";
import description from "../prompts/claude/tools/chat-stats/description.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
});

export const chatStatsTool = defineTool({
  name: "chat_stats",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { chat_id: { type: "string", description: CHAT_ID_ARG } },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    const all = await ctx.spindle.chat.getMessages(chatId);
    const by_role: Record<string, number> = {};
    const by_speaker: Record<string, number> = {};
    let totalChars = 0;
    let firstTs: number | null = null;
    let lastTs: number | null = null;
    for (const m of all) {
      by_role[m.role] = (by_role[m.role] ?? 0) + 1;
      by_speaker[m.name] = (by_speaker[m.name] ?? 0) + 1;
      totalChars += m.content.length;
      const ts = (m as unknown as { send_date?: number; created_at?: number }).send_date ?? (m as unknown as { created_at?: number }).created_at;
      if (typeof ts === "number") {
        if (firstTs === null || ts < firstTs) firstTs = ts;
        if (lastTs === null || ts > lastTs) lastTs = ts;
      }
    }
    const longest = all.reduce((m, x) => Math.max(m, x.content.length), 0);
    return {
      content: JSON.stringify({
        chat_id: chatId,
        chat_name: chat.name,
        chat_source: source,
        total_messages: all.length,
        total_chars: totalChars,
        longest_message_chars: longest,
        by_role,
        by_speaker,
        first_ts: firstTs,
        last_ts: lastTs,
        hint: all.length > 200
          ? "Big chat. Use chats(action=search) to find text, chats(action=messages) to skim, chats(action=read, last=20) for the newest messages, or read with offset and limit for a range."
          : "Small enough to read end-to-end if needed.",
      }, null, 2),
    };
  },
});
