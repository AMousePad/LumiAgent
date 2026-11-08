import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import description from "../prompts/claude/tools/list-activated-world-info/description.txt";
import argChatId from "../prompts/claude/tools/list-activated-world-info/arg_chat_id.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

export const listActivatedWorldInfoTool = defineTool({
  name: "list_activated_world_info",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: argChatId },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) return { content: JSON.stringify({ error: "no chat_id and no pinned chat" }), isError: true };
    try {
      const entries = await ctx.spindle.world_books.getActivated(chatId, ctx.userId);
      const bySource: Record<string, number> = {};
      const byBook: Record<string, number> = {};
      for (const e of entries) {
        const k = e.bookSource ?? "unknown";
        bySource[k] = (bySource[k] ?? 0) + 1;
        if (e.bookId) byBook[e.bookId] = (byBook[e.bookId] ?? 0) + 1;
      }
      const names = new Map<string, string>();
      await Promise.all(Object.keys(byBook).map(async (id) => {
        const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
        if (book) names.set(id, book.name);
      }));
      // Compact rows: the raw DTO repeats chatId per entry and carries every key, which spilled 140k chars on large books.
      const rows = entries.map((e) => ({
        path: `wb/${e.id}`,
        comment: e.comment,
        keys: e.keys.length > 6 ? [...e.keys.slice(0, 6), `+${e.keys.length - 6} more`] : e.keys,
        source: e.source,
        ...(e.bookSource ? { binding: e.bookSource } : {}),
        ...(e.score !== undefined ? { score: e.score } : {}),
        ...(e.bookId ? { book: names.get(e.bookId) ?? e.bookId } : {}),
      }));
      const books = Object.entries(byBook).map(([id, n]) => ({ book_id: id, name: names.get(id) ?? null, activated: n })).sort((a, b) => b.activated - a.activated);
      const out = JSON.stringify({ chat_id: chatId, count: entries.length, by_source: bySource, by_book: books, entries: rows }, null, 2);
      return { content: await spillOrReturn(ctx, out, `list_activated_world_info(${chatId})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
