import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  index: z.number(),
});

export const deleteAlternateGreetingTool = defineTool({
  name: "delete_alternate_greeting",
  description: "Delete the alternate greeting at the given 0-based index. The greeting's content is captured in the edit log; revert re-inserts it at the same position.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { index: { type: "number" } },
    required: ["index"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const arr = [...(c.alternate_greetings ?? [])];
    const idx = Math.floor(input.index);
    if (idx < 0 || idx >= arr.length) return { content: `Error: index ${idx} out of range (0..${arr.length - 1})`, isError: true };
    const removed = arr[idx] ?? "";
    arr.splice(idx, 1);
    await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
    ctx.pushEdit({
      op: "delete",
      surface: "alternate_greeting",
      surfaceId: String(idx),
      surfaceLabel: `alternate_greetings[${idx}]`,
      snapshot: { greeting: removed, index: idx },
    });
    return { content: JSON.stringify({ index: idx, deleted: true, chars_removed: removed.length }) };
  },
});
