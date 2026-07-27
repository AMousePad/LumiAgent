import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import { characterScope } from "../../types";
import type { CharacterUpdateDTO } from "lumiverse-spindle-types";
import { normaliseCharacterTags } from "./_surfaces";
import description from "../prompts/claude/tools/update-character/description.txt";

const inputSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
  character_id: z.string().optional(),
});

export const updateCharacterTool = defineTool({
  name: "update_character",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      patch: { type: "object", additionalProperties: true },
      character_id: { type: "string" },
    },
    required: ["patch"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let target: string;
    try { target = resolveCharacterTarget(ctx, input.character_id); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const patch = input.patch as CharacterUpdateDTO;
    // Refuse `extensions` here. A wholesale extensions patch bypasses the
    // per-path phone-line gates and would let the agent clobber any frozen /
    // derived surface (e.g. lumirealm.source) in one call. Direct it to the
    // path-based tools, which gate via check_write per leaf.
    if (Object.prototype.hasOwnProperty.call(patch, "extensions")) {
      return {
        content: "Error: [REFUSED_BY_EXTENSION] update_character cannot patch `extensions` wholesale. Use `set({path: 'char/extensions/<dotted>', value})`, `edit`, or `rewrite` on the specific path so per-extension write rules apply.",
        isError: true,
      };
    }
    // Refuse non-string fields except tags. Tags use canonical JSON in the
    // ledger so they remain revertable through the same character surface.
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      if (k === "tags") {
        const tags = normaliseCharacterTags(v);
        if (tags === null) {
          return {
            content: "Error: [INVALID_VALUE_TYPE] 'tags' expects a string array.",
            isError: true,
          };
        }
        patch.tags = tags;
        continue;
      }
      if (typeof v !== "string") {
        const kind = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
        return {
          content: `Error: [INVALID_VALUE_TYPE] update_character only patches string fields. '${k}' is ${kind}. Use \`set({path: "char/${k}", value: ...})\` so the edit is recorded and revertable.`,
          isError: true,
        };
      }
    }
    const c = await ctx.spindle.characters.get(target, ctx.userId);
    if (!c) return { content: `Error: character ${target} not found`, isError: true };
    const updated = await ctx.spindle.characters.update(target, patch, ctx.userId);
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const before = (c as unknown as Record<string, unknown>)[k];
      if (k === "tags" && Array.isArray(v)) {
        const beforeJson = JSON.stringify(Array.isArray(before) ? before : []);
        const afterJson = JSON.stringify(v);
        if (beforeJson === afterJson) continue;
        ctx.pushEdit({
          op: "edit",
          surface: "character_field",
          surfaceId: target,
          surfaceLabel: c.name,
          field: k,
          before: beforeJson,
          after: afterJson,
          valueEncoding: "json",
          scope: characterScope(target),
        });
        continue;
      }
      if (typeof before !== "string" || typeof v !== "string") continue;
      if (before === v) continue;
      ctx.pushEdit({ op: "edit", surface: "character_field", surfaceId: target, surfaceLabel: c.name, field: k, before, after: v, scope: characterScope(target) });
    }
    return { content: `OK. Updated character ${updated.id} fields: ${Object.keys(patch).join(", ")}` };
  },
});
