import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  path: z.string().optional(),
});

export const fsListTool = defineTool({
  name: "fs_list",
  description: "List entries in the workspace at a given directory. Pass an empty path for the root. Returns [{name, path, isDirectory, sizeBytes, modifiedAt}].",
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
    const norm = ws.normaliseRelPath(path);
    const entries = await ws.listDir(ctx.spindle, ctx.userId, path);
    // listDir returns [] for an empty dir AND a missing one. Stat to tell them apart.
    if (entries.length === 0 && norm !== "") {
      const node = await ws.stat(ctx.spindle, ctx.userId, path);
      if (node === null) {
        const hint = norm.startsWith("workspace/") ? " Paths are relative to the workspace root, drop the 'workspace/' prefix." : "";
        return { content: `[PATH_NOT_FOUND] No directory '${norm}'.${hint}`, isError: true };
      }
      if (!node.isDirectory) return { content: `[PATH_NOT_FOUND] '${norm}' is a file, use fs_read.`, isError: true };
    }
    const payload = JSON.stringify({ path: norm, count: entries.length, entries }, null, 2);
    const out = await spillOrReturn(ctx, payload, `fs_list:${path || "/"}`);
    return { content: out };
  },
});
