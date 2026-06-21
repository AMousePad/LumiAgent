import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { markReadWithHash } from "./_gates";
import description from "../prompts/claude/tools/read-persona/description.txt";
import argPersonaId from "../prompts/claude/tools/read-persona/arg_persona_id.txt";
import argWhich from "../prompts/claude/tools/read-persona/arg_which.txt";

const inputSchema = z.object({
  persona_id: z.string().optional(),
  which: z.enum(["active", "default"]).optional(),
}).strict().refine((v) => !(v.persona_id !== undefined && v.which !== undefined), {
  message: "pass `persona_id` or `which`, not both. Omit both to read the default persona.",
});

export const readPersonaTool = defineTool({
  name: "read_persona",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      persona_id: { type: "string", description: argPersonaId },
      which: { type: "string", enum: ["active", "default"], description: argWhich },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    try {
      let persona: Awaited<ReturnType<typeof ctx.spindle.personas.get>>;
      if (input.persona_id) {
        persona = await ctx.spindle.personas.get(input.persona_id, ctx.userId);
      } else if (input.which === "active") {
        persona = await ctx.spindle.personas.getActive(ctx.userId);
      } else {
        persona = await ctx.spindle.personas.getDefault(ctx.userId);
      }
      if (!persona) return { content: JSON.stringify({ found: false, query: input }) };
      for (const f of ["name", "title", "description"] as const) {
        const v = (persona as unknown as Record<string, unknown>)[f];
        if (typeof v === "string") markReadWithHash(ctx, `persona/${persona.id}/${f}`, v);
      }
      const out = JSON.stringify(persona, null, 2);
      return { content: await spillOrReturn(ctx, out, `read_persona(${persona.id})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
