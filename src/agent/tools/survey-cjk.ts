import { z } from "zod";
import type { CharacterDTO, WorldBookEntryDTO, RegexScriptDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import { CHARACTER_STRING_FIELDS } from "./_surfaces";
import { walkStringLeaves } from "./_walk";

const SURVEY_DEFAULT_MIN_LEN = 2;
const SURVEY_DEFAULT_TOP_N = 60;

const CJK_RUN_RE = /[぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿가-힣豈-﫿]+/g;

interface CjkOccurrence { count: number; surfaces: Set<string> }

function countCjkRuns(text: string, minLen: number, source: string, map: Map<string, CjkOccurrence>): void {
  if (text.length === 0) return;
  CJK_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CJK_RUN_RE.exec(text)) !== null) {
    const run = m[0];
    if (run.length < minLen) continue;
    let rec = map.get(run);
    if (!rec) { rec = { count: 0, surfaces: new Set() }; map.set(run, rec); }
    rec.count++;
    rec.surfaces.add(source);
  }
}

async function loadAllRegexScripts(ctx: ToolCtx): Promise<RegexScriptDTO[]> {
  const out: RegexScriptDTO[] = [];
  let offset = 0;
  for (;;) {
    const res = await ctx.spindle.regex_scripts.list({
      scope: "character",
      scopeId: ctx.characterId,
      userId: ctx.userId,
      limit: 200,
      offset,
    });
    out.push(...res.data);
    if (out.length >= res.total || res.data.length === 0) break;
    offset += res.data.length;
  }
  return out;
}

async function loadAllWorldBookEntries(ctx: ToolCtx, c: CharacterDTO): Promise<WorldBookEntryDTO[]> {
  const out: WorldBookEntryDTO[] = [];
  for (const wbId of c.world_book_ids) {
    let offset = 0;
    for (;;) {
      const res = await ctx.spindle.world_books.entries.list(wbId, { limit: 500, userId: ctx.userId, offset });
      out.push(...res.data);
      if (out.length - offset >= res.total || res.data.length === 0) break;
      offset += res.data.length;
    }
  }
  return out;
}

const inputSchema = z.object({
  scopes: z.array(z.enum(["character", "world_books", "regex_scripts", "extensions"])).optional(),
  min_length: z.number().optional(),
  top_n: z.number().optional(),
});

export const surveyCjkTool = defineTool({
  name: "survey_cjk",
  description: `Walk every editable surface and group all runs of CJK characters (Korean / Japanese / Chinese) by exact string. Run this first on any translation task.

Returns:
- \`scopes\`, \`min_length\` — request echoes.
- \`distinct_strings\`   — number of unique CJK runs found.
- \`total_runs\`         — sum of occurrences across all surfaces.
- \`returned\`, \`truncated\` — how many made it into \`top\` and whether some were dropped.
- \`top\` — array of \`{text, count, distinct_surfaces, sample_surfaces}\`, sorted by count descending. \`sample_surfaces\` is up to 4 surface names where the run appears.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scopes: { type: "array", items: { type: "string", enum: ["character", "world_books", "regex_scripts", "extensions"] } },
      min_length: { type: "number", description: `default ${SURVEY_DEFAULT_MIN_LEN}` },
      top_n: { type: "number", description: `default ${SURVEY_DEFAULT_TOP_N}` },
    },
    required: [],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const scopes = (input.scopes ?? ["character", "world_books", "regex_scripts", "extensions"]) as readonly string[];
    const minLen = Math.max(1, Math.floor(input.min_length ?? SURVEY_DEFAULT_MIN_LEN));
    const topN = Math.max(1, Math.min(500, Math.floor(input.top_n ?? SURVEY_DEFAULT_TOP_N)));
    const map = new Map<string, CjkOccurrence>();
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };

    if (scopes.includes("character")) {
      for (const field of CHARACTER_STRING_FIELDS) {
        const text = (c as unknown as Record<string, unknown>)[field];
        if (typeof text === "string") countCjkRuns(text, minLen, `character.${field}`, map);
      }
      if (Array.isArray(c.alternate_greetings)) {
        for (let i = 0; i < c.alternate_greetings.length; i++) {
          countCjkRuns(c.alternate_greetings[i] ?? "", minLen, `character.alternate_greetings[${i}]`, map);
        }
      }
    }
    if (scopes.includes("world_books")) {
      const entries = await loadAllWorldBookEntries(ctx, c);
      for (const e of entries) countCjkRuns(e.content, minLen, `world_book_entry[${e.id}]`, map);
    }
    if (scopes.includes("regex_scripts")) {
      const scripts = await loadAllRegexScripts(ctx);
      for (const r of scripts) {
        countCjkRuns(r.find_regex, minLen, `regex_script[${r.id}].find_regex`, map);
        countCjkRuns(r.replace_string, minLen, `regex_script[${r.id}].replace_string`, map);
      }
    }
    if (scopes.includes("extensions")) {
      const { buildExtensionsSearchSkip } = await import("../../phoneline/search-excludes");
      const skip = await buildExtensionsSearchSkip(ctx.spindle, ctx.userId);
      for (const leaf of walkStringLeaves(c.extensions ?? {}, "", skip)) {
        countCjkRuns(leaf.text, minLen, `extensions.${leaf.path}`, map);
      }
    }

    const all = [...map.entries()].map(([text, rec]) => ({
      text,
      count: rec.count,
      distinct_surfaces: rec.surfaces.size,
      sample_surfaces: [...rec.surfaces].slice(0, 4),
    }));
    all.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
    const top = all.slice(0, topN);
    const totalRuns = all.reduce((sum, x) => sum + x.count, 0);
    return {
      content: JSON.stringify({
        scopes,
        min_length: minLen,
        distinct_strings: all.length,
        total_runs: totalRuns,
        returned: top.length,
        truncated: top.length < all.length,
        top,
      }, null, 2),
    };
  },
});
