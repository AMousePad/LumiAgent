import { z } from "zod";
import { defineTool } from "./_framework";
import { wbLabel } from "./_surfaces";
import type { WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  entry_id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const updateWorldBookEntryTool = defineTool({
  name: "update_world_book_entry",
  description: "[LEGACY for single-field updates — prefer the set tool with path wb/<id>/<field>. Still useful when you need to change several metadata fields atomically in one call.] Update a world book entry's metadata (key array, comment, position, etc.). For content edits use the edit tool. Pass only fields to change in `patch`.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      patch: { type: "object", additionalProperties: true },
    },
    required: ["entry_id", "patch"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const id = input.entry_id;
    const patch = input.patch as WorldBookEntryUpdateDTO;
    const before = await ctx.spindle.world_books.entries.get(id, ctx.userId);
    if (!before) return { content: `Error: world book entry ${id} not found`, isError: true };
    const updated = await ctx.spindle.world_books.entries.update(id, patch, ctx.userId);
    const label = wbLabel(before);
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const prev = (before as unknown as Record<string, unknown>)[k];
      const beforeStr = typeof prev === "string" ? prev : JSON.stringify(prev);
      const afterStr = typeof v === "string" ? v : JSON.stringify(v);
      if (beforeStr === afterStr) continue;
      ctx.pushEdit({ op: "edit", surface: "world_book_entry", surfaceId: id, surfaceLabel: label, field: k, before: beforeStr, after: afterStr });
    }
    return { content: `OK. Updated world book entry ${updated.id} fields: ${Object.keys(patch).join(", ")}` };
  },
});
