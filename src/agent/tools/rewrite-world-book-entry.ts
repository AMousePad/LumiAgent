import { z } from "zod";
import type { WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { wbLabel } from "./_surfaces";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  entry_id: z.string().min(1),
  new_content: z.string().optional().describe("Full replacement content. Either this or new_content_handle is required."),
  new_content_handle: z.string().optional().describe("Handle of a previously-stashed draft. Use instead of new_content to avoid re-emitting."),
}).refine((d) => d.new_content !== undefined || d.new_content_handle !== undefined, {
  message: "either new_content or new_content_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) =>
    `world_book_entry:${input["entry_id"] ?? "?"}`,
  hint: (key: string) =>
    `Call read_world_book_entry with entry_id='${key.split(":")[1]}' first so you can confirm what you're overwriting.`,
};

export const rewriteWorldBookEntryTool = defineTool({
  name: "rewrite_world_book_entry",
  description: "[LEGACY — superseded by the rewrite tool with path wb/<id>/content. Kept for back-compat; prefer the named successor.] Wholesale-overwrite a world book entry's content. Use this (not edit_world_book_entry) only for full-entry rewrites like translating the whole entry into another language or replacing the entry wholesale. For targeted prose changes inside the entry, stick with edit_world_book_entry. Requires a recent read_world_book_entry on the same entry in this turn.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      new_content: { type: "string", description: "Full replacement content for the entry." },
      new_content_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of new_content to avoid re-emitting." },
    },
    required: ["entry_id"],
  },
  requiresRecentRead: gate,
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    let newContent = input.new_content;
    if (newContent === undefined && input.new_content_handle) {
      const loaded = await loadDraft(ctx, input.new_content_handle);
      if (loaded === null) return { content: `Error: draft handle '${input.new_content_handle}' not found or expired. Re-send new_content literally.`, isError: true };
      newContent = loaded;
    }
    if (newContent === undefined) {
      return { content: "Error: provide either new_content or new_content_handle.", isError: true };
    }

    const gateError = ensureRecentRead(ctx, gate, input as unknown as Record<string, unknown>);
    if (gateError !== null) {
      const handle = await stashDraft(ctx, `rewrite_world_book_entry:${input.entry_id}`, newContent);
      return { content: `${gateError}\n\n${draftReuseNote(handle, newContent.length, "new_content")}`, isError: true };
    }

    const e = await ctx.spindle.world_books.entries.get(input.entry_id, ctx.userId);
    if (!e) {
      const handle = await stashDraft(ctx, `rewrite_world_book_entry:${input.entry_id}`, newContent);
      return { content: `Error: world book entry ${input.entry_id} not found.\n\n${draftReuseNote(handle, newContent.length, "new_content")}`, isError: true };
    }

    await ctx.spindle.world_books.entries.update(input.entry_id, { content: newContent } as WorldBookEntryUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit",
      surface: "world_book_entry",
      surfaceId: input.entry_id,
      surfaceLabel: wbLabel(e),
      field: "content",
      before: e.content,
      after: newContent,
    });

    const patch = buildEditPatch(`world_book_entry[${input.entry_id}].content`, e.content, newContent);

    return {
      content: JSON.stringify({
        entry_id: input.entry_id,
        before_chars: e.content.length,
        after_chars: newContent.length,
        patch: { additions: patch.additions, deletions: patch.deletions, hunks: patch.hunks },
      }),
    };
  },
});
