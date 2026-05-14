import { z } from "zod";
import { defineTool, type ReadGate } from "./_framework";
import { buildEditPatch } from "./_patch";
import { ensureFreshRead, ensureRecentRead, refreshReadHash } from "./_gates";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";
import { resolveRead, resolveWrite, PathError, OutOfRangeError } from "./_path_v2";

const inputSchema = z.object({
  path: z.string().min(3).describe("Slash-separated path. Same grammar as `read` / `edit`."),
  new_content: z.string().optional().describe("Full replacement text. Mutually exclusive with new_content_handle."),
  new_content_handle: z.string().optional().describe("Handle of a previously-stashed draft."),
}).strict().refine((d) => d.new_content !== undefined || d.new_content_handle !== undefined, {
  message: "either new_content or new_content_handle is required",
});

const gate: ReadGate = {
  surface: (input) => String(input["path"] ?? "?"),
  hint: (key) => `Call \`read\` on '${key}' first so you've seen what you're overwriting.`,
};

export const rewriteTool = defineTool({
  name: "rewrite",
  description: `Wholesale-overwrite any string-valued surface by path. Use INSTEAD of \`edit\` when:
- The whole field changes (full translation, tone refactor, schema migration).
- Find/replace keeps failing on stylized text (zalgo, hand-tuned diacritics, NFC drift).
- The replacement is structurally different enough that finding a stable anchor is futile.

Requires a recent \`read\` on the SAME path. Pass \`new_content\` for a literal payload, or \`new_content_handle\` to reuse a draft a prior failed call stashed for you.

Returns:
- \`path\`         — canonical leaf path that was written.
- \`before_chars\`, \`after_chars\` — body size before vs after.
- \`patch\`        — \`{additions, deletions, hunks}\` jsdiff-structured for the UI.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Surface path. See `read` tool for grammar." },
      new_content: { type: "string" },
      new_content_handle: { type: "string" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  requiresRecentRead: gate,
  requiresCharacter: true,
  execute: async (input, ctx) => {
    let next = input.new_content;
    if (next === undefined && input.new_content_handle) {
      const loaded = await loadDraft(ctx, input.new_content_handle);
      if (loaded === null) return { content: `Error: [DRAFT_HANDLE_EXPIRED] draft handle '${input.new_content_handle}' not found or expired. Re-send new_content literally.`, isError: true };
      next = loaded;
    }
    if (next === undefined) return { content: "Error: provide either new_content or new_content_handle.", isError: true };

    let leaf;
    try { leaf = await resolveRead(ctx, input.path); }
    catch (err) {
      if (err instanceof OutOfRangeError) return { content: `Error: [OUT_OF_RANGE] ${err.message}`, isError: true };
      if (err instanceof PathError) return { content: `Error: [PATH_NOT_FOUND] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }

    const gateError = ensureRecentRead(ctx, gate, { path: leaf.key });
    if (gateError !== null) {
      const h = await stashDraft(ctx, `rewrite:${leaf.key}`, next);
      return { content: `${gateError}\n\n${draftReuseNote(h, next.length, "new_content")}`, isError: true };
    }

    const freshError = ensureFreshRead(ctx, leaf.key, leaf.value);
    if (freshError !== null) {
      const h = await stashDraft(ctx, `rewrite:${leaf.key}`, next);
      return { content: `${freshError}\n\n${draftReuseNote(h, next.length, "new_content")}`, isError: true };
    }

    try { await resolveWrite(ctx, leaf, next); }
    catch (err) { return { content: `Error: write failed: ${(err as Error).message}`, isError: true }; }
    refreshReadHash(ctx, leaf.key, next);

    const patch = buildEditPatch(leaf.key, leaf.value, next);
    return {
      content: JSON.stringify({
        path: leaf.key,
        before_chars: leaf.value.length,
        after_chars: next.length,
        patch: { additions: patch.additions, deletions: patch.deletions, hunks: patch.hunks },
      }),
    };
  },
});
