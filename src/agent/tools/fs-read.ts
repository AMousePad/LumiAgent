import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markRead } from "./_gates";

const inputSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const fsReadTool = defineTool({
  name: "fs_read",
  description: "Read a workspace text file with line numbers and pagination.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const node = await ws.stat(ctx.spindle, ctx.userId, input.path);
    if (!node) return { content: `Error: workspace path '${input.path}' not found`, isError: true };
    if (node.isDirectory) return { content: `Error: workspace path '${input.path}' is a directory; use fs_list instead`, isError: true };
    const text = await ws.readText(ctx.spindle, ctx.userId, input.path);
    const sliced = formatLineSlice(text, `workspace:${input.path}`, input.offset, input.limit);
    markRead(ctx, `fs:${input.path}`);
    const out = await spillOrReturn(ctx, sliced, `fs_read:${input.path}`);
    return { content: out };
  },
});
