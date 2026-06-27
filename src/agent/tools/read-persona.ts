import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
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
      const out = JSON.stringify({ ...persona, resolved_addons: await resolvePersonaAddons(ctx, persona) }, null, 2);
      return { content: await spillOrReturn(ctx, out, `read_persona(${persona.id})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});

// Persona-scoped add-ons live inline in metadata.addons; global add-ons are
// referenced by id in metadata.attached_global_addons and resolved here to their
// content so the agent can see and edit it (global_addon/<id>/content).
async function resolvePersonaAddons(ctx: ToolCtx, persona: { id: string; metadata: Record<string, unknown> }) {
  const meta = (persona.metadata && typeof persona.metadata === "object") ? persona.metadata as Record<string, any> : {};
  const personaScoped = (Array.isArray(meta.addons) ? meta.addons : [])
    .filter((a: any) => a && typeof a === "object")
    .map((a: any) => ({ scope: "persona", path: `persona/${persona.id}/addon/${a.id}/content`, id: a.id, label: a.label ?? "", enabled: a.enabled !== false, content: typeof a.content === "string" ? a.content : "" }));
  const refs = (Array.isArray(meta.attached_global_addons) ? meta.attached_global_addons : [])
    .map((r: any) => (typeof r === "string" ? r : r?.id))
    .filter((id: unknown): id is string => typeof id === "string");
  const global: Array<Record<string, unknown>> = [];
  for (const id of refs) {
    const a = await ctx.spindle.global_addons.get(id, ctx.userId).catch(() => null);
    if (a) global.push({ scope: "global", path: `global_addon/${a.id}/content`, id: a.id, label: a.label, content: a.content });
    else global.push({ scope: "global", id, missing: true });
  }
  return { persona_scoped: personaScoped, global };
}
