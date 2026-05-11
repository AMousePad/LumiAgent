import { z } from "zod";
import type { WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { wbLabel } from "./_surfaces";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  entry_id: z.string().min(1),
  find: z.string().min(1),
  replace: z.string().optional(),
  replace_handle: z.string().optional(),
  replace_all: z.boolean().optional(),
}).refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either replace or replace_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) => `world_book_entry:${input["entry_id"] ?? "?"}`,
  hint: (key: string) => `Call read_world_book_entry with entry_id='${key.split(":")[1]}' first.`,
};

export const editWorldBookEntryTool = defineTool({
  name: "edit_world_book_entry",
  description: "[LEGACY — superseded by the edit tool with path wb/<id>/content. Kept for back-compat; prefer the named successor.] Find/replace within a world book entry's content. Requires a recent read_world_book_entry on the same entry in this turn. For metadata edits use update_world_book_entry.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting." },
      replace_all: { type: "boolean" },
    },
    required: ["entry_id", "find"],
  },
  requiresRecentRead: gate,
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    let replace = input.replace;
    if (replace === undefined && input.replace_handle) {
      const loaded = await loadDraft(ctx, input.replace_handle);
      if (loaded === null) return { content: `Error: draft handle '${input.replace_handle}' not found or expired. Re-send replace literally.`, isError: true };
      replace = loaded;
    }
    if (replace === undefined) return { content: "Error: provide either replace or replace_handle.", isError: true };

    const gateError = ensureRecentRead(ctx, gate, input as unknown as Record<string, unknown>);
    if (gateError !== null) {
      const h = await stashDraft(ctx, `edit_world_book_entry:${input.entry_id}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const e = await ctx.spindle.world_books.entries.get(input.entry_id, ctx.userId);
    if (!e) return { content: `Error: world book entry ${input.entry_id} not found`, isError: true };

    let outcome;
    try {
      outcome = applyEdit(e.content, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const h = await stashDraft(ctx, `edit_world_book_entry:${input.entry_id}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    await ctx.spindle.world_books.entries.update(input.entry_id, { content: outcome.result } as WorldBookEntryUpdateDTO, ctx.userId);
    ctx.pushEdit({ op: "edit", surface: "world_book_entry", surfaceId: input.entry_id, surfaceLabel: wbLabel(e), field: "content", before: e.content, after: outcome.result });

    const diffPatch = buildEditPatch(`world_book_entry[${input.entry_id}].content`, e.content, outcome.result);
    const payload: Record<string, unknown> = {
      entry_id: input.entry_id,
      replacements: outcome.count,
      snippet: outcome.firstSnippet,
      patch: { additions: diffPatch.additions, deletions: diffPatch.deletions, hunks: diffPatch.hunks },
    };
    if (outcome.recoveredVia) {
      payload["recovered_via"] = outcome.recoveredVia;
      payload["note"] = `Your 'find' string did not match byte-exactly. The edit was applied using a ${outcome.recoveredVia} fallback. Future calls on this field should copy bytes verbatim from a recent read_*/grep_* output.`;
    }
    return { content: JSON.stringify(payload) };
  },
});
