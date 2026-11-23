import { z } from "zod";
import { defineTool } from "./_framework";
import { recordChange } from "./_change-history";
import { CHAT_ID_ARG, resolveChat } from "./_chat";
import description from "../prompts/claude/tools/rename-chat/description.txt";

const MAX_NAME = 200;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  name: z.string(),
}).strict();

export const renameChatTool = defineTool({
  name: "rename_chat",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      name: { type: "string", description: `New chat name, 1 to ${MAX_NAME} characters.` },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return { content: `Error: [INVALID_INPUT] name must be 1 to ${MAX_NAME} characters. Example: chats(action=rename, name="Road to Vael").`, isError: true };
    }
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    if (chat.name === name) {
      return { content: JSON.stringify({ chat_id: chatId, chat_source: source, name, unchanged: true, note: "The chat already has this name. Nothing was written." }, null, 2) };
    }
    let updated;
    // Only name is sent. The host replaces the whole metadata object when metadata is present.
    try { updated = await ctx.spindle.chats.update(chatId, { name }, ctx.userId); }
    catch (err) { return { content: `Error: [SPINDLE_ERROR] rename failed, the chat is still named "${chat.name}": ${(err as Error).message}`, isError: true }; }
    recordChange(ctx, { kind: "chat", id: chatId }, updated.name || name, "name", chat.name, updated.name, "Chat renames are not reverted from Workshop. Rename the chat back to the old name instead.");
    return { content: JSON.stringify({ chat_id: chatId, chat_source: source, old_name: chat.name, new_name: updated.name, renamed: true }, null, 2) };
  },
});
