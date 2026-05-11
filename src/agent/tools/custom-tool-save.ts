import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
});

export const customToolSaveTool = defineTool({
  name: "custom_tool_save",
  description: "Save (or overwrite) a custom tool manifest. The manifest must declare a name (a-z, 0-9, _), a description, a params object, and an ordered steps array. Each step calls a built-in tool with args that can reference `{{param_name}}` (from inputs) or `{{$var_name}}` (from earlier `save_as` bindings). After saving, you MUST also update workspace/custom_tools/tools.md to keep the index in sync.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      manifest: { type: "object", description: "Full manifest object. See system prompt for the schema." },
    },
    required: ["manifest"],
  },
  defaultSensitivity: "insensitive",
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
    return { content: JSON.stringify({ name: manifest.name, saved: true, hint: "Remember to update workspace/custom_tools/tools.md to match." }) };
  },
});
