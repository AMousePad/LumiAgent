import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  name: z.string().min(1),
});

export const customToolDeleteTool = defineTool({
  name: "custom_tool_delete",
  description: "Delete a custom tool manifest. Also remember to remove its line from custom_tools/tools.md.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  execute: async (input, ctx) => {
    const ct = await import("../../state/custom-tools");
    const ok = await ct.deleteCustomTool(ctx.spindle, ctx.userId, input.name);
    return { content: JSON.stringify({ name: input.name, deleted: ok, hint: "Remember to remove the line from custom_tools/tools.md." }) };
  },
});
