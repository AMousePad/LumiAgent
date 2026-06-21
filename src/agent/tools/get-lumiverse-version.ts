import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/get-lumiverse-version/description.txt";

const inputSchema = z.object({}).strict();

export const getLumiverseVersionTool = defineTool({
  name: "get_lumiverse_version",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  execute: async (_input, ctx) => {
    try {
      const [backend, frontend] = await Promise.all([
        ctx.spindle.version.getBackend(),
        ctx.spindle.version.getFrontend(),
      ]);
      return { content: JSON.stringify({ backend, frontend }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
