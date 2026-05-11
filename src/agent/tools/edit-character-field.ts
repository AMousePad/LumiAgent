import { z } from "zod";
import type { CharacterUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { CHARACTER_STRING_FIELDS, isCharacterStringField } from "./_surfaces";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  field: z.enum(CHARACTER_STRING_FIELDS as unknown as [string, ...string[]]),
  find: z.string().min(1),
  replace: z.string().optional(),
  replace_handle: z.string().optional(),
  replace_all: z.boolean().optional(),
}).refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either replace or replace_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) => `character_field:${input["field"] ?? "?"}`,
  hint: (key: string) => `Call read_character_field with field='${key.split(":")[1]}' first.`,
};

export const editCharacterFieldTool = defineTool({
  name: "edit_character_field",
  description: `[LEGACY — superseded by the edit tool with path char/<field>. Kept for back-compat; prefer the named successor.] Find/replace within one string field on the character. Requires a recent read_character_field on the same field in this turn. Valid fields: ${CHARACTER_STRING_FIELDS.join(", ")}.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      field: { type: "string", enum: [...CHARACTER_STRING_FIELDS] },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting." },
      replace_all: { type: "boolean" },
    },
    required: ["field", "find"],
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
      const h = await stashDraft(ctx, `edit_character_field:${input.field}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }
    if (!isCharacterStringField(input.field)) return { content: `Error: unknown field '${input.field}'`, isError: true };

    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const current = (c as unknown as Record<string, unknown>)[input.field] as string;
    if (typeof current !== "string") return { content: `Error: field '${input.field}' is not a string`, isError: true };

    let outcome;
    try {
      outcome = applyEdit(current, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const h = await stashDraft(ctx, `edit_character_field:${input.field}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const patch: CharacterUpdateDTO = { [input.field]: outcome.result } as CharacterUpdateDTO;
    await ctx.spindle.characters.update(ctx.characterId, patch, ctx.userId);
    ctx.pushEdit({ op: "edit", surface: "character_field", surfaceId: ctx.characterId, surfaceLabel: c.name, field: input.field, before: current, after: outcome.result });

    const diffPatch = buildEditPatch(`character.${input.field}`, current, outcome.result);
    const payload: Record<string, unknown> = {
      field: input.field,
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
