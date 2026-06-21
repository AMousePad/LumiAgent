import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/fs-unzip/description.txt";
import argZipPath from "../prompts/claude/tools/fs-unzip/arg_zip_path.txt";
import argDestDir from "../prompts/claude/tools/fs-unzip/arg_dest_dir.txt";

const inputSchema = z.object({
  zip_path: z.string().min(1),
  dest_dir: z.string(),
});

export const fsUnzipTool = defineTool({
  name: "fs_unzip",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      zip_path: { type: "string", description: argZipPath },
      dest_dir: { type: "string", description: argDestDir },
    },
    required: ["zip_path", "dest_dir"],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const { parseZip } = await import("../../state/zip");
    const bytes = await ws.readBinary(ctx.spindle, ctx.userId, input.zip_path);
    const entries = parseZip(bytes);
    const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
    let written = 0;
    let totalBytes = 0;
    for (const entry of entries) {
      // zip-slip defense: reject '..' segments and absolute paths before the
      // workspace validator sees them, so a malicious zip can't begin the loop.
      const rel = entry.path.replace(/^[\\/]+/, "");
      if (/[\\]/.test(rel) || rel.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
        throw new Error(`unsafe zip entry path: '${entry.path}'`);
      }
      const target = input.dest_dir === "" ? rel : `${input.dest_dir}/${rel}`;
      await ws.writeBinary(ctx.spindle, ctx.userId, target, entry.bytes, caps);
      written++;
      totalBytes += entry.bytes.byteLength;
    }
    return { content: JSON.stringify({ zip_path: input.zip_path, dest_dir: input.dest_dir, files_written: written, bytes: totalBytes }) };
  },
});
