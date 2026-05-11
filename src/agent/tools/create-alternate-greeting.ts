import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  content: z.string(),
  index: z.number().optional(),
});

export const createAlternateGreetingTool = defineTool({
  name: "create_alternate_greeting",
  description: "Append a new alternate greeting to the character's alternate_greetings array, OR insert at a specific index. Returns the new index. Revert removes the inserted greeting.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "the greeting prose" },
      index: { type: "number", description: "optional 0-based insert position. Omit to append to the end." },
    },
    required: ["content"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const content = input.content;
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const arr = [...(c.alternate_greetings ?? [])];
    const requested = input.index;
    const insertAt = requested === undefined ? arr.length : Math.max(0, Math.min(arr.length, Math.floor(requested)));
    arr.splice(insertAt, 0, content);
    await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
    ctx.pushEdit({
      op: "create",
      surface: "alternate_greeting",
      surfaceId: String(insertAt),
      surfaceLabel: `alternate_greetings[${insertAt}]`,
      snapshot: { greeting: content },
    });
    return { content: JSON.stringify({ index: insertAt, total: arr.length, chars_in_greeting: content.length }) };
  },
});
