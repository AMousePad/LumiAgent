import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  summary: z.string().min(1),
});

export const finishTool = defineTool({
  name: "finish",
  description: "Declare the entire task complete. Use only when the user explicitly indicates everything is done. Normally just stop without calling a tool and the conversation will pause for the user's next message.",
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
