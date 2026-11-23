import { z } from "zod";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, noTargetResult } from "./_context";
import type { EditRecord } from "../../types";
import { characterScope } from "../../types";
import { createPersona, createPersonaAddon, duplicateCharacter, hasCopySource, splitCharacterPath } from "./_character";
import { createRegexScripts } from "./_regex";
import { createWorldBook, createWorldBookEntries } from "./_worldbook";
import { createPreset, createPresetBlocks } from "./_preset";
import { ALTERNATE_FIELD_NAMES, isAlternateFieldName, readAltFieldArray, writeAltFieldArray, type AltFieldVariant } from "./_path_v2";
import description from "../prompts/claude/tools/create/description.txt";
import argPath from "../prompts/claude/tools/create/arg_path.txt";
import argValue from "../prompts/claude/tools/create/arg_value.txt";

const inputSchema = z.object({
  path: z.string().min(2).describe("Container to create a child in. See description for the grammar."),
  value: z.unknown().optional().describe("The new entity's fields (object), or a string for a greeting."),
  character_id: z.string().optional(),
}).strict();

// Models often send the object JSON-encoded as a string.
function asObject(v: unknown): Record<string, unknown> {
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try { v = JSON.parse(v); } catch { return {}; }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export const createTool = defineTool({
  name: "create",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: argPath },
      value: { description: argValue },
      character_id: { type: "string", description: "Target character for char/ paths. Same as writing char/<id>/<sub-path>." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Path-targeted. Only char paths need a character, the rest work in a no-character session.
  requiresCharacter: false,
  execute: async (input, ctx: ToolCtx) => {
    const split = splitCharacterPath(input.path.trim(), input.character_id);
    const path = split.path;
    const parts = path.split("/").filter((p) => p.length > 0);
    const v = asObject(input.value);

    if (path === "char" || path === "character" || path === "characters") {
      if (!hasCopySource(v)) return { content: 'Error: [INVALID_INPUT] create({path:"char"}) only duplicates: pass value { copy_of: "<character id or name>", name }. A new card from scratch is create_character.', isError: true };
      try { return await duplicateCharacter(ctx, v); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }
    let charId = "";
    if (parts[0] === "char") {
      try { charId = resolveCharacterTarget(ctx, split.target); }
      catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    }

    if (path === "wb" || path === "world_book" || path === "world_books") {
      try { return await createWorldBook(ctx, input.value); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    if ((parts[0] === "wb" || parts[0] === "world_book") && (parts[2] === "entry" || parts[2] === "entries") && parts.length === 3) {
      try { return await createWorldBookEntries(ctx, parts[1]!, input.value); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    if (path === "rx" || path === "regex_script") {
      try { return await createRegexScripts(ctx, v); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    if (path === "persona" || path === "personas") {
      try { return await createPersona(ctx, v); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    if (parts[0] === "persona" && (parts[2] === "addon" || parts[2] === "addons") && parts.length === 3) {
      const bare = typeof input.value === "string" && !input.value.trim().startsWith("{") ? input.value : undefined;
      try { return await createPersonaAddon(ctx, parts[1]!, v, bare); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    if (path === "preset" || path === "presets") {
      try { return await createPreset(ctx, v); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    // preset/<presetId>/block -> prompt block
    if (parts[0] === "preset" && (parts[2] === "block" || parts[2] === "blocks") && parts.length === 3) {
      try { return await createPresetBlocks(ctx, parts[1]!, v); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    }

    // char/alternate_fields/<field> -> add a variant for description / personality / scenario
    if (parts[0] === "char" && parts[1] === "alternate_fields" && parts.length === 3) {
      const field = parts[2]!;
      if (!isAlternateFieldName(field)) {
        return { content: `Error: [INVALID_INPUT] alternate_fields field must be one of ${ALTERNATE_FIELD_NAMES.join(", ")}, got '${field}'`, isError: true };
      }
      const label = typeof v.label === "string" ? v.label : "";
      const content = typeof input.value === "string"
        ? input.value
        : typeof v.content === "string" ? v.content : undefined;
      if (content === undefined) return { content: "Error: [INVALID_INPUT] variant requires value.content (or pass a string for content; value.label optional)", isError: true };
      // Minted before the read so this host round-trip stays outside the read-modify-write window.
      const variantId = await ctx.spindle.uuid.v4();
      const c = await ctx.spindle.characters.get(charId, ctx.userId);
      if (!c) return { content: `Error: [PATH_NOT_FOUND] character ${charId} not found`, isError: true };
      const before = readAltFieldArray(c.extensions, field);
      const newVariant: AltFieldVariant = { id: variantId, label, content };
      const requested = typeof v.index === "number" ? v.index : undefined;
      const at = requested === undefined ? before.length : Math.max(0, Math.min(before.length, Math.floor(requested)));
      const after = [...before];
      after.splice(at, 0, newVariant);
      const nextExt = writeAltFieldArray(c.extensions, field, after);
      await ctx.spindle.characters.update(charId, { extensions: nextExt }, ctx.userId);
      ctx.pushEdit({
        op: "create", surface: "alternate_field_variant", surfaceId: newVariant.id,
        surfaceLabel: `${field} variant '${label || "(unlabeled)"}'`,
        snapshot: { altField: field, variant: { id: newVariant.id, label, content }, index: at },
        scope: characterScope(charId),
      } satisfies EditRecord);
      return { content: JSON.stringify({ character: { id: charId, name: c.name }, field, variant_id: newVariant.id, index: at, total: after.length, content_chars: content.length }) };
    }

    // char/alternate_greetings -> append/insert one greeting or several
    if (path === "char/alternate_greetings") {
      const many = Array.isArray(input.value) ? input.value
        : Array.isArray(v.greetings) ? v.greetings
        : Array.isArray(v.content) ? v.content : null;
      const single = typeof input.value === "string"
        ? input.value
        : typeof v.content === "string" ? v.content : undefined;
      const texts = many ?? (single !== undefined ? [single] : []);
      if (texts.length === 0 || texts.some((t) => typeof t !== "string" || t.length === 0)) {
        return { content: "Error: [INVALID_INPUT] greeting requires a string value, an array of strings, or value.content", isError: true };
      }
      const c = await ctx.spindle.characters.get(charId, ctx.userId);
      if (!c) return { content: `Error: [PATH_NOT_FOUND] character ${charId} not found`, isError: true };
      const arr = [...(c.alternate_greetings ?? [])];
      const requested = typeof v.index === "number" ? v.index : undefined;
      const at = requested === undefined ? arr.length : Math.max(0, Math.min(arr.length, Math.floor(requested)));
      arr.splice(at, 0, ...(texts as string[]));
      await ctx.spindle.characters.update(charId, { alternate_greetings: arr }, ctx.userId);
      for (let i = 0; i < texts.length; i++) {
        ctx.pushEdit({
          op: "create", surface: "alternate_greeting", surfaceId: String(at + i),
          surfaceLabel: `alternate_greetings[${at + i}]`, snapshot: { greeting: texts[i] as string },
          scope: characterScope(charId),
        } satisfies EditRecord);
      }
      return { content: JSON.stringify({
        character: { id: charId, name: c.name },
        added: texts.length, index: at, total: arr.length,
        chars: (texts as string[]).map((t) => t.length),
      }) };
    }

    return { content: `Error: [PATH_NOT_FOUND] cannot create at '${path}'. Valid containers: wb, wb/<bookId>/entry, rx, persona, persona/<id>/addon, preset, preset/<presetId>/block, char (duplicate with copy_of), char/alternate_greetings, char/<id>/alternate_greetings, char/alternate_fields/<field>`, isError: true };
  },
});
