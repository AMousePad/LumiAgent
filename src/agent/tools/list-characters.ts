import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { fillPrompt } from "../prompts/_fill";
import { buildExtensionsSearchSkip } from "../../phoneline/search-excludes";
import description from "../prompts/claude/tools/list-characters/description.txt";
import argQuery from "../prompts/claude/tools/list-characters/arg_query.txt";
import argLimit from "../prompts/claude/tools/list-characters/arg_limit.txt";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_MAX_CHARS_PER_FIELD = 600;
const MAX_CHARS_PER_FIELD = 4000;
const MAX_EXTENSION_PROBES = 64;
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
type CatalogCharacter = {
  id: string;
  name: string;
  tags?: readonly string[];
  world_book_ids?: readonly string[];
  extensions?: Readonly<Record<string, unknown>>;
} & Partial<Record<DetailField, string>>;

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

const extensionKeySchema = z.string()
  .trim()
  .min(1, "extension key must contain a non-whitespace character");

const inputSchema = z.object({
  query: z.string().optional().describe("Case-insensitive substring filter on character names and tags."),
  extension_key: extensionKeySchema.optional().describe("Exact visible top-level extension key to require."),
  include_extension_keys: z.boolean().optional().describe("Include visible top-level extension keys in each returned row."),
  probe_extension_keys: z.array(extensionKeySchema).max(MAX_EXTENSION_PROBES).optional().describe("Report exact visible-key presence without returning extension content."),
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
      extension_key: { type: "string", minLength: 1, description: "Exact visible top-level extension key to require." },
      include_extension_keys: { type: "boolean", description: "Include visible top-level extension keys in each row." },
      probe_extension_keys: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: MAX_EXTENSION_PROBES,
        description: "Exact top-level keys to report in each row's extension_presence map.",
      },
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
    const requiredExtension = input.extension_key;
    const includeExtensionKeys = input.include_extension_keys === true;
    const probeExtensionKeys = [...new Set(input.probe_extension_keys ?? [])];
    const includeFields = [...new Set(input.include_fields ?? [])] as DetailField[];
    const maxChars = input.max_chars_per_field ?? DEFAULT_MAX_CHARS_PER_FIELD;
    const needsExtensionMetadata =
      requiredExtension !== undefined || includeExtensionKeys || probeExtensionKeys.length > 0;
    // The ordinary catalog remains cheap: only opt-in structural operations
    // discover phone-line providers. One predicate is then reused locally for
    // the whole page/scan, with the same root-list exclusion semantics as list.
    const skipExtensionSearch: ExtensionSearchSkip = needsExtensionMetadata
      ? await buildExtensionsSearchSkip(ctx.spindle, ctx.userId)
      : () => false;
    const toRow = (c: CatalogCharacter, knownExtensionKeys?: readonly string[]) => {
      const row: Record<string, unknown> = {
        id: c.id,
        name: c.name,
        tags: c.tags ?? [],
        world_book_count: c.world_book_ids?.length ?? 0,
      };
      if (includeExtensionKeys || probeExtensionKeys.length > 0) {
        const extensionKeys = knownExtensionKeys
          ?? visibleTopLevelExtensionKeys(c.extensions, skipExtensionSearch);
        if (includeExtensionKeys) row["extension_keys"] = extensionKeys;
        if (probeExtensionKeys.length > 0) {
          const present = new Set(extensionKeys);
          row["extension_presence"] = Object.fromEntries(
            probeExtensionKeys.map((key) => [key, present.has(key)]),
          );
        }
      }
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

    if (!q && requiredExtension === undefined) {
      const res = await ctx.spindle.characters.list({ limit, offset, userId: ctx.userId });
      const out = JSON.stringify({
        total: res.total,
        total_library: res.total,
        offset,
        returned: res.data.length,
        has_more: offset + res.data.length < res.total,
        next_offset: offset + res.data.length < res.total ? offset + res.data.length : null,
        ...(includeExtensionKeys ? { include_extension_keys: true } : {}),
        ...(probeExtensionKeys.length > 0 ? { probe_extension_keys: probeExtensionKeys } : {}),
        ...(includeFields.length > 0 ? { include_fields: includeFields, max_chars_per_field: maxChars } : {}),
        characters: res.data.map((character) => toRow(character)),
      }, null, 2);
      return { content: await spillOrReturn(ctx, out, "list_characters") };
    }

    // Filters are library-wide, but keep only ids and the requested output
    // window. CharacterDTO includes every large card field and extensions blob;
    // retaining the entire catalog here would turn a name lookup into O(all
    // card bytes) memory.
    const windowed: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let libraryTotal = 0;
    let scanned = 0;
    let matched = 0;
    let pageOffset = 0;
    for (;;) {
      const res = await ctx.spindle.characters.list({
        limit: MAX_LIMIT,
        offset: pageOffset,
        userId: ctx.userId,
      });
      libraryTotal = res.total;
      scanned += res.data.length;
      for (const c of res.data) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        if (q) {
          const tags = Array.isArray(c.tags) ? c.tags : [];
          if (!c.name.toLowerCase().includes(q) && !tags.some((tag) => tag.toLowerCase().includes(q))) {
            continue;
          }
        }
        let extensionKeys: string[] | undefined;
        if (requiredExtension !== undefined) {
          extensionKeys = visibleTopLevelExtensionKeys(c.extensions, skipExtensionSearch);
          if (!extensionKeys.includes(requiredExtension)) continue;
        }
        if (matched >= offset && windowed.length < limit) {
          windowed.push(toRow(c, extensionKeys));
        }
        matched++;
      }
      if (res.data.length === 0 || scanned >= res.total) break;
      pageOffset += res.data.length;
    }
    const out = JSON.stringify({
      total: matched,
      total_library: libraryTotal,
      offset,
      returned: windowed.length,
      has_more: offset + windowed.length < matched,
      next_offset: offset + windowed.length < matched ? offset + windowed.length : null,
      ...(q ? { query: input.query } : {}),
      ...(requiredExtension !== undefined ? { extension_key: requiredExtension } : {}),
      ...(includeExtensionKeys ? { include_extension_keys: true } : {}),
      ...(probeExtensionKeys.length > 0 ? { probe_extension_keys: probeExtensionKeys } : {}),
      ...(includeFields.length > 0 ? { include_fields: includeFields, max_chars_per_field: maxChars } : {}),
      scanned,
      characters: windowed,
    }, null, 2);
    return { content: await spillOrReturn(ctx, out, "list_characters") };
  },
});
