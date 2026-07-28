import { z } from "zod";
import { defineTool } from "./_framework";
import {
  chatIncludesCharacter,
  groupCharacterIds,
  isGroupChat,
  listAllChats,
} from "../../state/chat-catalog";
import description from "../prompts/claude/tools/list-chats/description.txt";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const inputSchema = z.object({
  query: z.string().optional().describe("Case-insensitive substring filter on chat names and ids."),
  character_id: z.string().optional().describe("Only chats containing this character, including group membership."),
  chat_type: z.enum(["all", "solo", "group"]).optional().describe("Chat type filter. Default all."),
  offset: z.number().int().min(0).optional().describe("Pagination offset. Default 0."),
  limit: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Max chats to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
}).strict();

type Input = z.infer<typeof inputSchema>;

export const listChatsTool = defineTool<Input>({
  name: "list_chats",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Case-insensitive substring filter on chat names and ids." },
      character_id: { type: "string", description: "Only chats containing this character, including group membership." },
      chat_type: { type: "string", enum: ["all", "solo", "group"], description: "Chat type filter. Default all." },
      offset: { type: "integer", minimum: 0, description: "Pagination offset. Default 0." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Max chats to return. Default ${DEFAULT_LIMIT}.` },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const [catalog, active] = await Promise.all([
      listAllChats(ctx.spindle, ctx.userId),
      (async (): Promise<{ id: string } | null> => {
        try { return await ctx.spindle.chats.getActive(ctx.userId) ?? null; }
        catch { return null; }
      })(),
    ]);

    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    const chatType = input.chat_type ?? "all";
    const offset = input.offset ?? 0;
    const limit = input.limit ?? DEFAULT_LIMIT;

    const matches = catalog
      .filter((chat) => chat.metadata?.["temporary"] !== true)
      .filter((chat) => !input.character_id || chatIncludesCharacter(chat, input.character_id))
      .filter((chat) => chatType === "all" || (chatType === "group") === isGroupChat(chat))
      .filter((chat) => {
        if (query.length === 0) return true;
        return chat.name.toLocaleLowerCase().includes(query)
          || chat.id.toLocaleLowerCase().includes(query);
      })
      .sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));

    const rows = matches.slice(offset, offset + limit).map((chat) => ({
      id: chat.id,
      name: chat.name,
      is_group: isGroupChat(chat),
      character_ids: isGroupChat(chat) ? groupCharacterIds(chat) : [chat.character_id],
      updated_at: chat.updated_at,
      created_at: chat.created_at,
      is_active: active?.id === chat.id,
      is_pinned: ctx.pinnedChatId === chat.id,
    }));
    const nextOffset = offset + rows.length < matches.length ? offset + rows.length : null;

    return {
      content: JSON.stringify({
        total: matches.length,
        returned: rows.length,
        offset,
        next_offset: nextOffset,
        pinned_chat_id: ctx.pinnedChatId,
        chats: rows,
      }, null, 2),
    };
  },
});
