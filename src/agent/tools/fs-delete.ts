import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
});

export const fsDeleteTool = defineTool({
  name: "fs_delete",
  description: "Delete a workspace file or directory. Directories must be empty unless recursive=true.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      recursive: { type: "boolean" },
    },
    required: ["path"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const recursive = input.recursive ?? false;
    const node = await ws.stat(ctx.spindle, ctx.userId, input.path);
    if (!node) throw new Error(`workspace path '${input.path}' not found`);
    if (node.isDirectory && !recursive) {
      const kids = await ws.listDir(ctx.spindle, ctx.userId, input.path);
      if (kids.length > 0) throw new Error(`directory '${input.path}' is not empty, pass recursive=true to delete`);
    }
    await ws.remove(ctx.spindle, ctx.userId, input.path);
    return { content: JSON.stringify({ path: input.path, deleted: true }) };
  },
});
