import { z } from "zod";
import { defineTool } from "./_framework";
import { findPatch, findStructural, listScopeLedgers, type ScopedLedger } from "../../state/ledger";
import type { ScopeRef } from "../../types";
import { revertEditWithCheck } from "../../state/edit-log";
import { spliceRevertedFromSession } from "../../state/sessions";
import description from "../prompts/claude/tools/revert-session-edits/description.txt";
import argAllowCrossSession from "../prompts/claude/tools/revert-session-edits/arg_allow_cross_session.txt";

const inputSchema = z.object({
  edit_ids: z.array(z.string().min(1)).min(1).max(500).describe("Edit ids from list_session_edits."),
  allow_cross_session: z.boolean().optional().describe("Allow reverting edits you made in a DIFFERENT chat session. Default false: only current-session edits are revertable. Opt in only when the user asks to undo work from an earlier conversation."),
}).strict();

export const revertSessionEditsTool = defineTool({
  name: "revert_session_edits",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      edit_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500 },
      allow_cross_session: { type: "boolean", description: argAllowCrossSession },
    },
    required: ["edit_ids"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const allowCrossSession = input.allow_cross_session === true;
    const scopeLedgers = await listScopeLedgers(ctx.spindle, ctx.userId);

    interface Accepted { id: string; ownerSessionId: string | null; ts: number; scope: ScopeRef; ledger: ScopedLedger; }
    const accepted: Accepted[] = [];
    const rejected: Array<{ edit_id: string; reason: string }> = [];
    for (const id of input.edit_ids) {
      // Field edits live on the patch stack; structural ops (op:create / op:delete
      // for alternate_greeting, alternate_field_variant, world books, personas,
      // presets, preset blocks) live on ledger.structural. Search every scope
      // ledger so cross-scope structural edits are revertable, not just
      // character-scoped ones.
      let found: { author: string | undefined; sessionId: string | null; ts: number; scope: ScopeRef; ledger: ScopedLedger } | null = null;
      for (const { scope, ledger } of scopeLedgers) {
        const located = findPatch(ledger, id);
        if (located) { found = { author: located.patch.author, sessionId: located.patch.sessionId, ts: located.patch.ts, scope, ledger }; break; }
        const struct = findStructural(ledger, id);
        if (struct) { found = { author: struct.author, sessionId: struct.sessionId, ts: struct.ts, scope, ledger }; break; }
      }
      if (!found) { rejected.push({ edit_id: id, reason: "not_found" }); continue; }
      if (found.author !== "agent") { rejected.push({ edit_id: id, reason: "not_agent_authored" }); continue; }
      if (!allowCrossSession && found.sessionId !== ctx.sessionId) {
        rejected.push({ edit_id: id, reason: "different_session (pass allow_cross_session: true to permit)" });
        continue;
      }
      accepted.push({ id, ownerSessionId: found.sessionId, ts: found.ts, scope: found.scope, ledger: found.ledger });
    }

    // Newest-first to minimise cascade chatter.
    accepted.sort((a, b) => b.ts - a.ts);

    // Snapshot id -> owning session across every scope ledger BEFORE reverting
    // (revertEditWithCheck purges, so ownership must be captured first). A
    // cascade victim can belong to a THIRD session, distinct from both the
    // current session and the primary edit's owner.
    const sessionOf = new Map<string, string | null>();
    for (const { ledger } of scopeLedgers) {
      for (const f of ledger.files) for (const p of f.patches) sessionOf.set(p.id, p.sessionId);
      for (const sp of ledger.structural) sessionOf.set(sp.id, sp.sessionId);
      for (const e of ledger.externalEdits) sessionOf.set(e.id, e.sessionId);
    }

    const outcomes: Array<Record<string, unknown>> = [];
    // Foreign session id -> ids to splice out of that session's edits view.
    // Current-session ids are mirrored by the loop's revert_logged handler.
    const foreignSessionEdits = new Map<string, Set<string>>();

    for (const { id, ownerSessionId, scope, ledger } of accepted) {
      // Character surfaces must use their owning character id, not the current
      // focus; a bulk tag call can place one edit in hundreds of ledgers.
      const characterId = scope.kind === "character" ? scope.id : (ctx.characterId ?? "");
      const outcome = await revertEditWithCheck(ctx.spindle, ledger, id, characterId, ctx.userId, /* force */ true);
      ctx.pushRevert(id, outcome, scope);
      outcomes.push({ edit_id: id, owner_session_id: ownerSessionId, ...outcome });
      if (outcome.kind === "clean") {
        // Splice the primary AND each cascade victim into ITS OWN owning
        // session, not the primary's owner.
        for (const vid of [id, ...(outcome.cascadedEditIds ?? [])]) {
          const owner = sessionOf.get(vid) ?? ownerSessionId;
          if (!owner || owner === ctx.sessionId) continue;
          let set = foreignSessionEdits.get(owner);
          if (!set) { set = new Set(); foreignSessionEdits.set(owner, set); }
          set.add(vid);
        }
      }
    }

    if (foreignSessionEdits.size > 0) {
      await Promise.allSettled(Array.from(foreignSessionEdits, ([sid, ids]) => {
        const note = `[Note from the system: an agent acting in a different chat session has reverted ${ids.size === 1 ? "an edit" : `${ids.size} edits`} that ${ids.size === 1 ? "was" : "were"} made here earlier. The affected fields have been restored to their prior state. This happened outside this conversation; do not bring it up unless the user asks.]`;
        return spliceRevertedFromSession(ctx.spindle, sid, ids, [note], ctx.userId);
      }));
    }

    return { content: JSON.stringify({
      reverted: outcomes.filter((o) => o["kind"] === "clean").length,
      cross_session_reverts: foreignSessionEdits.size > 0 ? Array.from(foreignSessionEdits.keys()) : undefined,
      outcomes,
      rejected,
    }) };
  },
});
