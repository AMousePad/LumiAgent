import { z } from "zod";
import type { WorldBookEntryDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, resolveCharacterTargetOptional, noTargetResult } from "./_context";
import { resolveRead, PathError, OutOfRangeError, ExtensionRefusedError, listAllWorldBooks, type ResolvedLeaf } from "./_path_v2";
import { wbLabel } from "./_surfaces";
import description from "../prompts/claude/tools/inspect/description.txt";
import argPath from "../prompts/claude/tools/inspect/arg_path.txt";
import argCharacterId from "../prompts/claude/tools/inspect/arg_character_id.txt";

const PEEK_CHARS = 200;
const TOP_N = 10;
const CJK_RE = /[가-힣぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/g;
const HANGUL_NFC_RANGE = /[가-힣]+/g;
const HANGUL_JAMO_RANGE = /[ᄀ-ᇿ]+/g;
const MIRRORED_CHARACTER_FIELDS = new Set([
  "first_mes", "description", "personality", "scenario",
  "system_prompt", "post_history_instructions", "mes_example",
]);

const inputSchema = z.object({
  path: z.string().min(2).describe("Path or container path. See description for forms."),
  character_id: z.string().optional().describe("For rx/wb containers: which character. Defaults to focus. 'wb' lists the whole library even with none; the id only annotates `attached`."),
}).strict();

function cjkCount(text: string): number {
  CJK_RE.lastIndex = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = CJK_RE.exec(text)) !== null) n += m[0].length;
  return n;
}

// Encoding-state diagnostics. The agent uses these to decide whether to copy
// bytes verbatim (clean source) or read with extra care (NFD Hangul, NBSPs,
// CRLF, mixed line endings). Cheap to compute and surfaced on every inspect.
async function buildDiagnostics(ctx: ToolCtx, leaf: ResolvedLeaf): Promise<Record<string, unknown>> {
  const text = leaf.value;

  // Hangul normalization: count runs that are precomposed (NFC) vs jamo (NFD)
  // vs both. NFD Hangul most commonly comes from macOS filesystem text.
  HANGUL_NFC_RANGE.lastIndex = 0;
  let nfcRuns = 0;
  while (HANGUL_NFC_RANGE.exec(text) !== null) nfcRuns++;
  HANGUL_JAMO_RANGE.lastIndex = 0;
  let nfdRuns = 0;
  while (HANGUL_JAMO_RANGE.exec(text) !== null) nfdRuns++;

  // Invisible / look-alike chars. BOMs and ZWJs are the main "find fails
  // byte-exact" culprits on Korean and emoji-heavy cards.
  const countCh = (cp: number): number => {
    const ch = String.fromCodePoint(cp);
    let n = 0;
    let i = -1;
    while ((i = text.indexOf(ch, i + 1)) >= 0) n++;
    return n;
  };
  const invisibles = {
    bom: countCh(0xFEFF),
    zwj: countCh(0x200D),
    zwnj: countCh(0x200C),
    zw_space: countCh(0x200B),
    nbsp: countCh(0x00A0),
  };

  // Line endings.
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lfTotal = (text.match(/\n/g) ?? []).length;
  const lf = lfTotal - crlf;
  const crOnly = (text.match(/\r(?!\n)/g) ?? []).length;

  // Smart quotes — important because edit's quote-norm recovery only fires
  // when these are present, so the agent can predict whether typography
  // preservation will kick in.
  const singleCurly = (text.match(/[‘’]/g) ?? []).length;
  const doubleCurly = (text.match(/[“”]/g) ?? []).length;
  const cornerBrackets = (text.match(/[「」『』]/g) ?? []).length;

  const diag: Record<string, unknown> = {
    hangul: { nfc_runs: nfcRuns, nfd_runs: nfdRuns },
    invisibles,
    line_endings: { lf, crlf, cr: crOnly },
    smart_quotes: { single_curly: singleCurly, double_curly: doubleCurly, cjk_corner_brackets: cornerBrackets },
  };

  // Dual-store mirror check for character canonical fields that LumiRealm
  // mirrors into `extensions.lumirealm.payload.*`. Drift means an upstream
  // translator schema bump could overwrite agent edits.
  if (leaf.surface === "character_field" && MIRRORED_CHARACTER_FIELDS.has(leaf.field)) {
    try {
      const c = await ctx.spindle.characters.get(leaf.surfaceId, ctx.userId);
      const payload = (c?.extensions as Record<string, unknown> | undefined)?.["lumirealm"] as Record<string, unknown> | undefined;
      const inner = payload?.["payload"] as Record<string, unknown> | undefined;
      const mirror = inner?.[leaf.field];
      if (typeof mirror === "string") {
        diag["dual_store"] = {
          mirror_path: `char/extensions/lumirealm.payload.${leaf.field}`,
          drift: mirror !== text,
          note: mirror !== text
            ? `Warning: this canonical field differs from its LumiRealm payload mirror at extensions.lumirealm.payload.${leaf.field}. A future translator-schema bump on the card will rebuild this canonical field from the payload mirror, overwriting your changes. The mirror is refused on write, so the only durable fix is to surface this drift to the user (the source-of-truth is in the payload).`
            : "Mirror in sync with canonical; safe to edit either path.",
        };
      }
    } catch { /* spindle hiccup; skip the check */ }
  }

  return diag;
}

async function inspectRegexContainer(ctx: ToolCtx, explicit?: string): Promise<Record<string, unknown>> {
  const scopeId = resolveCharacterTarget(ctx, explicit);
  const out = [];
  let offset = 0;
  let totalChars = 0;
  let disabled = 0;
  while (true) {
    const r = await ctx.spindle.regex_scripts.list({ scope: "character", scopeId, userId: ctx.userId, limit: 200, offset });
    for (const s of r.data) {
      const findChars = s.find_regex?.length ?? 0;
      const replaceChars = s.replace_string?.length ?? 0;
      totalChars += findChars + replaceChars;
      if (s.disabled) disabled++;
      out.push({
        path: `rx/${s.id}`,
        name: s.name,
        find_chars: findChars,
        replace_chars: replaceChars,
        disabled: s.disabled,
        target: s.target,
        placement: s.placement,
      });
    }
    if (r.data.length === 0 || offset + r.data.length >= r.total) break;
    offset += r.data.length;
  }
  out.sort((a, b) => (b.find_chars + b.replace_chars) - (a.find_chars + a.replace_chars));
  return { path: "rx", count: out.length, total_chars: totalChars, disabled, scripts: out };
}

async function inspectRegexScript(ctx: ToolCtx, scriptId: string): Promise<Record<string, unknown> | string> {
  const r = await ctx.spindle.regex_scripts.get(scriptId, ctx.userId);
  if (!r) return `regex script ${scriptId} not found`;
  return {
    path: `rx/${scriptId}`,
    id: r.id,
    name: r.name,
    target: r.target,
    placement: r.placement,
    flags: r.flags,
    disabled: r.disabled,
    substitute_macros: r.substitute_macros,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder,
    find_chars: r.find_regex?.length ?? 0,
    replace_chars: r.replace_string?.length ?? 0,
    find_cjk_chars: cjkCount(r.find_regex ?? ""),
    replace_cjk_chars: cjkCount(r.replace_string ?? ""),
    find_peek: (r.find_regex ?? "").slice(0, PEEK_CHARS),
    replace_peek: (r.replace_string ?? "").slice(0, PEEK_CHARS),
  };
}

async function inspectWorldBooksContainer(ctx: ToolCtx, explicit?: string): Promise<Record<string, unknown>> {
  // Whole-library listing: the book set is character-independent. A character
  // (focused or explicit) only annotates attachment status, so this runs with
  // no character at all (the "are there duplicate lorebooks across my library"
  // question doesn't need one).
  const charId = resolveCharacterTargetOptional(ctx, explicit);
  const attached = new Set<string>();
  if (charId !== null) {
    const c = await ctx.spindle.characters.get(charId, ctx.userId);
    if (!c) throw new Error(`character ${charId} not found`);
    for (const id of c.world_book_ids ?? []) attached.add(id);
  }
  const all = await listAllWorldBooks(ctx);
  const globalSet = new Set(await ctx.spindle.world_books.getGlobal(ctx.userId).catch(() => [] as string[]));
  const rows = await Promise.all(all.map(async (wb) => {
    const meta = await ctx.spindle.world_books.entries.list(wb.id, { limit: 1, userId: ctx.userId });
    return {
      path: `wb/${wb.id}`,
      name: wb.name,
      entries: meta.total,
      ...(charId !== null ? { attached: attached.has(wb.id) } : {}),
      // Global books are active in every chat even though attached is false.
      ...(globalSet.has(wb.id) ? { global: true } : {}),
    };
  }));
  rows.sort((a, b) => ((b.attached ? 1 : 0) - (a.attached ? 1 : 0)) || b.entries - a.entries);
  return { path: "wb", total: rows.length, ...(charId !== null ? { attached: attached.size } : {}), books: rows };
}

async function inspectWorldBook(ctx: ToolCtx, bookId: string): Promise<Record<string, unknown> | string> {
  const wb = await ctx.spindle.world_books.get(bookId, ctx.userId);
  if (!wb) return `world book ${bookId} not found`;
  const entries: WorldBookEntryDTO[] = [];
  let offset = 0;
  while (true) {
    const r = await ctx.spindle.world_books.entries.list(bookId, { limit: 500, userId: ctx.userId, offset });
    entries.push(...r.data);
    if (r.data.length === 0 || offset + r.data.length >= r.total) break;
    offset += r.data.length;
  }
  const disabled = entries.filter((e) => e.disabled).length;
  const constant = entries.filter((e) => e.constant).length;
  const totalChars = entries.reduce((sum, e) => sum + (e.content?.length ?? 0), 0);
  const top = [...entries]
    .sort((a, b) => (b.content?.length ?? 0) - (a.content?.length ?? 0))
    .slice(0, TOP_N)
    .map((e) => ({ path: `wb/${e.id}/content`, label: wbLabel(e), chars: e.content?.length ?? 0 }));
  return {
    path: `wb/${bookId}`,
    name: wb.name,
    entries: entries.length,
    disabled,
    constant,
    total_content_chars: totalChars,
    largest: top,
  };
}

export const inspectTool = defineTool({
  name: "inspect",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: argPath },
      character_id: { type: "string", description: argCharacterId },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Path-targeted; char/ loud-fails in resolveRead without a character.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const path = input.path.trim();

    // Container paths first — they're not leaves so resolveRead would reject them.
    // inspectRegexContainer / inspectWorldBooksContainer call resolveCharacterTarget(ctx)
    // internally, which throws NoTargetError in no-focus sessions. Catch it here so the
    // agent sees [NO_TARGET] guidance instead of a raw uncoded error string.
    if (path === "rx" || path === "regex_scripts") {
      try {
        const r = await inspectRegexContainer(ctx, input.character_id);
        return { content: JSON.stringify(r, null, 2) };
      } catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    }
    if (path === "wb" || path === "world_books") {
      // No-character whole-library listing is supported; attachment status is
      // just omitted. resolveCharacterTargetOptional never throws NoTarget here.
      const r = await inspectWorldBooksContainer(ctx, input.character_id);
      return { content: JSON.stringify(r, null, 2) };
    }
    // rx/<id> with no field segment → script DTO.
    const rxMatch = /^(?:rx|regex_script)\/([^/]+)$/.exec(path);
    if (rxMatch) {
      const r = await inspectRegexScript(ctx, rxMatch[1]!);
      if (typeof r === "string") return { content: `Error: ${r}`, isError: true };
      return { content: JSON.stringify(r, null, 2) };
    }
    // wb/<id> with no field segment → book aggregate.
    const wbMatch = /^(?:wb|world_book_entry)\/([^/]+)$/.exec(path);
    if (wbMatch) {
      const r = await inspectWorldBook(ctx, wbMatch[1]!);
      if (typeof r === "string") return { content: `Error: ${r}`, isError: true };
      return { content: JSON.stringify(r, null, 2) };
    }

    // Otherwise resolve as a leaf and report leaf stats + encoding diagnostics.
    let leaf;
    try { leaf = await resolveRead(ctx, path); }
    catch (err) {
      if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
      if (err instanceof OutOfRangeError) return { content: `Error: [OUT_OF_RANGE] ${err.message}`, isError: true };
      if (err instanceof PathError) return { content: `Error: [PATH_NOT_FOUND] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    const text = leaf.value;
    const diagnostics = await buildDiagnostics(ctx, leaf);
    return {
      content: JSON.stringify({
        path: leaf.key,
        surface: leaf.surface,
        surface_label: leaf.surfaceLabel,
        chars: text.length,
        lines: text === "" ? 0 : text.split("\n").length,
        cjk_chars: cjkCount(text),
        peek: text.slice(0, PEEK_CHARS),
        diagnostics,
      }, null, 2),
    };
  },
});
