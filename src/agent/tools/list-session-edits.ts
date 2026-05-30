import { z } from "zod";
import { defineTool } from "./_framework";
import { loadLedger, listNonCharacterScopeLedgers, type ScopedLedger } from "../../state/ledger";
import { characterScope } from "../../types";
import { resolveCharacterTarget, noTargetResult } from "./_context";

const inputSchema = z.object({
  scope: z.enum(["current_message", "current_session", "all_sessions"]).optional().describe("current_message: just this response. current_session: every edit you've made in this session. all_sessions: every agent-authored edit on this character across every session (useful when the user asks about prior conversations). Default current_message."),
  include_reverted: z.boolean().optional().describe("Include already-reverted edits. Default false."),
  limit: z.number().int().positive().max(500).optional(),
}).strict();

export const listSessionEditsTool = defineTool({
  name: "list_session_edits",
  description: `Lists agent-authored edits.

Usage:
- Default scope is the current response. Widen with \`current_session\` or \`all_sessions\`.
- Returns one row per patch: edit_id, surface, surface_id, surface_label, field, ts, reverted, session_id.
- Pass returned ids to \`revert_session_edits\` or \`squash_session_edits\`.
- Cross-session revert requires \`allow_cross_session: true\` on \`revert_session_edits\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["current_message", "current_session", "all_sessions"], description: "Default current_message." },
      include_reverted: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
    },
    additionalProperties: false,
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    let cid: string;
    try { cid = resolveCharacterTarget(ctx); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const scope = input.scope ?? "current_message";
    const includeReverted = input.include_reverted ?? false;
    const out: Array<Record<string, unknown>> = [];

    const collect = (ledger: ScopedLedger): void => {
      for (const f of ledger.files) {
        for (const p of f.patches) {
          if (p.author !== "agent") continue;
          if (scope !== "all_sessions" && p.sessionId !== ctx.sessionId) continue;
          if (scope === "current_message" && p.assistantMessageId !== ctx.assistantMessageId) continue;
          if (!includeReverted && p.reverted) continue;
          out.push({
            edit_id: p.id,
            op: "edit",
            surface: f.key.surface,
            surface_id: f.key.surfaceId,
            surface_label: f.surfaceLabel,
            field: f.key.field,
            ts: p.ts,
            tool: p.toolName ?? null,
            reverted: p.reverted,
            sealed: p.sealed === true,
            session_id: p.sessionId,
            is_current_session: p.sessionId === ctx.sessionId,
            message_id: p.assistantMessageId ?? null,
          });
        }
      }
      // Structural ops (op:create / op:delete) live alongside field patches. Without
      // this the agent can't see, let alone revert, its own create/delete actions
      // on alternate_greetings, alternate_field_variants, world books, personas,
      // presets, or preset blocks. They lack assistantMessageId, so current_message
      // scope can't isolate them; surface them at current_session and above.
      for (const sp of ledger.structural) {
        if (sp.author !== "agent") continue;
        if (scope === "current_message") continue;
        if (scope !== "all_sessions" && sp.sessionId !== ctx.sessionId) continue;
        if (!includeReverted && sp.reverted) continue;
        out.push({
          edit_id: sp.id,
          op: sp.op,
          surface: sp.surface,
          surface_id: sp.surfaceId,
          surface_label: sp.surfaceLabel,
          field: null,
          ts: sp.ts,
          tool: sp.toolCallId ? sp.op : null,
          reverted: sp.reverted,
          sealed: false,
          session_id: sp.sessionId,
          is_current_session: sp.sessionId === ctx.sessionId,
          message_id: null,
        });
      }
    };

    collect(await loadLedger(ctx.spindle, characterScope(cid), ctx.userId));
    // Persona / chat / preset / world_book / regex_script edits the agent made
    // this session file into their own per-scope ledgers, invisible to a
    // character-only scan. Enumerate them so the listing is scope-complete.
    for (const { ledger } of await listNonCharacterScopeLedgers(ctx.spindle, ctx.userId)) {
      collect(ledger);
    }
    out.sort((a, b) => (a["ts"] as number) - (b["ts"] as number));
    const limited = input.limit !== undefined ? out.slice(0, input.limit) : out;
    return { content: JSON.stringify({ scope, count: limited.length, total: out.length, edits: limited }) };
  },
});
