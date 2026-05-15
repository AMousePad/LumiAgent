import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const getActiveChatTool = defineTool({
  name: "get_active_chat",
  description: "Get the user's currently active chat (whatever the frontend is showing). Different from the pinned chat — pinned is what this agent session reads from; active is what the user is looking at right now in their main chat panel. Returns null if no chat is open.",
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
