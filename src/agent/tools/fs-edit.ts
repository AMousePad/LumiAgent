import { z } from "zod";
import { defineTool } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureRecentRead } from "./_gates";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

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
  surface: (input: Record<string, unknown>) => `fs:${input["path"] ?? "?"}`,
  hint: (key: string) => `Call fs_read with path='${key.split(":").slice(1).join(":")}' first.`,
};

export const fsEditTool = defineTool({
  name: "fs_edit",
  description: "Find/replace inside a workspace text file. Requires a recent fs_read on the same path in this turn. Same unique-find discipline as the card edit tools.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft." },
      replace_all: { type: "boolean" },
    },
    required: ["path", "find"],
  },
  requiresRecentRead: gate,
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
      const h = await stashDraft(ctx, `fs_edit:${input.path}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const ws = await import("../../state/workspace");
    const node = await ws.stat(ctx.spindle, ctx.userId, input.path);
    if (!node || node.isDirectory) return { content: `Error: workspace file '${input.path}' not found`, isError: true };
    const current = await ws.readText(ctx.spindle, ctx.userId, input.path);

    let outcome;
    try {
      outcome = applyEdit(current, input.find, replace, input.replace_all ?? false);
    } catch (err) {
      const h = await stashDraft(ctx, `fs_edit:${input.path}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
    await ws.writeText(ctx.spindle, ctx.userId, input.path, outcome.result, caps);
    const diffPatch = buildEditPatch(`workspace:${input.path}`, current, outcome.result);
    const payload: Record<string, unknown> = {
      path: input.path,
      replacements: outcome.count,
      snippet: outcome.firstSnippet,
      patch: { additions: diffPatch.additions, deletions: diffPatch.deletions, hunks: diffPatch.hunks },
    };
    if (outcome.recoveredVia) {
      payload["recovered_via"] = outcome.recoveredVia;
      payload["note"] = `Your 'find' string did not match byte-exactly. The edit was applied using a ${outcome.recoveredVia} fallback. Future calls on this field should copy bytes verbatim from a recent fs_read output.`;
    }
    return { content: JSON.stringify(payload) };
  },
});
