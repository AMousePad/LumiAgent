import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/delete-character/description.txt";

const inputSchema = z.object({
  character_id: z.string().min(1),
  confirm_name: z.string().min(1),
}).strict();

export const deleteCharacterTool = defineTool({
  name: "delete_character",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      character_id: { type: "string" },
      confirm_name: { type: "string", description: "Must exactly match the card's current name. Guards against deleting the wrong id." },
    },
    required: ["character_id", "confirm_name"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    try {
      const c = await ctx.spindle.characters.get(input.character_id, ctx.userId);
      if (!c) return { content: `Error: [PATH_NOT_FOUND] character '${input.character_id}' not found`, isError: true };
      if (c.name !== input.confirm_name) {
        return { content: `Error: [INVALID_INPUT] confirm_name '${input.confirm_name}' does not match the card's name '${c.name}'. Re-check which character you are deleting.`, isError: true };
      }
      const ok = await ctx.spindle.characters.delete(input.character_id, ctx.userId);
      return { content: JSON.stringify({ deleted: ok, id: input.character_id, name: c.name, note: "Unrecoverable. Attached world books remain in the library unattached." }) };
    } catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
  },
});
