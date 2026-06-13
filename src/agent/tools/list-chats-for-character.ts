import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";

const inputSchema = z.object({
  character_id: z.string().optional().describe("Character whose chats to list."),
}).strict();

export const listChatsForCharacterTool = defineTool({
  name: "list_chats_for_character",
  description: "List all of a character's chat sessions. Returns id, name, updated_at, message_count, is_active (whether the host is currently showing this chat). Use this to discover what chats exist before reading messages, or to suggest one for the user to pin.",
  inputSchema,
  jsonSchema: { type: "object", properties: { character_id: { type: "string" } }, required: [] },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let target: string;
    try { target = resolveCharacterTarget(ctx, input.character_id); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    let active: { id: string } | null = null;
    try { active = await ctx.spindle.chats.getActive(ctx.userId) ?? null; } catch { /* permission may not be granted */ }
    const res = await ctx.spindle.chats.list({ characterId: target, userId: ctx.userId, limit: 200 });
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
