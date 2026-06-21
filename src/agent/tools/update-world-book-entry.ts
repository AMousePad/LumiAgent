import { z } from "zod";
import { defineTool } from "./_framework";
import { wbLabel, coerceKeyList, WB_ENTRY_KEY_FIELDS, WB_ENTRY_WRITABLE_FIELDS } from "./_surfaces";
import { characterScope, type ScopeRef } from "../../types";
import type { WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";
import description from "../prompts/claude/tools/update-world-book-entry/description.txt";

const inputSchema = z.object({
  entry_id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const updateWorldBookEntryTool = defineTool({
  name: "update_world_book_entry",
  description,
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
    // Force key/keysecondary to string[]. The host stringifies whatever it gets,
    // so a model passing "a, b" or '["a","b"]' would corrupt the entry's key
    // column (unparseable, entry can no longer open in the editor).
    const rawPatch = input.patch as Record<string, unknown>;
    // Reject fields the host won't write, instead of reporting a phantom success.
    const unknown = Object.keys(rawPatch).filter((k) => !WB_ENTRY_WRITABLE_FIELDS.has(k));
    if (unknown.length > 0) return { content: `Error: [PATH_NOT_FOUND] world book entry has no writable field(s): ${unknown.join(", ")}. Valid: ${[...WB_ENTRY_WRITABLE_FIELDS].join(", ")}`, isError: true };
    const patch: WorldBookEntryUpdateDTO = { ...rawPatch } as WorldBookEntryUpdateDTO;
    for (const f of WB_ENTRY_KEY_FIELDS) {
      if (rawPatch[f] !== undefined) (patch as Record<string, unknown>)[f] = coerceKeyList(rawPatch[f]);
    }
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
