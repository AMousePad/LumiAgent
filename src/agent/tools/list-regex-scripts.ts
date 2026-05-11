import type { RegexScriptDTO } from "lumiverse-spindle-types";
import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
});

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

export const listRegexScriptsTool = defineTool({
  name: "list_regex_scripts",
  description: "[LEGACY — superseded by the list tool with path rx. Kept for back-compat; prefer the named successor.] List the character-scoped regex scripts with metadata only (find/replace previews truncated). Returns id, name, target, placement, disabled, find_regex_chars, replace_string_chars. For inventory before grep/read.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      offset: { type: "number" },
      limit: { type: "number" },
    },
    required: [],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Math.floor(input.limit ?? 200)));
    const scripts = await loadAllRegexScripts(ctx);
    const slice = scripts.slice(offset, offset + limit);
    const rows = slice.map((r) => ({
      id: r.id,
      name: r.name,
      target: r.target,
      placement: r.placement,
      disabled: r.disabled,
      sort_order: r.sort_order,
      find_regex_chars: r.find_regex.length,
      replace_string_chars: r.replace_string.length,
    }));
    return { content: JSON.stringify({ total: scripts.length, offset, returned: rows.length, scripts: rows }, null, 2) };
  },
});
