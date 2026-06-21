import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-chat-world-books/description.txt";
import argChatId from "../prompts/claude/tools/list-chat-world-books/arg_chat_id.txt";

// The books feeding a chat are a union of four binding layers (mirrors the
// host's prompt-assembly). Default list/grep only ever expose the character
// layer, so this surfaces the full picture per scope. Global ("Always Active")
// books come from spindle.world_books.getGlobal (the `globalWorldBooks` setting).
const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

interface BookRow {
  world_book_id: string;
  label: string;
  entries: number;
  scope: "character" | "persona" | "chat" | "global";
}

export const listChatWorldBooksTool = defineTool({
  name: "list_chat_world_books",
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
    // persona + global are user-level (no chat needed); character + chat need a
    // resolved chat. With nothing pinned, still answer the user-level layers
    // instead of erroring, so "which books are global?" works chat-free.
    const chatId = input.chat_id ?? ctx.pinnedChatId ?? null;
    try {
      let chat: Awaited<ReturnType<typeof ctx.spindle.chats.get>> = null;
      if (chatId) {
        chat = await ctx.spindle.chats.get(chatId, ctx.userId);
        if (!chat) return { content: `Error: chat '${chatId}' not found`, isError: true };
      }

      const seen = new Set<string>();
      const rows: BookRow[] = [];
      const addBook = async (id: string, scope: BookRow["scope"]) => {
        if (seen.has(id)) return;
        seen.add(id);
        const wb = await ctx.spindle.world_books.get(id, ctx.userId);
        if (!wb) return;
        const meta = await ctx.spindle.world_books.entries.list(id, { limit: 1, userId: ctx.userId });
        rows.push({ world_book_id: id, label: wb.name, entries: meta.total, scope });
      };

      // Order is the narrowness precedence: a book bound at multiple scopes keeps
      // the first (narrowest) label. character > persona > chat > global.
      if (chat) {
        const character = await ctx.spindle.characters.get(chat.character_id, ctx.userId);
        for (const id of character?.world_book_ids ?? []) await addBook(id, "character");
      }

      // The host's prompt assembly uses the active persona OR the default one
      // when none is active (resolvePersonaOrDefault). getActive alone returns
      // null with no active persona, missing the default persona's book.
      const persona = (await ctx.spindle.personas.getActive(ctx.userId)) ?? (await ctx.spindle.personas.getDefault(ctx.userId));
      if (persona?.attached_world_book_id) await addBook(persona.attached_world_book_id, "persona");

      if (chat) {
        const rawChatIds = (chat.metadata ?? {})["chat_world_book_ids"];
        const chatIds = Array.isArray(rawChatIds) ? rawChatIds.filter((v): v is string => typeof v === "string") : [];
        for (const id of chatIds) await addBook(id, "chat");
      }

      // Global ("Always Active") books apply to every chat, with or without a pin.
      const globalIds = await ctx.spindle.world_books.getGlobal(ctx.userId).catch(() => [] as string[]);
      for (const id of globalIds) await addBook(id, "global");

      return { content: JSON.stringify({
        chat_id: chatId,
        ...(chat ? {} : { note: "No chat pinned: showing user-level layers only (persona, global). Pin a chat or pass chat_id to also include character- and chat-bound books." }),
        count: rows.length,
        books: rows,
      }, null, 2) };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});
