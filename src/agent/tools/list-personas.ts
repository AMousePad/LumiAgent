import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listPersonasTool = defineTool({
  name: "list_personas",
  description: "List the user's personas (identity profiles used as the {{user}} side of chats). Returns metadata only — id, name, title, folder, is_default, attached_world_book_id, image_id, description char count. Use read_persona for a specific one's full description and metadata.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, default 200." },
      offset: { type: "number", description: "Pagination offset." },
    },
    required: [],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    try {
      const res = await ctx.spindle.personas.list({
        limit: input.limit ?? 200,
        offset: input.offset ?? 0,
        userId: ctx.userId,
      });
      const rows = res.data.map((p) => ({
        id: p.id,
        name: p.name,
        title: p.title,
        folder: p.folder,
        is_default: p.is_default,
        attached_world_book_id: p.attached_world_book_id,
        image_id: p.image_id,
        description_chars: p.description.length,
        updated_at: p.updated_at,
      }));
      return { content: JSON.stringify({ total: res.total, returned: rows.length, personas: rows }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
