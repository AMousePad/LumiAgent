import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/tmp-stat/description.txt";

const inputSchema = z.object({
  handle: z.string(),
});

export const tmpStatTool = defineTool({
  name: "tmp_stat",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { handle: { type: "string" } },
    required: ["handle"],
  },
  execute: async (input, ctx) => {
    const { statTmp } = await import("../../state/tmp-store");
    const info = await statTmp(ctx.spindle, ctx.sessionId, ctx.userId, input.handle);
    if (!info) return { content: `Error: tmp handle '${input.handle}' not found. Real handles look like 'tmp_<id>' and only come from a spilled read result (envelope.tmp_handle) or a write-tool failure response (draft handle). Don't construct them from object ids. Call tmp_list to see live handles.`, isError: true };
    return { content: JSON.stringify(info, null, 2) };
  },
});
