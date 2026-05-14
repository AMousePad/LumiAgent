import { z } from "zod";
import { defineTool } from "./_framework";
import { wbLabel } from "./_surfaces";

const inputSchema = z.object({
  entry_id: z.string().min(1),
});

export const deleteWorldBookEntryTool = defineTool({
  name: "delete_world_book_entry",
  description: "Delete a world book entry by id. The entry's full state is captured in the edit log so it can be restored via revert.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { entry_id: { type: "string" } },
    required: ["entry_id"],
  },
  defaultSensitivity: "insensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const id = input.entry_id;
    const before = await ctx.spindle.world_books.entries.get(id, ctx.userId);
    if (!before) return { content: `Error: world book entry ${id} not found`, isError: true };
    const label = wbLabel(before);
    await ctx.spindle.world_books.entries.delete(id, ctx.userId);
    ctx.pushEdit({ op: "delete", surface: "world_book_entry", surfaceId: id, surfaceLabel: label, snapshot: before });
    return { content: JSON.stringify({ entry_id: id, deleted: true, can_revert: true }) };
  },
});
