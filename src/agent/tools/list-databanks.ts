import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  scope: z.enum(["global", "character", "chat"]).optional(),
  scope_id: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listDatabanksTool = defineTool({
  name: "list_databanks",
  description: "List the user's databanks (RAG document collections). Optional scope filter: global / character / chat. Pass scope_id to scope to a specific character or chat (omit for the active character / pinned chat as the natural default). Returns metadata only — id, name, scope, document_count, enabled.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["global", "character", "chat"], description: "Filter by scope." },
      scope_id: { type: ["string", "null"], description: "For character/chat scopes, the specific id. Defaults to active character / pinned chat." },
      limit: { type: "number", description: "Max results, default 200." },
      offset: { type: "number", description: "Pagination offset." },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    try {
      let scopeId = input.scope_id;
      if (input.scope === "character" && scopeId === undefined) scopeId = ctx.characterId;
      if (input.scope === "chat" && scopeId === undefined) scopeId = ctx.pinnedChatId;
      const res = await ctx.spindle.databanks.list({
        ...(input.scope ? { scope: input.scope } : {}),
        ...(scopeId !== undefined ? { scopeId } : {}),
        limit: input.limit ?? 200,
        offset: input.offset ?? 0,
        userId: ctx.userId,
      });
      const rows = res.data.map((d) => ({
        id: d.id,
        name: d.name,
        scope: d.scope,
        scope_id: d.scope_id,
        enabled: d.enabled,
        document_count: d.document_count ?? null,
        description_chars: d.description.length,
      }));
      return { content: JSON.stringify({ total: res.total, returned: rows.length, databanks: rows }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
