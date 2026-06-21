import { z } from "zod";
import { defineTool } from "./_framework";
import { scopeForLeafKey } from "./_path_v2";
import type { RegexScriptUpdateDTO } from "lumiverse-spindle-types";
import description from "../prompts/claude/tools/update-regex-script/description.txt";

const inputSchema = z.object({
  script_id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const updateRegexScriptTool = defineTool({
  name: "update_regex_script",
  description,
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
      // Tag json ONLY for non-string values, so a string field (name, flags,
      // find_regex, replace_string, description, folder, target) stays raw and
      // matches the edit/rewrite route on the same leaf (no history-dropping
      // encoding rebase); non-string fields (disabled, placement, sort_order)
      // are json-tagged to round-trip on revert.
      const isStr = typeof v === "string";
      const beforeStr = isStr ? (typeof prev === "string" ? prev : JSON.stringify(prev ?? null)) : JSON.stringify(prev ?? null);
      const afterStr = isStr ? (v as string) : JSON.stringify(v ?? null);
      if (beforeStr === afterStr) continue;
      ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, field: k, before: beforeStr, after: afterStr, ...(isStr ? {} : { valueEncoding: "json" as const }), scope: scopeForLeafKey(`rx/${id}`, ctx) });
    }
    return { content: `OK. Updated regex script ${updated.id} ("${updated.name}") fields: ${Object.keys(patch).join(", ")}` };
  },
});
