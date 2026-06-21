import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/read-persona-world-book/description.txt";
import argPersonaId from "../prompts/claude/tools/read-persona-world-book/arg_persona_id.txt";

const inputSchema = z.object({
  persona_id: z.string().min(1),
}).strict();

export const readPersonaWorldBookTool = defineTool({
  name: "read_persona_world_book",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      persona_id: { type: "string", description: argPersonaId },
    },
    required: ["persona_id"],
  },
  execute: async (input, ctx) => {
    try {
      const wb = await ctx.spindle.personas.getWorldBook(input.persona_id, ctx.userId);
      if (!wb) return { content: JSON.stringify({ persona_id: input.persona_id, attached_world_book: null }) };
      return { content: JSON.stringify({ persona_id: input.persona_id, attached_world_book: wb }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
