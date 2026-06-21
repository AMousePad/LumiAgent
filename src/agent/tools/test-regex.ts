import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/test-regex/description.txt";

const inputSchema = z.object({
  pattern: z.string(),
  flags: z.string().optional(),
  sample: z.string(),
});

export const testRegexTool = defineTool({
  name: "test_regex",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      flags: { type: "string" },
      sample: { type: "string" },
    },
    required: ["pattern", "sample"],
  },
  execute: async (input) => {
    const flags = input.flags ?? "";
    let re: RegExp;
    try { re = new RegExp(input.pattern, flags); }
    catch (e) { return { content: JSON.stringify({ ok: false, error: `compile failed: ${(e as Error).message}` }) }; }
    // String.prototype.match() with /g returns a flat array of full matches with
    // no `index` and no capture-group slots — reporting m.slice(1) as `groups`
    // would lie (those are subsequent matches, not groups). Force the global
    // path through matchAll so the response always carries per-match index +
    // groups. Non-global behaves like a single matchAll iteration.
    if (re.global) {
      const all = [...input.sample.matchAll(re)];
      if (all.length === 0) return { content: JSON.stringify({ ok: true, matched: false }) };
      const matches = all.map((m) => ({ match: m[0], groups: m.slice(1), index: m.index ?? null }));
      return { content: JSON.stringify({ ok: true, matched: true, match_count: matches.length, matches }) };
    }
    const m = re.exec(input.sample);
    if (!m) return { content: JSON.stringify({ ok: true, matched: false }) };
    return { content: JSON.stringify({ ok: true, matched: true, match: m[0], groups: m.slice(1), index: m.index }) };
  },
});
