import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { fillPrompt } from "../prompts/_fill";
import { listAllCharacters } from "../../state/character-catalog";
import { buildExtensionsSearchSkip } from "../../phoneline/search-excludes";
import description from "../prompts/claude/tools/list-characters/description.txt";
import argQuery from "../prompts/claude/tools/list-characters/arg_query.txt";
import argLimit from "../prompts/claude/tools/list-characters/arg_limit.txt";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_MAX_CHARS_PER_FIELD = 600;
const MAX_CHARS_PER_FIELD = 4000;
const DETAIL_FIELDS = [
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "creator",
] as const;
type DetailField = typeof DETAIL_FIELDS[number];
type ExtensionSearchSkip = (path: string) => boolean;

// Keep top-level extension-key disclosure identical to list({path:
// "char/extensions"}). Identifier keys use dotted syntax; every other key uses
// the bracket-quoted form that listExtensions passes to the phone-line search
// exclusion matcher.
function extensionSearchPath(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
}

export function visibleTopLevelExtensionKeys(
  extensions: Readonly<Record<string, unknown>> | undefined,
  skip: ExtensionSearchSkip,
): string[] {
  return Object.keys(extensions ?? {})
    .filter((key) => !skip(extensionSearchPath(key)))
    .sort();
}

const inputSchema = z.object({
  query: z.string().optional().describe("Case-insensitive substring filter on character names and tags."),
  extension_key: z.string().min(1).optional().describe("Exact top-level character extension key to require, such as 'lumirealm'."),
  include_fields: z.array(z.enum(DETAIL_FIELDS)).max(DETAIL_FIELDS.length).optional().describe("Optional card-text previews for bulk comparison or classification."),
  max_chars_per_field: z.number().int().min(100).max(MAX_CHARS_PER_FIELD).optional().describe(`Per-field preview cap. Default ${DEFAULT_MAX_CHARS_PER_FIELD}, max ${MAX_CHARS_PER_FIELD}.`),
  offset: z.number().int().min(0).optional().describe("Pagination offset. Default 0."),
  limit: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Max characters to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
}).strict();

export const listCharactersTool = defineTool({
  name: "list_characters",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: argQuery },
      extension_key: { type: "string", description: "Exact top-level extension key to require, for example 'lumirealm'." },
      include_fields: { type: "array", items: { type: "string", enum: DETAIL_FIELDS }, maxItems: DETAIL_FIELDS.length },
      max_chars_per_field: { type: "integer", minimum: 100, maximum: MAX_CHARS_PER_FIELD },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: fillPrompt(argLimit, { DEFAULT_LIMIT }) },
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
    const requiredExtension = input.extension_key?.trim();
    const includeFields = [...new Set(input.include_fields ?? [])] as DetailField[];
    const maxChars = input.max_chars_per_field ?? DEFAULT_MAX_CHARS_PER_FIELD;
    // This is a structural search over the extensions root, not a read of an
    // addressed subtree. Match list(char/extensions root): build the approved
    // providers' exclusion predicate once, then apply it locally to every DTO.
    // Calling checkExtensionRead here would require one phone-line RPC per
    // character and would be stricter than the existing root-list surface.
    const skipExtensionSearch = await buildExtensionsSearchSkip(ctx.spindle, ctx.userId);
    const toRow = (c: {
      id: string;
      name: string;
      tags?: readonly string[];
      world_book_ids?: readonly string[];
      extensions?: Readonly<Record<string, unknown>>;
    } & Partial<Record<DetailField, string>>) => {
      const extensionKeys = visibleTopLevelExtensionKeys(c.extensions, skipExtensionSearch);
      const row: Record<string, unknown> = {
        id: c.id,
        name: c.name,
        tags: c.tags ?? [],
        world_book_count: c.world_book_ids?.length ?? 0,
        extension_keys: extensionKeys,
        has_lumirealm: extensionKeys.includes("lumirealm"),
      };
      if (includeFields.length > 0) {
        const fields: Record<string, unknown> = {};
        for (const field of includeFields) {
          const text = typeof c[field] === "string" ? c[field] : "";
          fields[field] = {
            text: text.slice(0, maxChars),
            total_chars: text.length,
            truncated: text.length > maxChars,
          };
        }
        row["fields"] = fields;
      }
      return row;
    };
    const matchesFilters = (c: {
      name: string;
      tags?: readonly string[];
      extensions?: Readonly<Record<string, unknown>>;
    }): boolean => {
      if (q) {
        const tags = Array.isArray(c.tags) ? c.tags : [];
        if (!c.name.toLowerCase().includes(q) && !tags.some((tag) => tag.toLowerCase().includes(q))) return false;
      }
      if (requiredExtension && !visibleTopLevelExtensionKeys(c.extensions, skipExtensionSearch).includes(requiredExtension)) return false;
      return true;
    };

    if (!q && !requiredExtension) {
      const res = await ctx.spindle.characters.list({ limit, offset, userId: ctx.userId });
      const out = JSON.stringify({
        total: res.total,
        total_library: res.total,
        offset,
        returned: res.data.length,
        has_more: offset + res.data.length < res.total,
        next_offset: offset + res.data.length < res.total ? offset + res.data.length : null,
        ...(includeFields.length > 0 ? { include_fields: includeFields, max_chars_per_field: maxChars } : {}),
        characters: res.data.map(toRow),
      }, null, 2);
      return { content: await spillOrReturn(ctx, out, "list_characters") };
    }

    // A name query is a LIBRARY-WIDE filter: page through every character so a
    // match on a later page isn't missed, then window the matches by
    // offset/limit. The spindle `total` is the pre-filter count, so it can't be
    // surfaced as the match total.
    const library = await listAllCharacters(ctx.spindle, ctx.userId);
    const matches = library.filter(matchesFilters);
    const windowed = matches.slice(offset, offset + limit).map(toRow);
    const out = JSON.stringify({
      total: matches.length,
      total_library: library.length,
      offset,
      returned: windowed.length,
      has_more: offset + windowed.length < matches.length,
      next_offset: offset + windowed.length < matches.length ? offset + windowed.length : null,
      ...(q ? { query: input.query } : {}),
      ...(requiredExtension ? { extension_key: requiredExtension } : {}),
      ...(includeFields.length > 0 ? { include_fields: includeFields, max_chars_per_field: maxChars } : {}),
      scanned: library.length,
      characters: windowed,
    }, null, 2);
    return { content: await spillOrReturn(ctx, out, "list_characters") };
  },
});
