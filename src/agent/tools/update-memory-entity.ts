import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveMemoryChat, NO_CHAT_ERROR, memoryError, findEntity, entityRow } from "./_memory";
import description from "../prompts/claude/tools/update-memory-entity/description.txt";

const inputSchema = z.object({
  name: z.string().optional(),
  entity_id: z.string().optional(),
  status: z.enum(["active", "inactive", "deceased", "destroyed"]).optional(),
  add_aliases: z.array(z.string().min(1)).max(20).optional(),
  pin: z.boolean().optional(),
  chat_id: z.string().optional(),
}).strict().refine(
  (d) => (d.name !== undefined) !== (d.entity_id !== undefined),
  { message: "pass exactly one of name / entity_id" },
).refine(
  (d) => d.status !== undefined || d.add_aliases !== undefined || d.pin === true,
  { message: "nothing to do: pass status, add_aliases, and/or pin" },
);

export const updateMemoryEntityTool = defineTool({
  name: "update_memory_entity",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Entity name or alias." },
      entity_id: { type: "string", description: "Exact entity id, instead of name." },
      status: { type: "string", enum: ["active", "inactive", "deceased", "destroyed"], description: "inactive retires from retrieval; deceased/destroyed model in-fiction fate; active revives." },
      add_aliases: { type: "array", items: { type: "string" }, maxItems: 20, description: "Alternate names that should resolve to this entity." },
      pin: { type: "boolean", description: "Permanently lock against automatic extraction and garbage collection." },
      chat_id: { type: "string", description: "Defaults to the pinned chat." },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = resolveMemoryChat(ctx, input.chat_id);
    if (!chatId) return { content: NO_CHAT_ERROR, isError: true };
    try {
      const entity = await findEntity(ctx.spindle, chatId, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.entity_id !== undefined ? { entityId: input.entity_id } : {}) }, ctx.userId);
      if (!entity) return { content: `Error: [PATH_NOT_FOUND] entity not found. \`list_memory_entities\` shows what exists.`, isError: true };

      const applied: string[] = [];
      if (input.add_aliases !== undefined || input.pin === true) {
        const aliases = [...new Set([...entity.aliases, ...(input.add_aliases ?? [])])];
        // markUserEdited is host-supported but absent from the published DTO;
        // it locks curated fields against extraction and the entity against GC.
        const payload = {
          name: entity.name,
          type: entity.entityType,
          aliases,
          ...(input.pin === true ? { markUserEdited: true } : {}),
        } as Parameters<typeof ctx.spindle.memories.entities.upsert>[1];
        await ctx.spindle.memories.entities.upsert(chatId, payload, { userId: ctx.userId });
        if (input.add_aliases !== undefined) applied.push(`aliases +${input.add_aliases.length}`);
        if (input.pin === true) applied.push("pinned (permanent)");
      }
      if (input.status !== undefined) {
        await ctx.spindle.memories.entities.updateStatus(entity.id, { status: input.status }, ctx.userId);
        applied.push(`status ${entity.status} -> ${input.status}`);
      }
      await ctx.spindle.memories.cortex.invalidateCache(chatId).catch(() => {});
      const fresh = await ctx.spindle.memories.entities.get(entity.id, ctx.userId);
      return { content: JSON.stringify({ applied, entity: fresh ? entityRow(fresh) : entityRow(entity) }, null, 2) };
    } catch (err) { return { content: memoryError(err), isError: true }; }
  },
});
