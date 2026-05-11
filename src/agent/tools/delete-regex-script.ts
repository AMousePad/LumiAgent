import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  script_id: z.string().min(1),
});

export const deleteRegexScriptTool = defineTool({
  name: "delete_regex_script",
  description: "Delete a regex script by id. The script's full state is captured in the edit log so it can be restored via revert.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { script_id: { type: "string" } },
    required: ["script_id"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const id = input.script_id;
    const before = await ctx.spindle.regex_scripts.get(id, ctx.userId);
    if (!before) return { content: `Error: regex script ${id} not found`, isError: true };
    await ctx.spindle.regex_scripts.delete(id, ctx.userId);
    ctx.pushEdit({ op: "delete", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, snapshot: before });
    return { content: JSON.stringify({ script_id: id, deleted: true, can_revert: true }) };
  },
});
