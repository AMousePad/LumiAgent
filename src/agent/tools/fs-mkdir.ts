import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  path: z.string().min(1),
});

export const fsMkdirTool = defineTool({
  name: "fs_mkdir",
  description: "Create an empty directory in the workspace. Intermediate directories are created automatically by fs_write, so use this only when you need an empty folder.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    await ws.makeDir(ctx.spindle, ctx.userId, input.path);
    return { content: JSON.stringify({ path: input.path, created: true }) };
  },
});
