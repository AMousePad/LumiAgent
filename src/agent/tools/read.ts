import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markReadWithHash } from "./_gates";
import { resolveRead, PathError, OutOfRangeError, ExtensionRefusedError } from "./_path_v2";
import description from "../prompts/claude/tools/read/description.txt";
import argPath from "../prompts/claude/tools/read/arg_path.txt";

const inputSchema = z.object({
  path: z.string().min(3).describe("Slash-separated path to a string leaf. Examples: 'char/description', 'char/first_mes', 'char/alternate_greetings/0', 'char/extensions/lumirealm.payload.background_html_source', 'rx/<scriptId>/replace_string', 'wb/<entryId>/content', 'wb/<entryId>/comment'."),
  offset: z.number().int().positive().optional().describe("1-based starting line number."),
  limit: z.number().int().positive().optional().describe("Max lines to return."),
}).strict();

export const readTool = defineTool({
  name: "read",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: argPath },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Path-targeted: wb/rx/persona/chat/preset resolve by entity id with no
  // character. char/ paths loud-fail in resolveRead when none is selected.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let leaf;
    try { leaf = await resolveRead(ctx, input.path); }
    catch (err) {
      if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
      if (err instanceof OutOfRangeError) return { content: `Error: [OUT_OF_RANGE] ${err.message}`, isError: true };
      if (err instanceof PathError) return { content: `Error: [PATH_NOT_FOUND] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    const body = formatLineSlice(leaf.value, leaf.key, input.offset, input.limit);
    // Hash the FULL value, not the sliced view, so a paged read against a
    // large leaf still gates correctly when the agent edits.
    markReadWithHash(ctx, leaf.key, leaf.value);
    const out = await spillOrReturn(ctx, body, `read:${leaf.key}`, "If the leaf is huge, narrow with offset/limit or grep first.");
    return { content: out };
  },
});
