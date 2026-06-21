import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/custom-tool-save/description.txt";
import argManifest from "../prompts/claude/tools/custom-tool-save/arg_manifest.txt";

const inputSchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
});

export const customToolSaveTool = defineTool({
  name: "custom_tool_save",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      manifest: { type: "object", description: argManifest },
    },
    required: ["manifest"],
  },
  execute: async (input, ctx) => {
    const ct = await import("../../state/custom-tools");
    let manifest;
    try { manifest = ct.validateManifest(input.manifest); }
    catch (e) { return { content: `Error: ${(e as Error).message}`, isError: true }; }
    // Built-in name collision check. The full set of built-in names is unknown
    // here, so we rely on the registry plus an allow-prefix for custom_*.
    const { registry } = await import("./_registry");
    if (registry.get(manifest.name) && !manifest.name.startsWith("custom_")) {
      return { content: `Error: '${manifest.name}' collides with a built-in tool name. Use a different name.`, isError: true };
    }
    await ct.saveCustomTool(ctx.spindle, ctx.userId, manifest);
    return { content: JSON.stringify({ name: manifest.name, saved: true, hint: "Remember to update custom_tools/tools.md to match." }) };
  },
});
