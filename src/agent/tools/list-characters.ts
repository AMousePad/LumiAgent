import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const inputSchema = z.object({
  query: z.string().optional().describe("Case-insensitive substring filter on the character name."),
  offset: z.number().int().min(0).optional().describe("Pagination offset. Default 0."),
  limit: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Max characters to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
}).strict();

export const listCharactersTool = defineTool({
  name: "list_characters",
  description: `Enumerate the user's characters so you can address one by id. Returns id, name, and attached world-book count per character.

Use this to find the id of the character the user is talking about, then address it with \`char/<id>/<field>\` paths or the \`character_id\` argument on whole-card tools (grep / audit / survey / list / inspect / update_character / apply_glossary).

When a character is focused you rarely need this. \`query\` filters by name substring.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Case-insensitive name substring filter." },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `default ${DEFAULT_LIMIT}` },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const res = await ctx.spindle.characters.list({ limit, offset, userId: ctx.userId });
    const q = input.query?.trim().toLowerCase();
    let rows = res.data.map((c) => ({
      id: c.id,
      name: c.name,
      world_book_count: c.world_book_ids?.length ?? 0,
    }));
    // With a query filter, the spindle `total` is the pre-filter library count,
    // not the post-filter match count — surfacing it as `total` would tell the
    // agent there are more matches on later pages when there aren't.
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    const out = JSON.stringify({
      total: q ? filtered.length : res.total,
      total_library: res.total,
      offset,
      returned: filtered.length,
      ...(q ? { query: input.query, scanned: rows.length, note: "query filtered post-fetch on this page only; raise limit if you need broader coverage" } : {}),
      characters: filtered,
    }, null, 2);
    return { content: await spillOrReturn(ctx, out, "list_characters") };
  },
});
