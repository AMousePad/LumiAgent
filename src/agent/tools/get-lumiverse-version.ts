import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const getLumiverseVersionTool = defineTool({
  name: "get_lumiverse_version",
  description: "Get the running Lumiverse backend and frontend semantic version strings. Useful when the user reports a bug or behaviour that depends on a specific build — surface the version before guessing.",
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
