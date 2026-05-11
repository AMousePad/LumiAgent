import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  databank_id: z.string().min(1),
}).strict();

export const readDatabankTool = defineTool({
  name: "read_databank",
  description: "Read a single databank's metadata (name, description, scope, enabled, document count). Use list_databank_documents and read_databank_document to drill into contents.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      databank_id: { type: "string", description: "Databank id." },
    },
    required: ["databank_id"],
  },
  defaultSensitivity: "insensitive",
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
