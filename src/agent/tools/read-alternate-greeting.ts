import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markRead } from "./_gates";

const inputSchema = z.object({
  index: z.number().int().nonnegative().describe("0-indexed position in alternate_greetings"),
  offset: z.number().int().positive().optional().describe("1-indexed line to start from (default 1)"),
  limit: z.number().int().positive().optional().describe("Max lines to return (default 800)"),
});

export const readAlternateGreetingTool = defineTool({
  name: "read_alternate_greeting",
  description: "[LEGACY — superseded by the read tool with path char/alternate_greetings/<idx>. Kept for back-compat; prefer the named successor.] Read one alternate_greetings entry by 0-indexed position, with line numbers.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0, description: "0-indexed position in alternate_greetings" },
      offset: { type: "integer", minimum: 1, description: "1-indexed line to start from (default 1)" },
      limit: { type: "integer", minimum: 1, description: "Max lines to return (default 800)" },
    },
    required: ["index"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const arr = c.alternate_greetings ?? [];
    if (input.index >= arr.length) {
      return { content: `Error: index ${input.index} out of range (0..${arr.length - 1})`, isError: true };
    }
    const text = arr[input.index] ?? "";
    const label = `character.alternate_greetings[${input.index}]`;
    const body = formatLineSlice(text, label, input.offset, input.limit);
    markRead(ctx, `alternate_greeting:${input.index}`);
    const out = await spillOrReturn(ctx, body, `read_alternate_greeting:${input.index}`);
    return { content: out };
  },
});
