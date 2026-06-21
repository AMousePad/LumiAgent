import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/finish/description.txt";

const inputSchema = z.object({
  summary: z.string().min(1),
});

export const finishTool = defineTool({
  name: "finish",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
  },
  execute: async (input, ctx) => {
    ctx.setFinished(input.summary);
    return { content: "OK. Task marked complete." };
  },
});
