import { z } from "zod";
import { defineTool } from "./_framework";
import type { RegexScriptUpdateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  script_id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const updateRegexScriptTool = defineTool({
  name: "update_regex_script",
  description: "[LEGACY for single-field updates — prefer the set tool with path rx/<id>/<field>. Still useful when you need to change several metadata fields atomically in one call.] Update a regex script's metadata fields (name, flags, disabled, placement, sort_order, description, folder). For content edits use the edit tool.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      script_id: { type: "string" },
      patch: { type: "object", additionalProperties: true },
    },
    required: ["script_id", "patch"],
  },
  defaultSensitivity: "insensitive",
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
      ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, field: k, before: beforeStr, after: afterStr });
    }
    return { content: `OK. Updated regex script ${updated.id} ("${updated.name}") fields: ${Object.keys(patch).join(", ")}` };
  },
});
