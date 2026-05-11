import type { WorldBookEntryDTO } from "lumiverse-spindle-types";
import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const listWorldBookEntriesTool = defineTool({
  name: "list_world_book_entries",
  description: "[LEGACY — superseded by the list tool with path wb/<bookId>. Kept for back-compat; prefer the named successor.] List the active character's world book entries with metadata only (no content). Returns id, world_book_id, comment, key (activation keys), constant, disabled, position, order_value, content_chars. Use this to inventory the lorebook. For large lorebooks, paginate with offset/limit.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      offset: { type: "number", description: "0-indexed start, default 0" },
      limit: { type: "number", description: "max entries per call, default 200" },
    },
    required: [],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Math.floor(input.limit ?? 200)));
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const all: WorldBookEntryDTO[] = [];
    for (const wbId of c.world_book_ids) {
      const res = await ctx.spindle.world_books.entries.list(wbId, { limit: 500, userId: ctx.userId });
      all.push(...res.data);
    }
    const slice = all.slice(offset, offset + limit);
    const rows = slice.map((e) => ({
      id: e.id,
      world_book_id: e.world_book_id,
      comment: e.comment,
      key: e.key,
      constant: e.constant,
      disabled: e.disabled,
      position: e.position,
      order_value: e.order_value,
      content_chars: e.content.length,
    }));
    const payload = JSON.stringify({
      total: all.length,
      offset,
      returned: rows.length,
      truncated: all.length > offset + rows.length,
      entries: rows,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `list_world_book_entries:${offset}-${offset + rows.length}`, "If the lorebook is huge, call world_book_stats first or narrow by keyword via grep_card.");
    return { content: out };
  },
});
