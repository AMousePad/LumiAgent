import { z } from "zod";
import { defineTool } from "./_framework";
import { observeChange } from "./_change-history";
import { memoryError } from "./_memory";
import type { ToolCtx } from "./_context";
import { CHAT_ID_ARG, NO_CHAT_TARGET, resolveChatId } from "./_chat";
import description from "../prompts/claude/tools/remember-fact/description.txt";

const inputSchema = z.object({
  entity: z.string().min(1),
  facts: z.array(z.string().min(1).max(500)).min(1).max(20),
  importance: z.number().int().min(1).max(10).optional(),
  entity_type: z.enum(["character", "location", "item", "faction", "concept", "event"]).optional(),
  chat_id: z.string().optional(),
}).strict();

const ALTERNATIVE = "To make the fact reach the AI regardless, put it in an always-on lorebook entry: create({path:\"wb/<bookId>/entry\", value:{content, constant:true}}).";

// Mirrors the host rule: the user switch, then a per-chat opt-out, and temporary chats never use Cortex.
async function cortexState(ctx: ToolCtx, chatId: string): Promise<{ enabled: boolean | null; why?: string }> {
  let enabled: boolean;
  try { enabled = (await ctx.spindle.memories.cortex.getConfig(ctx.userId)).enabled === true; }
  catch { return { enabled: null }; }
  if (!enabled) return { enabled: false, why: "Memory Cortex is turned off in the user's Lumiverse memory settings" };
  try {
    const meta = ((await ctx.spindle.chats.get(chatId, ctx.userId))?.metadata ?? {}) as Record<string, unknown>;
    if (meta["temporary"] === true) return { enabled: false, why: "this is a temporary chat, which never uses Memory Cortex" };
    const own = meta["cortex_settings"];
    if (own && typeof own === "object" && (own as Record<string, unknown>)["enabled"] === false) return { enabled: false, why: "Memory Cortex is turned off for this chat" };
  } catch { /* the user-level switch is on, report that */ }
  return { enabled: true };
}

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
      chat_id: { type: "string", description: CHAT_ID_ARG },
    },
    required: ["entity", "facts"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const target = await resolveChatId(ctx, input.chat_id);
    if (!target) return { content: NO_CHAT_TARGET, isError: true };
    const chatId = target.chatId;
    try {
      return await observeChange(ctx, { kind: "cortex", id: chatId }, input.entity, "facts", async () => {
        const entity = await ctx.spindle.memories.entities.findByName(chatId, input.entity, ctx.userId);
        return entity ? { entity, facts: await ctx.spindle.memories.entities.getFacts(entity.id, ctx.userId) } : null;
      }, async () => {
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
      const cortex = await cortexState(ctx, chatId);
      const names = [after.name, ...(after.aliases ?? [])].filter((n) => n.length >= 3);
      const note = cortex.enabled === false
        ? `Saved, but it will NOT reach the AI: ${cortex.why}. Nothing from memory is injected until the user enables Memory Cortex in Lumiverse memory settings. ${ALTERNATIVE}`
        : `${cortex.enabled === null ? "Saved. Could not confirm that Memory Cortex is enabled. If it is, the" : "Saved. The"} last 6 facts are injected only on turns where the recent chat text mentions ${names.length > 0 ? names.map((n) => `"${n}"`).join(" or ") : `"${after.name}" (names under 3 characters never match, add a longer alias with update_memory_entity)`}. For a fact that must always be present use a constant lorebook entry instead.`;
      return {
        content: JSON.stringify({
          entity: after.name,
          entity_id: after.id,
          chat_id: chatId,
          chat_source: target.source,
          ...(created ? { created_entity: true } : {}),
          fact_count: facts.length,
          last_6_in_prompt: facts.slice(-6),
          cortex_enabled: cortex.enabled,
          note,
        }, null, 2),
      };
      });
    } catch (err) { return { content: memoryError(err), isError: true }; }
  },
});
