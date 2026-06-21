import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/custom-tool-list/description.txt";

const inputSchema = z.object({});

export const customToolListTool = defineTool({
  name: "custom_tool_list",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  execute: async (_input, ctx) => {
    const ct = await import("../../state/custom-tools");
    const entries = await ct.listCustomTools(ctx.spindle, ctx.userId);
    return { content: JSON.stringify({ count: entries.length, entries }, null, 2) };
  },
});
