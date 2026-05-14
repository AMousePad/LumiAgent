import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({});

export const tmpListTool = defineTool({
  name: "tmp_list",
  description: "List active tmp handles for this user across all sessions. Returns newest-first with handle, origin, total_chars, total_lines, createdAt. Per-user cap is 50 files OR 30MB; oldest are auto-evicted on the next spill.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  execute: async (_input, ctx) => {
    const { listAllTmpForUser, TMP_MAX_FILES_PER_USER, TMP_MAX_BYTES_PER_USER } = await import("../../state/tmp-store");
    const entries = await listAllTmpForUser(ctx.spindle, ctx.userId);
    const totalBytes = entries.reduce((s, e) => s + e.totalChars, 0);
    return {
      content: JSON.stringify({
        count: entries.length,
        total_chars: totalBytes,
        cap_files: TMP_MAX_FILES_PER_USER,
        cap_bytes: TMP_MAX_BYTES_PER_USER,
        entries,
      }, null, 2),
    };
  },
});
