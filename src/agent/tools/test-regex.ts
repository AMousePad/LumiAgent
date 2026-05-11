import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  pattern: z.string(),
  flags: z.string().optional(),
  sample: z.string(),
});

export const testRegexTool = defineTool({
  name: "test_regex",
  description: "Compile a regex and test it against a sample. Returns whether it matches, the match, and capture groups.",
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
  defaultSensitivity: "insensitive",
  execute: async (input) => {
    const flags = input.flags ?? "";
    let re: RegExp;
    try { re = new RegExp(input.pattern, flags); }
    catch (e) { return { content: JSON.stringify({ ok: false, error: `compile failed: ${(e as Error).message}` }) }; }
    const m = input.sample.match(re);
    if (!m) return { content: JSON.stringify({ ok: true, matched: false }) };
    return { content: JSON.stringify({ ok: true, matched: true, match: m[0], groups: m.slice(1), index: m.index }) };
  },
});
