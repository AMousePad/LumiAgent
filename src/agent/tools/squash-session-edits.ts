import { z } from "zod";
import { defineTool } from "./_framework";
import { squashMessage } from "../../state/ledger";
import { characterScope } from "../../types";
import { resolveCharacterTarget, noTargetResult } from "./_context";

const inputSchema = z.object({
  phase_label: z.string().max(120).optional().describe("Optional label for what this phase represented (e.g. 'translation pass', 'tone refactor'). Stored on the merged patch's description."),
}).strict();

export const squashSessionEditsTool = defineTool({
  name: "squash_session_edits",
  description: `Seals every edit made so far in this response into one consolidated patch per file/field.

Usage:
- Call mid-response to commit a phase of work before starting another (translation pass → seal → tone refactor).
- End-of-message autosquash never merges across sealed patches; phases stay revertable as discrete units.
- If never called, all edits in this response get auto-squashed into one patch per file at the end of the message.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      phase_label: { type: "string", maxLength: 120 },
    },
    additionalProperties: false,
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    if (!ctx.assistantMessageId) return { content: "Error: no active assistant message; squash_session_edits only valid inside an agent response.", isError: true };
    let cid: string;
    try { cid = resolveCharacterTarget(ctx); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const result = await squashMessage(ctx.spindle, characterScope(cid), ctx.assistantMessageId, ctx.userId, { sealed: true });
    if (result.filesTouched > 0 || result.absorbedIds.length > 0) {
      // Pass the absorbed → merged map so the backend rewrites tool-block
      // edit_ids on the in-flight message. Without this, the sealed phase's
      // "Revert all" buttons point at absorbed (now-purged) ids and the
      // matching reverts fail with "edit not found in ledger".
      const remap: Record<string, string> = {};
      for (const [k, v] of result.absorbedToMerged) remap[k] = v;
      // Null-collapse runs (edits that net to no change) purge ids that have NO
      // merged target, so they're absent from absorbedToMerged. Encode them as
      // id -> "" so the backend still drops them from s.edits and strips them
      // from tool-block edit_ids; otherwise the phantom ids linger as live.
      for (const id of result.absorbedIds) if (!(id in remap)) remap[id] = "";
      ctx.pushLedgerResync(remap);
    }
    return {
      content: JSON.stringify({
        files_touched: result.filesTouched,
        groups_merged: result.groupsMerged,
        absorbed_edit_ids: result.absorbedIds,
        new_patch_ids: result.newPatchIds,
        ...(input.phase_label ? { phase_label: input.phase_label } : {}),
        note: result.groupsMerged === 0
          ? "Nothing to squash (no contiguous unsealed runs in this message)."
          : `Sealed ${result.groupsMerged} group${result.groupsMerged === 1 ? "" : "s"} across ${result.filesTouched} file${result.filesTouched === 1 ? "" : "s"}. Subsequent edits in this response start a new phase.`,
      }),
    };
  },
});
