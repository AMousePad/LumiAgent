import { z } from "zod";
import { defineTool } from "./_framework";
import { iterateAllLeaves } from "./_path_v2";
import { spillOrReturn } from "./_io";

// Unicode ranges for the languages users actually translate FROM. Each entry
// is a regex character class. Keep this list short. Adding ranges grows the
// false-positive surface (CJK punctuation, fullwidth ASCII, etc.).
const LANG_PATTERNS: Record<string, { name: string; regex: RegExp }> = {
  ko:    { name: "Korean (Hangul)",    regex: /[가-힣]/g },
  ja:    { name: "Japanese (Kana)",    regex: /[぀-ゟ゠-ヿ]/g },
  zh:    { name: "Chinese (Han)",      regex: /[一-鿿]/g },
  cjk:   { name: "Any CJK script",     regex: /[가-힣぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/g },
  arabic:{ name: "Arabic",             regex: /[؀-ۿ]/g },
  cyrillic:{ name: "Cyrillic",         regex: /[Ѐ-ӿ]/g },
};

const inputSchema = z.object({
  source_lang: z.enum(["ko", "ja", "zh", "cjk", "arabic", "cyrillic"]).optional().describe("Which script to look for. 'cjk' covers Korean/Japanese/Chinese together. Default 'cjk'."),
  min_chars: z.number().int().min(0).max(10_000).optional().describe("Skip leaves with fewer matching chars than this. Default 1."),
  include_paths: z.array(z.string()).optional().describe("Restrict to leaves whose path starts with one of these prefixes."),
  exclude_paths: z.array(z.string()).optional().describe("Skip leaves whose path starts with any of these prefixes."),
  show_samples: z.boolean().optional().describe("Include up to 5 sample matched runs per leaf, stratified across the leaf. Default true."),
}).strict();

interface MatchSample {
  readonly run: string;
  // The enclosing line, trimmed around the match so the agent sees
  // SYNTACTIC context: `-- comment`, `local x = {"수학"}`, `<div>수학</div>`,
  // `{{#risu_if::lang::0}}…`. Treating raw runs as "just words" was the
  // mis-classification pattern that bypassed completion gates.
  readonly line: string;
  readonly line_number: number;
  readonly quartile: 1 | 2 | 3 | 4;
}

interface QuartileDensity {
  readonly range: string;
  readonly chars: number;
  readonly runs: number;
  readonly lines_with_matches: number;
}

interface LeafReport {
  readonly path: string;
  readonly surface: string;
  readonly surface_label: string;
  readonly total_chars: number;
  readonly total_lines: number;
  readonly match_chars: number;
  readonly match_runs: number;
  readonly match_ratio: number;
  readonly density_by_quartile: readonly QuartileDensity[];
  readonly samples?: readonly MatchSample[];
  readonly coverage_warning?: string;
  // Set on code leaves with any match. Tells the agent that classification
  // requires a full sequential `read` of this leaf in the same phase, no
  // carry-over credit from earlier reads. Exists so the rule isn't buried in
  // prose; the agent can mechanically check this flag before writing a verdict.
  readonly must_read_in_full?: { required: true; reason: string; recommended_action: string };
}

const LINE_CONTEXT_BEFORE = 60;
const LINE_CONTEXT_AFTER = 60;
const MAX_SAMPLES = 5;

// Cumulative offset table for each newline so charOffset → line number is
// O(log n) instead of O(n). One pass over the text, then binary search.
function buildLineIndex(text: string): readonly number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) ends.push(i);
  ends.push(text.length);
  return ends;
}

function lineAtOffset(lineEnds: readonly number[], off: number): number {
  let lo = 0;
  let hi = lineEnds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lineEnds[mid]! < off) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function quartileOf(off: number, qBounds: readonly [number, number, number]): 1 | 2 | 3 | 4 {
  if (off < qBounds[0]) return 1;
  if (off < qBounds[1]) return 2;
  if (off < qBounds[2]) return 3;
  return 4;
}

function buildSample(text: string, lineEnds: readonly number[], run: string, offset: number, quartile: 1 | 2 | 3 | 4): MatchSample {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEndAt = text.indexOf("\n", offset + run.length);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  const fullLine = text.slice(lineStart, lineEnd);
  const matchOffsetInLine = offset - lineStart;
  const windowStart = Math.max(0, matchOffsetInLine - LINE_CONTEXT_BEFORE);
  const windowEnd = Math.min(fullLine.length, matchOffsetInLine + run.length + LINE_CONTEXT_AFTER);
  const window = (windowStart > 0 ? "…" : "")
    + fullLine.slice(windowStart, windowEnd)
    + (windowEnd < fullLine.length ? "…" : "");
  return {
    run,
    line: window,
    line_number: lineAtOffset(lineEnds, offset),
    quartile,
  };
}

interface DistinctRun { readonly run: string; readonly offset: number; readonly quartile: 1 | 2 | 3 | 4; }

// Collect every distinct match run with its first-seen offset and quartile.
// Distinct on run text so a regex that matches every character doesn't
// drown the sample budget with adjacent duplicates.
function collectDistinctRuns(text: string, regex: RegExp, qBounds: readonly [number, number, number]): readonly DistinctRun[] {
  // Build a fresh global regex from the source. Reusing the input regex
  // would share lastIndex across calls and corrupt state.
  const runRe = new RegExp(`(${regex.source}+)`, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const out: DistinctRun[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(text)) !== null) {
    const run = m[1] ?? "";
    if (run.length === 0) break;
    if (seen.has(run)) continue;
    seen.add(run);
    out.push({ run, offset: m.index, quartile: quartileOf(m.index, qBounds) });
  }
  return out;
}

// Stratified sampling: pick the LONGEST distinct run from each quartile that
// has matches, plus the document-level longest if it wasn't already chosen.
// Longest-per-quartile favours data-dense lines (subject_pools, lookup
// tables) over short section-header comments that would otherwise share the
// quartile, while greedy-first-N picks were biased toward top-of-leaf regions
// regardless of content. Capped at MAX_SAMPLES.
function pickStratifiedSamples(text: string, lineEnds: readonly number[], runs: readonly DistinctRun[]): MatchSample[] {
  if (runs.length === 0) return [];
  const chosen = new Map<number, DistinctRun>();
  for (const q of [1, 2, 3, 4] as const) {
    let pick: DistinctRun | undefined;
    for (const r of runs) {
      if (r.quartile !== q) continue;
      if (!pick || r.run.length > pick.run.length) pick = r;
    }
    if (pick && !chosen.has(pick.offset)) chosen.set(pick.offset, pick);
  }
  if (chosen.size < MAX_SAMPLES) {
    let longest: DistinctRun | undefined;
    for (const r of runs) {
      if (chosen.has(r.offset)) continue;
      if (!longest || r.run.length > longest.run.length) longest = r;
    }
    if (longest) chosen.set(longest.offset, longest);
  }
  return [...chosen.values()]
    .sort((a, b) => a.offset - b.offset)
    .slice(0, MAX_SAMPLES)
    .map((r) => buildSample(text, lineEnds, r.run, r.offset, r.quartile));
}

function computeDensityByQuartile(
  text: string,
  regex: RegExp,
  qBounds: readonly [number, number, number],
  lineEnds: readonly number[],
): { densities: readonly QuartileDensity[]; matchChars: number; runCount: number } {
  const [q1Line, q2Line, q3Line] = qBounds.map((b) => lineAtOffset(lineEnds, Math.max(0, b - 1))) as [number, number, number];
  const totalLines = lineEnds.length;
  const ranges: readonly [string, string, string, string] = [
    `lines_1_${q1Line}`,
    `lines_${q1Line + 1}_${q2Line}`,
    `lines_${q2Line + 1}_${q3Line}`,
    `lines_${q3Line + 1}_${totalLines}`,
  ];
  const chars: [number, number, number, number] = [0, 0, 0, 0];
  const runs: [number, number, number, number] = [0, 0, 0, 0];
  const lineSets: [Set<number>, Set<number>, Set<number>, Set<number>] = [new Set(), new Set(), new Set(), new Set()];

  const charRe = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let m: RegExpExecArray | null;
  let matchChars = 0;
  while ((m = charRe.exec(text)) !== null) {
    const len = m[0].length;
    const q = (quartileOf(m.index, qBounds) - 1) as 0 | 1 | 2 | 3;
    chars[q] += len;
    matchChars += len;
    lineSets[q].add(lineAtOffset(lineEnds, m.index));
  }
  const runRe = new RegExp(`(${regex.source}+)`, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let r: RegExpExecArray | null;
  let runCount = 0;
  while ((r = runRe.exec(text)) !== null) {
    if ((r[1] ?? "").length === 0) break;
    runs[(quartileOf(r.index, qBounds) - 1) as 0 | 1 | 2 | 3] += 1;
    runCount += 1;
  }
  const densities: QuartileDensity[] = ranges.map((range, i) => ({
    range,
    chars: chars[i]!,
    runs: runs[i]!,
    lines_with_matches: lineSets[i]!.size,
  }));
  return { densities, matchChars, runCount };
}

function buildCoverageWarning(matchRuns: number, samplesShown: number, densities: readonly QuartileDensity[]): string | undefined {
  if (matchRuns <= samplesShown) return undefined;
  const uncoveredQuartiles = densities
    .filter((d) => d.runs > 0)
    .map((d) => d.range)
    .join(", ");
  return `Samples below cover ${samplesShown} of ${matchRuns} distinct runs in this leaf. Density spans ${uncoveredQuartiles}. Read the full leaf, or grep with a tighter regex / offset, before concluding it's clean.`;
}

export const auditCardCoverageTool = defineTool({
  name: "audit_card_coverage",
  description: `Audit every editable string leaf on the character (top-level fields, alternate_greetings, regex_scripts find/replace, world_book entries content/comment, every extension string leaf) for remaining content in a target script.

THE COMPLETION GATE. Call this BEFORE claiming a translation task is done. If it returns any leaves with match_chars > 0 (other than ones you intentionally left), you are NOT done.

For each leaf with matches the report carries three signals you MUST read together:

- match_chars / match_runs / match_ratio — totals.
- density_by_quartile — match chars and distinct runs in each quartile of the leaf, labelled by line range. A non-zero quartile that no sample touches is content you have not seen.
- samples — STRATIFIED across the leaf (one per quartile that has matches, plus the longest distinct run), each carrying its enclosing line so syntactic context (literal, comment, gated branch) is visible.

If the leaf's coverage_warning fires, samples cover only a fraction of the matches. Read the full leaf or run grep over the uncovered quartiles before classifying.

Sorted by match_chars descending so the worst offenders surface first.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      source_lang: { type: "string", enum: ["ko", "ja", "zh", "cjk", "arabic", "cyrillic"], description: "Script to look for. Default 'cjk'." },
      min_chars: { type: "integer", minimum: 0, maximum: 10000 },
      include_paths: { type: "array", items: { type: "string" } },
      exclude_paths: { type: "array", items: { type: "string" } },
      show_samples: { type: "boolean" },
    },
    additionalProperties: false,
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const langKey = input.source_lang ?? "cjk";
    const minChars = input.min_chars ?? 1;
    const showSamples = input.show_samples ?? true;
    const includePrefixes = input.include_paths ?? [];
    const excludePrefixes = input.exclude_paths ?? [];

    const pat = LANG_PATTERNS[langKey];
    if (!pat) return { content: `Error: unknown source_lang '${langKey}'`, isError: true };

    // A leaf is "code" when it sits under a Lua/script storage path. Code
    // hides translation gaps in places sampling and chunked reads miss; the
    // audit emits an explicit must_read_in_full directive on these so the
    // agent's classification step has a mechanical gate, not just a prose nudge.
    const isCodeLeaf = (path: string): boolean =>
      path.endsWith(".code")
      || path.includes("lumirealm.payload.lua_scripts")
      || path.includes("lumirealm.payload.triggers");

    const leaves: LeafReport[] = [];
    let scanned = 0;
    let totalMatchChars = 0;
    let codeLeavesNeedingFullRead = 0;
    for await (const leaf of iterateAllLeaves(ctx)) {
      scanned++;
      if (includePrefixes.length > 0 && !includePrefixes.some((p) => leaf.key.startsWith(p))) continue;
      if (excludePrefixes.some((p) => leaf.key.startsWith(p))) continue;

      const text = leaf.value;
      const N = text.length;
      if (N === 0) continue;
      const lineEnds = buildLineIndex(text);
      const qBounds: [number, number, number] = [Math.floor(N / 4), Math.floor(N / 2), Math.floor((3 * N) / 4)];

      const { densities, matchChars, runCount } = computeDensityByQuartile(text, pat.regex, qBounds, lineEnds);
      if (matchChars < minChars) continue;

      const ratio = N > 0 ? matchChars / N : 0;
      const totalLines = lineEnds.length;

      const entry: Omit<LeafReport, "samples" | "coverage_warning"> & { samples?: readonly MatchSample[]; coverage_warning?: string } = {
        path: leaf.key,
        surface: leaf.surface,
        surface_label: leaf.surfaceLabel,
        total_chars: N,
        total_lines: totalLines,
        match_chars: matchChars,
        match_runs: runCount,
        match_ratio: Math.round(ratio * 1000) / 1000,
        density_by_quartile: densities,
      };
      if (showSamples) {
        const runs = collectDistinctRuns(text, pat.regex, qBounds);
        const samples = pickStratifiedSamples(text, lineEnds, runs);
        entry.samples = samples;
        const warning = buildCoverageWarning(runCount, samples.length, densities);
        if (warning) entry.coverage_warning = warning;
      }
      if (isCodeLeaf(leaf.key)) {
        // Code leaf: force the agent's classification flow through a full
        // sequential read in this same phase. The flag exists so the rule is
        // a literal field the agent reads off the audit, not a paragraph it
        // can summarise away.
        (entry as { must_read_in_full?: LeafReport["must_read_in_full"] }).must_read_in_full = {
          required: true,
          reason: "Code leaf. Sampling and chunked reads miss hardcoded Korean in table keys, equality branches, and render paths that bypass getText().",
          recommended_action: `read('${leaf.key}', offset=1, limit=${totalLines}). If the read spills, follow with tmp_read on the spill handle until you've covered every line. Do not classify this leaf until that's done IN THIS PHASE. Earlier-session reads do not count.`,
        };
        codeLeavesNeedingFullRead++;
      }
      leaves.push(entry);
      totalMatchChars += matchChars;
    }

    leaves.sort((a, b) => b.match_chars - a.match_chars);

    const summary = {
      source_lang: langKey,
      source_lang_name: pat.name,
      leaves_scanned: scanned,
      leaves_with_matches: leaves.length,
      total_match_chars: totalMatchChars,
      code_leaves_needing_full_read: codeLeavesNeedingFullRead,
      ...(includePrefixes.length > 0 ? { include_paths: includePrefixes } : {}),
      ...(excludePrefixes.length > 0 ? { exclude_paths: excludePrefixes } : {}),
      verdict: leaves.length === 0
        ? `CLEAN. No ${pat.name} content remaining (in the scoped paths). Translation task can be claimed complete.`
        : `INCOMPLETE. ${leaves.length} leaf${leaves.length === 1 ? "" : "es"} still contain ${pat.name} (${totalMatchChars} chars total)${codeLeavesNeedingFullRead > 0 ? `, ${codeLeavesNeedingFullRead} of which are code leaves carrying must_read_in_full` : ""}. For EACH remaining leaf: check density_by_quartile to see how matches are distributed, then examine the line context in samples (stratified: one per non-empty quartile plus the longest run). If a leaf has must_read_in_full, you MUST \`read\` it end-to-end IN THIS PHASE before classifying; reads from earlier turns do not count. If a leaf has coverage_warning, samples don't cover all distinct runs, so read it in full before classifying. If the context shows a match in a string literal (\`{"수학"}\`, \`"label = 수학"\`), HTML text node, or any rendered position, translate it. If it sits in a comment (\`//\` \`--\` \`/*\`) or a deliberately-bilingual gated block (\`{{#risu_if::lang::0}}…{{/risu_if}}\`), add the path to exclude_paths with a justification. Before labelling anything an "internal key" or "already bilingual", \`grep\` for the lookup or gate identifier and confirm the call site exists. Lookup tables that exist but are never called are common in user-authored Lua and prove nothing about runtime behaviour.`,
      leaves,
    };

    const text = JSON.stringify(summary, null, 2);
    const out = await spillOrReturn(ctx, text, `audit_card_coverage:${langKey}`,
      "Narrow with include_paths / exclude_paths or raise min_chars to bring the report back inline.");
    return { content: out };
  },
});
