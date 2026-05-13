import { z } from "zod";
import { defineTool } from "./_framework";
import { loadLedger } from "../../state/ledger";

const inputSchema = z.object({
  scope: z.enum(["current_message", "current_session", "all_sessions"]).optional().describe("current_message: just this response. current_session: every edit you've made in this session. all_sessions: every agent-authored edit on this character across every session (useful when the user asks about prior conversations). Default current_message."),
  include_reverted: z.boolean().optional().describe("Include already-reverted edits. Default false."),
  limit: z.number().int().positive().max(500).optional(),
}).strict();

export const listMyEditsTool = defineTool({
  name: "list_my_edits",
  description: "List edits you (the agent) have made. Default scope is the current response; widen with `current_session` or `all_sessions`. Returns one entry per patch with id, surface, surfaceLabel, field, ts, reverted, session_id. Use the ids with revert_my_edits or squash_my_edits (revert across sessions requires allow_cross_session: true on revert_my_edits).",
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
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const scope = input.scope ?? "current_message";
    const includeReverted = input.include_reverted ?? false;
    const ledger = await loadLedger(ctx.spindle, ctx.characterId, ctx.userId);
    const out: Array<Record<string, unknown>> = [];
    for (const f of ledger.files) {
      for (const p of f.patches) {
        if (p.author !== "agent") continue;
        if (scope !== "all_sessions" && p.sessionId !== ctx.sessionId) continue;
        if (scope === "current_message" && p.assistantMessageId !== ctx.assistantMessageId) continue;
        if (!includeReverted && p.reverted) continue;
        out.push({
          edit_id: p.id,
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
    out.sort((a, b) => (a["ts"] as number) - (b["ts"] as number));
    const limited = input.limit !== undefined ? out.slice(0, input.limit) : out;
    return { content: JSON.stringify({ scope, count: limited.length, total: out.length, edits: limited }) };
  },
});
