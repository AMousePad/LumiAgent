import { z } from "zod";
import type { RegexScriptUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { REGEX_SCRIPT_BIG_FIELDS, isRegexScriptBigField } from "./_surfaces";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  script_id: z.string().min(1),
  field: z.enum(REGEX_SCRIPT_BIG_FIELDS as unknown as [string, ...string[]]),
  find: z.string().min(1),
  replace: z.string().optional(),
  replace_handle: z.string().optional(),
  replace_all: z.boolean().optional(),
}).refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either replace or replace_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) => `regex_script_field:${input["script_id"] ?? "?"}/${input["field"] ?? "?"}`,
  hint: (key: string) => {
    const [, ref] = key.split(":");
    const [id, field] = (ref ?? "").split("/");
    return `Call read_regex_script_field with script_id='${id}' and field='${field}' first.`;
  },
};

export const editRegexScriptFieldTool = defineTool({
  name: "edit_regex_script_field",
  description: `[LEGACY — superseded by the edit tool with path rx/<id>/<field>. Kept for back-compat; prefer the named successor.] Find/replace within a regex script's find_regex or replace_string. Requires a recent read_regex_script_field on the same script_id/field in this turn.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      script_id: { type: "string" },
      field: { type: "string", enum: [...REGEX_SCRIPT_BIG_FIELDS] },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting." },
      replace_all: { type: "boolean" },
    },
    required: ["script_id", "field", "find"],
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
      const h = await stashDraft(ctx, `edit_regex_script_field:${input.script_id}/${input.field}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }
    if (!isRegexScriptBigField(input.field)) return { content: `Error: field must be one of ${REGEX_SCRIPT_BIG_FIELDS.join(", ")}`, isError: true };

    const r = await ctx.spindle.regex_scripts.get(input.script_id, ctx.userId);
    if (!r) return { content: `Error: regex script ${input.script_id} not found`, isError: true };
    const current = (r as unknown as Record<string, unknown>)[input.field] as string;

    let outcome;
    try {
      outcome = applyEdit(current, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const h = await stashDraft(ctx, `edit_regex_script_field:${input.script_id}/${input.field}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const patch: RegexScriptUpdateDTO = { [input.field]: outcome.result } as RegexScriptUpdateDTO;
    await ctx.spindle.regex_scripts.update(input.script_id, patch, ctx.userId);
    ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: input.script_id, surfaceLabel: r.name, field: input.field, before: current, after: outcome.result });

    const diffPatch = buildEditPatch(`regex_script[${input.script_id}].${input.field}`, current, outcome.result);
    const payload: Record<string, unknown> = {
      script_id: input.script_id,
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
