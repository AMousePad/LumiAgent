import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  chat_id: z.string().optional(),
});

function resolveChatId(input: { chat_id?: string | undefined }, ctx: ToolCtx): string | { error: string } {
  if (input.chat_id) return input.chat_id;
  if (!ctx.pinnedChatId) return { error: "No chat_id provided and no chat is pinned. Either pass chat_id or have the user pin a chat." };
  return ctx.pinnedChatId;
}

export const chatStatsTool = defineTool({
  name: "chat_stats",
  description: "ALWAYS CALL THIS FIRST when the user references a chat. Cheap orientation: returns total_messages, total_chars, longest_message_chars, by_role counts, first_ts, last_ts. Use the result to choose between read_chat_messages (small), list_chat_messages (skim), or grep_chat_messages (search). Omit chat_id to use the pinned chat.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { chat_id: { type: "string", description: "Optional. Omit to use the pinned chat." } },
    required: [],
  },
  defaultSensitivity: "insensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const resolved = resolveChatId(input, ctx);
    if (typeof resolved !== "string") return { content: `Error: ${resolved.error}`, isError: true };
    const chatId = resolved;
    const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
    if (!chat) return { content: `Error: chat ${chatId} not found`, isError: true };
    const all = await ctx.spindle.chat.getMessages(chatId);
    const by_role: Record<string, number> = {};
    let totalChars = 0;
    let firstTs: number | null = null;
    let lastTs: number | null = null;
    for (const m of all) {
      by_role[m.role] = (by_role[m.role] ?? 0) + 1;
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
        total_messages: all.length,
        total_chars: totalChars,
        longest_message_chars: longest,
        by_role,
        first_ts: firstTs,
        last_ts: lastTs,
        hint: all.length > 200
          ? "Big chat. Prefer grep_chat_messages for content search, list_chat_messages for skimming, or read_chat_messages with offset/limit for targeted ranges. read_chat_messages without offset returns only the tail by default."
          : "Small enough to read end-to-end if needed.",
      }, null, 2),
    };
  },
});
