import { z } from "zod";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  index: z.number().int().nonnegative().describe("0-indexed position in alternate_greetings"),
  find: z.string().min(1).describe("Exact text in the greeting to replace. Copy verbatim from a recent read_alternate_greeting."),
  replace: z.string().optional().describe("Text to substitute for `find`. Either this or replace_handle is required."),
  replace_handle: z.string().optional().describe("Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting."),
  replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring uniqueness. Default false."),
}).refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either replace or replace_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) =>
    `alternate_greeting:${(input["index"] as number) ?? "?"}`,
  hint: (key: string) =>
    `Call read_alternate_greeting with index=${key.split(":")[1]} first.`,
};

export const editAlternateGreetingTool = defineTool({
  name: "edit_alternate_greeting",
  description: "[LEGACY — superseded by the edit tool with path char/alternate_greetings/<idx>. Kept for back-compat; prefer the named successor.] Find/replace within one alternate_greetings entry by 0-indexed position. Requires a recent read_alternate_greeting on the same index in this turn.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0, description: "0-indexed position in alternate_greetings" },
      find: { type: "string", description: "Exact text in the greeting to replace. Copy verbatim from a recent read_alternate_greeting." },
      replace: { type: "string", description: "Text to substitute for `find`. May be empty (deletion)." },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting." },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring uniqueness. Default false." },
    },
    required: ["index", "find"],
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
    if (replace === undefined) {
      return { content: "Error: provide either replace or replace_handle.", isError: true };
    }

    const gateError = ensureRecentRead(ctx, gate, input as unknown as Record<string, unknown>);
    if (gateError !== null) {
      const handle = await stashDraft(ctx, `edit_alternate_greeting:${input.index}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(handle, replace.length, "replace")}`, isError: true };
    }

    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };

    const arr = [...(c.alternate_greetings ?? [])];
    if (input.index >= arr.length) {
      return { content: `Error: index ${input.index} out of range (0..${arr.length - 1})`, isError: true };
    }
    const current = arr[input.index] ?? "";

    let outcome;
    try {
      outcome = applyEdit(current, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const handle = await stashDraft(ctx, `edit_alternate_greeting:${input.index}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(handle, replace.length, "replace")}`, isError: true };
    }

    arr[input.index] = outcome.result;
    await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
    ctx.pushEdit({
      op: "edit",
      surface: "alternate_greeting",
      surfaceId: String(input.index),
      surfaceLabel: `alternate_greetings[${input.index}]`,
      field: String(input.index),
      before: current,
      after: outcome.result,
    });

    const patch = buildEditPatch(`alternate_greetings[${input.index}]`, current, outcome.result);

    const payload: Record<string, unknown> = {
      index: input.index,
      replacements: outcome.count,
      snippet: outcome.firstSnippet,
      patch: { additions: patch.additions, deletions: patch.deletions, hunks: patch.hunks },
    };
    if (outcome.recoveredVia) {
      payload["recovered_via"] = outcome.recoveredVia;
      payload["note"] = `Your 'find' string did not match byte-exactly. The edit was applied using a ${outcome.recoveredVia} fallback. Future calls on this field should copy bytes verbatim from a recent read_*/grep_* output.`;
    }
    return { content: JSON.stringify(payload) };
  },
});
