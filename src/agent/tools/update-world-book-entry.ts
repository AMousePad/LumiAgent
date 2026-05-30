import { z } from "zod";
import { defineTool } from "./_framework";
import { wbLabel } from "./_surfaces";
import { characterScope, type ScopeRef } from "../../types";
import type { WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  entry_id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const updateWorldBookEntryTool = defineTool({
  name: "update_world_book_entry",
  description: `Updates metadata fields of a world book entry atomically.

Usage:
- Path-based \`edit\` / \`rewrite\` only address \`wb/<id>/content\` and \`wb/<id>/comment\`. Metadata goes through here: \`key\` array, \`keysecondary\`, \`priority\`, \`disabled\`, \`constant\`, \`position\`, \`depth\`, \`role\`, \`selective\`, \`selectiveLogic\`.
- Pass only the fields to change in \`patch\`.
- For content edits prefer \`edit\` / \`rewrite\`.
- Works in a no-character session (operates by \`entry_id\`), like \`edit\` / \`rewrite\` / \`set\` on \`wb/\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      patch: { type: "object", additionalProperties: true },
    },
    required: ["entry_id", "patch"],
  },
  // Operates purely by entry_id; consistent with the wb/ path tools, which
  // are all requiresCharacter:false.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const id = input.entry_id;
    const patch = input.patch as WorldBookEntryUpdateDTO;
    const before = await ctx.spindle.world_books.entries.get(id, ctx.userId);
    if (!before) return { content: `Error: world book entry ${id} not found`, isError: true };
    const updated = await ctx.spindle.world_books.entries.update(id, patch, ctx.userId);
    const label = wbLabel(before);
    // File under the focused character, else the OWNING BOOK id (from
    // before.world_book_id), never the entry id. scopeForLeafKey(`wb/<id>`) would
    // mis-file under the entry id in a no-character session (same bug class as
    // the path-edit fix that reads e.world_book_id).
    const scope: ScopeRef = ctx.characterId
      ? characterScope(ctx.characterId)
      : { kind: "world_book", id: before.world_book_id };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const prev = (before as unknown as Record<string, unknown>)[k];
      // Tag json ONLY for non-string values. A string field stored raw matches
      // the edit/rewrite route on the same leaf (content/comment), avoiding an
      // encoding-rebase that would drop history; non-string metadata (arrays,
      // bools, numbers) is json-tagged so it round-trips on revert.
      const isStr = typeof v === "string";
      const beforeStr = isStr ? (typeof prev === "string" ? prev : JSON.stringify(prev ?? null)) : JSON.stringify(prev ?? null);
      const afterStr = isStr ? (v as string) : JSON.stringify(v ?? null);
      if (beforeStr === afterStr) continue;
      ctx.pushEdit({ op: "edit", surface: "world_book_entry", surfaceId: id, surfaceLabel: label, field: k, before: beforeStr, after: afterStr, ...(isStr ? {} : { valueEncoding: "json" as const }), scope });
    }
    return { content: `OK. Updated world book entry ${updated.id} fields: ${Object.keys(patch).join(", ")}` };
  },
});
