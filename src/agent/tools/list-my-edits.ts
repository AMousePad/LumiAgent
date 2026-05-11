import { z } from "zod";
import { defineTool } from "./_framework";
import { loadLedger } from "../../state/ledger";

const inputSchema = z.object({
  scope: z.enum(["current_message", "current_session"]).optional().describe("current_message: just this response. current_session: every edit you've made in this session. Default current_message."),
  include_reverted: z.boolean().optional().describe("Include already-reverted edits. Default false."),
  limit: z.number().int().positive().max(500).optional(),
}).strict();

export const listMyEditsTool = defineTool({
  name: "list_my_edits",
  description: "List edits you (the agent) have made, scoped to either the current response or the whole session. Returns one entry per patch with id, surface, surfaceLabel, field, byte deltas, ts, reverted. Use the ids with revert_my_edits or squash_my_edits.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["current_message", "current_session"], description: "Default current_message." },
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
        if (p.sessionId !== ctx.sessionId) continue;
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
          message_id: p.assistantMessageId ?? null,
        });
      }
    }
    out.sort((a, b) => (a["ts"] as number) - (b["ts"] as number));
    const limited = input.limit !== undefined ? out.slice(0, input.limit) : out;
    return { content: JSON.stringify({ scope, count: limited.length, total: out.length, edits: limited }) };
  },
});
