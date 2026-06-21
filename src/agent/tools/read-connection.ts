import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/read-connection/description.txt";
import argConnectionId from "../prompts/claude/tools/read-connection/arg_connection_id.txt";

const inputSchema = z.object({
  connection_id: z.string().min(1),
}).strict();

export const readConnectionTool = defineTool({
  name: "read_connection",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      connection_id: { type: "string", description: argConnectionId },
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
