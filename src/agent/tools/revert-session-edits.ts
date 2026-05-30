import { z } from "zod";
import { defineTool } from "./_framework";
import { loadLedger, findPatch, findStructural } from "../../state/ledger";
import { characterScope } from "../../types";
import { revertEditWithCheck } from "../../state/edit-log";
import { spliceRevertedFromSession } from "../../state/sessions";
import { resolveCharacterTarget, noTargetResult } from "./_context";

const inputSchema = z.object({
  edit_ids: z.array(z.string().min(1)).min(1).max(50).describe("Edit ids from list_session_edits."),
  allow_cross_session: z.boolean().optional().describe("Allow reverting edits you made in a DIFFERENT chat session. Default false: only current-session edits are revertable. Opt in only when the user asks to undo work from an earlier conversation."),
}).strict();

export const revertSessionEditsTool = defineTool({
  name: "revert_session_edits",
  description: `Reverts one or more agent-authored edits by id.

Usage:
- Restricted by default to edits authored in the CURRENT session.
- Set \`allow_cross_session: true\` to revert edits from earlier sessions on this character. Use sparingly; the user from those earlier sessions doesn't know about the change.
- Cascade-aware: if a later edit depended on a reverted one and can no longer apply, it gets reverted too and listed under \`cascadedEditIds\`.
- Edit ids come from \`list_session_edits\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      edit_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
      allow_cross_session: { type: "boolean", description: "Default false. Set true to revert edits owned by a different session." },
    },
    required: ["edit_ids"],
    additionalProperties: false,
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    let cid: string;
    try { cid = resolveCharacterTarget(ctx); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const allowCrossSession = input.allow_cross_session === true;
    const ledger = await loadLedger(ctx.spindle, characterScope(cid), ctx.userId);

    interface Accepted { id: string; ownerSessionId: string | null; ts: number; }
    const accepted: Accepted[] = [];
    const rejected: Array<{ edit_id: string; reason: string }> = [];
    for (const id of input.edit_ids) {
      // Field edits live on the patch stack; structural ops (op:create / op:delete
      // for alternate_greeting, alternate_field_variant, and character-scoped wb
      // entries) live on ledger.structural. Without the structural fallback the
      // tool reports every create/delete as "not_found" even though the agent
      // can see them through list_session_edits.
      const located = findPatch(ledger, id);
      if (located) {
        if (located.patch.author !== "agent") { rejected.push({ edit_id: id, reason: "not_agent_authored" }); continue; }
        if (!allowCrossSession && located.patch.sessionId !== ctx.sessionId) {
          rejected.push({ edit_id: id, reason: "different_session (pass allow_cross_session: true to permit)" });
          continue;
        }
        accepted.push({ id, ownerSessionId: located.patch.sessionId, ts: located.patch.ts });
        continue;
      }
      const struct = findStructural(ledger, id);
      if (struct) {
        if (struct.author !== "agent") { rejected.push({ edit_id: id, reason: "not_agent_authored" }); continue; }
        if (!allowCrossSession && struct.sessionId !== ctx.sessionId) {
          rejected.push({ edit_id: id, reason: "different_session (pass allow_cross_session: true to permit)" });
          continue;
        }
        accepted.push({ id, ownerSessionId: struct.sessionId, ts: struct.ts });
        continue;
      }
      rejected.push({ edit_id: id, reason: "not_found (note: persona / preset / world_book structural edits live in their own per-scope ledgers, which this tool does not yet enumerate)" });
    }

    // Newest-first to minimise cascade chatter.
    accepted.sort((a, b) => b.ts - a.ts);

    const outcomes: Array<Record<string, unknown>> = [];
    // Foreign session id -> ids to splice out of that session's edits view.
    // Current-session ids are mirrored by the loop's revert_logged handler.
    const foreignSessionEdits = new Map<string, Set<string>>();

    for (const { id, ownerSessionId } of accepted) {
      const outcome = await revertEditWithCheck(ctx.spindle, ledger, id, cid, ctx.userId, /* force */ true);
      ctx.pushRevert(id, outcome);
      outcomes.push({ edit_id: id, owner_session_id: ownerSessionId, ...outcome });
      if (outcome.kind === "clean" && ownerSessionId && ownerSessionId !== ctx.sessionId) {
        let set = foreignSessionEdits.get(ownerSessionId);
        if (!set) { set = new Set(); foreignSessionEdits.set(ownerSessionId, set); }
        set.add(id);
        for (const c of outcome.cascadedEditIds ?? []) set.add(c);
      }
    }

    if (foreignSessionEdits.size > 0) {
      const note = `[Note from the system: an agent acting in a different chat session for this character has reverted ${accepted.length === 1 ? "an edit" : "edits"} that was made here earlier. The affected character fields have been restored to their prior state. This happened outside this conversation; do not bring it up unless the user asks.]`;
      await Promise.allSettled(Array.from(foreignSessionEdits, ([sid, ids]) =>
        spliceRevertedFromSession(ctx.spindle, sid, ids, [note], ctx.userId),
      ));
    }

    return { content: JSON.stringify({
      reverted: outcomes.filter((o) => o["kind"] === "clean").length,
      cross_session_reverts: foreignSessionEdits.size > 0 ? Array.from(foreignSessionEdits.keys()) : undefined,
      outcomes,
      rejected,
    }) };
  },
});
