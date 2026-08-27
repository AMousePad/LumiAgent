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

    const out: Record<string, unknown> = { theme };

    if (input.include_catalog === true) {
      if (!ctx.callFrontend) {
        out["catalog_note"] = "Catalog unavailable: no frontend bridge in this run.";
      } else {
        try {
          out["catalog"] = await ctx.callFrontend("theme_catalog", {}, 15_000);
        } catch (err) {
          out["catalog_note"] = `Catalog unavailable (${(err as Error).message}). It needs the LumiAgent drawer open in a browser tab.`;
        }
      }
    }

    return { content: JSON.stringify(out, null, 2) };
  },
});
