import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  path: z.string().optional(),
});

export const fsListTool = defineTool({
  name: "fs_list",
  description: "List entries in the agent's workspace at a given directory. Pass an empty path for the root. Returns [{name, path, isDirectory, sizeBytes, modifiedAt}]. The workspace persists across sessions and is shared with the user via the Files tab in the Workshop.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to workspace root. Empty/omit for root." },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const path = input.path ?? "";
    const entries = await ws.listDir(ctx.spindle, ctx.userId, path);
    const payload = JSON.stringify({ path: ws.normaliseRelPath(path), count: entries.length, entries }, null, 2);
    const out = await spillOrReturn(ctx, payload, `fs_list:${path || "/"}`);
    return { content: out };
  },
});
