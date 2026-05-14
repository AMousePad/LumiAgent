import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  persona_id: z.string().min(1),
}).strict();

export const readPersonaWorldBookTool = defineTool({
  name: "read_persona_world_book",
  description: `Reads the world book attached to a persona (metadata only, not entries).

Usage:
- Personas can carry their own world book separate from the character's.
- Use \`list({path: "wb/<id>"})\` on the returned id to enumerate entries.
- Returns null if the persona has no attached WB.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      persona_id: { type: "string", description: "Persona id." },
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
