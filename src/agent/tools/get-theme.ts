import { themeRpc } from "./_theme-rpc";
import { spillOrReturn } from "./_io";
import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/get-theme/description.txt";
import argIncludeCatalog from "../prompts/claude/tools/get-theme/arg_include_catalog.txt";

const inputSchema = z.object({
  include_catalog: z.boolean().optional(),
}).strict();

export const getThemeTool = defineTool({
  name: "get_theme",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      include_catalog: { type: "boolean", description: argIncludeCatalog },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute: async (input, ctx) => {
    let theme;
    try { theme = await ctx.spindle.theme.getCurrent(ctx.userId); }
    catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }

    const out: Record<string, unknown> = { theme, base_theme: theme };
    try { out["state"] = await themeRpc(ctx, "state"); }
    catch (error) { out["state_note"] = `Saved theme state unavailable: ${(error as Error).message}. base_theme excludes custom styling and device preferences.`; }

    if (input.include_catalog === true) {
      try { out.catalog = { components: await themeRpc(ctx, "components", {}), variables: await themeRpc(ctx, "variables", {}) }; }
      catch (error) { out.catalog_note = (error as Error).message; }
    }

    return { content: await spillOrReturn(ctx, JSON.stringify(out, null, 2), "get_theme") };
  },
});
