import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/install-theme-pack/description.txt";
import argName from "../prompts/claude/tools/install-theme-pack/arg_name.txt";
import argGlobalCss from "../prompts/claude/tools/install-theme-pack/arg_global_css.txt";
import argComponents from "../prompts/claude/tools/install-theme-pack/arg_components.txt";
import argApply from "../prompts/claude/tools/install-theme-pack/arg_apply.txt";
import argSaveToLibrary from "../prompts/claude/tools/install-theme-pack/arg_save_to_library.txt";

const inputSchema = z.object({
  name: z.string().min(1).max(200),
  author: z.string().max(200).optional(),
  desc: z.string().max(5000).optional(),
  global_css: z.string().optional(),
  components: z.record(z.string(), z.object({
    css: z.string(),
    enabled: z.boolean().optional(),
  })).optional(),
  apply: z.boolean().optional(),
  save_to_library: z.boolean().optional(),
}).strict().refine(
  (d) => (d.global_css !== undefined && d.global_css.trim() !== "") || (d.components !== undefined && Object.keys(d.components).length > 0),
  { message: "provide global_css, components, or both; an empty pack installs nothing" },
);

export const installThemePackTool = defineTool({
  name: "install_theme_pack",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200, description: argName },
      author: { type: "string", maxLength: 200 },
      desc: { type: "string", maxLength: 5000, description: "Pack description shown in the library. Max 5000 chars." },
      global_css: { type: "string", description: argGlobalCss },
      components: { type: "object", description: argComponents },
      apply: { type: "boolean", description: argApply },
      save_to_library: { type: "boolean", description: argSaveToLibrary },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    if (!ctx.callFrontend) {
      return { content: "Error: theme pack install needs the frontend bridge; this run has none.", isError: true };
    }
    const draft = {
      name: input.name,
      ...(input.author !== undefined ? { author: input.author } : {}),
      ...(input.desc !== undefined ? { description: input.desc } : {}),
      globalCSS: input.global_css ?? "",
      ...(input.components !== undefined ? { components: input.components } : {}),
    };
    let result: unknown;
    try {
      result = await ctx.callFrontend("theme_install_pack", {
        draft,
        ...(input.apply !== undefined ? { apply: input.apply } : {}),
        ...(input.save_to_library !== undefined ? { save_to_library: input.save_to_library } : {}),
      }, 30_000);
    } catch (err) {
      const msg = (err as Error).message;
      const hint = msg.includes("INVALID_THEME_CSS")
        ? " The CSS failed parse validation; check for unbalanced braces or stripped constructs (@import, external url())."
        : msg.includes("timed out")
          ? " The LumiAgent drawer must be open in a browser tab."
          : "";
      return { content: `Error: ${msg}.${hint}`, isError: true };
    }
    return { content: JSON.stringify(result, null, 2) };
  },
});
