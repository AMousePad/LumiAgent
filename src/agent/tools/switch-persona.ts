import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/switch-persona/description.txt";
import argPersonaId from "../prompts/claude/tools/switch-persona/arg_persona_id.txt";

const inputSchema = z.object({
  persona_id: z.string().min(1),
}).strict();

export const switchPersonaTool = defineTool({
  name: "switch_persona",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      persona_id: { type: "string", description: argPersonaId },
    },
    required: ["persona_id"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const deactivate = input.persona_id === "none";
    const before = await ctx.spindle.personas.getActive(ctx.userId);

    if (!deactivate) {
      const target = await ctx.spindle.personas.get(input.persona_id, ctx.userId).catch(() => null);
      if (!target) {
        return { content: `Error: [PATH_NOT_FOUND] persona '${input.persona_id}' not found. Use \`list_personas\` to enumerate ids.`, isError: true };
      }
    }

    try { await ctx.spindle.personas.switchActive(deactivate ? null : input.persona_id, ctx.userId); }
    catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }

    const after = await ctx.spindle.personas.getActive(ctx.userId);
    if (before?.id !== after?.id) ctx.pushEdit({ op: "edit", surface: "active_persona", surfaceId: "active", surfaceLabel: "Active persona", field: "persona", before: JSON.stringify(before?.id ?? null), after: JSON.stringify(after?.id ?? null), valueEncoding: "json", scope: { kind: "settings", id: "active-persona" } });
    return {
      content: JSON.stringify({
        previous: before ? { id: before.id, name: before.name } : null,
        active: after ? { id: after.id, name: after.name } : null,
      }, null, 2),
    };
  },
});
