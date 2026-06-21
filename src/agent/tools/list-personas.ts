import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-personas/description.txt";
import argLimit from "../prompts/claude/tools/list-personas/arg_limit.txt";
import argOffset from "../prompts/claude/tools/list-personas/arg_offset.txt";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listPersonasTool = defineTool({
  name: "list_personas",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: argLimit },
      offset: { type: "number", description: argOffset },
    },
    required: [],
  },
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
