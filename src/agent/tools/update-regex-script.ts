import { z } from "zod";
import { cleanPatch, defineTool, emptyPatchError } from "./_framework";
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
      patch: {
        type: "object",
        description: "Only the fields to change.",
        properties: {
          name: { type: "string" },
          find_regex: { type: "string" },
          replace_string: { type: "string" },
          flags: { type: "string" },
          disabled: { type: "boolean" },
          placement: { type: "array", items: { type: "string", enum: ["user_input", "ai_output", "world_info", "reasoning"] } },
          target: { type: "string", enum: ["prompt", "response", "display"] },
          substitute_macros: { type: "string", enum: ["none", "find", "raw", "escaped", "after"] },
          min_depth: { type: "integer" },
          max_depth: { type: "integer" },
          trim_strings: { type: "array", items: { type: "string" } },
          run_on_edit: { type: "boolean" },
          sort_order: { type: "integer" },
          description: { type: "string" },
          folder: { type: "string" },
        },
      },
    },
    required: ["script_id", "patch"],
  },
  // Operates purely by script_id; consistent with the rx/ path tools, which
  // are all requiresCharacter:false.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const id = input.script_id;
    const before = await ctx.spindle.regex_scripts.get(id, ctx.userId);
    if (!before) return { content: `Error: regex script ${id} not found`, isError: true };
    const raw: Record<string, unknown> = { ...input.patch };
    if ("preset_id" in raw) {
      return { content: 'Error: [READ_ONLY] preset_id is set at creation only. To bind a script to a preset use create({path:"rx", value:{copy_of:"<scriptId>", preset_id:"<presetId>"}}) and delete the old one.', isError: true };
    }
    // The host stores target as an array. A bare string would not round-trip on revert.
    if (typeof raw["target"] === "string") raw["target"] = [raw["target"]];
    // The host couples scope with scope_id, so a per-field revert cannot restore it. Moves go through copy and delete.
    if ("scope" in raw || "scope_id" in raw) {
      return { content: 'Error: [UNSUPPORTED] scope is not patchable here. Move a script with create({path:"rx", value:{copy_of:"<scriptId>", scope:"global"}}) then delete the original.', isError: true };
    }
    const cleaned = cleanPatch(raw, before as unknown as Record<string, unknown>, new Set(["replace_string"]));
    if (Object.keys(cleaned.patch).length === 0) return { content: emptyPatchError(cleaned.unchanged, '{"disabled": true}'), isError: true };
    const patch = cleaned.patch as RegexScriptUpdateDTO;
    const updated = await ctx.spindle.regex_scripts.update(id, patch, ctx.userId);
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const prev = (before as unknown as Record<string, unknown>)[k];
      // Tag json ONLY for non-string values, so a string field stays raw and
      // matches the edit/rewrite route on the same leaf. Non-string fields are json-tagged to round-trip on revert.
      const isStr = typeof v === "string";
      const beforeStr = isStr ? (typeof prev === "string" ? prev : JSON.stringify(prev ?? null)) : JSON.stringify(prev ?? null);
      const afterStr = isStr ? (v as string) : JSON.stringify(v ?? null);
      if (beforeStr === afterStr) continue;
      ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, field: k, before: beforeStr, after: afterStr, ...(isStr ? {} : { valueEncoding: "json" as const }), scope: scopeForLeafKey(`rx/${id}`, ctx) });
    }
    return { content: `OK. Updated regex script ${updated.id} ("${updated.name}"). Changed ${cleaned.summary}` };
  },
});
