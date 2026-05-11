import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markRead } from "./_gates";
import { REGEX_SCRIPT_BIG_FIELDS, isRegexScriptBigField } from "./_surfaces";

const inputSchema = z.object({
  script_id: z.string().min(1),
  field: z.enum(REGEX_SCRIPT_BIG_FIELDS as unknown as [string, ...string[]]),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const readRegexScriptFieldTool = defineTool({
  name: "read_regex_script_field",
  description: `[LEGACY — superseded by the read tool with path rx/<id>/<find_regex|replace_string>. Kept for back-compat; prefer the named successor.] Read one large field of a regex script with line numbers. Valid fields: ${REGEX_SCRIPT_BIG_FIELDS.join(", ")}.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      script_id: { type: "string" },
      field: { type: "string", enum: [...REGEX_SCRIPT_BIG_FIELDS] },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["script_id", "field"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    if (!isRegexScriptBigField(input.field)) return { content: `Error: field must be one of ${REGEX_SCRIPT_BIG_FIELDS.join(", ")}`, isError: true };
    const r = await ctx.spindle.regex_scripts.get(input.script_id, ctx.userId);
    if (!r) return { content: `Error: regex script ${input.script_id} not found`, isError: true };
    const text = (r as unknown as Record<string, unknown>)[input.field] as string;
    const body = formatLineSlice(text, `regex_script[${input.script_id}].${input.field}`, input.offset, input.limit);
    markRead(ctx, `regex_script_field:${input.script_id}/${input.field}`);
    const out = await spillOrReturn(ctx, body, `read_regex_script_field:${input.script_id}/${input.field}`, "If huge, narrow with offset/limit, or use test_regex to spot-check matches.");
    return { content: out };
  },
});
