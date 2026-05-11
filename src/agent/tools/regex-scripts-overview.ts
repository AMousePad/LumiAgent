import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { RegexScriptDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({});

async function loadAllRegexScripts(ctx: ToolCtx): Promise<RegexScriptDTO[]> {
  const out: RegexScriptDTO[] = [];
  let offset = 0;
  for (;;) {
    const res = await ctx.spindle.regex_scripts.list({
      scope: "character",
      scopeId: ctx.characterId,
      userId: ctx.userId,
      limit: 200,
      offset,
    });
    out.push(...res.data);
    if (out.length >= res.total || res.data.length === 0) break;
    offset += res.data.length;
  }
  return out;
}

export const regexScriptsOverviewTool = defineTool({
  name: "regex_scripts_overview",
  description: "[LEGACY — superseded by the inspect tool with path rx. Kept for back-compat; prefer the named successor.] Cheap orientation for the character's regex scripts. Returns total count, disabled count, total find_regex + replace_string chars, and the 10 largest scripts by combined size.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
  execute: async (_input, ctx) => {
    const scripts = await loadAllRegexScripts(ctx);
    const totalFind = scripts.reduce((s, r) => s + (r.find_regex?.length ?? 0), 0);
    const totalReplace = scripts.reduce((s, r) => s + (r.replace_string?.length ?? 0), 0);
    const disabledCount = scripts.filter((r) => r.disabled).length;
    const largest = [...scripts]
      .map((r) => ({ id: r.id, name: r.name, target: r.target, placement: r.placement, find_chars: r.find_regex?.length ?? 0, replace_chars: r.replace_string?.length ?? 0 }))
      .sort((a, b) => (b.find_chars + b.replace_chars) - (a.find_chars + a.replace_chars))
      .slice(0, 10);
    return {
      content: JSON.stringify({
        total_scripts: scripts.length,
        disabled: disabledCount,
        total_find_chars: totalFind,
        total_replace_chars: totalReplace,
        largest_10: largest,
      }, null, 2),
    };
  },
});
