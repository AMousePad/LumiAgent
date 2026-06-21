import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-stat/description.txt";

const inputSchema = z.object({
  path: z.string().min(1),
});

export const fsStatTool = defineTool({
  name: "fs_stat",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const node = await ws.stat(ctx.spindle, ctx.userId, input.path);
    if (!node) return { content: JSON.stringify({ path: input.path, exists: false }) };
    return { content: JSON.stringify({ exists: true, ...node }) };
  },
});
