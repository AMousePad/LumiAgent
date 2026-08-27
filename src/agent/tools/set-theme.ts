import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/set-theme/description.txt";
import argAccent from "../prompts/claude/tools/set-theme/arg_accent.txt";
import argFromImageId from "../prompts/claude/tools/set-theme/arg_from_image_id.txt";
import argVariables from "../prompts/claude/tools/set-theme/arg_variables.txt";
import argClear from "../prompts/claude/tools/set-theme/arg_clear.txt";

const inputSchema = z.object({
  accent: z.object({
    h: z.number().min(0).max(360),
    s: z.number().min(0).max(100),
    l: z.number().min(0).max(100),
  }).optional(),
  from_image_id: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  clear: z.boolean().optional(),
}).strict().refine(
  (d) => [d.accent, d.from_image_id, d.variables, d.clear].filter((v) => v !== undefined).length === 1,
  { message: "pass exactly one of accent / from_image_id / variables / clear" },
);

export const setThemeTool = defineTool({
  name: "set_theme",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      accent: {
        type: "object",
        description: argAccent,
        properties: {
          h: { type: "number", minimum: 0, maximum: 360 },
          s: { type: "number", minimum: 0, maximum: 100 },
          l: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["h", "s", "l"],
      },
      from_image_id: { type: "string", description: argFromImageId },
      variables: { type: "object", description: argVariables },
      clear: { type: "boolean", description: argClear },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    try {
      if (input.clear === true) {
        await ctx.spindle.theme.clear(ctx.userId);
        return { content: JSON.stringify({ cleared: true }) };
      }

      if (input.variables !== undefined) {
        const keys = Object.keys(input.variables);
        const bad = keys.filter((k) => !k.startsWith("--"));
        if (bad.length > 0) {
          return { content: `Error: [INVALID_VALUE_TYPE] CSS variable keys must start with '--': ${bad.slice(0, 5).join(", ")}`, isError: true };
        }
        if (keys.length > 200) {
          return { content: `Error: [INVALID_VALUE_TYPE] max 200 variables per extension, got ${keys.length}`, isError: true };
        }
        await ctx.spindle.theme.apply({ variables: input.variables }, ctx.userId);
        return {
          content: JSON.stringify({
            applied_variables: keys.length,
            mode: keys.length >= 40 ? "replaced scope (40+ keys)" : "merged with prior overrides",
          }),
        };
      }

      let accent = input.accent;
      let extraction: Record<string, unknown> | undefined;
      if (input.from_image_id !== undefined) {
        const colors = await ctx.spindle.theme.extractColors(input.from_image_id, ctx.userId);
        accent = colors.dominantHsl;
        extraction = { dominant_hsl: colors.dominantHsl, is_light: colors.isLight };
      }

      await ctx.spindle.theme.applyPalette({ accent: accent! }, ctx.userId);
      return {
        content: JSON.stringify({
          palette_applied: accent,
          ...(extraction !== undefined ? { extracted: extraction } : {}),
          note: "Full light+dark palette derived; user glass/radius/font/scale preserved. `set_theme({clear:true})` reverts.",
        }, null, 2),
      };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true };
    }
  },
});
