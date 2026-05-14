import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const TMP_GREP_DEFAULT_MAX = 100;
const TMP_GREP_MAX_CAP = 1000;
const GREP_PREVIEW_CHARS = 150;

const inputSchema = z.object({
  handle: z.string(),
  pattern: z.string(),
  flags: z.string().optional(),
  case_insensitive: z.boolean().optional(),
  max_matches: z.number().optional(),
});

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

export const tmpGrepTool = defineTool({
  name: "tmp_grep",
  description: `Regex search inside a tmp handle. Use for finding the specific lines you need after a spill, without reading the whole file.

Returns:
- \`handle\`, \`pattern\`, \`flags\` — request echoes.
- \`match_count\`, \`truncated\` — total hits returned, and whether the cap fired.
- \`hits\` — array of \`{line, match, preview}\`. \`line\` is 1-indexed against the tmp file, \`preview\` is the line trimmed to ~150 chars.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      handle: { type: "string" },
      pattern: { type: "string" },
      flags: { type: "string" },
      case_insensitive: { type: "boolean" },
      max_matches: { type: "number", description: `Default ${TMP_GREP_DEFAULT_MAX}, cap ${TMP_GREP_MAX_CAP}` },
    },
    required: ["handle", "pattern"],
  },
  execute: async (input, ctx) => {
    const flagsExtra = input.flags ?? "";
    const caseInsensitive = input.case_insensitive ?? false;
    const cap = Math.min(TMP_GREP_MAX_CAP, Math.max(1, Math.floor(input.max_matches ?? TMP_GREP_DEFAULT_MAX)));
    const { readTmp } = await import("../../state/tmp-store");
    const body = await readTmp(ctx.spindle, ctx.sessionId, ctx.userId, input.handle);
    if (body === null) return { content: `Error: tmp handle '${input.handle}' not found. Real handles look like 'tmp_<id>' and only come from a spilled read result (envelope.tmp_handle) or a write-tool failure response (draft handle). Don't construct them from object ids. Call tmp_list to see live handles.`, isError: true };
    let assembled = flagsExtra.includes("g") ? flagsExtra : `g${flagsExtra}`;
    if (caseInsensitive && !assembled.includes("i")) assembled = `${assembled}i`;
    let re: RegExp;
    try { re = new RegExp(input.pattern, assembled); } catch (e) {
      return { content: `Error: regex compile failed: ${(e as Error).message}`, isError: true };
    }
    const hits = grepText(body, re, cap);
    const payload = JSON.stringify({
      handle: input.handle,
      pattern: input.pattern,
      flags: assembled,
      match_count: hits.length,
      truncated: hits.length >= cap,
      hits,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `tmp_grep:${input.handle}`);
    return { content: out };
  },
});
