import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveMemoryChat, NO_CHAT_ERROR, memoryError, entityRow } from "./_memory";
import description from "../prompts/claude/tools/list-memory-entities/description.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
  name: z.string().optional(),
  include_inactive: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
}).strict();

export const listMemoryEntitiesTool = defineTool({
  name: "list_memory_entities",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat to inspect. Defaults to the pinned chat." },
      name: { type: "string", description: "Fetch one entity by name or alias, with its full fact list." },
      include_inactive: { type: "boolean", description: "Also list retired entities. Default false." },
      limit: { type: "integer", minimum: 1, maximum: 500, description: "Max rows. Default 100." },
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
      if (input.name !== undefined) {
        const e = await ctx.spindle.memories.entities.findByName(chatId, input.name, ctx.userId);
        if (!e) return { content: `Error: [PATH_NOT_FOUND] no memory entity named '${input.name}' in this chat. List without \`name\` to see what exists.`, isError: true };
        const [facts, relations] = await Promise.all([
          ctx.spindle.memories.entities.getFacts(e.id, ctx.userId),
          ctx.spindle.memories.relations.forEntity(chatId, e.id, ctx.userId).catch(() => []),
        ]);
        return {
          content: JSON.stringify({
            ...entityRow(e),
            facts,
            facts_note: "The LAST 6 facts render into the prompt's entity-context block.",
            relations: relations.map((r) => ({ source: r.sourceEntityId, target: r.targetEntityId, type: r.relationType, label: r.relationLabel })),
          }, null, 2),
        };
      }
      const rows = await ctx.spindle.memories.entities.list(chatId, {
        activeOnly: input.include_inactive !== true,
        limit: input.limit ?? 100,
        userId: ctx.userId,
      });
      return {
        content: JSON.stringify({
          chat_id: chatId,
          count: rows.length,
          entities: rows.map(entityRow),
        }, null, 2),
      };
    } catch (err) { return { content: memoryError(err), isError: true }; }
  },
});
