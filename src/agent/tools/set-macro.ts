import { z } from "zod";
import { defineTool } from "./_framework";
import { MACRO_NAME_RE, MACRO_VALUE_MAX_CHARS, setMacro, clearMacro, listMacros } from "../../state/agent-macros";
import description from "../prompts/claude/tools/set-macro/description.txt";
import argName from "../prompts/claude/tools/set-macro/arg_name.txt";
import argValue from "../prompts/claude/tools/set-macro/arg_value.txt";
import argClear from "../prompts/claude/tools/set-macro/arg_clear.txt";

const inputSchema = z.object({
  name: z.string().min(1).max(64),
  value: z.string().max(MACRO_VALUE_MAX_CHARS).optional(),
  clear: z.boolean().optional(),
}).strict().refine(
  (d) => (d.value !== undefined) !== (d.clear === true),
  { message: "pass exactly one of value / clear" },
);

export const setMacroTool = defineTool({
  name: "set_macro",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 64, description: argName },
      value: { type: "string", maxLength: MACRO_VALUE_MAX_CHARS, description: argValue },
      clear: { type: "boolean", description: argClear },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const name = input.name.trim().toLowerCase();
    if (!MACRO_NAME_RE.test(name)) {
      return { content: `Error: [INVALID_VALUE_TYPE] macro name must match ${MACRO_NAME_RE}, got '${input.name}'`, isError: true };
    }
    try {
      if (input.clear === true) {
        const removed = await clearMacro(ctx.spindle, ctx.userId, name);
        const remaining = Object.keys(await listMacros(ctx.spindle, ctx.userId)).sort();
        return { content: JSON.stringify({ cleared: removed, name, stored: remaining }) };
      }
      const res = await setMacro(ctx.spindle, ctx.userId, name, input.value!);
      return {
        content: JSON.stringify({
          [res.created ? "created" : "updated"]: name,
          reference: `{{lumiagent::${name}}}`,
          chars: input.value!.length,
          stored_count: res.count,
          note: "Resolves wherever the user pastes the reference (presets, world books, author's notes). Storing alone changes no prompt.",
        }, null, 2),
      };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true };
    }
  },
});
