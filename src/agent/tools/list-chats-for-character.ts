import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import { groupCharacterIds, isGroupChat, listChatsForCharacter } from "../../state/chat-catalog";
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
    const chats = await listChatsForCharacter(ctx.spindle, ctx.userId, target);
    const rows = chats.map((c) => ({
      id: c.id,
      name: c.name,
      is_group: isGroupChat(c),
      character_ids: isGroupChat(c) ? groupCharacterIds(c) : [c.character_id],
      updated_at: c.updated_at,
      created_at: c.created_at,
      is_active: active?.id === c.id,
      is_pinned: ctx.pinnedChatId === c.id,
    }));
    return { content: JSON.stringify({ total: rows.length, returned: rows.length, pinned_chat_id: ctx.pinnedChatId, chats: rows }, null, 2) };
  },
});
