import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-copy/description.txt";

const inputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  recursive: z.boolean().optional(),
});

export const fsCopyTool = defineTool({
  name: "fs_copy",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source workspace path." },
      to: { type: "string", description: "Exact destination path, which must not exist." },
      recursive: { type: "boolean", description: "Required for copying a directory. Defaults to false." },
    },
    required: ["from", "to"],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
    const result = await ws.copyPath(ctx.spindle, ctx.userId, input.from, input.to, {
      recursive: input.recursive ?? false,
      caps,
      signal: ctx.signal,
    });
    return { content: JSON.stringify(result) };
  },
});
