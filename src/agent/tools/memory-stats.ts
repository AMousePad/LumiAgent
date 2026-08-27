import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveMemoryChat, NO_CHAT_ERROR, memoryError } from "./_memory";
import description from "../prompts/claude/tools/memory-stats/description.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
}).strict();

export const memoryStatsTool = defineTool({
  name: "memory_stats",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat to inspect. Defaults to the pinned chat." },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute: async (input, ctx) => {
    const chatId = resolveMemoryChat(ctx, input.chat_id);
    if (!chatId) return { content: NO_CHAT_ERROR, isError: true };
    try {
      const [usage, ingestion, arc] = await Promise.all([
        ctx.spindle.memories.stats.usage(chatId, ctx.userId),
        ctx.spindle.memories.stats.ingestionStatus(chatId, ctx.userId).catch(() => null),
        ctx.spindle.memories.consolidations.latestArc(chatId, ctx.userId).catch(() => null),
      ]);
      return {
        content: JSON.stringify({
          chat_id: chatId,
          usage,
          ingestion: ingestion ?? "idle",
          latest_arc: arc ? { tier: arc.tier, summary: arc.summary } : null,
        }, null, 2),
      };
    } catch (err) { return { content: memoryError(err), isError: true }; }
  },
});
