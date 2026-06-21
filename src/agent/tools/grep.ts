import { z } from "zod";
import { defineTool } from "./_framework";
import { iterateAllLeaves } from "./_path_v2";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import { fillPrompt } from "../prompts/_fill";
import descTemplate from "../prompts/claude/tools/grep/description.txt";
import argFlags from "../prompts/claude/tools/grep/arg_flags.txt";
import argMaxMatches from "../prompts/claude/tools/grep/arg_max_matches.txt";
import argMaxHitsPerLine from "../prompts/claude/tools/grep/arg_max_hits_per_line.txt";
import argWorldScope from "../prompts/claude/tools/grep/arg_world_scope.txt";

const GREP_DEFAULT_MAX = 50;
const GREP_MAX_CAP = 200;
const GREP_PREVIEW_CHARS = 150;
const GREP_DEFAULT_HITS_PER_LINE = 1;

const description = fillPrompt(descTemplate, { GREP_DEFAULT_MAX, GREP_MAX_CAP, GREP_DEFAULT_HITS_PER_LINE });

const inputSchema = z.object({
  pattern: z.string().min(1).describe("ECMAScript regex pattern. The global flag is added automatically."),
  flags: z.string().optional().describe("Extra regex flags (i/m/s/u). 'g' is implied."),
  case_insensitive: z.boolean().optional(),
  include_paths: z.array(z.string()).optional().describe("Restrict search to leaves whose path starts with one of these prefixes."),
  exclude_paths: z.array(z.string()).optional().describe("Skip leaves whose path starts with any of these prefixes."),
  max_matches: z.number().int().positive().max(GREP_MAX_CAP).optional().describe(`Cap on total returned hits across all leaves. Default ${GREP_DEFAULT_MAX}, max ${GREP_MAX_CAP}.`),
  max_hits_per_line: z.number().int().positive().max(50).optional().describe(`Cap on hits returned per line. Default ${GREP_DEFAULT_HITS_PER_LINE}. Keep at 1 when the pattern matches dense single characters (e.g. CJK glyphs) so a single line full of matches doesn't burn the entire max_matches budget.`),
  character_id: z.string().optional().describe("Character to search. Defaults to the focused character."),
  world_scope: z.enum(["attached", "all"]).optional().describe("World books to search. 'attached' (default) only this character's books; 'all' also searches every other owned book, labeling entries [global] (in the Always-Active set) or [unattached]."),
}).strict();

interface GrepHit {
  readonly path: string;
  readonly surface: string;
  readonly surface_label: string;
  readonly line: number;
  readonly match: string;
  readonly preview: string;
}

interface LeafScan {
  readonly hits: GrepHit[];
  readonly lastLineScanned: number;
  readonly totalLines: number;
  readonly stoppedEarly: boolean;
}

function grepLeaf(
  text: string,
  re: RegExp,
  leafKey: string,
  surface: string,
  surfaceLabel: string,
  maxRemaining: number,
  maxHitsPerLine: number,
): LeafScan {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const hits: GrepHit[] = [];
  let lastLineScanned = 0;
  let stoppedEarly = false;
  for (let i = 0; i < totalLines; i++) {
    if (hits.length >= maxRemaining) { stoppedEarly = true; break; }
    lastLineScanned = i + 1;
    const line = lines[i]!;
    re.lastIndex = 0;
    const lineMatches: string[] = [];
    if (re.global) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        lineMatches.push(m[0]);
        if (m.index === re.lastIndex) re.lastIndex++;
        if (lineMatches.length >= maxHitsPerLine) break;
      }
    } else {
      const m = re.exec(line);
      if (m) lineMatches.push(m[0]);
    }
    if (lineMatches.length === 0) continue;
    const preview = line.length > GREP_PREVIEW_CHARS
      ? `${line.slice(0, GREP_PREVIEW_CHARS - 5)} […]`
      : line;
    const room = Math.min(lineMatches.length, maxRemaining - hits.length);
    for (let k = 0; k < room; k++) {
      hits.push({ path: leafKey, surface, surface_label: surfaceLabel, line: i + 1, match: lineMatches[k]!, preview });
    }
  }
  // The top-of-loop check only flags truncation when a LATER line is left
  // unscanned. If the budget fills exactly on the last line (or a mid-line
  // clamp leaves more matches), the loop ends naturally with stoppedEarly false,
  // so the caller emits no truncated_at / leaves_unscanned and silently drops
  // the remaining leaves. Flag it here too when the budget is exhausted.
  if (hits.length >= maxRemaining) stoppedEarly = true;
  return { hits, lastLineScanned, totalLines, stoppedEarly };
}

export const grepTool = defineTool({
  name: "grep",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      flags: { type: "string", description: argFlags },
      case_insensitive: { type: "boolean" },
      include_paths: { type: "array", items: { type: "string" } },
      exclude_paths: { type: "array", items: { type: "string" } },
      max_matches: { type: "integer", minimum: 1, maximum: GREP_MAX_CAP, description: fillPrompt(argMaxMatches, { GREP_DEFAULT_MAX }) },
      max_hits_per_line: { type: "integer", minimum: 1, maximum: 50, description: fillPrompt(argMaxHitsPerLine, { GREP_DEFAULT_HITS_PER_LINE }) },
      character_id: { type: "string" },
      world_scope: { type: "string", enum: ["attached", "all"], description: argWorldScope },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let target: string;
    try { target = resolveCharacterTarget(ctx, input.character_id); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const cap = Math.min(GREP_MAX_CAP, Math.max(1, Math.floor(input.max_matches ?? GREP_DEFAULT_MAX)));
    const perLineCap = Math.max(1, Math.floor(input.max_hits_per_line ?? GREP_DEFAULT_HITS_PER_LINE));
    const include = input.include_paths ?? [];
    const exclude = input.exclude_paths ?? [];
    const flagsExtra = input.flags ?? "";
    const caseInsensitive = input.case_insensitive ?? false;
    let assembled = flagsExtra.includes("g") ? flagsExtra : `g${flagsExtra}`;
    if (caseInsensitive && !assembled.includes("i")) assembled = `${assembled}i`;
    let re: RegExp;
    try { re = new RegExp(input.pattern, assembled); }
    catch (e) { return { content: `Error: regex compile failed: ${(e as Error).message}`, isError: true }; }

    const hits: GrepHit[] = [];
    let leavesScanned = 0;
    let leavesFiltered = 0;
    let leavesWithMatches = 0;
    let truncatedAt: { path: string; line: number; total_lines: number; leaves_unscanned: number } | null = null;

    // Materialise the iterator so we can report how many leaves we never
    // reached when the cap fires. iterateAllLeaves is bounded by the card
    // size, not an open stream.
    const eligibleLeaves: Array<{ key: string; value: string; surface: string; surfaceLabel: string }> = [];
    for await (const leaf of iterateAllLeaves(ctx, target, { wbScope: input.world_scope ?? "attached" })) {
      leavesScanned++;
      if (include.length > 0 && !include.some((p) => leaf.key.startsWith(p))) { leavesFiltered++; continue; }
      if (exclude.some((p) => leaf.key.startsWith(p))) { leavesFiltered++; continue; }
      eligibleLeaves.push({ key: leaf.key, value: leaf.value, surface: leaf.surface, surfaceLabel: leaf.surfaceLabel });
    }

    for (let i = 0; i < eligibleLeaves.length; i++) {
      const leaf = eligibleLeaves[i]!;
      const remaining = cap - hits.length;
      if (remaining <= 0) {
        // Cap was exhausted by a previous leaf; record skipped count.
        if (truncatedAt) truncatedAt = { ...truncatedAt, leaves_unscanned: eligibleLeaves.length - i };
        break;
      }
      const scan = grepLeaf(leaf.value, re, leaf.key, leaf.surface, leaf.surfaceLabel, remaining, perLineCap);
      for (const h of scan.hits) hits.push(h);
      if (scan.hits.length > 0) leavesWithMatches++;
      if (scan.stoppedEarly) {
        truncatedAt = {
          path: leaf.key,
          line: scan.lastLineScanned,
          total_lines: scan.totalLines,
          leaves_unscanned: eligibleLeaves.length - i - 1,
        };
      }
    }

    const truncated = truncatedAt !== null || hits.length >= cap;
    const out: Record<string, unknown> = {
      pattern: input.pattern,
      flags: assembled,
      max_matches: cap,
      max_hits_per_line: perLineCap,
      leaves_scanned: leavesScanned,
      leaves_skipped: leavesFiltered,
      leaves_with_matches: leavesWithMatches,
      match_count: hits.length,
      truncated,
      hits,
    };
    if (include.length > 0) out["include_paths"] = include;
    if (exclude.length > 0) out["exclude_paths"] = exclude;
    if (truncatedAt) {
      out["truncated_at"] = truncatedAt;
      out["hint"] = `Search stopped at line ${truncatedAt.line} of ${truncatedAt.total_lines} in '${truncatedAt.path}', with ${truncatedAt.leaves_unscanned} eligible leaves left unscanned. Re-run with a tighter regex, raise max_hits_per_line only if the pattern matches distinct tokens, or read '${truncatedAt.path}' from line ${truncatedAt.line + 1} onward directly to see the uncovered region.`;
    }

    return { content: JSON.stringify(out, null, 2) };
  },
});
