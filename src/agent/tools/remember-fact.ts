import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveMemoryChat, NO_CHAT_ERROR, memoryError } from "./_memory";
import description from "../prompts/claude/tools/remember-fact/description.txt";

const inputSchema = z.object({
  entity: z.string().min(1),
  facts: z.array(z.string().min(1).max(500)).min(1).max(20),
  importance: z.number().int().min(1).max(10).optional(),
  entity_type: z.enum(["character", "location", "item", "faction", "concept", "event"]).optional(),
  chat_id: z.string().optional(),
}).strict();

export const rememberFactTool = defineTool({
  name: "remember_fact",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entity: { type: "string", description: "Entity name or alias. Created if it does not exist." },
      facts: { type: "array", items: { type: "string", maxLength: 500 }, minItems: 1, maxItems: 20, description: "Short present-tense clauses, one fact each." },
      importance: { type: "integer", minimum: 1, maximum: 10, description: "Trim resistance, default 5. 8-10 for facts that must never fall out of the 30-fact cap." },
      entity_type: { type: "string", enum: ["character", "location", "item", "faction", "concept", "event"], description: "Type when creating a new entity. Default character." },
      chat_id: { type: "string", description: "Defaults to the pinned chat." },
    },
    required: ["entity", "facts"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = resolveMemoryChat(ctx, input.chat_id);
    if (!chatId) return { content: NO_CHAT_ERROR, isError: true };
    try {
      let entity = await ctx.spindle.memories.entities.findByName(chatId, input.entity, ctx.userId);
      let created = false;
      if (!entity) {
        entity = await ctx.spindle.memories.entities.upsert(chatId, {
          name: input.entity,
          type: input.entity_type ?? "character",
        }, { userId: ctx.userId });
        created = true;
      }
      // The importance tag is parsed off the raw string by retention and
      // stripped before display, so it never leaks into the prompt.
      const importance = input.importance ?? 5;
      const tagged = input.facts.map((f) => `[i:${importance}] ${f}`);
      const after = await ctx.spindle.memories.entities.addFacts(entity.id, tagged, ctx.userId);
      await ctx.spindle.memories.cortex.invalidateCache(chatId).catch(() => {});
      const facts = await ctx.spindle.memories.entities.getFacts(entity.id, ctx.userId);
      return {
        content: JSON.stringify({
          entity: after.name,
          entity_id: after.id,
          ...(created ? { created_entity: true } : {}),
          fact_count: facts.length,
          last_6_in_prompt: facts.slice(-6),
        }, null, 2),
      };
    } catch (err) { return { content: memoryError(err), isError: true }; }
  },
});
