import { nameQuery, nameQueryProperty, matchesName, searchPage } from "./_name-search";
import { z } from "zod";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, resolveCharacterTargetOptional, noTargetResult } from "./_context";
import { parseExtensionPath, getAtPath } from "./_paths";
import { wbLabel } from "./_surfaces";
import { ExtensionRefusedError, ALTERNATE_FIELD_NAMES, readAltFieldArray, isAlternateFieldName, type AlternateFieldName } from "./_path_v2";
import description from "../prompts/claude/tools/list/description.txt";
import argPath from "../prompts/claude/tools/list/arg_path.txt";
import argCharacterId from "../prompts/claude/tools/list/arg_character_id.txt";
import argIncludeUnattached from "../prompts/claude/tools/list/arg_include_unattached.txt";
import argMaxEntries from "../prompts/claude/tools/list/arg_max_entries.txt";
import argMaxDepth from "../prompts/claude/tools/list/arg_max_depth.txt";

const inputSchema = z.object({
  query: nameQuery,
  path: z.string().describe("Container path. Empty / 'char' for the character overview. 'rx' for regex scripts. 'wb' for world books. 'wb/<bookId>' for entries in a book. 'char/alternate_greetings' for all greetings. 'char/extensions[/dotted]' for an extensions subtree. 'persona' for all personas. 'preset' for all presets. 'preset/<presetId>' for a preset's blocks."),
  offset: z.number().int().nonnegative().optional().describe("Zero-based result offset. Continue with next_offset from the previous page."),
  max_entries: z.number().int().positive().max(2000).optional().describe("Max items returned. Default 200."),
  max_depth: z.number().int().positive().max(10).optional().describe("Recursion depth (only used for extensions traversal). Default 4."),
  include_unattached: z.boolean().optional().describe("path='wb' only: list all owned world books, not just the character's attached ones. Works with no focused character; with one, rows carry an `attached` flag."),
  character_id: z.string().optional().describe("For char/rx/wb paths: which character. Defaults to the focused character."),
}).strict();

interface ListEntry {
  path: string;
  type: string;
  // `size` means different things per type and reading it as chars when it's
  // an entry count is the kind of bug that costs sessions. For container-type
  // rows (world books) emit `entries` instead so the unit is on the field
  // name. Leaf-type rows (wb_entry, string, etc.) keep `size` (chars).
  size?: number;
  entries?: number;
  label?: string;
}

function classifyNode(v: unknown): { type: string; size?: number } {
  if (v === null) return { type: "null" };
  if (Array.isArray(v)) return { type: "array", size: v.length };
  if (typeof v === "object") return { type: "object", size: Object.keys(v).length };
  if (typeof v === "string") return { type: "string", size: v.length };
  if (typeof v === "number") return { type: "number" };
  if (typeof v === "boolean") return { type: "boolean" };
  return { type: typeof v };
}

async function listCharacterRoot(ctx: ToolCtx, characterId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const fields = ["name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes", "system_prompt", "post_history_instructions", "creator"] as const;
  const out: ListEntry[] = [];
  for (const f of fields) {
    const v = (c as unknown as Record<string, unknown>)[f];
    if (typeof v === "string") out.push({ path: `char/${f}`, type: "string", size: v.length });
  }
  out.push({ path: "char/tags", type: "array", size: c.tags?.length ?? 0 });
  if (Array.isArray(c.alternate_greetings) && c.alternate_greetings.length > 0) {
    out.push({ path: "char/alternate_greetings", type: "array", size: c.alternate_greetings.length });
  }
  let altTotal = 0;
  for (const f of ALTERNATE_FIELD_NAMES) altTotal += readAltFieldArray(c.extensions, f).length;
  if (altTotal > 0) {
    out.push({ path: "char/alternate_fields", type: "alternate_fields", size: altTotal });
  }
  out.push({ path: "char/extensions", type: "object", size: c.extensions ? Object.keys(c.extensions).length : 0 });
  return out.filter(entry => matchesName(entry.label ?? entry.path, query)).slice(offset, offset + maxEntries);
}

async function listGreetings(ctx: ToolCtx, characterId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const arr = c.alternate_greetings ?? [];
  return arr.map((g, i) => ({
    path: `char/alternate_greetings/${i}`,
    type: "string",
    size: typeof g === "string" ? g.length : 0,
  })).filter(entry => matchesName(entry.path, query)).slice(offset, offset + maxEntries);
}

async function listAlternateFields(ctx: ToolCtx, characterId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const out: ListEntry[] = [];
  for (const f of ALTERNATE_FIELD_NAMES) {
    const variants = readAltFieldArray(c.extensions, f);
    out.push({ path: `char/alternate_fields/${f}`, type: "alt_field_group", entries: variants.length });
  }
  return out.filter(entry => matchesName(entry.label ?? entry.path, query)).slice(offset, offset + maxEntries);
}

async function listAlternateFieldVariants(ctx: ToolCtx, characterId: string, field: AlternateFieldName, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const variants = readAltFieldArray(c.extensions, field);
  return variants.map((v, i) => ({
    path: `char/alternate_fields/${field}/${v.id}`,
    type: "alt_field_variant",
    label: v.label || `(unlabeled #${i})`,
    size: v.content.length,
  })).filter(entry => matchesName(entry.label, query)).slice(offset, offset + maxEntries);
}

async function listRegex(ctx: ToolCtx, characterId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const page = await searchPage((limit, offset) => ctx.spindle.regex_scripts.list({ scope: "character", scopeId: characterId, userId: ctx.userId, limit, offset }),
    script => script.name, { limit: maxEntries, offset, query }, ctx.signal);
  return page.data.map(script => ({ path: `rx/${script.id}`, type: "regex_script", label: script.name, size: (script.find_regex?.length ?? 0) + (script.replace_string?.length ?? 0) }));
}

async function listWorldBooks(ctx: ToolCtx, characterId: string | null, maxEntries: number, includeUnattached: boolean, offset = 0, query?: string): Promise<ListEntry[]> {
  // characterId may be null only with includeUnattached: the whole library is
  // character-independent, the character just annotates `attached`.
  const attached = new Set<string>();
  if (characterId !== null) {
    const c = await ctx.spindle.characters.get(characterId, ctx.userId);
    if (!c) throw new Error(`character ${characterId} not found`);
    for (const id of c.world_book_ids ?? []) attached.add(id);
  }
  // Global ("Always Active") books are active in every chat despite showing
  // attached:false, so flag them to stop "unattached" reading as "inactive".
  const globalSet = includeUnattached
    ? new Set(await ctx.spindle.world_books.getGlobal(ctx.userId).catch(() => [] as string[]))
    : new Set<string>();
  const books = includeUnattached
    ? (await searchPage((limit, offset) => ctx.spindle.world_books.list({ limit, offset, userId: ctx.userId }),
        book => book.name, { limit: maxEntries, offset, query }, ctx.signal)).data
    : [];
  if (!includeUnattached) {
    let skipped = 0;
    for (const id of attached) {
      ctx.signal.throwIfAborted();
      const book = await ctx.spindle.world_books.get(id, ctx.userId);
      if (!book || !matchesName(book.name, query)) continue;
      if (skipped++ < offset) continue;
      books.push(book);
      if (books.length >= maxEntries) break;
    }
  }
  const out: ListEntry[] = [];
  for (const wb of books) {
    ctx.signal.throwIfAborted();
    const wbId = wb.id;
    const meta = await ctx.spindle.world_books.entries.list(wbId, { limit: 1, userId: ctx.userId });
    const entry: ListEntry = { path: `wb/${wbId}`, type: "world_book", label: wb.name, entries: meta.total };
    if (includeUnattached && characterId !== null) (entry as ListEntry & { attached: boolean }).attached = attached.has(wbId);
    if (globalSet.has(wbId)) (entry as ListEntry & { global: boolean }).global = true;
    out.push(entry);
  }
  return out;
}

async function listWorldBookEntries(ctx: ToolCtx, bookId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const page = await searchPage((limit, offset) => ctx.spindle.world_books.entries.list(bookId, { limit, offset, userId: ctx.userId }),
    wbLabel, { limit: maxEntries, offset, query }, ctx.signal);
  return page.data.map(entry => {
    const row: ListEntry & { keys?: string[]; secondary_keys?: string[]; constant?: true; disabled?: true } = { path: `wb/${entry.id}`, type: "wb_entry", label: wbLabel(entry), size: entry.content?.length ?? 0 };
    if (entry.key?.length) row.keys = entry.key;
    if (entry.keysecondary?.length) row.secondary_keys = entry.keysecondary;
    if (entry.constant) row.constant = true;
    if (entry.disabled) row.disabled = true;
    return row;
  });
}

async function listExtensions(ctx: ToolCtx, characterId: string, subPath: string, maxEntries: number, maxDepth: number, offset = 0, query?: string): Promise<ListEntry[]> {
  // Gate the entry point on the phone-line check_read so callers can't peek
  // into refused subtrees (lumirealm.source.*, etc.) by addressing them here.
  if (subPath !== "") {
    const { checkExtensionRead } = await import("../../phoneline/gate");
    const res = await checkExtensionRead(ctx.spindle, ctx.userId, characterId, subPath);
    if (!res.ok) throw new ExtensionRefusedError(`char/extensions/${subPath}`, "read", res.message ?? "extension refused read at this path");
  }
  // Same search-exclude predicate the find/grep walkers use, so refused-but-
  // unaddressed children (lumirealm.payload.background_html etc.) don't leak
  // through a list of a permitted parent.
  const { buildExtensionsSearchSkip } = await import("../../phoneline/search-excludes");
  const skip = await buildExtensionsSearchSkip(ctx.spindle, ctx.userId);

  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const segs = subPath === "" ? [] : parseExtensionPath(subPath);
  const root = getAtPath(c.extensions ?? {}, segs);
  if (root === undefined) throw new Error(`extensions${subPath === "" ? "" : "." + subPath} does not exist`);
  const out: ListEntry[] = [];
  let visited = 0;
  const visit = (node: unknown, prefix: string, depth: number): void => {
    if (out.length >= maxEntries) return;
    const info = classifyNode(node);
    const fullDotted = subPath === ""
      ? prefix
      : (prefix === "" ? subPath : (subPath + (prefix.startsWith("[") ? "" : ".") + prefix));
    if (prefix !== "" && skip(fullDotted)) return;
    if (prefix !== "") {
      const entry: ListEntry = { path: `char/extensions/${fullDotted}`, type: info.type };
      if (info.size !== undefined) entry.size = info.size;
      if (matchesName(entry.label ?? entry.path, query) && visited++ >= offset) out.push(entry);
    }
    if (depth >= maxDepth) return;
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (out.length >= maxEntries) return;
        visit(node[i], `${prefix}[${i}]`, depth + 1);
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (out.length >= maxEntries) return;
      const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      const isIdent = safeKey === k;
      const seg = isIdent ? (prefix === "" ? k : `.${k}`) : `[${safeKey}]`;
      visit(v, prefix + seg, depth + 1);
    }
  };
  visit(root, "", 0);
  return out;
}

async function listPersonas(ctx: ToolCtx, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const page = await searchPage((limit, offset) => ctx.spindle.personas.list({ limit, offset, userId: ctx.userId }),
    persona => persona.name, { limit: maxEntries, offset, query }, ctx.signal);
  return page.data.map(persona => ({ path: `persona/${persona.id}`, type: "persona", label: persona.name, size: persona.description?.length ?? 0 }));
}

async function listPresets(ctx: ToolCtx, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const page = await searchPage((limit, offset) => ctx.spindle.presets.list({ limit, offset, userId: ctx.userId }),
    preset => preset.name, { limit: maxEntries, offset, query }, ctx.signal);
  return page.data.map(preset => ({ path: `preset/${preset.id}`, type: "preset", label: preset.name }));
}

async function listPresetBlocks(ctx: ToolCtx, presetId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
  const entries: ListEntry[] = blocks.map((b) => {
    const content = (b as unknown as Record<string, unknown>).content;
    const enabled = (b as unknown as Record<string, unknown>).enabled;
    return {
      path: `preset/${presetId}/block/${b.id}`,
      type: "preset_block",
      label: b.name || "block",
      size: typeof content === "string" ? content.length : 0,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
    };
  });
  // New-chat, continue, impersonation and nudge prompts live outside the block list.
  const preset = await ctx.spindle.presets.get(presetId, ctx.userId);
  const { walkStringLeaves } = await import("./_walk");
  for (const leaf of walkStringLeaves(preset?.prompts ?? {})) {
    entries.push({ path: `preset/${presetId}/prompts/${leaf.path}`, type: "preset_prompt", label: `prompts.${leaf.path}`, size: leaf.text.length });
  }
  return entries.filter(entry => matchesName(entry.label, query)).slice(offset, offset + maxEntries);
}

export const listTool = defineTool({
  name: "list",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: nameQueryProperty,
      path: { type: "string", description: argPath },
      offset: { type: "integer", minimum: 0, description: "Zero-based result offset. Continue with next_offset." },
      max_entries: { type: "integer", minimum: 1, maximum: 2000, description: argMaxEntries },
      max_depth: { type: "integer", minimum: 1, maximum: 10, description: argMaxDepth },
      character_id: { type: "string", description: argCharacterId },
      include_unattached: { type: "boolean", description: argIncludeUnattached },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Path-targeted: persona / preset containers resolve without a character;
  // char/ rx/ wb/ branches loud-fail below when none is selected.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const query = input.query;
    const pageSize = input.max_entries ?? 200;
    const maxEntries = pageSize + 1;
    const offset = input.offset ?? 0;
    const path = input.path.trim();
    const rootExtensions = path === "char/extensions" || path === "extensions";
    const maxDepth = input.max_depth ?? (rootExtensions ? 1 : 4);
    try {
      const personaOrPreset = path === "persona" || path === "personas"
        || path === "preset" || path === "presets" || path.startsWith("preset/");
      // wb/<bookId> entry listing is book-id-scoped, needs no character.
      const wbEntryListing = path.startsWith("wb/") || path.startsWith("world_books/");
      // Whole-library world-book listing (include_unattached) is character-
      // independent: the character only annotates `attached`. Don't gate it.
      const wbWholeLibrary = (path === "wb" || path === "world_books") && input.include_unattached === true;
      let target = "";
      if (!personaOrPreset && !wbEntryListing && !wbWholeLibrary) {
        try { target = resolveCharacterTarget(ctx, input.character_id); }
        catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
      } else if (wbWholeLibrary) {
        target = resolveCharacterTargetOptional(ctx, input.character_id) ?? "";
      }
      let entries: ListEntry[];
      if (path === "" || path === "char" || path === "character") {
        entries = await listCharacterRoot(ctx, target, maxEntries, offset, query);
      } else if (path === "char/alternate_greetings" || path === "alternate_greetings") {
        entries = await listGreetings(ctx, target, maxEntries, offset, query);
      } else if (path === "char/alternate_fields" || path === "alternate_fields") {
        entries = await listAlternateFields(ctx, target, maxEntries, offset, query);
      } else if (path.startsWith("char/alternate_fields/") || path.startsWith("alternate_fields/")) {
        const field = path.replace(/^(char\/)?alternate_fields\//, "");
        if (!isAlternateFieldName(field)) {
          return { content: `Error: [PATH_NOT_FOUND] unknown alternate field '${field}'. Valid: ${ALTERNATE_FIELD_NAMES.join(", ")}.`, isError: true };
        }
        entries = await listAlternateFieldVariants(ctx, target, field, maxEntries, offset, query);
      } else if (path === "rx" || path === "regex_scripts") {
        entries = await listRegex(ctx, target, maxEntries, offset, query);
      } else if (path === "wb" || path === "world_books") {
        entries = await listWorldBooks(ctx, target === "" ? null : target, maxEntries, input.include_unattached === true, offset, query);
      } else if (path.startsWith("wb/") || path.startsWith("world_books/")) {
        const bookId = path.split("/")[1] ?? "";
        if (!bookId) return { content: "Error: wb/<bookId> requires a book id", isError: true };
        entries = await listWorldBookEntries(ctx, bookId, maxEntries, offset, query);
      } else if (path === "char/extensions" || path === "extensions") {
        entries = await listExtensions(ctx, target, "", maxEntries, maxDepth, offset, query);
      } else if (path.startsWith("char/extensions/") || path.startsWith("extensions/")) {
        const sub = path.replace(/^(char\/)?extensions\//, "");
        entries = await listExtensions(ctx, target, sub, maxEntries, maxDepth, offset, query);
      } else if (path === "persona" || path === "personas") {
        entries = await listPersonas(ctx, maxEntries, offset, query);
      } else if (path === "preset" || path === "presets") {
        entries = await listPresets(ctx, maxEntries, offset, query);
      } else if (path.startsWith("preset/")) {
        const presetId = path.split("/")[1] ?? "";
        if (!presetId) return { content: "Error: preset/<presetId> requires a preset id", isError: true };
        entries = await listPresetBlocks(ctx, presetId, maxEntries, offset, query);
      } else {
        return { content: `Error: unknown list path '${path}'. Try: '', 'char/alternate_greetings', 'rx', 'wb', 'wb/<id>', 'char/extensions[/dotted]', 'persona', 'preset', 'preset/<id>'.`, isError: true };
      }
      const hasMore = entries.length > pageSize;
      entries = entries.slice(0, pageSize);
      return { content: JSON.stringify({ path, offset, count: entries.length, has_more: hasMore,
        next_offset: hasMore ? offset + entries.length : null, entries }, null, 2) };
    } catch (err) {
      if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});
