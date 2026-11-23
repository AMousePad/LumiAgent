import { nameQuery, nameQueryProperty, matchesName, searchPage } from "./_name-search";
import { z } from "zod";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, resolveCharacterTargetOptional, noTargetResult } from "./_context";
import { parseExtensionPath, getAtPath } from "./_paths";
import { listWorldBooks, listWorldBookEntries } from "./_worldbook";
import { countGlobalRegexScripts, regexSearchKey, targetList, visibleRegexReader } from "./_regex";
import { describeActivePreset, listAllPresets, presetVars, presetVarTable } from "./_preset";
import { ExtensionRefusedError, ALTERNATE_FIELD_NAMES, readAltFieldArray, isAlternateFieldName, isCharSubtreeToken, type AlternateFieldName } from "./_path_v2";
import { splitCharacterPath } from "./_character";
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
  scope?: string;
  target?: string;
  folder?: string;
  disabled?: true;
  preset_id?: string;
  preset?: string | undefined;
  index?: number;
  blocks?: number;
  variables?: number;
  mode?: string;
  marker?: string;
  enabled?: boolean;
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

// A name query spans character and global scripts. Without one, a focused
// character lists only its own, so a large global library is never dumped.
async function listRegex(ctx: ToolCtx, characterId: string | null, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const searching = (query ?? "").trim().length > 0;
  const read = searching || characterId === null
    ? visibleRegexReader(ctx, searching ? characterId : null)
    : (limit: number, off: number) => ctx.spindle.regex_scripts.list({ scope: "character", scopeId: characterId, userId: ctx.userId, limit, offset: off });
  // Users name a preset's regexes by the preset, which the script row only carries as an id.
  const presetNames = new Map<string, string>();
  if (searching) {
    try {
      for (let off = 0; ; ) {
        const r = await ctx.spindle.presets.list({ limit: 200, offset: off, userId: ctx.userId });
        for (const preset of r.data) presetNames.set(preset.id, preset.name);
        off += r.data.length;
        if (r.data.length === 0 || off >= r.total) break;
      }
    } catch { /* names are a search convenience */ }
  }
  const presetOf = (script: { preset_id?: string | null }) => (script.preset_id ? presetNames.get(script.preset_id) : undefined);
  const page = await searchPage(read, script => `${regexSearchKey(script)}
${presetOf(script) ?? ""}`, { limit: maxEntries, offset, query }, ctx.signal);
  return page.data.map(script => ({
    path: `rx/${script.id}`, type: "regex_script", label: script.name,
    size: (script.find_regex?.length ?? 0) + (script.replace_string?.length ?? 0),
    scope: script.scope, target: targetList(script).join(","),
    ...(script.folder ? { folder: script.folder } : {}),
    ...(script.disabled ? { disabled: true } : {}),
    ...(script.preset_id ? { preset_id: script.preset_id } : {}),
    ...(presetOf(script) ? { preset: presetOf(script) } : {}),
  }));
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
  return page.data.map(preset => {
    const blocks = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
    const variables = presetVars(preset).length;
    return { path: `preset/${preset.id}`, type: "preset", label: preset.name, blocks: blocks.length, ...(variables > 0 ? { variables } : {}) };
  });
}

async function listPresetBlocks(ctx: ToolCtx, presetId: string, maxEntries: number, offset = 0, query?: string): Promise<ListEntry[]> {
  const preset = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!preset) throw new Error(`[PATH_NOT_FOUND] preset ${presetId} not found. list({path:"preset", query:"<name>"}) finds the id.`);
  const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
  const entries: ListEntry[] = blocks.map((b, index) => {
    const content = (b as unknown as Record<string, unknown>).content;
    const enabled = (b as unknown as Record<string, unknown>).enabled;
    const category = b.marker === "category";
    return {
      path: `preset/${presetId}/block/${b.id}`,
      type: category ? "preset_category" : "preset_block",
      label: b.name || "block",
      index,
      size: typeof content === "string" ? content.length : 0,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...(category && typeof b.categoryMode === "string" ? { mode: b.categoryMode } : {}),
      ...(!category && typeof b.marker === "string" && b.marker.length > 0 ? { marker: b.marker } : {}),
      ...(Array.isArray(b.variables) && b.variables.length > 0 ? { variables: b.variables.length } : {}),
    };
  });
  // New-chat, continue, impersonation and nudge prompts live outside the block list.
  const { walkStringLeaves } = await import("./_walk");
  for (const leaf of walkStringLeaves(preset.prompts ?? {})) {
    entries.push({ path: `preset/${presetId}/prompts/${leaf.path}`, type: "preset_prompt", label: `prompts.${leaf.path}`, size: leaf.text.length });
  }
  return entries.filter(entry => matchesName(entry.label, query)).slice(offset, offset + maxEntries);
}

const UNKNOWN_LIST_PATH = (path: string) =>
  `Error: [PATH_NOT_FOUND] unknown list path '${path}'. Valid: '' or 'char' (character overview), 'char/alternate_greetings', 'char/alternate_fields', 'char/extensions[/dotted]', 'rx', 'wb', 'wb/<bookId>', 'persona', 'preset', 'preset/<presetId>', 'preset/<presetId>/var'.`;

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
  // Path-targeted: persona / preset / rx containers resolve without a character.
  // char/ and wb/ branches loud-fail below when none is selected.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const query = input.query;
    const pageSize = input.max_entries ?? 200;
    const maxEntries = pageSize + 1;
    const offset = input.offset ?? 0;
    // char/<id> alone lists that card's root, char/<id>/<sub> one of its containers.
    const rootOf = /^(?:char|character)\/([^/]+)\/?$/.exec(input.path.trim());
    const split = rootOf && !isCharSubtreeToken(rootOf[1]!)
      ? { path: "char", target: rootOf[1]! }
      : splitCharacterPath(input.path.trim(), input.character_id);
    const path = split.path;
    const characterArg = split.target ?? undefined;
    const rootExtensions = path === "char/extensions" || path === "extensions";
    const maxDepth = input.max_depth ?? (rootExtensions ? 1 : 4);
    try {
      const personaOrPreset = path === "persona" || path === "personas"
        || path === "preset" || path === "presets" || path.startsWith("preset/") || path.startsWith("presets/");
      // wb/<bookId> entry listing is book-id-scoped, needs no character.
      const wbEntryListing = path.startsWith("wb/") || path.startsWith("world_books/");
      // The book library is character-independent. A character only annotates `attached` and picks the default rows.
      const wbWholeLibrary = path === "wb" || path === "world_books";
      const rxListing = path === "rx" || path === "regex_scripts";
      let target = "";
      if (rxListing) {
        target = resolveCharacterTargetOptional(ctx, characterArg) ?? "";
      } else if (!personaOrPreset && !wbEntryListing && !wbWholeLibrary) {
        // A mistyped root must not be reported as a missing character.
        if (path !== "" && !/^(?:char|character|alternate_greetings|alternate_fields|extensions)(?:\/|$)/.test(path)) {
          return { content: UNKNOWN_LIST_PATH(path), isError: true };
        }
        try { target = resolveCharacterTarget(ctx, characterArg); }
        catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
      } else if (wbWholeLibrary) {
        target = resolveCharacterTargetOptional(ctx, characterArg) ?? "";
      }
      let entries: ListEntry[];
      let wbNote: Record<string, unknown> = {};
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
      } else if (rxListing) {
        entries = await listRegex(ctx, target === "" ? null : target, maxEntries, offset, query);
      } else if (path === "wb" || path === "world_books") {
        const listed = await listWorldBooks(ctx, target === "" ? null : target, maxEntries, input.include_unattached === true, offset, query);
        entries = listed.entries;
        wbNote = listed.extra;
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
      } else if (path.startsWith("preset/") || path.startsWith("presets/")) {
        const [, presetId = "", sub, ...rest] = path.split("/").filter((seg) => seg.length > 0);
        if (!presetId) return { content: "Error: preset/<presetId> requires a preset id", isError: true };
        if (sub === "var" || sub === "vars" || sub === "variables") {
          const preset = await ctx.spindle.presets.get(presetId, ctx.userId);
          if (!preset) return { content: `Error: [PATH_NOT_FOUND] preset ${presetId} not found. list({path:"preset", query:"<name>"}) finds the id.`, isError: true };
          return { content: JSON.stringify(presetVarTable(preset, query ?? rest[rest.length - 1]), null, 2) };
        }
        if (sub !== undefined && sub !== "block" && sub !== "blocks") {
          return { content: `Error: [PATH_NOT_FOUND] '${path}' is not a container. list takes preset/${presetId} (blocks) or preset/${presetId}/var (settings variables). Read a setting with read({path:"${path}"}).`, isError: true };
        }
        entries = await listPresetBlocks(ctx, presetId, maxEntries, offset, query);
      } else {
        return { content: UNKNOWN_LIST_PATH(path), isError: true };
      }
      const hasMore = entries.length > pageSize;
      entries = entries.slice(0, pageSize);
      // Rows for a non-focused character carry its id, or a follow-up read would land on the focused card.
      if (target !== "" && target !== ctx.characterId) {
        entries = entries.map((e) => (e.path.startsWith("char/") ? { ...e, path: `char/${target}/${e.path.slice(5)}` } : e));
      }
      let regexNote: Record<string, unknown> = {};
      if (rxListing && target !== "" && (query ?? "").trim().length === 0) {
        const globals = await countGlobalRegexScripts(ctx).catch(() => 0);
        if (globals > 0) regexNote = { global_scripts: globals, note: `Rows are this character's scripts. ${globals} global scripts also apply: pass query (script name or folder name) to search them, or inspect({path:"rx"}) for the folder breakdown.` };
      }
      let presetNote: Record<string, unknown> = {};
      if (path === "preset" || path === "presets") {
        const active = await describeActivePreset(ctx, await listAllPresets(ctx)).catch(() => null);
        if (active) presetNote = { active };
      } else if (path.startsWith("preset/") && entries.some((e) => (e.variables ?? 0) > 0)) {
        presetNote = { note: `Blocks with variables carry user-facing settings. Their labels, options and current values: list({path:"${path.split("/").slice(0, 2).join("/")}/var"}).` };
      }
      return { content: JSON.stringify({ path, offset, count: entries.length, has_more: hasMore,
        next_offset: hasMore ? offset + entries.length : null, ...regexNote, ...presetNote, ...wbNote, entries }, null, 2) };
    } catch (err) {
      if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});
