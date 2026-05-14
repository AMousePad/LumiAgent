import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  handle: z.string(),
});

export const tmpStatTool = defineTool({
  name: "tmp_stat",
  description: `Inspect a tmp handle produced by an earlier spill. Cheap. Run before tmp_read / tmp_grep to know what you're dealing with.

Returns:
- \`handle\`               — the input echoed back.
- \`total_chars\`, \`total_lines\` — body size.
- \`createdAt\`            — ms epoch.
- \`origin\`               — short tag of the tool that produced the spill (e.g. \`read:char/first_mes\`, \`list:wb/<id>\`).`,
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
