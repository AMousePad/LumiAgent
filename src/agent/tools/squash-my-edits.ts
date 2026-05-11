import { z } from "zod";
import { defineTool } from "./_framework";
import { squashMessage } from "../../state/ledger";

const inputSchema = z.object({
  phase_label: z.string().max(120).optional().describe("Optional label for what this phase represented (e.g. 'translation pass', 'tone refactor'). Stored on the merged patch's description."),
}).strict();

export const squashMyEditsTool = defineTool({
  name: "squash_my_edits",
  description: "Seal every edit you've made so far in THIS response into one consolidated patch per file/field. Use mid-response to commit a phase of work before starting another (translation pass → seal → tone refactor). The end-of-message autosquash will never merge across sealed patches, so phases stay revertable as discrete units. If you don't call this, all your edits in this response get auto-squashed into one patch per file at the end of the message.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      phase_label: { type: "string", maxLength: 120 },
    },
    additionalProperties: false,
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    if (!ctx.assistantMessageId) return { content: "Error: no active assistant message; squash_my_edits only valid inside an agent response.", isError: true };
    const result = await squashMessage(ctx.spindle, ctx.characterId, ctx.assistantMessageId, ctx.userId, { sealed: true });
    if (result.filesTouched > 0 || result.absorbedIds.length > 0) ctx.pushLedgerResync();
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
