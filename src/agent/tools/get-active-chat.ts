import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/get-active-chat/description.txt";

const inputSchema = z.object({}).strict();

export const getActiveChatTool = defineTool({
  name: "get_active_chat",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  requiresCharacter: true,
  execute: async (_input, ctx) => {
    try {
      const chat = await ctx.spindle.chats.getActive(ctx.userId);
      if (!chat) return { content: JSON.stringify({ active_chat: null }) };
      return { content: JSON.stringify({ active_chat: chat, is_same_as_pinned: chat.id === ctx.pinnedChatId }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
