import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { fillPrompt } from "../prompts/_fill";
import description from "../prompts/claude/tools/tmp-read/description.txt";
import argOffset from "../prompts/claude/tools/tmp-read/arg_offset.txt";
import argLimit from "../prompts/claude/tools/tmp-read/arg_limit.txt";

const TMP_READ_DEFAULT_LIMIT = 200;
const TMP_READ_MAX_LIMIT = 4000;

const inputSchema = z.object({
  handle: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const tmpReadTool = defineTool({
  name: "tmp_read",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      handle: { type: "string" },
      offset: { type: "number", description: argOffset },
      limit: { type: "number", description: fillPrompt(argLimit, { TMP_READ_DEFAULT_LIMIT, TMP_READ_MAX_LIMIT }) },
    },
    required: ["handle"],
  },
  execute: async (input, ctx) => {
    const { readTmp, statTmp } = await import("../../state/tmp-store");
    const body = await readTmp(ctx.spindle, ctx.sessionId, ctx.userId, input.handle);
    if (body === null) return { content: `Error: tmp handle '${input.handle}' not found. Real handles look like 'tmp_<id>' and only come from a spilled read result (envelope.tmp_handle) or a write-tool failure response (draft handle). Don't construct them from object ids. Call tmp_list to see live handles.`, isError: true };
    const info = await statTmp(ctx.spindle, ctx.sessionId, ctx.userId, input.handle);
    const offset = Math.max(1, Math.floor(input.offset ?? 1));
    const limit = Math.min(TMP_READ_MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? TMP_READ_DEFAULT_LIMIT)));
    const sliced = formatLineSlice(body, `tmp:${input.handle}`, offset, limit);
    const payload = info
      ? `[origin=${info.origin}, total_lines=${info.totalLines}, total_chars=${info.totalChars}]\n${sliced}`
      : sliced;
    const out = await spillOrReturn(ctx, payload, `tmp_read:${input.handle}`);
    return { content: out };
  },
});
