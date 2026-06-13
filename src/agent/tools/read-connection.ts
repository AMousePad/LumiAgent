import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  connection_id: z.string().min(1),
}).strict();

export const readConnectionTool = defineTool({
  name: "read_connection",
  description: "Read a single LLM connection profile by id. Returns full metadata including custom fields (no API key, only `has_api_key`).",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      connection_id: { type: "string", description: "Connection profile id." },
    },
    required: ["connection_id"],
  },
  execute: async (input, ctx) => {
    try {
      const c = await ctx.spindle.connections.get(input.connection_id, ctx.userId);
      if (!c) return { content: JSON.stringify({ found: false, connection_id: input.connection_id }) };
      return { content: JSON.stringify(c, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
