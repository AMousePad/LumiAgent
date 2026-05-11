import { z } from "zod";
import { defineTool } from "./_framework";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  index: z.number().int().nonnegative().describe("0-indexed position in alternate_greetings"),
  new_text: z.string().optional().describe("Full replacement text for the greeting. Either this or new_text_handle is required."),
  new_text_handle: z.string().optional().describe("Handle of a previously-stashed draft (returned by a failed retry). Use this to avoid re-emitting a long payload."),
}).refine((d) => d.new_text !== undefined || d.new_text_handle !== undefined, {
  message: "either new_text or new_text_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) =>
    `alternate_greeting:${(input["index"] as number) ?? "?"}`,
  hint: (key: string) =>
    `Call read_alternate_greeting with index=${key.split(":")[1]} first so you can confirm what you're overwriting.`,
};

export const rewriteAlternateGreetingTool = defineTool({
  name: "rewrite_alternate_greeting",
  description: "[LEGACY — superseded by the rewrite tool with path char/alternate_greetings/<idx>. Kept for back-compat; prefer the named successor.] Wholesale-overwrite one alternate_greetings entry by 0-indexed position. Use this (not edit_alternate_greeting) when you're rewriting the entire greeting, e.g. a full translation, a complete tone refactor, or any case where find/replace keeps failing on stylized text (zalgo, hand-tuned diacritics). Requires a recent read_alternate_greeting on the same index in this turn so you've seen what you're overwriting. Pass `new_text` for a literal payload, or `new_text_handle` to reuse a draft stashed by a prior failed call.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0, description: "0-indexed position in alternate_greetings" },
      new_text: { type: "string", description: "Full replacement text for the greeting." },
      new_text_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of new_text to avoid re-emitting." },
    },
    required: ["index"],
  },
  requiresRecentRead: gate,
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    let newText = input.new_text;
    if (newText === undefined && input.new_text_handle) {
      const loaded = await loadDraft(ctx, input.new_text_handle);
      if (loaded === null) return { content: `Error: draft handle '${input.new_text_handle}' not found or expired. Re-send new_text literally.`, isError: true };
      newText = loaded;
    }
    if (newText === undefined) {
      return { content: "Error: provide either new_text or new_text_handle.", isError: true };
    }

    const gateError = ensureRecentRead(ctx, gate, input as unknown as Record<string, unknown>);
    if (gateError !== null) {
      const handle = await stashDraft(ctx, `rewrite_alternate_greeting:${input.index}`, newText);
      return { content: `${gateError}\n\n${draftReuseNote(handle, newText.length, "new_text")}`, isError: true };
    }

    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };

    const arr = [...(c.alternate_greetings ?? [])];
    if (input.index >= arr.length) {
      const handle = await stashDraft(ctx, `rewrite_alternate_greeting:${input.index}`, newText);
      return { content: `Error: index ${input.index} out of range (0..${arr.length - 1}).\n\n${draftReuseNote(handle, newText.length, "new_text")}`, isError: true };
    }
    const current = arr[input.index] ?? "";
    arr[input.index] = newText;

    await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
    ctx.pushEdit({
      op: "edit",
      surface: "alternate_greeting",
      surfaceId: String(input.index),
      surfaceLabel: `alternate_greetings[${input.index}]`,
      field: String(input.index),
      before: current,
      after: newText,
    });

    const patch = buildEditPatch(`alternate_greetings[${input.index}]`, current, newText);

    return {
      content: JSON.stringify({
        index: input.index,
        before_chars: current.length,
        after_chars: newText.length,
        patch: { additions: patch.additions, deletions: patch.deletions, hunks: patch.hunks },
      }),
    };
  },
});
