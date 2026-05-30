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
    const q = input.query?.trim().toLowerCase();
    const toRow = (c: { id: string; name: string; world_book_ids?: readonly string[] }) => ({
      id: c.id,
      name: c.name,
      world_book_count: c.world_book_ids?.length ?? 0,
    });

    if (!q) {
      const res = await ctx.spindle.characters.list({ limit, offset, userId: ctx.userId });
      const out = JSON.stringify({
        total: res.total,
        total_library: res.total,
        offset,
        returned: res.data.length,
        characters: res.data.map(toRow),
      }, null, 2);
      return { content: await spillOrReturn(ctx, out, "list_characters") };
    }

    // A name query is a LIBRARY-WIDE filter: page through every character so a
    // match on a later page isn't missed, then window the matches by
    // offset/limit. The spindle `total` is the pre-filter count, so it can't be
    // surfaced as the match total.
    const matches: ReturnType<typeof toRow>[] = [];
    let libraryTotal = 0;
    let scanned = 0;
    let pageOffset = 0;
    for (;;) {
      const res = await ctx.spindle.characters.list({ limit: MAX_LIMIT, offset: pageOffset, userId: ctx.userId });
      libraryTotal = res.total;
      scanned += res.data.length;
      for (const c of res.data) if (c.name.toLowerCase().includes(q)) matches.push(toRow(c));
      if (res.data.length === 0 || scanned >= res.total) break;
      pageOffset += res.data.length;
    }
    const windowed = matches.slice(offset, offset + limit);
    const out = JSON.stringify({
      total: matches.length,
      total_library: libraryTotal,
      offset,
      returned: windowed.length,
      query: input.query,
      scanned,
      characters: windowed,
    }, null, 2);
    return { content: await spillOrReturn(ctx, out, "list_characters") };
  },
});
