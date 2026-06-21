import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-connections/description.txt";

const inputSchema = z.object({}).strict();

export const listConnectionsTool = defineTool({
  name: "list_connections",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  execute: async (_input, ctx) => {
    try {
      const list = await ctx.spindle.connections.list(ctx.userId);
      const rows = list.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        api_url: c.api_url,
        model: c.model,
        preset_id: c.preset_id,
        is_default: c.is_default,
        has_api_key: c.has_api_key,
      }));
      return { content: JSON.stringify({ count: rows.length, connections: rows }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
