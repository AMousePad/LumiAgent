import { z } from "zod";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { parseExtensionPath, getAtPath, setAtPath } from "./_paths";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";
import { checkLumirealmWritePath } from "./_lumirealm-gates";

const inputSchema = z.object({
  path: z.string().min(1),
  find: z.string().min(1),
  replace: z.string().optional(),
  replace_handle: z.string().optional(),
  replace_all: z.boolean().optional(),
}).refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either replace or replace_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) => `character_extension:${input["path"] ?? "?"}`,
  hint: (key: string) => `Call read_character_extension with path='${key.split(":").slice(1).join(":")}' first.`,
};

export const editCharacterExtensionTool = defineTool({
  name: "edit_character_extension",
  description: "[LEGACY — superseded by the edit tool with path char/extensions/<dotted>. Kept for back-compat; prefer the named successor.] Find/replace within a string value at a path inside character.extensions. Requires a recent read_character_extension on the same path in this turn. Same unique-find discipline as edit_character_field.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting." },
      replace_all: { type: "boolean" },
    },
    required: ["path", "find"],
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

    const lrGuard = checkLumirealmWritePath(input.path);
    if (!lrGuard.ok) return { content: `Refused: ${lrGuard.message}`, isError: true };

    const gateError = ensureRecentRead(ctx, gate, input as unknown as Record<string, unknown>);
    if (gateError !== null) {
      const h = await stashDraft(ctx, `edit_character_extension:${input.path}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    let segs;
    try {
      segs = parseExtensionPath(input.path);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    if (segs.length === 0) return { content: "Error: path must be non-empty (relative to character.extensions)", isError: true };

    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const current = getAtPath(c.extensions ?? {}, segs);
    if (typeof current !== "string") {
      const got = current === undefined ? "undefined" : Array.isArray(current) ? "array" : typeof current;
      return { content: `Error: extensions.${input.path} is not a string (got ${got}).`, isError: true };
    }

    let outcome;
    try {
      outcome = applyEdit(current, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const h = await stashDraft(ctx, `edit_character_extension:${input.path}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const next = setAtPath(c.extensions ?? {}, segs, outcome.result) as Record<string, unknown>;
    await ctx.spindle.characters.update(ctx.characterId, { extensions: next }, ctx.userId);
    ctx.pushEdit({ op: "edit", surface: "extension", surfaceId: ctx.characterId, surfaceLabel: `extensions.${input.path}`, field: input.path, before: current, after: outcome.result });

    const diffPatch = buildEditPatch(`extensions.${input.path}`, current, outcome.result);
    const payload: Record<string, unknown> = {
      path: input.path,
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
