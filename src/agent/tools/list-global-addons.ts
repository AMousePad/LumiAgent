import { nameQuery, nameQueryProperty, searchPage } from "./_name-search";
import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-global-addons/description.txt";

const inputSchema = z.object({
  query: nameQuery,
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listGlobalAddonsTool = defineTool({
  name: "list_global_addons",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: nameQueryProperty,
      limit: { type: "integer", minimum: 1, maximum: 500, description: "Max rows. Default 200." },
      offset: { type: "integer", minimum: 0 },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute: async (input, ctx) => {
    let res;
    try {
      res = await searchPage((limit, offset) => ctx.spindle.global_addons.list({
        limit,
        offset,
        userId: ctx.userId,
      }), item => item.label, input, ctx.signal);
    } catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }

    return {
      content: JSON.stringify({
        total: res.total, offset: res.offset, has_more: res.has_more, next_offset: res.next_offset,
        returned: res.data.length,
        addons: res.data.map((a) => ({
          path: `global_addon/${a.id}/content`,
          id: a.id,
          label: a.label,
          sort_order: a.sort_order,
          chars: typeof a.content === "string" ? a.content.length : 0,
        })),
      }, null, 2),
    };
  },
});
