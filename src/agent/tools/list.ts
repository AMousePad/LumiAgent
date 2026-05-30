import { z } from "zod";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, noTargetResult } from "./_context";
import { parseExtensionPath, getAtPath } from "./_paths";
import { wbLabel } from "./_surfaces";
import { ExtensionRefusedError, ALTERNATE_FIELD_NAMES, readAltFieldArray, isAlternateFieldName, type AlternateFieldName } from "./_path_v2";

const inputSchema = z.object({
  path: z.string().describe("Container path. Empty / 'char' for the character overview. 'rx' for regex scripts. 'wb' for world books. 'wb/<bookId>' for entries in a book. 'char/alternate_greetings' for all greetings. 'char/extensions[/dotted]' for an extensions subtree. 'persona' for all personas. 'preset' for all presets. 'preset/<presetId>' for a preset's blocks."),
  max_entries: z.number().int().positive().max(2000).optional().describe("Max items returned. Default 200."),
  max_depth: z.number().int().positive().max(10).optional().describe("Recursion depth (only used for extensions traversal). Default 4."),
  include_unattached: z.boolean().optional().describe("Only meaningful for path='wb': also list world books the user owns but hasn't attached to this character. Each row carries an `attached` flag. Use when picking a destination for a new world_book_entry."),
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

async function listCharacterRoot(ctx: ToolCtx, characterId: string, maxEntries: number): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const fields = ["name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes", "system_prompt", "post_history_instructions", "creator"] as const;
  const out: ListEntry[] = [];
  for (const f of fields) {
    const v = (c as unknown as Record<string, unknown>)[f];
    if (typeof v === "string") out.push({ path: `char/${f}`, type: "string", size: v.length });
  }
  if (Array.isArray(c.alternate_greetings) && c.alternate_greetings.length > 0) {
    out.push({ path: "char/alternate_greetings", type: "array", size: c.alternate_greetings.length });
  }
  let altTotal = 0;
  for (const f of ALTERNATE_FIELD_NAMES) altTotal += readAltFieldArray(c.extensions, f).length;
  if (altTotal > 0) {
    out.push({ path: "char/alternate_fields", type: "alternate_fields", size: altTotal });
  }
  out.push({ path: "char/extensions", type: "object", size: c.extensions ? Object.keys(c.extensions).length : 0 });
  return out.slice(0, maxEntries);
}

async function listGreetings(ctx: ToolCtx, characterId: string, maxEntries: number): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const arr = c.alternate_greetings ?? [];
  return arr.slice(0, maxEntries).map((g, i) => ({
    path: `char/alternate_greetings/${i}`,
    type: "string",
    size: typeof g === "string" ? g.length : 0,
  }));
}

async function listAlternateFields(ctx: ToolCtx, characterId: string, maxEntries: number): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const out: ListEntry[] = [];
  for (const f of ALTERNATE_FIELD_NAMES) {
    const variants = readAltFieldArray(c.extensions, f);
    out.push({ path: `char/alternate_fields/${f}`, type: "alt_field_group", entries: variants.length });
    if (out.length >= maxEntries) break;
  }
  return out;
}

async function listAlternateFieldVariants(ctx: ToolCtx, characterId: string, field: AlternateFieldName, maxEntries: number): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const variants = readAltFieldArray(c.extensions, field);
  return variants.slice(0, maxEntries).map((v, i) => ({
    path: `char/alternate_fields/${field}/${v.id}`,
    type: "alt_field_variant",
    label: v.label || `(unlabeled #${i})`,
    size: v.content.length,
  }));
}

async function listRegex(ctx: ToolCtx, characterId: string, maxEntries: number): Promise<ListEntry[]> {
  const out: ListEntry[] = [];
  let offset = 0;
  while (out.length < maxEntries) {
    const r = await ctx.spindle.regex_scripts.list({ scope: "character", scopeId: characterId, userId: ctx.userId, limit: 200, offset });
    for (const s of r.data) {
      if (out.length >= maxEntries) break;
      out.push({ path: `rx/${s.id}`, type: "regex_script", label: s.name, size: (s.find_regex?.length ?? 0) + (s.replace_string?.length ?? 0) });
    }
    if (r.data.length === 0 || offset + r.data.length >= r.total) break;
    offset += r.data.length;
  }
  return out;
}

async function listWorldBooks(ctx: ToolCtx, characterId: string, maxEntries: number, includeUnattached: boolean): Promise<ListEntry[]> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) throw new Error(`character ${characterId} not found`);
  const attached = new Set(c.world_book_ids ?? []);
  const wbIds = includeUnattached
    ? (await ctx.spindle.world_books.list({ limit: 1000, userId: ctx.userId })).data.map((wb) => wb.id)
    : [...attached];
  const out: ListEntry[] = [];
  for (const wbId of wbIds) {
    if (out.length >= maxEntries) break;
    const wb = await ctx.spindle.world_books.get(wbId, ctx.userId);
    if (!wb) continue;
    const meta = await ctx.spindle.world_books.entries.list(wbId, { limit: 1, userId: ctx.userId });
    const entry: ListEntry = { path: `wb/${wbId}`, type: "world_book", label: wb.name, entries: meta.total };
    if (includeUnattached) (entry as ListEntry & { attached: boolean }).attached = attached.has(wbId);
    out.push(entry);
  }
  return out;
}

async function listWorldBookEntries(ctx: ToolCtx, bookId: string, maxEntries: number): Promise<ListEntry[]> {
  const out: ListEntry[] = [];
  let offset = 0;
  while (out.length < maxEntries) {
    const r = await ctx.spindle.world_books.entries.list(bookId, { limit: 500, userId: ctx.userId, offset });
    for (const e of r.data) {
      if (out.length >= maxEntries) break;
      out.push({ path: `wb/${e.id}`, type: "wb_entry", label: wbLabel(e), size: (e.content?.length ?? 0) });
    }
    if (r.data.length === 0 || offset + r.data.length >= r.total) break;
    offset += r.data.length;
  }
  return out;
}

async function listExtensions(ctx: ToolCtx, characterId: string, subPath: string, maxEntries: number, maxDepth: number): Promise<ListEntry[]> {
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
      out.push(entry);
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

async function listPersonas(ctx: ToolCtx, maxEntries: number): Promise<ListEntry[]> {
  const out: ListEntry[] = [];
  let offset = 0;
  while (out.length < maxEntries) {
    const r = await ctx.spindle.personas.list({ limit: 200, offset, userId: ctx.userId });
    for (const p of r.data) {
      if (out.length >= maxEntries) break;
      out.push({ path: `persona/${p.id}`, type: "persona", label: p.name, size: p.description?.length ?? 0 });
    }
    if (r.data.length === 0 || offset + r.data.length >= r.total) break;
    offset += r.data.length;
  }
  return out;
}

async function listPresets(ctx: ToolCtx, maxEntries: number): Promise<ListEntry[]> {
  const out: ListEntry[] = [];
  let offset = 0;
  while (out.length < maxEntries) {
    const r = await ctx.spindle.presets.list({ limit: 200, offset, userId: ctx.userId });
    for (const p of r.data) {
      if (out.length >= maxEntries) break;
      out.push({ path: `preset/${p.id}`, type: "preset", label: p.name });
    }
    if (r.data.length === 0 || offset + r.data.length >= r.total) break;
    offset += r.data.length;
  }
  return out;
}

async function listPresetBlocks(ctx: ToolCtx, presetId: string, maxEntries: number): Promise<ListEntry[]> {
  const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
  return blocks.slice(0, maxEntries).map((b) => {
    const content = (b as unknown as Record<string, unknown>).content;
    return {
      path: `preset/${presetId}/block/${b.id}`,
      type: "preset_block",
      label: b.name || "block",
      size: typeof content === "string" ? content.length : 0,
    };
  });
}

export const listTool = defineTool({
  name: "list",
  description: `Directory-style listing for any structural path.

Path forms:
- (empty) or 'char'                  the character's top-level shape
- 'char/alternate_greetings'         all greetings
- 'char/alternate_fields'            description / personality / scenario variant counts
- 'char/alternate_fields/<field>'    variants for one of description / personality / scenario
- 'char/extensions'                  top-level keys of extensions
- 'char/extensions/<dotted>'         keys/indices under that subtree (recurses up to max_depth)
- 'rx'                               all character-scoped regex scripts
- 'wb'                               all attached world books
- 'wb/<bookId>'                      all entries in a world book
- 'persona'                          all of the user's personas (works without an active character)
- 'preset'                           all prompt presets (works without an active character)
- 'preset/<presetId>'                all prompt blocks in a preset

\`char/\`, \`rx\`, \`wb\` need an active character; \`persona\` / \`preset\` do not.

Each returned row carries:
- \`path\`     — pass straight to \`read\` / \`inspect\` / \`edit\`.
- \`type\`     — one of: \`string\`, \`array\`, \`object\`, \`regex_script\`, \`world_book\`, \`wb_entry\`, etc.
- \`label\`    — human name when there is one (regex script name, world book name, entry comment).
- \`size\`     — for string leaves: character count. For arrays/objects: child count. For \`wb_entry\`: content character count.
- \`entries\`  — only on \`world_book\` rows: total entry count in the book. Read this, not \`size\`, to gauge book volume.

Container paths (\`rx/<scriptId>\`, \`wb/<entryId>\`) are inspectable as a whole via \`inspect\`; to \`read\` / \`edit\` a string leaf, append the field name (\`rx/<scriptId>/find_regex\` or \`/replace_string\`; \`wb/<entryId>/content\` or \`/comment\`). Leaf paths (\`char/<field>\`, \`char/alternate_greetings/<idx>\`, \`char/extensions/<dotted>\`) are directly read/editable.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Container path. See description for forms." },
      max_entries: { type: "integer", minimum: 1, maximum: 2000 },
      max_depth: { type: "integer", minimum: 1, maximum: 10 },
      character_id: { type: "string", description: "For char/rx/wb paths: defaults to the focused character." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Path-targeted: persona / preset containers resolve without a character;
  // char/ rx/ wb/ branches loud-fail below when none is selected.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const maxEntries = input.max_entries ?? 200;
    const maxDepth = input.max_depth ?? 4;
    const path = input.path.trim();
    try {
      const personaOrPreset = path === "persona" || path === "personas"
        || path === "preset" || path === "presets" || path.startsWith("preset/");
      // wb/<bookId> entry listing is book-id-scoped, needs no character.
      const wbEntryListing = path.startsWith("wb/") || path.startsWith("world_books/");
      let target = "";
      if (!personaOrPreset && !wbEntryListing) {
        try { target = resolveCharacterTarget(ctx, input.character_id); }
        catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
      }
      let entries: ListEntry[];
      if (path === "" || path === "char" || path === "character") {
        entries = await listCharacterRoot(ctx, target, maxEntries);
      } else if (path === "char/alternate_greetings" || path === "alternate_greetings") {
        entries = await listGreetings(ctx, target, maxEntries);
      } else if (path === "char/alternate_fields" || path === "alternate_fields") {
        entries = await listAlternateFields(ctx, target, maxEntries);
      } else if (path.startsWith("char/alternate_fields/") || path.startsWith("alternate_fields/")) {
        const field = path.replace(/^(char\/)?alternate_fields\//, "");
        if (!isAlternateFieldName(field)) {
          return { content: `Error: [PATH_NOT_FOUND] unknown alternate field '${field}'. Valid: ${ALTERNATE_FIELD_NAMES.join(", ")}.`, isError: true };
        }
        entries = await listAlternateFieldVariants(ctx, target, field, maxEntries);
      } else if (path === "rx" || path === "regex_scripts") {
        entries = await listRegex(ctx, target, maxEntries);
      } else if (path === "wb" || path === "world_books") {
        entries = await listWorldBooks(ctx, target, maxEntries, input.include_unattached === true);
      } else if (path.startsWith("wb/") || path.startsWith("world_books/")) {
        const bookId = path.split("/")[1] ?? "";
        if (!bookId) return { content: "Error: wb/<bookId> requires a book id", isError: true };
        entries = await listWorldBookEntries(ctx, bookId, maxEntries);
      } else if (path === "char/extensions" || path === "extensions") {
        entries = await listExtensions(ctx, target, "", maxEntries, maxDepth);
      } else if (path.startsWith("char/extensions/") || path.startsWith("extensions/")) {
        const sub = path.replace(/^(char\/)?extensions\//, "");
        entries = await listExtensions(ctx, target, sub, maxEntries, maxDepth);
      } else if (path === "persona" || path === "personas") {
        entries = await listPersonas(ctx, maxEntries);
      } else if (path === "preset" || path === "presets") {
        entries = await listPresets(ctx, maxEntries);
      } else if (path.startsWith("preset/")) {
        const presetId = path.split("/")[1] ?? "";
        if (!presetId) return { content: "Error: preset/<presetId> requires a preset id", isError: true };
        entries = await listPresetBlocks(ctx, presetId, maxEntries);
      } else {
        return { content: `Error: unknown list path '${path}'. Try: '', 'char/alternate_greetings', 'rx', 'wb', 'wb/<id>', 'char/extensions[/dotted]', 'persona', 'preset', 'preset/<id>'.`, isError: true };
      }
      return { content: JSON.stringify({ path, count: entries.length, entries }, null, 2) };
    } catch (err) {
      if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});
