import { z } from "zod";
import { defineTool } from "./_framework";
import { loadLedger, findPatch } from "../../state/ledger";
import { revertEditWithCheck } from "../../state/edit-log";

const inputSchema = z.object({
  edit_ids: z.array(z.string().min(1)).min(1).max(50).describe("Edit ids from list_my_edits. Only edits you authored in the current session may be reverted."),
}).strict();

export const revertMyEditsTool = defineTool({
  name: "revert_my_edits",
  description: "Revert one or more of your own prior edits. Restricted to edits you authored in the current session. Cascade-aware (if a later edit depended on a reverted one and can no longer apply, it gets reverted too and listed under cascadedEditIds). Useful when you realise a chunk of changes was wrong and want to roll back without asking the user. The edit ids come from list_my_edits.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      edit_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
    },
    required: ["edit_ids"],
    additionalProperties: false,
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const ledger = await loadLedger(ctx.spindle, ctx.characterId, ctx.userId);

    const ownerOk: string[] = [];
    const rejected: Array<{ edit_id: string; reason: string }> = [];
    for (const id of input.edit_ids) {
      const located = findPatch(ledger, id);
      if (!located) { rejected.push({ edit_id: id, reason: "not_found" }); continue; }
      if (located.patch.author !== "agent") { rejected.push({ edit_id: id, reason: "not_agent_authored" }); continue; }
      if (located.patch.sessionId !== ctx.sessionId) { rejected.push({ edit_id: id, reason: "different_session" }); continue; }
      ownerOk.push(id);
    }

    // Newest-first to minimise cascade chatter.
    ownerOk.sort((a, b) => {
      const pa = findPatch(ledger, a)?.patch.ts ?? 0;
      const pb = findPatch(ledger, b)?.patch.ts ?? 0;
      return pb - pa;
    });

    const outcomes: Array<Record<string, unknown>> = [];
    for (const id of ownerOk) {
      const outcome = await revertEditWithCheck(ctx.spindle, ledger, id, ctx.characterId, ctx.userId, /* force */ true);
      ctx.pushRevert(id, outcome);
      outcomes.push({ edit_id: id, ...outcome });
    }

    return { content: JSON.stringify({ reverted: outcomes.filter((o) => o["kind"] === "clean").length, outcomes, rejected }) };
  },
});
