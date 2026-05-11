import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({});

export const customToolListTool = defineTool({
  name: "custom_tool_list",
  description: "List every custom tool the agent has authored in this workspace. Returns name, description, param count, step count. Cheap; call this whenever you suspect a recipe already exists for the user's request.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
  execute: async (_input, ctx) => {
    const ct = await import("../../state/custom-tools");
    const entries = await ct.listCustomTools(ctx.spindle, ctx.userId);
    return { content: JSON.stringify({ count: entries.length, entries }, null, 2) };
  },
});
