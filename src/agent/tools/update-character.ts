import { z } from "zod";
import { defineTool } from "./_framework";
import type { CharacterUpdateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
});

export const updateCharacterTool = defineTool({
  name: "update_character",
  description: "Wholesale-replace one or more character fields. Pass only the fields to change in `patch`. For long fields prefer edit_character_field.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { patch: { type: "object", additionalProperties: true } },
    required: ["patch"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const patch = input.patch as CharacterUpdateDTO;
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const updated = await ctx.spindle.characters.update(ctx.characterId, patch, ctx.userId);
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      const before = (c as unknown as Record<string, unknown>)[k];
      if (typeof before !== "string") continue;
      if (before === v) continue;
      ctx.pushEdit({ op: "edit", surface: "character_field", surfaceId: ctx.characterId, surfaceLabel: c.name, field: k, before, after: v });
    }
    return { content: `OK. Updated character ${updated.id} fields: ${Object.keys(patch).join(", ")}` };
  },
});
