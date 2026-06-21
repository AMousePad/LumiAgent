import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-databanks/description.txt";
import argScope from "../prompts/claude/tools/list-databanks/arg_scope.txt";
import argScopeId from "../prompts/claude/tools/list-databanks/arg_scope_id.txt";
import argLimit from "../prompts/claude/tools/list-databanks/arg_limit.txt";
import argOffset from "../prompts/claude/tools/list-databanks/arg_offset.txt";

const inputSchema = z.object({
  scope: z.enum(["global", "character", "chat"]).optional(),
  scope_id: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listDatabanksTool = defineTool({
  name: "list_databanks",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["global", "character", "chat"], description: argScope },
      scope_id: { type: ["string", "null"], description: argScopeId },
      limit: { type: "number", description: argLimit },
      offset: { type: "number", description: argOffset },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    try {
      let scopeId = input.scope_id;
      // Falsy guard, not === undefined: in a no-character session ctx.characterId
      // is coerced to "" (and pinnedChatId can be null). Forwarding scopeId:"" /
      // null mis-scopes or errors host-side, so drop empties.
      if (input.scope === "character" && !scopeId) scopeId = ctx.characterId || undefined;
      if (input.scope === "chat" && !scopeId) scopeId = ctx.pinnedChatId || undefined;
      const res = await ctx.spindle.databanks.list({
        ...(input.scope ? { scope: input.scope } : {}),
        ...(scopeId ? { scopeId } : {}),
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
