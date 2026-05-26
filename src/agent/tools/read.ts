import { z } from "zod";
import { defineTool } from "./_framework";
import { formatLineSlice, spillOrReturn } from "./_io";
import { markReadWithHash } from "./_gates";
import { resolveRead, PathError, OutOfRangeError, ExtensionRefusedError } from "./_path_v2";

const inputSchema = z.object({
  path: z.string().min(3).describe("Slash-separated path to a string leaf. Examples: 'char/description', 'char/first_mes', 'char/alternate_greetings/0', 'char/extensions/lumirealm.payload.background_html_source', 'rx/<scriptId>/replace_string', 'wb/<entryId>/content', 'wb/<entryId>/comment'."),
  offset: z.number().int().positive().optional().describe("1-based starting line number."),
  limit: z.number().int().positive().optional().describe("Max lines to return."),
}).strict();

export const readTool = defineTool({
  name: "read",
  description: `Reads any string-valued surface on the character by path.

Path grammar:
  char/<field>                          top-level character string (description, first_mes, scenario, personality, mes_example, system_prompt, post_history_instructions, creator_notes, creator, name)
  char/alternate_greetings/<idx>        one greeting by 0-based index
  char/alternate_fields/<field>/<variantId>/<content|label>  one variant of description / personality / scenario. Discover ids via list({path:"char/alternate_fields/<field>"}).
  char/extensions/<dotted-extension>    a string leaf under character.extensions (dotted-with-brackets, e.g. lumirealm.payload.triggers[0].effect[0].value)
  rx/<scriptId>/find_regex              regex script pattern
  rx/<scriptId>/replace_string          regex script body
  wb/<entryId>/content                  lorebook entry body
  wb/<entryId>/comment                  lorebook entry label
  persona/<id>/<name|title|description>  a user persona field
  persona/<id>/wb/<entryId>/<content|comment>  persona world-book entry
  chat/<chatId>/msg/<msgId>/content     one chat message
  preset/<presetId>/block/<blockId>/<content|name>  prompt-preset block

Records the path as 'recently read' so a subsequent \`edit\` on the same path passes the read-gate.

Returns: a plain string body. Most of the time that's line-numbered text (\`   1\\tcontent line\\n   2\\t...\`). If the body would exceed the per-call budget it spills, and you get JSON of the form \`{spilled: true, tmp_handle: "tmp_...", peek, total_chars, total_lines, hint}\` — pass \`tmp_handle\` to \`tmp_grep\` / \`tmp_read\` / \`tmp_stat\` from there.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Surface path. See tool description for grammar." },
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
