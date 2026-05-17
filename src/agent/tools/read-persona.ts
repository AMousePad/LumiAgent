import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { markReadWithHash } from "./_gates";

const inputSchema = z.object({
  persona_id: z.string().optional(),
  which: z.enum(["active", "default"]).optional(),
}).strict().refine((v) => (v.persona_id !== undefined) !== (v.which !== undefined), {
  message: "exactly one of `persona_id` or `which` is required",
});

export const readPersonaTool = defineTool({
  name: "read_persona",
  description: "Read a single persona's full content. Pass `persona_id` for a specific one, or `which: 'active'` for the currently-selected persona / `which: 'default'` for the user's default. Returns full description plus all metadata. The persona's description text gets injected into the prompt as {{user}} / {{persona}}. Records the persona's name / title / description as recently read so a subsequent `edit` / `rewrite` on `persona/<id>/<field>` passes the read-gate.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      persona_id: { type: "string", description: "Specific persona id." },
      which: { type: "string", enum: ["active", "default"], description: "Look up by role instead of id." },
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
