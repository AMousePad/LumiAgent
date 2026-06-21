import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-move/description.txt";

const inputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const fsMoveTool = defineTool({
  name: "fs_move",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      to: { type: "string" },
    },
    required: ["from", "to"],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    await ws.movePath(ctx.spindle, ctx.userId, input.from, input.to);
    return { content: JSON.stringify({ from: input.from, to: input.to, moved: true }) };
  },
});
