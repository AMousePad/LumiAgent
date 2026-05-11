import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  script_id: z.string().min(1),
});

export const readRegexScriptMetaTool = defineTool({
  name: "read_regex_script_meta",
  description: "[LEGACY — superseded by the inspect tool with path rx/<id>/<field>, or the list tool with path rx. Kept for back-compat; prefer the named successor.] Read a regex script's metadata (name, target, placement, flags, disabled, etc.) plus field sizes.",
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
    return {
      content: JSON.stringify({
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
        find_regex_chars: r.find_regex.length,
        replace_string_chars: r.replace_string.length,
      }, null, 2),
    };
  },
});
