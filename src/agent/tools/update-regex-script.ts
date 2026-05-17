import { z } from "zod";
import { defineTool } from "./_framework";
import { scopeForLeafKey } from "./_path_v2";
import type { RegexScriptUpdateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  script_id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const updateRegexScriptTool = defineTool({
  name: "update_regex_script",
  description: `Updates metadata fields of a regex script atomically.

Usage:
- Path-based \`edit\` / \`rewrite\` only address \`rx/<id>/find_regex\` and \`rx/<id>/replace_string\`. Metadata goes through here: \`name\`, \`flags\`, \`disabled\`, \`placement\`, \`target\`, \`sort_order\`, \`description\`, \`folder\`.
- Pass only the fields to change in \`patch\`.
- Works in a no-character session (operates by \`script_id\`), like \`edit\` / \`rewrite\` / \`set\` on \`rx/\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      script_id: { type: "string" },
      patch: { type: "object", additionalProperties: true },
    },
    required: ["script_id", "patch"],
  },
  // Operates purely by script_id; consistent with the rx/ path tools, which
  // are all requiresCharacter:false.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const id = input.script_id;
    const patch = input.patch as RegexScriptUpdateDTO;
    const before = await ctx.spindle.regex_scripts.get(id, ctx.userId);
    if (!before) return { content: `Error: regex script ${id} not found`, isError: true };
    const updated = await ctx.spindle.regex_scripts.update(id, patch, ctx.userId);
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const prev = (before as unknown as Record<string, unknown>)[k];
      const beforeStr = typeof prev === "string" ? prev : JSON.stringify(prev);
      const afterStr = typeof v === "string" ? v : JSON.stringify(v);
      if (beforeStr === afterStr) continue;
      ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, field: k, before: beforeStr, after: afterStr, scope: scopeForLeafKey(`rx/${id}`, ctx) });
    }
    return { content: `OK. Updated regex script ${updated.id} ("${updated.name}") fields: ${Object.keys(patch).join(", ")}` };
  },
});
