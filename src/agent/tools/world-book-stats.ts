import { z } from "zod";
import { defineTool } from "./_framework";
import type { WorldBookEntryDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({});

export const worldBookStatsTool = defineTool({
  name: "world_book_stats",
  description: "[LEGACY — superseded by the list tool with path wb/<bookId>. Kept for back-compat; prefer the named successor.] Cheap orientation for the character's whole lorebook. Returns total entry count, per-book breakdown, count of disabled/constant entries, total content chars, and the 10 largest entries by content size. Call this BEFORE list_world_book_entries on any unfamiliar lorebook, it tells you whether to grep, paginate, or just read.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
  execute: async (_input, ctx) => {
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const all: WorldBookEntryDTO[] = [];
    const perBook: Record<string, number> = {};
    for (const wbId of c.world_book_ids) {
      const res = await ctx.spindle.world_books.entries.list(wbId, { limit: 500, userId: ctx.userId });
      all.push(...res.data);
      perBook[wbId] = res.data.length;
    }
    const totalChars = all.reduce((s, e) => s + e.content.length, 0);
    const constantCount = all.filter((e) => e.constant).length;
    const disabledCount = all.filter((e) => e.disabled).length;
    const largest = [...all]
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, 10)
      .map((e) => ({ id: e.id, comment: e.comment, content_chars: e.content.length }));
    return {
      content: JSON.stringify({
        total_entries: all.length,
        total_content_chars: totalChars,
        constant: constantCount,
        disabled: disabledCount,
        per_book: perBook,
        largest_10: largest,
      }, null, 2),
    };
  },
});
