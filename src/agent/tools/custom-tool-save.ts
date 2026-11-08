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
      // A bare {type:"object"} gets emitted as {} by strict-schema providers, so spell out the shape.
      manifest: {
        type: "object",
        description: argManifest,
        properties: {
          name: { type: "string", description: "Identifier: letters, digits, underscore. Becomes the recipe name." },
          description: { type: "string", description: "What the recipe does, shown in custom_tools list." },
          params: { type: "object", description: "Parameter map, e.g. {\"character_id\": {\"type\": \"string\", \"description\": \"...\"}}. Steps read them as {{$character_id}}." },
          steps: {
            type: "array",
            description: "Ordered tool calls, same shape as custom_tool_run steps.",
            items: {
              type: "object",
              properties: {
                call: { type: "string" },
                args: { type: "object" },
                save_as: { type: "string" },
              },
              required: ["call"],
            },
          },
          return: { description: "Optional template built from saved step results, e.g. \"{{$count}}\"." },
        },
        required: ["name", "description", "steps"],
      },
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
