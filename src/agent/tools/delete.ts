import { z } from "zod";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, noTargetResult } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { characterScope } from "../../types";
import { deleteCharacter, deletePersonaAddon, splitCharacterPath } from "./_character";
import { deleteWorldBookPath } from "./_worldbook";
import { isAlternateFieldName, wholeCharacterDeleteTarget, readAltFieldArray, writeAltFieldArray, ALTERNATE_FIELD_NAMES } from "./_path_v2";
import description from "../prompts/claude/tools/delete/description.txt";
import argPath from "../prompts/claude/tools/delete/arg_path.txt";

const inputSchema = z.object({
  path: z.string().min(3).describe("Entity to delete. Same path grammar as `read` / `edit`."),
  character_id: z.string().optional(),
}).strict();

export const deleteTool = defineTool({
  name: "delete",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: argPath },
      character_id: { type: "string", description: "Target character for char/alternate_greetings and char/alternate_fields paths. Never selects a character to delete." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx: ToolCtx) => {
    const split = splitCharacterPath(input.path.trim().replace(/\/+$/, ""), input.character_id);
    const path = split.path;
    const parts = path.split("/").filter((p) => p.length > 0);

    // The same parse decides the forced confirmation, so the two can never disagree on what counts as a whole-card delete.
    const wholeCard = wholeCharacterDeleteTarget(input.path);
    if (wholeCard !== null) {
      try { return await deleteCharacter(ctx, wholeCard); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }
    if (parts.length === 1 && (parts[0] === "char" || parts[0] === "characters")) {
      return { content: 'Error: [INVALID_INPUT] deleting a character needs its id or exact name: delete({path:"char/<id>"}).', isError: true };
    }
    let charId = "";
    if (parts[0] === "char") {
      try { charId = resolveCharacterTarget(ctx, split.target); }
      catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    }

    // preset/<presetId>/block/<blockId>
    if (parts[0] === "preset" && parts[2] === "block" && parts.length === 4) {
      const presetId = parts[1]!;
      const blockId = parts[3]!;
      const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx < 0) return { content: `Error: [PATH_NOT_FOUND] block ${blockId} not in preset ${presetId}`, isError: true };
      const before = blocks[idx]!;
      await ctx.spindle.presets.blocks.delete(presetId, blockId, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "preset_block", surfaceId: `${presetId}:${blockId}`,
        surfaceLabel: `${before.name || "block"}`,
        snapshot: { ...before, __presetId: presetId, __index: idx } as never,
        scope: { kind: "preset", id: presetId },
      } satisfies EditRecord);
      return { content: JSON.stringify({ preset_id: presetId, block_id: blockId, deleted: true, can_revert: true }) };
    }

    // preset/<presetId>
    if (parts[0] === "preset" && parts.length === 2) {
      const presetId = parts[1]!;
      const preset = await ctx.spindle.presets.get(presetId, ctx.userId);
      if (!preset) return { content: `Error: [PATH_NOT_FOUND] preset ${presetId} not found`, isError: true };
      const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
      await ctx.spindle.presets.delete(presetId, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "preset", surfaceId: presetId, surfaceLabel: preset.name,
        snapshot: { preset, blocks }, scope: { kind: "preset", id: presetId },
      } satisfies EditRecord);
      return { content: JSON.stringify({ preset_id: presetId, deleted: true, blocks_removed: blocks.length, can_revert: true }) };
    }

    if (parts[0] === "persona" && parts[2] === "addon" && parts.length === 4) {
      try { return await deletePersonaAddon(ctx, parts[1]!, parts[3]!); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    // persona/<personaId>
    if (parts[0] === "persona" && parts.length === 2) {
      const personaId = parts[1]!;
      const p = await ctx.spindle.personas.get(personaId, ctx.userId);
      if (!p) return { content: `Error: [PATH_NOT_FOUND] persona ${personaId} not found. Find its id with personas({action:"list", query}).`, isError: true };
      const active = await ctx.spindle.personas.getActive(ctx.userId).catch(() => null);
      await ctx.spindle.personas.delete(personaId, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "persona", surfaceId: personaId, surfaceLabel: p.name,
        snapshot: p, scope: { kind: "persona", id: personaId },
      } satisfies EditRecord);
      const flags = { ...(p.is_default ? { was_default: true } : {}), ...(active?.id === personaId ? { was_active: true } : {}) };
      return { content: JSON.stringify({
        persona_id: personaId, name: p.name, deleted: true, can_revert: true, ...flags,
        ...(Object.keys(flags).length > 0 ? { note: "No persona holds that role now. A revert recreates it under a new id without its portrait." } : {}),
      }) };
    }

    // rx/<scriptId>
    if ((parts[0] === "rx" || parts[0] === "regex_script") && parts.length === 2) {
      const id = parts[1]!;
      const before = await ctx.spindle.regex_scripts.get(id, ctx.userId);
      if (!before) return { content: `Error: [PATH_NOT_FOUND] regex script ${id} not found`, isError: true };
      await ctx.spindle.regex_scripts.delete(id, ctx.userId);
      const scope: ScopeRef | undefined = ctx.characterId ? undefined : { kind: "regex_script", id };
      ctx.pushEdit({
        op: "delete", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, snapshot: before,
        ...(scope ? { scope } : {}),
      } satisfies EditRecord);
      return { content: JSON.stringify({ script_id: id, deleted: true, can_revert: true }) };
    }

    // char/alternate_fields/<field>/<variantId>
    if (parts[0] === "char" && parts[1] === "alternate_fields" && parts.length === 4) {
      const field = parts[2]!;
      const variantId = parts[3]!;
      if (!isAlternateFieldName(field)) {
        return { content: `Error: [INVALID_INPUT] alternate_fields field must be one of ${ALTERNATE_FIELD_NAMES.join(", ")}, got '${field}'`, isError: true };
      }
      const c = await ctx.spindle.characters.get(charId, ctx.userId);
      if (!c) return { content: `Error: [PATH_NOT_FOUND] character ${charId} not found`, isError: true };
      const before = readAltFieldArray(c.extensions, field);
      const idx = before.findIndex((v) => v.id === variantId);
      if (idx < 0) return { content: `Error: [PATH_NOT_FOUND] variant '${variantId}' not found under alternate_fields.${field}`, isError: true };
      const removed = before[idx]!;
      const after = before.slice(0, idx).concat(before.slice(idx + 1));
      const nextExt = writeAltFieldArray(c.extensions, field, after);
      await ctx.spindle.characters.update(charId, { extensions: nextExt }, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "alternate_field_variant", surfaceId: variantId,
        surfaceLabel: `${field} variant '${removed.label || "(unlabeled)"}'`,
        snapshot: { altField: field, variant: { id: removed.id, label: removed.label, content: removed.content }, index: idx },
        scope: characterScope(charId),
      } satisfies EditRecord);
      return { content: JSON.stringify({ character: { id: charId, name: c.name }, field, variant_id: variantId, index: idx, deleted: true, can_revert: true, chars_removed: removed.content.length }) };
    }

    // char/alternate_greetings/<idx> or a comma list of indices
    if ((path.startsWith("char/alternate_greetings/")) && parts.length === 3) {
      const wanted = parts[2]!.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
      if (wanted.length === 0 || wanted.some((x) => !/^\d+$/.test(x))) return { content: `Error: [INVALID_INPUT] '${parts[2]}' is not an index. Pass one 0-based index or a comma list such as char/alternate_greetings/2,3,5.`, isError: true };
      const indices = [...new Set(wanted.map((x) => parseInt(x, 10)))].sort((x, y) => y - x);
      const c = await ctx.spindle.characters.get(charId, ctx.userId);
      if (!c) return { content: `Error: [PATH_NOT_FOUND] character ${charId} not found`, isError: true };
      const arr = [...(c.alternate_greetings ?? [])];
      const bad = indices.filter((i) => i >= arr.length);
      if (bad.length > 0) return { content: `Error: [OUT_OF_RANGE] index ${bad.join(", ")} (length ${arr.length}). Nothing was deleted.`, isError: true };
      const removed: Array<{ index: number; chars: number; peek: string; text: string }> = [];
      // Highest index first so the remaining indices stay valid and a newest-first revert restores the order.
      for (const idx of indices) {
        const text = arr[idx] ?? "";
        arr.splice(idx, 1);
        removed.push({ index: idx, chars: text.length, peek: text.slice(0, 80), text });
      }
      await ctx.spindle.characters.update(charId, { alternate_greetings: arr }, ctx.userId);
      for (const r of removed) {
        ctx.pushEdit({
          op: "delete", surface: "alternate_greeting", surfaceId: String(r.index),
          surfaceLabel: `alternate_greetings[${r.index}]`, snapshot: { greeting: r.text, index: r.index },
          scope: characterScope(charId),
        } satisfies EditRecord);
      }
      return { content: JSON.stringify({
        character: { id: charId, name: c.name },
        deleted: removed.length, removed: removed.reverse().map(({ text: _text, ...row }) => row), remaining: arr.length,
        ...(arr.length > 0 ? { note: "Later greetings moved down. Indices from before this call are stale." } : {}),
      }) };
    }

    if ((parts[0] === "wb" || parts[0] === "world_book" || parts[0] === "world_books") && parts.length === 2) {
      try { return await deleteWorldBookPath(ctx, parts[1]!); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    return { content: `Error: [PATH_NOT_FOUND] cannot delete '${path}'. Valid: wb/<id>, rx/<id>, persona/<id>, persona/<id>/addon/<addonId>, preset/<id>, preset/<id>/block/<id>, char/<id> (whole card), char/alternate_greetings/<idx>, char/<id>/alternate_greetings/<idx>, char/alternate_fields/<field>/<variantId>`, isError: true };
  },
});
