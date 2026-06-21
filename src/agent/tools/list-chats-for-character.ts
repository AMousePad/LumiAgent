import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import description from "../prompts/claude/tools/list-chats-for-character/description.txt";

const inputSchema = z.object({
  character_id: z.string().optional().describe("Character whose chats to list."),
}).strict();

export const listChatsForCharacterTool = defineTool({
  name: "list_chats_for_character",
  description,
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
