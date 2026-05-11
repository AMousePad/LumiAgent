import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  call_ids: z.array(z.string().min(1)).min(1).describe("Tool call ids to retag (the call_id you got back from each tool_use)."),
  sensitivity: z.enum(["sensitive", "insensitive"]).describe("'sensitive' keeps the result indefinitely; 'insensitive' makes it eligible for auto-free after 10 user turns on non-cached connections."),
});

export const markToolResultsTool = defineTool({
  name: "mark_tool_results",
  description: "Retag prior tool results as sensitive or insensitive. Use this when the default classification is wrong for your workflow. Mark a result 'sensitive' if you'll need its full content in a later turn (a long greeting you're translating across turns, a chat-message dump you'll keep grepping). Mark 'insensitive' once you've extracted what you needed (the original read for a now-completed edit, a glossary survey that's been applied). On cached connections this only affects UI display, no auto-free runs. On non-cached connections, insensitive results auto-free after 10 user turns to save context.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      call_ids: { type: "array", items: { type: "string" }, description: "Tool call ids to retag." },
      sensitivity: { type: "string", enum: ["sensitive", "insensitive"], description: "New classification." },
    },
    required: ["call_ids", "sensitivity"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    for (const id of input.call_ids) ctx.markSensitivity(id, input.sensitivity);
    return { content: JSON.stringify({ retagged: input.call_ids.length, sensitivity: input.sensitivity }) };
  },
});
