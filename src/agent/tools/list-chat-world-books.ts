import { z } from "zod";
import { defineTool } from "./_framework";

// The books feeding a chat are a union of four binding layers (mirrors the
// host's prompt-assembly). Default list/grep only ever expose the character
// layer, so this surfaces the full picture per scope. Global ("Always Active")
// books live in the user setting `globalWorldBooks`, which the spindle API
// exposes no reader for, so that layer is reported as unavailable rather than
// silently omitted (which would read as "no global books").
const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

interface BookRow {
  world_book_id: string;
  label: string;
  entries: number;
  scope: "character" | "persona" | "chat";
}

export const listChatWorldBooksTool = defineTool({
  name: "list_chat_world_books",
  description: `List every world book bound to a chat, grouped by binding scope: character (\`char/world_book_ids\`), persona (active persona's attached book), and chat ("This Chat Only", \`chat.metadata.chat_world_book_ids\`). Defaults to the pinned chat.

Use this, not \`list({path:"wb"})\`, to answer "what lorebooks are active for this chat" — plain \`list\` only sees character-attached books and reports the others as unattached. Global "Always Active" books are a fourth layer the host doesn't expose to extensions, so they're reported under \`global_unavailable\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat to inspect. Defaults to the pinned chat." },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) return { content: "Error: no chat_id and no pinned chat. Pin a chat or pass chat_id.", isError: true };
    try {
      const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
      if (!chat) return { content: `Error: chat '${chatId}' not found`, isError: true };

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

      const character = await ctx.spindle.characters.get(chat.character_id, ctx.userId);
      for (const id of character?.world_book_ids ?? []) await addBook(id, "character");

      const persona = await ctx.spindle.personas.getActive(ctx.userId);
      if (persona?.attached_world_book_id) await addBook(persona.attached_world_book_id, "persona");

      const rawChatIds = (chat.metadata ?? {})["chat_world_book_ids"];
      const chatIds = Array.isArray(rawChatIds) ? rawChatIds.filter((v): v is string => typeof v === "string") : [];
      for (const id of chatIds) await addBook(id, "chat");

      return { content: JSON.stringify({
        chat_id: chatId,
        count: rows.length,
        books: rows,
        global_unavailable: "Always-Active (global) books live in the user setting `globalWorldBooks`, which the host does not expose to this agent. They are not listed here.",
      }, null, 2) };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});
