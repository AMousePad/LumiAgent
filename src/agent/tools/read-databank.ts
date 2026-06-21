import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/read-databank/description.txt";
import argDatabankId from "../prompts/claude/tools/read-databank/arg_databank_id.txt";

const inputSchema = z.object({
  databank_id: z.string().min(1),
}).strict();

export const readDatabankTool = defineTool({
  name: "read_databank",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      databank_id: { type: "string", description: argDatabankId },
    },
    required: ["databank_id"],
  },
  execute: async (input, ctx) => {
    try {
      const d = await ctx.spindle.databanks.get(input.databank_id, ctx.userId);
      if (!d) return { content: JSON.stringify({ found: false, databank_id: input.databank_id }) };
      return { content: JSON.stringify(d, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
