import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  zip_path: z.string().min(1),
  dest_dir: z.string(),
});

export const fsUnzipTool = defineTool({
  name: "fs_unzip",
  description: "Extract a workspace .zip into a destination directory. STORE and DEFLATE are supported. Rejects entries with path traversal ('..') or absolute paths. Subject to the same per-file and total workspace caps as fs_write.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      zip_path: { type: "string", description: "Workspace-relative path to the zip." },
      dest_dir: { type: "string", description: "Workspace-relative target directory. Created if it doesn't exist." },
    },
    required: ["zip_path", "dest_dir"],
  },
  execute: async (input, ctx) => {
    const ws = await import("../../state/workspace");
    const { parseZip } = await import("../../state/zip");
    const bytes = await ws.readBinary(ctx.spindle, ctx.userId, input.zip_path);
    const entries = parseZip(bytes);
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
      await ws.writeBinary(ctx.spindle, ctx.userId, target, entry.bytes);
      written++;
      totalBytes += entry.bytes.byteLength;
    }
    return { content: JSON.stringify({ zip_path: input.zip_path, dest_dir: input.dest_dir, files_written: written, bytes: totalBytes }) };
  },
});
