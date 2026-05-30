import { z } from "zod";
import type {
  CharacterDTO,
  CharacterUpdateDTO,
  WorldBookEntryDTO,
  WorldBookEntryUpdateDTO,
  RegexScriptDTO,
  RegexScriptUpdateDTO,
} from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, noTargetResult } from "./_context";
import { CHARACTER_STRING_FIELDS, wbLabel } from "./_surfaces";
import { parseExtensionPath, setAtPath } from "./_paths";
import { walkStringLeaves } from "./_walk";
import { characterScope } from "../../types";

const CJK_RE = /[぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿가-힣豈-﫿]/;

async function loadAllRegexScripts(ctx: ToolCtx, characterId: string): Promise<RegexScriptDTO[]> {
  const out: RegexScriptDTO[] = [];
  let offset = 0;
  for (;;) {
    const res = await ctx.spindle.regex_scripts.list({
      scope: "character",
      scopeId: characterId,
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
    let bookFetched = 0;
    for (;;) {
      const res = await ctx.spindle.world_books.entries.list(wbId, { limit: 500, userId: ctx.userId, offset });
      out.push(...res.data);
      bookFetched += res.data.length;
      // Compare per-book progress, not the accumulated `out` length. Previously
      // `out.length - offset >= res.total` broke after the first page of every
      // book beyond the first, because `out` carried entries from prior books
      // and `offset` reset to 0 each book.
      if (res.data.length === 0 || bookFetched >= res.total) break;
      offset += res.data.length;
    }
  }
  return out;
}

const inputSchema = z.object({
  entries: z.record(z.string(), z.unknown()),
  scopes: z.array(z.enum(["character", "world_books", "regex_scripts", "extensions"])).optional(),
  dry_run: z.boolean().optional(),
  allow_short_cjk: z.boolean().optional(),
  character_id: z.string().optional(),
});

export const applyGlossaryTool = defineTool({
  name: "apply_glossary",
  description: `Apply a phrase-to-translation map across the union of surfaces in one call. Replacements are sorted longest-first to avoid the shorter-key-clobbers-longer-key footgun. Per-surface, all hits are batched and written as one edit (one diff card per surface in the chat).

Safety: by default this refuses single-character CJK keys, which cause substring collisions (Korean '비' → 'Rain' corrupts '비명' → 'Rain명'). Pass allow_short_cjk=true only if you know what you're doing. Use dry_run=true first to see hit counts before committing.

Scopes (default: character + world_books + regex_scripts.replace_string + extensions string leaves). Regex find_regex patterns are never touched (would break regex syntax).

Returns:
- \`dry_run\`              — whether this was a dry run.
- \`entries_in_glossary\`  — count of keys you passed.
- \`total_replacements\`   — sum of hits across all surfaces.
- \`surfaces_affected\`    — number of distinct surfaces touched.
- \`per_entry_hits\`       — object mapping each key to its hit count.
- \`per_surface\`          — array of \`{surface, surfaceId, field, hits}\` so you can verify which surfaces actually changed.
- \`note\`                 — short summary string.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entries: { type: "object", description: "object mapping source phrase to translation. Example: {\"안녕\": \"Hello\", \"감사합니다\": \"Thank you\"}" },
      scopes: { type: "array", items: { type: "string", enum: ["character", "world_books", "regex_scripts", "extensions"] } },
      dry_run: { type: "boolean", description: "if true, count hits per entry without writing" },
      allow_short_cjk: { type: "boolean", description: "permit 1-character CJK source keys. Default false." },
      character_id: { type: "string", description: "Defaults to the focused character." },
    },
    required: ["entries"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let target: string;
    try { target = resolveCharacterTarget(ctx, input.character_id); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const charScope = characterScope(target);
    const scopes = (input.scopes ?? ["character", "world_books", "regex_scripts", "extensions"]) as readonly string[];
    const dryRun = input.dry_run ?? false;
    const allowShortCjk = input.allow_short_cjk ?? false;

    const pairs: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(input.entries)) {
      if (typeof v !== "string") return { content: `Error: glossary value for '${k}' must be a string`, isError: true };
      if (k.length === 0) return { content: "Error: glossary keys must be non-empty", isError: true };
      pairs.push([k, v]);
    }
    if (!allowShortCjk) {
      const bad: string[] = [];
      for (const [k] of pairs) {
        if (k.length === 1 && CJK_RE.test(k)) bad.push(k);
      }
      if (bad.length > 0) {
        return { content: `Error: refusing to apply 1-character CJK keys (substring collision risk): ${bad.join(", ")}. Use longer phrases or pass allow_short_cjk=true.`, isError: true };
      }
    }
    pairs.sort((a, b) => b[0].length - a[0].length);

    const hitCounts: Record<string, number> = {};
    for (const [k] of pairs) hitCounts[k] = 0;

    const applyAll = (text: string): { out: string; perEntry: Record<string, number> } => {
      let cur = text;
      const counts: Record<string, number> = {};
      for (const [k, v] of pairs) {
        if (k === v) continue;
        let n = 0;
        let scan = 0;
        while ((scan = cur.indexOf(k, scan)) >= 0) { n++; scan += k.length; }
        if (n > 0) {
          cur = cur.split(k).join(v);
          counts[k] = (counts[k] ?? 0) + n;
        }
      }
      return { out: cur, perEntry: counts };
    };

    const surfaceChanges: Array<{ surface: string; surfaceId: string; field: string; hits: number }> = [];
    const c = await ctx.spindle.characters.get(target, ctx.userId);
    if (!c) return { content: `Error: character ${target} not found`, isError: true };

    if (scopes.includes("character")) {
      const patch: CharacterUpdateDTO = {};
      let charChanged = false;
      for (const field of CHARACTER_STRING_FIELDS) {
        const text = (c as unknown as Record<string, unknown>)[field];
        if (typeof text !== "string" || text.length === 0) continue;
        const { out, perEntry } = applyAll(text);
        let fieldHits = 0;
        for (const [k, n] of Object.entries(perEntry)) { hitCounts[k] = (hitCounts[k] ?? 0) + n; fieldHits += n; }
        if (fieldHits > 0 && out !== text) {
          surfaceChanges.push({ surface: "character_field", surfaceId: target, field, hits: fieldHits });
          (patch as Record<string, unknown>)[field] = out;
          charChanged = true;
          if (!dryRun) ctx.pushEdit({ op: "edit", surface: "character_field", surfaceId: target, surfaceLabel: c.name, field, before: text, after: out, scope: charScope });
        }
      }
      const newGreetings = [...(c.alternate_greetings ?? [])];
      let greetingsChanged = false;
      for (let i = 0; i < newGreetings.length; i++) {
        const text = newGreetings[i] ?? "";
        if (text.length === 0) continue;
        const { out, perEntry } = applyAll(text);
        let hits = 0;
        for (const [k, n] of Object.entries(perEntry)) { hitCounts[k] = (hitCounts[k] ?? 0) + n; hits += n; }
        if (hits > 0 && out !== text) {
          surfaceChanges.push({ surface: "alternate_greeting", surfaceId: target, field: String(i), hits });
          newGreetings[i] = out;
          greetingsChanged = true;
          if (!dryRun) ctx.pushEdit({ op: "edit", surface: "alternate_greeting", surfaceId: target, surfaceLabel: `alternate_greetings[${i}]`, field: String(i), before: text, after: out, scope: charScope });
        }
      }
      if (greetingsChanged) (patch as { alternate_greetings?: string[] }).alternate_greetings = newGreetings;
      if (!dryRun && (charChanged || greetingsChanged)) {
        await ctx.spindle.characters.update(target, patch, ctx.userId);
      }
    }

    if (scopes.includes("world_books")) {
      const allEntries = await loadAllWorldBookEntries(ctx, c);
      for (const e of allEntries) {
        const { out, perEntry } = applyAll(e.content);
        let hits = 0;
        for (const [k, n] of Object.entries(perEntry)) { hitCounts[k] = (hitCounts[k] ?? 0) + n; hits += n; }
        if (hits > 0 && out !== e.content) {
          surfaceChanges.push({ surface: "world_book_entry", surfaceId: e.id, field: "content", hits });
          if (!dryRun) {
            await ctx.spindle.world_books.entries.update(e.id, { content: out } as WorldBookEntryUpdateDTO, ctx.userId);
            ctx.pushEdit({ op: "edit", surface: "world_book_entry", surfaceId: e.id, surfaceLabel: wbLabel(e), field: "content", before: e.content, after: out, scope: charScope });
          }
        }
      }
    }

    if (scopes.includes("regex_scripts")) {
      const scripts = await loadAllRegexScripts(ctx, target);
      for (const r of scripts) {
        const { out, perEntry } = applyAll(r.replace_string);
        let hits = 0;
        for (const [k, n] of Object.entries(perEntry)) { hitCounts[k] = (hitCounts[k] ?? 0) + n; hits += n; }
        if (hits > 0 && out !== r.replace_string) {
          surfaceChanges.push({ surface: "regex_script", surfaceId: r.id, field: "replace_string", hits });
          if (!dryRun) {
            await ctx.spindle.regex_scripts.update(r.id, { replace_string: out } as RegexScriptUpdateDTO, ctx.userId);
            ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: r.id, surfaceLabel: r.name, field: "replace_string", before: r.replace_string, after: out, scope: charScope });
          }
        }
      }
    }

    if (scopes.includes("extensions")) {
      const beforeExt = c.extensions ?? {};
      let nextExt: unknown = beforeExt;
      const changedLeaves: Array<{ path: string; before: string; after: string; hits: number }> = [];
      const { buildExtensionsSearchSkip } = await import("../../phoneline/search-excludes");
      const skip = await buildExtensionsSearchSkip(ctx.spindle, ctx.userId);
      for (const leaf of walkStringLeaves(beforeExt, "", skip)) {
        const { out, perEntry } = applyAll(leaf.text);
        let hits = 0;
        for (const [k, n] of Object.entries(perEntry)) { hitCounts[k] = (hitCounts[k] ?? 0) + n; hits += n; }
        if (hits > 0 && out !== leaf.text) {
          changedLeaves.push({ path: leaf.path, before: leaf.text, after: out, hits });
          const segs = parseExtensionPath(leaf.path);
          nextExt = setAtPath(nextExt, segs, out);
          surfaceChanges.push({ surface: "extension", surfaceId: leaf.path, field: leaf.path, hits });
        }
      }
      if (!dryRun && changedLeaves.length > 0) {
        await ctx.spindle.characters.update(target, { extensions: nextExt as Record<string, unknown> }, ctx.userId);
        for (const leaf of changedLeaves) {
          // Match setExtension / resolveWrite extension encoding so the patch
          // stack doesn't see an encoding mismatch and rebase (= drop) prior
          // tagged history on the same extension leaf.
          ctx.pushEdit({ op: "edit", surface: "extension", surfaceId: target, surfaceLabel: `extensions.${leaf.path}`, field: leaf.path, before: JSON.stringify(leaf.before), after: JSON.stringify(leaf.after), scope: charScope, valueEncoding: "json" });
        }
      }
    }

    const totalHits = Object.values(hitCounts).reduce((a, b) => a + b, 0);
    return {
      content: JSON.stringify({
        dry_run: dryRun,
        entries_in_glossary: pairs.length,
        total_replacements: totalHits,
        surfaces_affected: surfaceChanges.length,
        per_entry_hits: hitCounts,
        per_surface: surfaceChanges,
        note: dryRun ? "dry_run=true: nothing was written. Call again with dry_run=false to commit." : "Each affected field is now a separate edit-log entry; the user can revert per surface.",
      }, null, 2),
    };
  },
});
