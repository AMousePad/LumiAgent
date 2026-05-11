import { z } from "zod";
import { defineTool } from "./_framework";
import { CHARACTER_STRING_FIELDS, isCharacterStringField } from "./_surfaces";

const inputSchema = z.object({
  field: z.enum(CHARACTER_STRING_FIELDS as unknown as [string, ...string[]]),
});

export const characterFieldStatsTool = defineTool({
  name: "character_field_stats",
  description: "[LEGACY — superseded by the inspect tool with path char/<field>. Kept for back-compat; prefer the named successor.] Cheap orientation for one of the character's string fields. Returns char count, line count, and a 200-char peek. Call this before read_character_field if you suspect the field is large.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { field: { type: "string", enum: [...CHARACTER_STRING_FIELDS] } },
    required: ["field"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    if (!isCharacterStringField(input.field)) return { content: `Error: unknown field '${input.field}'`, isError: true };
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const text = (c as unknown as Record<string, unknown>)[input.field];
    if (typeof text !== "string") return { content: `Error: field '${input.field}' is not a string`, isError: true };
    return {
      content: JSON.stringify({
        field: input.field,
        chars: text.length,
        lines: text === "" ? 0 : text.split("\n").length,
        peek: text.slice(0, 200),
      }, null, 2),
    };
  },
});
