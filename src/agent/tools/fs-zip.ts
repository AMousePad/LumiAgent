import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-zip/description.txt";
import argPaths from "../prompts/claude/tools/fs-zip/arg_paths.txt";
import argOutput from "../prompts/claude/tools/fs-zip/arg_output.txt";

const inputSchema = z.object({
  paths: z.array(z.string()).min(1),
  output: z.string().min(1),
});

export const fsZipTool = defineTool({
  name: "fs_zip",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: argPaths },
      output: { type: "string", description: argOutput },
    },
    required: ["paths", "output"],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const { buildZip } = await import("../../state/zip");
    if (input.paths.length === 0) throw new Error("'paths' must be a non-empty string array");
    type Entry = { path: string; bytes: Uint8Array };
    const entries: Entry[] = [];
    const seen = new Set<string>();
    for (const p of input.paths) {
      const node = await ws.stat(ctx.spindle, ctx.userId, p);
      if (!node) throw new Error(`workspace path '${p}' not found`);
      if (node.isDirectory) {
        const files = await ws.walk(ctx.spindle, ctx.userId, p);
        for (const f of files) {
          if (seen.has(f.path)) continue;
          seen.add(f.path);
          const bytes = await ws.readBinary(ctx.spindle, ctx.userId, f.path).catch(async () => {
            const text = await ws.readText(ctx.spindle, ctx.userId, f.path);
            return new TextEncoder().encode(text);
          });
          entries.push({ path: f.path, bytes });
        }
      } else {
        if (seen.has(node.path)) continue;
        seen.add(node.path);
        const bytes = await ws.readBinary(ctx.spindle, ctx.userId, node.path).catch(async () => {
          const text = await ws.readText(ctx.spindle, ctx.userId, node.path);
          return new TextEncoder().encode(text);
        });
        entries.push({ path: node.path, bytes });
      }
    }
    if (entries.length === 0) throw new Error("no files to zip");
    const zip = buildZip(entries);
    const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
    await ws.writeBinary(ctx.spindle, ctx.userId, input.output, zip, caps);
    return { content: JSON.stringify({ output: input.output, entries: entries.length, bytes: zip.byteLength }) };
  },
});
