import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markRead } from "./_gates";
import { parseExtensionPath, getAtPath } from "./_paths";

const inputSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const readCharacterExtensionTool = defineTool({
  name: "read_character_extension",
  description: "[LEGACY — superseded by the read tool with path char/extensions/<dotted>. Kept for back-compat; prefer the named successor.] Read one path inside character.extensions with line numbers (string leaves get pagination, non-string leaves serialize to JSON).",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Dot/bracket path relative to character.extensions, e.g. 'lumirealm.payload.first_mes'" },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    let segs;
    try {
      segs = parseExtensionPath(input.path);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    const val = getAtPath(c.extensions ?? {}, segs);
    if (val === undefined) return { content: `Error: extensions.${input.path} does not exist`, isError: true };
    const body = typeof val === "string"
      ? formatLineSlice(val, `extensions.${input.path}`, input.offset, input.limit)
      : formatLineSlice(JSON.stringify(val, null, 2), `extensions.${input.path} (${Array.isArray(val) ? "array" : typeof val})`, input.offset, input.limit);
    markRead(ctx, `character_extension:${input.path}`);
    const out = await spillOrReturn(ctx, body, `read_character_extension:${input.path}`, "If the field is huge, try character_extension_stats first or grep_card for the substring you need.");
    return { content: out };
  },
});
