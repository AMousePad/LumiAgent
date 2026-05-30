import { z } from "zod";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureFreshRead, ensureRecentRead, refreshReadHash } from "./_gates";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  item_id: z.string().min(1),
  field: z.string().min(1),
  find: z.string().min(1),
  replace: z.string().optional(),
  replace_handle: z.string().optional(),
  replace_all: z.boolean().optional(),
}).refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either replace or replace_handle is required",
});

const gate = {
  surface: (input: Record<string, unknown>) =>
    `external_item:${input["surface_id"] ?? "?"}/${input["item_id"] ?? "?"}/${input["field"] ?? "?"}`,
  hint: (key: string) => {
    const [, ref] = key.split(":");
    const [sid, iid, field] = (ref ?? "").split("/");
    return `Call read_external with surface_id='${sid}' item_id='${iid}' field='${field}' first.`;
  },
};

export const editExternalTool = defineTool({
  name: "edit_external",
  description: `Performs exact string replacement inside one field of an external provider's item.

Usage:
- You must call \`read_external\` with the same surface/item/field first. This tool will error if you have not.
- The edit will fail if \`find\` is not unique in the field. Either provide more surrounding context to make it unique or set \`replace_all: true\`.
- For non-string values or wholesale replacement, use \`update_external\`.
- If a prior call returned a draft handle, pass \`replace_handle\` instead of re-emitting the literal replacement.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      item_id: { type: "string" },
      field: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of replace to avoid re-emitting." },
      replace_all: { type: "boolean" },
    },
    required: ["surface_id", "item_id", "field", "find"],
  },
  requiresRecentRead: gate,
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const draftOrigin = `edit_external:${input.surface_id}/${input.item_id}/${input.field}`;
    let replace = input.replace;
    if (replace === undefined && input.replace_handle) {
      const loaded = await loadDraft(ctx, input.replace_handle);
      if (loaded === null) return { content: `Error: draft handle '${input.replace_handle}' not found or expired. Re-send replace literally.`, isError: true };
      replace = loaded;
    }
    if (replace === undefined) return { content: "Error: provide either replace or replace_handle.", isError: true };

    const gateError = ensureRecentRead(ctx, gate, input as unknown as Record<string, unknown>);
    if (gateError !== null) {
      const h = await stashDraft(ctx, draftOrigin, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const providers = await discoverProviders(ctx.spindle, ctx.userId);
    const match = findSurface(providers, input.surface_id);
    if (!match) return { content: `Error: unknown surface: ${input.surface_id}`, isError: true };
    const surfaceLabel = match.surface.label;
    const providerName = match.provider.manifest.extension.name;

    const { dialReadItem, dialWriteField } = await import("../../phoneline/transport");
    const readRes = await dialReadItem(ctx.spindle, match.provider.id, {
      userId: ctx.userId, surfaceId: input.surface_id, itemId: input.item_id, field: input.field,
    });
    const current = readRes.value;
    if (typeof current !== "string") {
      const got = current === null ? "null" : Array.isArray(current) ? "array" : typeof current;
      return { content: `Error: ${input.surface_id}.${input.field} is not a string (got ${got}). Use update_external for non-string fields.`, isError: true };
    }

    const gateKey = `external_item:${input.surface_id}/${input.item_id}/${input.field}`;
    const freshError = ensureFreshRead(ctx, gateKey, current);
    if (freshError !== null) {
      const h = await stashDraft(ctx, draftOrigin, replace);
      return { content: `${freshError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    let outcome;
    try {
      outcome = applyEdit(current, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const h = await stashDraft(ctx, draftOrigin, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const writeRes = await dialWriteField(ctx.spindle, match.provider.id, {
      userId: ctx.userId, surfaceId: input.surface_id, itemId: input.item_id, field: input.field, value: outcome.result,
    });
    if (!writeRes.ok) return { content: `Error: write failed: ${writeRes.error ?? "unknown"}`, isError: true };
    refreshReadHash(ctx, gateKey, outcome.result);

    ctx.pushEdit({
      op: "edit",
      surface: "external",
      providerId: match.provider.id,
      providerName,
      externalSurfaceId: input.surface_id,
      itemId: input.item_id,
      surfaceId: `${match.provider.id}:${input.surface_id}:${input.item_id}`,
      surfaceLabel: `${providerName} / ${surfaceLabel} / ${input.item_id}`,
      field: input.field,
      before: current,
      after: outcome.result,
    });

    const diffPatch = buildEditPatch(`${input.surface_id}/${input.item_id}.${input.field}`, current, outcome.result);
    const payload: Record<string, unknown> = {
      surface_id: input.surface_id,
      item_id: input.item_id,
      field: input.field,
      replacements: outcome.count,
      snippet: outcome.firstSnippet,
      patch: { additions: diffPatch.additions, deletions: diffPatch.deletions, hunks: diffPatch.hunks },
    };
    if (outcome.recoveredVia) {
      payload["recovered_via"] = outcome.recoveredVia;
      payload["note"] = `Your 'find' string did not match byte-exactly. The edit was applied using a ${outcome.recoveredVia} fallback. Future calls on this field should copy bytes verbatim from a recent read_external output.`;
    }
    return { content: JSON.stringify(payload) };
  },
});
