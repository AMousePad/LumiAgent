import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import { groupCharacterIds, isGroupChat, listChatsForCharacter } from "../../state/chat-catalog";
import description from "../prompts/claude/tools/list-chats-for-character/description.txt";

const MESSAGE_COUNT_LIMIT = 60;

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
    // Without counts the model calls chat stats once per chat just to size them.
    const counts = new Map<string, number>();
    const countable = [...chats].sort((a, b) => b.updated_at - a.updated_at).slice(0, MESSAGE_COUNT_LIMIT);
    for (let i = 0; i < countable.length; i += 5) {
      await Promise.all(countable.slice(i, i + 5).map(async (c) => {
        try { counts.set(c.id, (await ctx.spindle.chat.getMessages(c.id, { light: true, includeExtra: false, ownMetadataOnly: true })).length); }
        catch { /* leave uncounted */ }
      }));
    }
    const rows = chats.map((c) => ({
      id: c.id,
      name: c.name,
      ...(counts.has(c.id) ? { message_count: counts.get(c.id) } : {}),
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
