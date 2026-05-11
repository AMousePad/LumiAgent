import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  script_id: z.string(),
});

export const regexScriptStatsTool = defineTool({
  name: "regex_script_stats",
  description: "[LEGACY — superseded by the inspect tool with path rx/<id>/<field>. Kept for back-compat; prefer the named successor.] Cheap orientation for a regex script. Returns find_regex / replace_string char and line counts plus short peeks. Call this before read_regex_script_field on any script you don't already know is small.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { script_id: { type: "string" } },
    required: ["script_id"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const r = await ctx.spindle.regex_scripts.get(input.script_id, ctx.userId);
    if (!r) return { content: `Error: regex script ${input.script_id} not found`, isError: true };
    const find = r.find_regex ?? "";
    const replace = r.replace_string ?? "";
    return {
      content: JSON.stringify({
        script_id: input.script_id,
        name: r.name,
        target: r.target,
        placement: r.placement,
        flags: r.flags,
        disabled: r.disabled,
        find_regex: { chars: find.length, lines: find === "" ? 0 : find.split("\n").length, peek: find.slice(0, 120) },
        replace_string: { chars: replace.length, lines: replace === "" ? 0 : replace.split("\n").length, peek: replace.slice(0, 120) },
      }, null, 2),
    };
  },
});
