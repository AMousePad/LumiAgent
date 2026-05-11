import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const listAlternateGreetingsTool = defineTool({
  name: "list_alternate_greetings",
  description: "[LEGACY — superseded by the list tool with path char/alternate_greetings. Kept for back-compat; prefer the named successor.] Returns the character's alternate_greetings as {index, chars_in_greeting} list (no content).",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
  execute: async (_input, ctx) => {
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const items = (c.alternate_greetings ?? []).map((g, i) => ({ index: i, chars_in_greeting: g.length }));
    return { content: JSON.stringify({ count: items.length, greetings: items }, null, 2) };
  },
});
