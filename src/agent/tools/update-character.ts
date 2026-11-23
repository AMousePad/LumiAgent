import { z } from "zod";
import { cleanPatch, defineTool, emptyPatchError } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import { characterScope } from "../../types";
import type { CharacterUpdateDTO } from "lumiverse-spindle-types";
import { CHARACTER_STRING_FIELDS, isCharacterStringField, normaliseCharacterTags } from "./_surfaces";
import { CHARACTER_FIELD_ALIASES } from "./_character";
import description from "../prompts/claude/tools/update-character/description.txt";

const inputSchema = z.object({
  patch: z.record(z.string(), z.unknown()).optional(),
  clear: z.array(z.string()).optional(),
  character_id: z.string().optional(),
});

export const updateCharacterTool = defineTool({
  name: "update_character",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      patch: {
        type: "object",
        description: "Only the fields to change. tags replaces the whole list.",
        properties: Object.fromEntries([
          ...["name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes", "system_prompt", "post_history_instructions", "creator"].map((k) => [k, { type: "string" }]),
          ["tags", { type: "array", items: { type: "string" } }],
        ]),
      },
      clear: { type: "array", items: { type: "string" }, description: "Field names to empty, e.g. [\"system_prompt\"]. An empty string in patch is ignored, so this is the only way to blank a field. \"tags\" removes every tag." },
      character_id: { type: "string" },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let target: string;
    try { target = resolveCharacterTarget(ctx, input.character_id); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const rawPatch = (input.patch ?? {}) as Record<string, unknown>;
    const renamed: string[] = [];
    const unknown: string[] = [];
    const patch = {} as CharacterUpdateDTO;
    for (const [k, v] of Object.entries(rawPatch)) {
      const key = CHARACTER_FIELD_ALIASES[k] ?? k;
      if (key !== k) renamed.push(`${k} -> ${key}`);
      if (key !== "tags" && key !== "extensions" && !isCharacterStringField(key)) { unknown.push(k); continue; }
      (patch as Record<string, unknown>)[key] = v;
    }
    const clear = [...new Set((input.clear ?? []).map((k) => CHARACTER_FIELD_ALIASES[k] ?? k))];
    for (const k of clear) if (k !== "tags" && !isCharacterStringField(k)) unknown.push(k);
    if (unknown.length > 0) {
      const folder = unknown.includes("folder") ? " A character's folder cannot be changed by an extension: the user moves it in the character manager." : "";
      const greetings = unknown.includes("alternate_greetings") ? ' Greetings: add with create({path:"char/alternate_greetings"}), reorder with set({path:"char/alternate_greetings", value:{from,to}}).' : "";
      return {
        content: `Error: [PATH_NOT_FOUND] unknown character field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Nothing was written. Valid: ${CHARACTER_STRING_FIELDS.join(", ")}, tags.${folder}${greetings}`,
        isError: true,
      };
    }
    if (clear.includes("name")) return { content: "Error: [INVALID_INPUT] a character name cannot be cleared. Nothing was written.", isError: true };
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
          content: `Error: [INVALID_VALUE_TYPE] update_character only patches string fields. '${k}' is ${kind}.${v === null ? ` To blank it pass clear: ["${k}"].` : ""} Nothing was written.`,
          isError: true,
        };
      }
    }
    const c = await ctx.spindle.characters.get(target, ctx.userId);
    if (!c) return { content: `Error: character ${target} not found`, isError: true };
    const ignoredEmpty = Object.entries(patch as Record<string, unknown>).filter(([k, v]) => v === "" && !clear.includes(k)).map(([k]) => k);
    for (const k of clear) (patch as Record<string, unknown>)[k] = k === "tags" ? [] : "";
    const cleaned = cleanPatch(patch as Record<string, unknown>, c as unknown as Record<string, unknown>, new Set(clear));
    // cleanPatch drops an empty array, which is exactly what clearing tags asks for.
    if (clear.includes("tags") && (c.tags ?? []).length > 0) cleaned.patch["tags"] = [];
    const emptyHint = ignoredEmpty.length > 0 ? ` Empty strings were ignored for: ${ignoredEmpty.join(", ")}. To blank a field pass clear: ${JSON.stringify(ignoredEmpty)}.` : "";
    if (Object.keys(cleaned.patch).length === 0) return { content: emptyPatchError(cleaned.unchanged, '{"scenario": "..."}') + emptyHint, isError: true };
    const updated = await ctx.spindle.characters.update(target, cleaned.patch as CharacterUpdateDTO, ctx.userId);
    const notApplied = Object.entries(cleaned.patch)
      .filter(([k, v]) => JSON.stringify((updated as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(v))
      .map(([k]) => k);
    for (const [k, v] of Object.entries(cleaned.patch)) {
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
    const cleared = clear.filter((k) => k in cleaned.patch);
    const tail = [
      cleared.length > 0 ? ` Cleared: ${cleared.join(", ")}.` : "",
      renamed.length > 0 ? ` Field names corrected: ${renamed.join(", ")}.` : "",
      emptyHint,
    ].join("");
    if (notApplied.length > 0) {
      return { content: `Error: [NOT_APPLIED] the host did not store: ${notApplied.join(", ")}. Other fields in this call were written.${tail}`, isError: true };
    }
    return { content: `OK. Updated ${updated.name} (${updated.id}). Changed ${cleaned.summary || cleared.join(", ")}.${tail}` };
  },
});
