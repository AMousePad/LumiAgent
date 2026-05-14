import { z } from "zod";
import { defineTool, type ReadGate } from "./_framework";
import { applyEdit } from "./_edit";
import { buildEditPatch } from "./_patch";
import { ensureFreshRead, ensureRecentRead, refreshReadHash } from "./_gates";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";
import { resolveRead, resolveWrite, PathError, OutOfRangeError } from "./_path_v2";

const inputSchema = z.object({
  path: z.string().min(3).describe("Slash-separated path. Same grammar as `read`."),
  find: z.string().min(1).describe("Exact substring to locate. Must be unique unless replace_all=true."),
  replace: z.string().optional().describe("Replacement text. Mutually exclusive with replace_handle."),
  replace_handle: z.string().optional().describe("Handle of a previously-stashed replacement draft (returned by a failed prior edit). Use instead of `replace` to avoid re-emitting big payloads."),
  replace_all: z.boolean().optional().describe("Replace every occurrence instead of failing on duplicates."),
}).strict().refine((d) => d.replace !== undefined || d.replace_handle !== undefined, {
  message: "either `replace` or `replace_handle` is required",
});

// The gate keys off the canonical leaf path, the same string read.ts records
// via markRead. resolveRead canonicalises ('char/description' and
// 'character/description' both → 'char/description'), so passing the raw
// input.path won't match; the dispatch code substitutes leaf.key before
// calling ensureRecentRead.
const gate: ReadGate = {
  surface: (input) => String(input["path"] ?? "?"),
  hint: (key) => `Call \`read\` on '${key}' first.`,
};

export const editTool = defineTool({
  name: "edit",
  description: `Find/replace within a string-valued surface, by path.

Rules:
1. Recent-read gate: \`read\` must have run on the SAME path in this turn. Surface keys match byte-for-byte. If you read 'char/description' the gate fails for 'char/extensions/...'.
2. Unique-find: \`find\` must appear exactly once, unless replace_all=true.
3. Automatic recovery: when byte-exact match fails, falls through NFC / NFD / strip-invisible / quote-asciify / whitespace-flex variants. Result includes \`recovered_via\` on success.
4. Failure stashes the replacement payload as a draft handle the next call can pass via \`replace_handle\`.

Path grammar: same as \`read\`. Examples: 'char/first_mes', 'rx/<id>/replace_string', 'wb/<id>/comment', 'char/extensions/lumirealm.payload.background_html'.

Returns:
- \`path\`         — canonical leaf path that was written.
- \`replacements\` — how many occurrences were replaced (1 unless replace_all).
- \`snippet\`      — short context window around the first hit, post-replace.
- \`patch\`        — \`{additions, deletions, hunks}\` jsdiff-structured for the UI.
- \`recovered_via\` (only on fallback) — name of the recovery strategy that matched. Leading WARNING line precedes the JSON.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Surface path. See `read` tool for grammar." },
      find: { type: "string" },
      replace: { type: "string" },
      replace_handle: { type: "string", description: "Handle of a previously-stashed draft." },
      replace_all: { type: "boolean" },
    },
    required: ["path", "find"],
    additionalProperties: false,
  },
  requiresRecentRead: gate,
  requiresCharacter: true,
  execute: async (input, ctx) => {
    let replace = input.replace;
    if (replace === undefined && input.replace_handle) {
      const loaded = await loadDraft(ctx, input.replace_handle);
      if (loaded === null) return { content: `Error: [DRAFT_HANDLE_EXPIRED] draft handle '${input.replace_handle}' not found or expired. Re-send replace literally.`, isError: true };
      replace = loaded;
    }
    if (replace === undefined) return { content: "Error: provide either `replace` or `replace_handle`.", isError: true };

    let leaf;
    try { leaf = await resolveRead(ctx, input.path); }
    catch (err) {
      if (err instanceof OutOfRangeError) return { content: `Error: [OUT_OF_RANGE] ${err.message}`, isError: true };
      if (err instanceof PathError) return { content: `Error: [PATH_NOT_FOUND] ${err.message}`, isError: true };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }

    // Gate check is keyed on the raw `path` input, but the canonical leaf.key
    // is what `read` records. Synthesize a normalized input for the gate.
    const gateError = ensureRecentRead(ctx, gate, { path: leaf.key });
    if (gateError !== null) {
      const h = await stashDraft(ctx, `edit:${leaf.key}`, replace);
      return { content: `${gateError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    // Freshness gate: even within the 10-minute window, the spindle value
    // may have shifted (external write, prior edit in this turn). Hash
    // mismatch fails LOUD so the agent re-reads instead of overwriting
    // someone else's edit.
    const freshError = ensureFreshRead(ctx, leaf.key, leaf.value);
    if (freshError !== null) {
      const h = await stashDraft(ctx, `edit:${leaf.key}`, replace);
      return { content: `${freshError}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    let outcome;
    try { outcome = applyEdit(leaf.value, input.find, replace, input.replace_all ?? false); }
    catch (err) {
      const h = await stashDraft(ctx, `edit:${leaf.key}`, replace);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, replace.length, "replace")}`, isError: true };
    }

    try { await resolveWrite(ctx, leaf, outcome.result); }
    catch (err) { return { content: `Error: write failed: ${(err as Error).message}`, isError: true }; }
    refreshReadHash(ctx, leaf.key, outcome.result);

    const diffPatch = buildEditPatch(leaf.key, leaf.value, outcome.result);
    // recovered_via fires LOUD: leading WARNING line above the JSON. Silent
    // recoveries train the agent to assume bytes are clean; a banner trains
    // it to copy bytes verbatim and run `inspect` when source looks weird.
    const payload: Record<string, unknown> = {
      path: leaf.key,
      replacements: outcome.count,
      snippet: outcome.firstSnippet,
      patch: { additions: diffPatch.additions, deletions: diffPatch.deletions, hunks: diffPatch.hunks },
    };
    let body = JSON.stringify(payload);
    if (outcome.recoveredVia) {
      const warning = `WARNING: edit applied via fallback "${outcome.recoveredVia}", NOT byte-exact. The source contains typography (curly quotes, corner brackets, etc.) that your 'find' string didn't match literally. Future edits on this path: run \`inspect\` to see the encoding diagnostics, then copy bytes verbatim from a fresh \`read\` output. Repeated reliance on fallbacks usually means the source has encoding drift you haven't surfaced.`;
      body = `${warning}\n\n${body}`;
    }
    return { content: body };
  },
});
