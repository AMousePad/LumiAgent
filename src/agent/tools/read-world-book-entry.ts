import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markRead } from "./_gates";

const inputSchema = z.object({
  entry_id: z.string().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const readWorldBookEntryTool = defineTool({
  name: "read_world_book_entry",
  description: "[LEGACY — superseded by the read tool with path wb/<id>/content. Kept for back-compat; prefer the named successor.] Read a single world book entry's content with line numbers and metadata header.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["entry_id"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const e = await ctx.spindle.world_books.entries.get(input.entry_id, ctx.userId);
    if (!e) return { content: `Error: world book entry ${input.entry_id} not found`, isError: true };
    const meta = JSON.stringify({
      comment: e.comment,
      key: e.key,
      keysecondary: e.keysecondary,
      constant: e.constant,
      disabled: e.disabled,
      position: e.position,
      depth: e.depth,
      order_value: e.order_value,
      priority: e.priority,
    });
    const body = formatLineSlice(e.content, `world_book_entry[${input.entry_id}].content`, input.offset, input.limit);
    const payload = `[meta] ${meta}\n${body}`;
    markRead(ctx, `world_book_entry:${input.entry_id}`);
    const out = await spillOrReturn(ctx, payload, `read_world_book_entry:${input.entry_id}`, "If the entry is huge, call world_book_entry_stats first, or narrow with offset/limit / grep_card.");
    return { content: out };
  },
});
