import { z } from "zod";
import type { WorldBookEntryDTO, RegexScriptDTO, CharacterDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import { CHARACTER_STRING_FIELDS, REGEX_SCRIPT_BIG_FIELDS, wbLabel } from "./_surfaces";
import { walkStringLeaves } from "./_walk";

const GREP_DEFAULT_MAX = 50;
const GREP_MAX_CAP = 200;
const GREP_PREVIEW_CHARS = 150;

const inputSchema = z.object({
  pattern: z.string(),
  flags: z.string().optional(),
  case_insensitive: z.boolean().optional(),
  scopes: z.array(z.enum(["character", "world_books", "regex_scripts", "extensions"])).optional(),
  max_matches: z.number().optional(),
});

interface GrepHit {
  surface: string;
  id: string;
  label: string;
  field: string;
  line: number;
  match: string;
  preview: string;
}


function grepText(text: string, re: RegExp, maxRemaining: number): Array<{ line: number; match: string; preview: string }> {
  if (text.length === 0 || maxRemaining <= 0) return [];
  const lines = text.split("\n");
  const out: Array<{ line: number; match: string; preview: string }> = [];
  for (let i = 0; i < lines.length && out.length < maxRemaining; i++) {
    const line = lines[i]!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const matches: string[] = [];
    if (re.global) {
      while ((m = re.exec(line)) !== null) {
        matches.push(m[0]);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    } else {
      m = re.exec(line);
      if (m) matches.push(m[0]);
    }
    if (matches.length === 0) continue;
    const preview = line.length > GREP_PREVIEW_CHARS ? `${line.slice(0, GREP_PREVIEW_CHARS - 5)} […]` : line;
    for (const mm of matches) {
      out.push({ line: i + 1, match: mm, preview });
      if (out.length >= maxRemaining) break;
    }
  }
  return out;
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

export const grepCardTool = defineTool({
  name: "grep_card",
  description: "[LEGACY — superseded by the grep tool with include_paths/exclude_paths prefix filters. Kept for back-compat; prefer the named successor.] Search every editable surface of the character with a regex. Returns matches with surface, document id, label (comment or name), field, line number, the matched substring, and a line preview. THIS IS THE LOAD-BEARING TOOL for finding cross-references between regex find patterns, prompt instructions, and lorebook content before reading or editing anything.\n\nScopes (default: all): character / world_books / regex_scripts / extensions.\nPatterns use ECMAScript regex syntax. The global flag is added automatically.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      flags: { type: "string", description: "extra regex flags (i/m/s/u). g is implied." },
      case_insensitive: { type: "boolean" },
      scopes: { type: "array", items: { type: "string", enum: ["character", "world_books", "regex_scripts", "extensions"] } },
      max_matches: { type: "number", description: `default ${GREP_DEFAULT_MAX}, max ${GREP_MAX_CAP}` },
    },
    required: ["pattern"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const pattern = input.pattern;
    const flagsExtra = input.flags ?? "";
    const caseInsensitive = input.case_insensitive ?? false;
    const scopes = (input.scopes ?? ["character", "world_books", "regex_scripts", "extensions"]) as readonly string[];
    const cap = Math.min(GREP_MAX_CAP, Math.max(1, Math.floor(input.max_matches ?? GREP_DEFAULT_MAX)));
    let assembled = flagsExtra.includes("g") ? flagsExtra : `g${flagsExtra}`;
    if (caseInsensitive && !assembled.includes("i")) assembled = `${assembled}i`;
    let re: RegExp;
    try { re = new RegExp(pattern, assembled); } catch (e) {
      return { content: `Error: regex compile failed: ${(e as Error).message}`, isError: true };
    }
    const hits: GrepHit[] = [];
    let remaining = cap;

    let cached: CharacterDTO | null = null;
    const getChar = async (): Promise<CharacterDTO | null> => {
      if (!cached) {
        const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
        if (!c) return null;
        cached = c;
      }
      return cached;
    };
    const charNotFound = `Error: character ${ctx.characterId} not found`;

    if (scopes.includes("character")) {
      const c = await getChar();
      if (!c) return { content: charNotFound, isError: true };
      for (const field of CHARACTER_STRING_FIELDS) {
        if (remaining <= 0) break;
        const text = (c as unknown as Record<string, unknown>)[field];
        if (typeof text !== "string" || text.length === 0) continue;
        const lh = grepText(text, re, remaining);
        for (const m of lh) hits.push({ surface: "character", id: ctx.characterId, label: c.name, field, line: m.line, match: m.match, preview: m.preview });
        remaining -= lh.length;
      }
      if (remaining > 0 && Array.isArray(c.alternate_greetings)) {
        for (let i = 0; i < c.alternate_greetings.length && remaining > 0; i++) {
          const text = c.alternate_greetings[i] ?? "";
          if (text.length === 0) continue;
          const lh = grepText(text, re, remaining);
          for (const m of lh) hits.push({ surface: "character", id: ctx.characterId, label: c.name, field: `alternate_greetings[${i}]`, line: m.line, match: m.match, preview: m.preview });
          remaining -= lh.length;
        }
      }
    }

    if (scopes.includes("world_books") && remaining > 0) {
      const c = await getChar();
      if (!c) return { content: charNotFound, isError: true };
      const entries = await loadAllWorldBookEntries(ctx, c);
      for (const e of entries) {
        if (remaining <= 0) break;
        const lh = grepText(e.content, re, remaining);
        const label = wbLabel(e);
        for (const m of lh) hits.push({ surface: "world_book_entry", id: e.id, label, field: "content", line: m.line, match: m.match, preview: m.preview });
        remaining -= lh.length;
      }
    }

    if (scopes.includes("regex_scripts") && remaining > 0) {
      const scripts = await loadAllRegexScripts(ctx);
      for (const r of scripts) {
        for (const field of REGEX_SCRIPT_BIG_FIELDS) {
          if (remaining <= 0) break;
          const text = (r as unknown as Record<string, unknown>)[field] as string;
          const lh = grepText(text, re, remaining);
          for (const m of lh) hits.push({ surface: "regex_script", id: r.id, label: r.name, field, line: m.line, match: m.match, preview: m.preview });
          remaining -= lh.length;
        }
      }
    }

    if (scopes.includes("extensions") && remaining > 0) {
      const c = await getChar();
      if (!c) return { content: charNotFound, isError: true };
      for (const leaf of walkStringLeaves(c.extensions ?? {}, "")) {
        if (remaining <= 0) break;
        const lh = grepText(leaf.text, re, remaining);
        for (const m of lh) hits.push({ surface: "extensions", id: ctx.characterId, label: leaf.path, field: leaf.path, line: m.line, match: m.match, preview: m.preview });
        remaining -= lh.length;
      }
    }

    return {
      content: JSON.stringify({
        pattern,
        flags: assembled,
        scopes,
        match_count: hits.length,
        truncated: hits.length >= cap,
        hits,
      }, null, 2),
    };
  },
});
