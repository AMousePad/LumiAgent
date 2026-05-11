import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markRead } from "./_gates";
import { CHARACTER_STRING_FIELDS, isCharacterStringField } from "./_surfaces";

const inputSchema = z.object({
  field: z.enum(CHARACTER_STRING_FIELDS as unknown as [string, ...string[]]),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const readCharacterFieldTool = defineTool({
  name: "read_character_field",
  description: `[LEGACY — superseded by the read tool with path char/<field>. Kept for back-compat; prefer the named successor.] Read one string field of the character with line numbers and pagination. Valid fields: ${CHARACTER_STRING_FIELDS.join(", ")}.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      field: { type: "string", enum: [...CHARACTER_STRING_FIELDS] },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["field"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    if (!isCharacterStringField(input.field)) return { content: `Error: unknown field '${input.field}'`, isError: true };
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const text = (c as unknown as Record<string, unknown>)[input.field];
    if (typeof text !== "string") return { content: `Error: field '${input.field}' is not a string`, isError: true };
    const body = formatLineSlice(text, `character.${input.field}`, input.offset, input.limit);
    markRead(ctx, `character_field:${input.field}`);
    const out = await spillOrReturn(ctx, body, `read_character_field:${input.field}`, "If the field is huge, try character_field_stats first or narrow with offset/limit.");
    return { content: out };
  },
});
