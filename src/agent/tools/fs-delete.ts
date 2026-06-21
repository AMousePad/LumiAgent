import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-delete/description.txt";

const inputSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
});

export const fsDeleteTool = defineTool({
  name: "fs_delete",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      recursive: { type: "boolean" },
    },
    required: ["path"],
  },
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
