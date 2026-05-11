import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const listWorldBooksTool = defineTool({
  name: "list_world_books",
  description: "[LEGACY — superseded by the list tool with path wb. Kept for back-compat; prefer the named successor.] List ALL of the user's world books (not just ones attached to this character). Returns id, name, description, char count. Use this when adding a new world_book_entry to choose which book it goes into; the character's attached world_book_ids are returned separately so you know which are in-scope for this character.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
  execute: async (_input, ctx) => {
    const all = await ctx.spindle.world_books.list({ limit: 1000, userId: ctx.userId });
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    const attached = new Set(c?.world_book_ids ?? []);
    const rows = all.data.map((wb) => ({
      id: wb.id,
      name: wb.name,
      description: wb.description.slice(0, 200),
      attached_to_active_character: attached.has(wb.id),
    }));
    return { content: JSON.stringify({ total: all.total, attached_count: attached.size, world_books: rows }, null, 2) };
  },
});
