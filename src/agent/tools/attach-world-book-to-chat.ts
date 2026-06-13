import { z } from "zod";
import { defineTool } from "./_framework";

// Chat-scoped world book bindings live in chat.metadata.chat_world_book_ids
// (the "This Chat Only" group in the UI). The host's chats.update replaces the
// whole metadata blob, so this reads the current metadata and writes it back
// merged, never bare, otherwise wi_state and every other chat field is wiped.
const inputSchema = z.object({
  world_book_id: z.string().min(1),
  action: z.enum(["attach", "detach"]).optional(),
  chat_id: z.string().optional(),
}).strict();

export const attachWorldBookToChatTool = defineTool({
  name: "attach_world_book_to_chat",
  description: `Attach or detach a world book to a chat (the "This Chat Only" binding). Writes \`chat.metadata.chat_world_book_ids\`. Defaults to \`action: "attach"\`.

This is a different layer than character attachment (\`char/world_book_ids\`) or persona attachment (\`persona/<id>/attached_world_book_id\`): a chat-bound book is active for this one chat regardless of character. Idempotent: re-attaching an already-bound book is a no-op. Does not create the book, pass an existing world_book_id (\`create({path:"wb"})\` first if needed).`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      world_book_id: { type: "string", description: "Id of an existing world book." },
      action: { type: "string", enum: ["attach", "detach"], description: "Default 'attach'." },
      chat_id: { type: "string", description: "Chat to bind." },
    },
    required: ["world_book_id"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) return { content: "Error: no chat_id and no pinned chat. Pin a chat or pass chat_id.", isError: true };
    const action = input.action ?? "attach";
    try {
      if (action === "attach") {
        const wb = await ctx.spindle.world_books.get(input.world_book_id, ctx.userId);
        if (!wb) return { content: `Error: world book '${input.world_book_id}' not found`, isError: true };
      }
      const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
      if (!chat) return { content: `Error: chat '${chatId}' not found`, isError: true };

      const metadata = { ...(chat.metadata ?? {}) } as Record<string, unknown>;
      const raw = metadata["chat_world_book_ids"];
      const current = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
      const has = current.includes(input.world_book_id);

      let next: string[];
      if (action === "attach") {
        if (has) return { content: JSON.stringify({ ok: true, chat_id: chatId, world_book_id: input.world_book_id, action, changed: false, chat_world_book_ids: current }) };
        next = [...current, input.world_book_id];
      } else {
        if (!has) return { content: JSON.stringify({ ok: true, chat_id: chatId, world_book_id: input.world_book_id, action, changed: false, chat_world_book_ids: current }) };
        next = current.filter((id) => id !== input.world_book_id);
      }

      metadata["chat_world_book_ids"] = next;
      await ctx.spindle.chats.update(chatId, { metadata }, ctx.userId);
      return { content: JSON.stringify({ ok: true, chat_id: chatId, world_book_id: input.world_book_id, action, changed: true, chat_world_book_ids: next }, null, 2) };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});
