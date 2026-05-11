import { z } from "zod";
import { defineTool } from "./_framework";
import { parseExtensionPath, getAtPath, setAtPath } from "./_paths";
import { checkLumirealmWritePath } from "./_lumirealm-gates";

const inputSchema = z.object({
  path: z.string().min(1),
  value: z.unknown(),
});

export const updateCharacterExtensionTool = defineTool({
  name: "update_character_extension",
  description: "[LEGACY — superseded by the set tool with path char/extensions/<dotted>. Kept for back-compat; prefer the named successor.] Wholesale-replace the value at a path inside character.extensions. For non-string fields or replacing entire objects/arrays.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      value: {},
    },
    required: ["path", "value"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const path = input.path;
    const value = input.value;

    const lrGuard = checkLumirealmWritePath(path);
    if (!lrGuard.ok) return { content: `Refused: ${lrGuard.message}`, isError: true };

    let segs;
    try {
      segs = parseExtensionPath(path);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    if (segs.length === 0) return { content: "Error: path must be non-empty (relative to character.extensions)", isError: true };
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const before = getAtPath(c.extensions ?? {}, segs);
    const next = setAtPath(c.extensions ?? {}, segs, value) as Record<string, unknown>;
    await ctx.spindle.characters.update(ctx.characterId, { extensions: next }, ctx.userId);
    const beforeStr = before === undefined ? "" : typeof before === "string" ? before : JSON.stringify(before, null, 2);
    const afterStr = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    ctx.pushEdit({ op: "edit", surface: "extension", surfaceId: ctx.characterId, surfaceLabel: `extensions.${path}`, field: path, before: beforeStr, after: afterStr });
    return { content: JSON.stringify({ path, ok: true }) };
  },
});
