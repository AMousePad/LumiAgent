import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  entry_id: z.string(),
});

export const worldBookEntryStatsTool = defineTool({
  name: "world_book_entry_stats",
  description: "[LEGACY — superseded by the inspect tool with path wb/<id>/content. Kept for back-compat; prefer the named successor.] Cheap orientation for a world book entry. Returns content char count, line count, key/keysecondary, comment, and a 200-char peek. Call this before read_world_book_entry on any entry you don't already know is small.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { entry_id: { type: "string" } },
    required: ["entry_id"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const e = await ctx.spindle.world_books.entries.get(input.entry_id, ctx.userId);
    if (!e) return { content: `Error: world book entry ${input.entry_id} not found`, isError: true };
    return {
      content: JSON.stringify({
        entry_id: input.entry_id,
        comment: e.comment,
        key: e.key,
        keysecondary: e.keysecondary,
        constant: e.constant,
        disabled: e.disabled,
        content_chars: e.content.length,
        content_lines: e.content === "" ? 0 : e.content.split("\n").length,
        peek: e.content.slice(0, 200),
      }, null, 2),
    };
  },
});
