import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-mkdir/description.txt";

const inputSchema = z.object({
  path: z.string().min(1),
});

export const fsMkdirTool = defineTool({
  name: "fs_mkdir",
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
    await ws.makeDir(ctx.spindle, ctx.userId, input.path);
    return { content: JSON.stringify({ path: input.path, created: true }) };
  },
});
