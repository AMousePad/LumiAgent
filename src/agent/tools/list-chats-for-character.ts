import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const listChatsForCharacterTool = defineTool({
  name: "list_chats_for_character",
  description: "List all of the user's chat sessions for the active character. Returns id, name, updated_at, message_count, is_active (whether the host is currently showing this chat). Use this to discover what chats exist before reading messages, or to suggest one for the user to pin.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  requiresCharacter: true,
  execute: async (_input, ctx) => {
    let active: { id: string } | null = null;
    try { active = await ctx.spindle.chats.getActive(ctx.userId) ?? null; } catch { /* permission may not be granted */ }
    const res = await ctx.spindle.chats.list({ characterId: ctx.characterId, userId: ctx.userId, limit: 200 });
    const rows = res.data.map((c) => ({
      id: c.id,
      name: c.name,
      updated_at: c.updated_at,
      created_at: c.created_at,
      is_active: active?.id === c.id,
      is_pinned: ctx.pinnedChatId === c.id,
    }));
    rows.sort((a, b) => b.updated_at - a.updated_at);
    return { content: JSON.stringify({ total: res.total, returned: rows.length, pinned_chat_id: ctx.pinnedChatId, chats: rows }, null, 2) };
  },
});
