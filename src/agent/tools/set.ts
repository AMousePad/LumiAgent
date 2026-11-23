import { z } from "zod";
import type { CharacterUpdateDTO, RegexScriptUpdateDTO, PersonaUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { type ToolCtx, resolveCharacterTarget, noTargetResult } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { characterScope } from "../../types";
import { CHARACTER_FIELD_ALIASES, setPersonaAddonField } from "./_character";
import { CHARACTER_STRING_FIELDS, isCharacterStringField, normaliseCharacterTags } from "./_surfaces";
import { parseExtensionPath, setAtPath } from "./_paths";
import { applyCharacterId, resolveRead, PathError, NonStringLeafError, ExtensionRefusedError, assertExtensionWriteAllowed, scopeForLeafKey, isCharSubtreeToken, isAlternateFieldName, readAltFieldArray, writeAltFieldArray, ALTERNATE_FIELD_NAMES } from "./_path_v2";
import { encodeScalar } from "../../state/edit-log";
import { movePresetBlock, setPresetField, setPresetVars } from "./_preset";
import { setWorldBookField } from "./_worldbook";
import description from "../prompts/claude/tools/set/description.txt";
import argPath from "../prompts/claude/tools/set/arg_path.txt";
import argValue from "../prompts/claude/tools/set/arg_value.txt";

const inputSchema = z.object({
  path: z.string().min(3).describe("Slash-separated path. Same grammar as `read` / `edit`."),
  value: z.unknown().optional().describe("The new value. Any JSON-encodable type (string, number, boolean, array, object, null). Wholesale replacement at the path."),
  copy_from: z.string().optional(),
  character_id: z.string().optional(),
}).strict().transform((d) => ({ ...d, path: applyCharacterId(d.path, d.character_id) }));

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v ?? null);
}

async function setCharacterField(ctx: ToolCtx, characterId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding?: "json" } | string> {
  field = CHARACTER_FIELD_ALIASES[field] ?? field;
  if (field === "alternate_greetings") {
    const c = await ctx.spindle.characters.get(characterId, ctx.userId);
    if (!c) return "character not found";
    const current = [...(c.alternate_greetings ?? [])];
    let next: string[];
    const move = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    if (move && typeof move.from === "number" && typeof move.to === "number") {
      if (move.from < 0 || move.from >= current.length) return `[OUT_OF_RANGE] from ${move.from} (length ${current.length}).`;
      next = [...current];
      const [g] = next.splice(move.from, 1);
      next.splice(Math.max(0, Math.min(next.length, Math.floor(move.to))), 0, g!);
    } else if (Array.isArray(value) && value.every((g) => typeof g === "string")) {
      next = value as string[];
      const lost = current.filter((g) => !next.includes(g)).length;
      if (lost > 0 && next.length < current.length) {
        return `[WOULD_DROP_GREETINGS] the new list has ${next.length} greetings and drops ${lost} of the ${current.length} stored ones. Nothing was written. Reorder with value {from, to}, remove with delete({path:"char/alternate_greetings/<idx>"}), add with create.`;
      }
    } else {
      return "[INVALID_VALUE_TYPE] char/alternate_greetings takes {from, to} to move one greeting, or the full string array to reorder. One greeting's text is char/alternate_greetings/<idx>.";
    }
    await ctx.spindle.characters.update(characterId, { alternate_greetings: next }, ctx.userId);
    return { before: JSON.stringify(current), after: JSON.stringify(next), label: c.name, surface: "character_field", surfaceId: characterId, field, valueEncoding: "json" };
  }
  if (field === "tags") {
    const c = await ctx.spindle.characters.get(characterId, ctx.userId);
    if (!c) return "character not found";
    // {add, remove} edits the stored list, so adding one tag cannot wipe the others.
    const delta = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const asList = (x: unknown): unknown => (typeof x === "string" ? x.split(",") : x);
    // A bare string is ambiguous between adding one tag and replacing them all, and guessing replace loses tags.
    if (typeof value === "string") return `[INVALID_VALUE_TYPE] char/tags takes {add: [...]} to add, {remove: [...]} to remove, or a full array to replace the list. Current tags: ${JSON.stringify(c.tags ?? [])}. Nothing was written.`;
    let tags: string[] | null;
    if (delta && (delta.add !== undefined || delta.remove !== undefined)) {
      const add = normaliseCharacterTags(asList(delta.add ?? []));
      const remove = normaliseCharacterTags(asList(delta.remove ?? []));
      if (add === null || remove === null) return "[INVALID_VALUE_TYPE] char/tags {add, remove} take string arrays";
      const drop = new Set(remove.map((t) => t.toLowerCase()));
      tags = normaliseCharacterTags([...(c.tags ?? []).filter((t) => !drop.has(t.toLowerCase())), ...add]);
    } else {
      tags = normaliseCharacterTags(value);
    }
    if (tags === null) {
      return `[INVALID_VALUE_TYPE] char/tags expects a string array (replaces the list) or {add: [...], remove: [...]}`;
    }
    const before = JSON.stringify(c.tags ?? []);
    const after = JSON.stringify(tags);
    await ctx.spindle.characters.update(characterId, { tags }, ctx.userId);
    return {
      before,
      after,
      label: c.name,
      surface: "character_field",
      surfaceId: characterId,
      field,
      valueEncoding: "json",
    };
  }
  if (!isCharacterStringField(field)) {
    const hint = field === "folder" ? " A character's folder cannot be changed by an extension: the user moves it in the character manager." : "";
    return `[PATH_NOT_FOUND] unknown character field '${field}'. Valid: ${CHARACTER_STRING_FIELDS.join(", ")}, tags, alternate_greetings, alternate_greetings/<idx>, extensions/<dotted>.${hint}`;
  }
  if (typeof value !== "string") return `[INVALID_VALUE_TYPE] char/${field} expects a string value, got ${typeof value}`;
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) return "character not found";
  const before = (c as unknown as Record<string, unknown>)[field];
  const beforeStr = typeof before === "string" ? before : "";
  await ctx.spindle.characters.update(characterId, { [field]: value } as CharacterUpdateDTO, ctx.userId);
  return { before: beforeStr, after: value, label: c.name, surface: "character_field", surfaceId: characterId, field };
}

async function setAlternateGreeting(ctx: ToolCtx, characterId: string, idx: number, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  if (typeof value !== "string") return `[INVALID_VALUE_TYPE] alternate_greetings is a string array; non-string values not allowed`;
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) return "character not found";
  const arr = [...(c.alternate_greetings ?? [])];
  if (idx < 0 || idx >= arr.length) return `[OUT_OF_RANGE] alternate_greetings[${idx}] is past the end (length ${arr.length}). \`list({path: "char/alternate_greetings"})\` shows valid indices.`;
  const before = arr[idx] ?? "";
  arr[idx] = value;
  await ctx.spindle.characters.update(characterId, { alternate_greetings: arr }, ctx.userId);
  return { before, after: value, label: `Greeting #${idx}`, surface: "alternate_greeting", surfaceId: characterId, field: String(idx) };
}

async function setAlternateFieldLeaf(ctx: ToolCtx, characterId: string, field: string, variantId: string, leaf: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding: "json" } | string> {
  if (!isAlternateFieldName(field)) return `[PATH_NOT_FOUND] alternate_fields field must be one of ${ALTERNATE_FIELD_NAMES.join(", ")}, got '${field}'`;
  if (leaf !== "content" && leaf !== "label") return `[PATH_NOT_FOUND] alternate_fields leaf must be content or label, got '${leaf}'`;
  if (typeof value !== "string") return `[INVALID_VALUE_TYPE] alternate_fields.${leaf} expects a string, got ${typeof value}`;
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) return "character not found";
  const variants = readAltFieldArray(c.extensions, field);
  const idx = variants.findIndex((v) => v.id === variantId);
  if (idx < 0) return `[PATH_NOT_FOUND] variant '${variantId}' not found under alternate_fields.${field}`;
  const current = variants[idx]!;
  const before = current[leaf];
  // JSON-encode + tag matches setExtension and resolveWrite's extension branch.
  // Mixing tools on the same path would otherwise force a patch-stack rebase
  // (encoding mismatch) and lose history. Idempotent writes are absorbed by
  // recordEdit's input.live === input.next guard, so no early return needed.
  const updated = { ...current, [leaf]: value };
  const next = [...variants];
  next[idx] = updated;
  const nextExt = writeAltFieldArray(c.extensions, field, next);
  await ctx.spindle.characters.update(characterId, { extensions: nextExt }, ctx.userId);
  return {
    before: JSON.stringify(before),
    after: JSON.stringify(value),
    label: `${field} variant '${updated.label || `(unlabeled #${idx})`}' (${leaf})`,
    surface: "extension",
    surfaceId: characterId,
    field: `alternate_fields.${field}[${idx}].${leaf}`,
    valueEncoding: "json",
  };
}

async function setExtension(ctx: ToolCtx, characterId: string, dotted: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding: "json" } | string> {
  await assertExtensionWriteAllowed(ctx, characterId, dotted);
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) return "character not found";
  const segs = parseExtensionPath(dotted);
  // The extensions root is always an object. A leading [index] would make
  // setAtPath rebuild it as an array, wiping every key (including provider-owned
  // subtrees the check_write gate protects), and firstSegment can't resolve an
  // index to a provider so the gate falls open. Reject before writing.
  if (segs.length === 0 || segs[0]!.kind !== "key") {
    return `[PATH_NOT_FOUND] extensions path must start with a named key, got '${dotted}'.`;
  }
  // Get the previous value to record in the ledger.
  let cur: unknown = c.extensions ?? {};
  for (const seg of segs) {
    if (cur === null || cur === undefined) { cur = undefined; break; }
    if (seg.kind === "key") cur = (cur as Record<string, unknown>)[seg.value];
    else cur = Array.isArray(cur) ? cur[seg.value] : undefined;
  }
  const next = setAtPath(c.extensions ?? {}, segs, value) as Record<string, unknown>;
  await ctx.spindle.characters.update(characterId, { extensions: next }, ctx.userId);
  return {
    before: JSON.stringify(cur === undefined ? null : cur),
    after: JSON.stringify(value === undefined ? null : value),
    label: `extensions.${dotted}`,
    surface: "extension",
    surfaceId: characterId,
    field: dotted,
    valueEncoding: "json",
  };
}

const REGEX_READ_ONLY_FIELDS: ReadonlySet<string> = new Set(["id", "preset_id", "can_mutate", "folder_version", "created_at", "updated_at"]);

async function setRegexScriptField(ctx: ToolCtx, scriptId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding?: "json" } | string> {
  const r = await ctx.spindle.regex_scripts.get(scriptId, ctx.userId);
  if (!r) return `regex script ${scriptId} not found`;
  if (REGEX_READ_ONLY_FIELDS.has(field)) {
    return `[READ_ONLY] regex script field '${field}' cannot be changed after creation.${field === "preset_id" ? ' To bind a script to a preset, create it with create({path:"rx", value:{copy_of:"<scriptId>", preset_id:"<presetId>"}}) and delete the old one.' : ""}`;
  }
  if (!(field in r)) return `[PATH_NOT_FOUND] regex script has no field '${field}'. Fields: ${Object.keys(r).filter((k) => !REGEX_READ_ONLY_FIELDS.has(k)).join(", ")}`;
  const before = (r as unknown as Record<string, unknown>)[field];
  // A bare target string and its one-item array are the same value to the host.
  if (field === "target" && typeof value === "string") value = [value];
  const updated = await ctx.spindle.regex_scripts.update(scriptId, { [field]: value } as RegexScriptUpdateDTO, ctx.userId);
  const landed = (updated as unknown as Record<string, unknown>)[field];
  if (stringify(landed) !== stringify(value) && stringify(landed) === stringify(before)) {
    return `[NOT_APPLIED] the host kept regex script field '${field}' at ${stringify(before)}. Nothing changed.`;
  }
  // Tag json ONLY for non-string values. String fields (find_regex,
  // replace_string) are stored RAW to match the edit/rewrite route on the same
  // leaf; tagging them would mismatch that route's untagged record and trigger
  // a history-dropping encoding rebase. Non-string fields (disabled, sort_order)
  // are set-only and must be json-tagged to round-trip on revert.
  const isStr = typeof value === "string";
  return { before: stringify(before), after: stringify(value), label: r.name, surface: "regex_script", surfaceId: scriptId, field, ...(isStr ? {} : { valueEncoding: "json" as const }) };
}

// Text fields go through edit/rewrite so the read gate and freshness hash apply.
const PRESET_BLOCK_TEXT_FIELDS = new Set(["content", "name"]);

async function setPresetBlockField(ctx: ToolCtx, presetId: string, blockId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding?: "json"; report?: Record<string, unknown> } | string> {
  if (PRESET_BLOCK_TEXT_FIELDS.has(field)) return `[USE_EDIT] preset block ${field} is text. Use edit or rewrite on preset/${presetId}/block/${blockId}/${field}.`;
  if (field === "index" || field === "after" || field === "before") return movePresetBlock(ctx, presetId, blockId, field, value);
  const b = await ctx.spindle.presets.blocks.get(presetId, blockId, ctx.userId);
  if (!b) return `preset block ${blockId} not found in preset ${presetId}`;
  const record = b as unknown as Record<string, unknown>;
  if (!(field in record)) return `[PATH_NOT_FOUND] preset block has no field '${field}'. Settable: ${Object.keys(record).filter((k) => k !== "id" && !PRESET_BLOCK_TEXT_FIELDS.has(k)).join(", ")}`;
  const before = record[field];
  if (typeof before === "boolean" && typeof value === "string" && (value === "true" || value === "false")) value = value === "true";
  if (typeof before === "boolean" && typeof value !== "boolean") return `[INVALID_VALUE_TYPE] block.${field} is a boolean. Pass true or false.`;
  await ctx.spindle.presets.blocks.update(presetId, blockId, { [field]: value }, ctx.userId);
  return { before: JSON.stringify(before ?? null), after: JSON.stringify(value ?? null), label: b.name || "block", surface: "preset_block", surfaceId: `${presetId}:${blockId}`, field, valueEncoding: "json" };
}

async function setPersonaAttachedWorldBook(ctx: ToolCtx, personaId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; report?: Record<string, unknown> } | string> {
  if (field === "default") field = "is_default";
  if (field === "is_default") {
    const want = value === true || value === "true" ? true : value === false || value === "false" ? false : null;
    if (want === null) return "[INVALID_VALUE_TYPE] is_default expects true or false.";
    const p = await ctx.spindle.personas.get(personaId, ctx.userId);
    if (!p) return `[PATH_NOT_FOUND] persona ${personaId} not found. Find its id with personas({action:"list", query}).`;
    if (p.is_default === want) return `[NO_CHANGE] ${p.name} is already ${want ? "the default persona" : "not the default persona"}. Nothing was written.`;
    const previous = want ? await ctx.spindle.personas.getDefault(ctx.userId).catch(() => null) : null;
    const updated = await ctx.spindle.personas.update(personaId, { is_default: want } as PersonaUpdateDTO, ctx.userId);
    if (updated.is_default !== want) return `[NOT_APPLIED] the host kept is_default=${updated.is_default} for ${p.name}.`;
    return {
      before: JSON.stringify(p.is_default), after: JSON.stringify(want), label: p.name, surface: "persona", surfaceId: personaId, field,
      report: {
        path: `persona/${personaId}/is_default`, persona: p.name, is_default: want,
        ...(previous && previous.id !== personaId ? { replaced_default: { id: previous.id, name: previous.name } } : {}),
        note: want
          ? 'The default persona is used when none is active. The active persona is unchanged: switch it with personas({action:"switch"}).'
          : "No persona is the default now.",
      },
    };
  }
  if (field === "folder") {
    if (typeof value !== "string") return '[INVALID_VALUE_TYPE] folder expects a string. Pass "" for no folder.';
    const p = await ctx.spindle.personas.get(personaId, ctx.userId);
    if (!p) return `[PATH_NOT_FOUND] persona ${personaId} not found. Find its id with personas({action:"list", query}).`;
    const updated = await ctx.spindle.personas.update(personaId, { folder: value } as PersonaUpdateDTO, ctx.userId);
    return {
      before: JSON.stringify(p.folder ?? ""), after: JSON.stringify(updated.folder ?? ""), label: p.name, surface: "persona", surfaceId: personaId, field,
      report: { path: `persona/${personaId}/folder`, persona: p.name, before: p.folder ?? "", after: updated.folder ?? "" },
    };
  }
  if (field !== "attached_world_book_id") {
    return `[PATH_NOT_FOUND] persona/${personaId}/${field} is not settable. Settable with set: is_default, folder, attached_world_book_id. For name / title / description use edit or rewrite on persona/${personaId}/<field>. The portrait and pronouns can only be changed by the user in the persona editor.`;
  }
  const p = await ctx.spindle.personas.get(personaId, ctx.userId);
  if (!p) return `persona ${personaId} not found`;
  let nextId: string | null;
  if (value === null || value === undefined || value === "") {
    nextId = null;
  } else if (typeof value === "string") {
    const wb = await ctx.spindle.world_books.get(value, ctx.userId).catch(() => null);
    if (!wb) return `[PATH_NOT_FOUND] world book '${value}' not found. Pass an existing world_book id to attach, or null to detach.`;
    nextId = value;
  } else {
    return `[INVALID_VALUE_TYPE] attached_world_book_id expects a world_book id string or null, got ${typeof value}`;
  }
  // "" detaches host-side (PersonaUpdateDTO is string | undefined, host does `|| null`).
  await ctx.spindle.personas.update(personaId, { attached_world_book_id: nextId ?? "" } as PersonaUpdateDTO, ctx.userId);
  return {
    before: encodeScalar(field, p.attached_world_book_id ?? null),
    after: encodeScalar(field, nextId),
    label: p.name,
    surface: "persona",
    surfaceId: personaId,
    field,
  };
}

export const setTool = defineTool({
  name: "set",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: argPath },
      character_id: { type: "string", description: "Target character for char/ paths. Same as writing char/<id>/<field>." },
      value: { description: argValue },
      copy_from: { type: "string", description: "A readable path whose current content is written here byte-for-byte, e.g. char/<otherId>/scenario. When given, value is ignored (send \"\"). Use it to copy text between cards without re-typing it." },
    },
    // value stays required so dispatch keeps a real null or [] instead of dropping it as a placeholder.
    required: ["path", "value"],
    additionalProperties: false,
  },
  // Path-targeted; char/ paths fail loudly without a character, wb/rx work.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let path = input.path.trim();
    let value = input.value;
    let copiedFrom: string | null = null;
    if (typeof input.copy_from === "string" && input.copy_from.trim().length > 0) {
      try {
        const leaf = await resolveRead(ctx, input.copy_from.trim());
        value = leaf.value;
        copiedFrom = leaf.key;
      } catch (err) {
        if (err instanceof NonStringLeafError) { value = err.value; copiedFrom = err.key; }
        else if (err instanceof PathError) return { content: `Error: [PATH_NOT_FOUND] copy_from: ${err.message}. Nothing was written.`, isError: true };
        else throw err;
      }
    } else if (value === undefined) {
      return { content: "Error: [INVALID_INPUT] set needs value, or copy_from naming a path to copy.", isError: true };
    }
    const requestedPath = path;

    // char/<id>/... explicit addressing (mirrors read/edit/rewrite). When the
    // segment after char/ is a character id (not a known subtree token), strip
    // it and bind charTarget to it; else fall back to the session focus.
    let charTarget: string | null = ctx.characterId;
    const explicitChar = /^(?:char|character)\/([^/]+)\/(.+)$/.exec(path);
    if (explicitChar && !isCharSubtreeToken(explicitChar[1]!)) {
      charTarget = explicitChar[1]!;
      path = `char/${explicitChar[2]!}`;
    }
    const isCharPath = path.startsWith("char/") || path.startsWith("character/");
    let charId = "";
    if (isCharPath) {
      try { charId = resolveCharacterTarget(ctx, charTarget); }
      catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    }

    let result: { before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding?: "json"; scopeOverride?: ScopeRef } | string;
    let presetReport: Record<string, unknown> | null = null;

    if (path.startsWith("char/extensions/") || path.startsWith("character/extensions/")) {
      const dotted = path.replace(/^(char|character)\/extensions\//, "");
      if (dotted.length === 0) return { content: "Error: extensions path requires a sub-path", isError: true };
      try { result = await setExtension(ctx, charId, dotted, value); }
      catch (err) {
        if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
        throw err;
      }
    } else if (path.startsWith("char/alternate_fields/") || path.startsWith("character/alternate_fields/")) {
      const rest = path.replace(/^(char|character)\/alternate_fields\//, "");
      const segs = rest.split("/");
      if (segs.length !== 3) return { content: "Error: expected char/alternate_fields/<field>/<variantId>/<content|label>", isError: true };
      result = await setAlternateFieldLeaf(ctx, charId, segs[0]!, segs[1]!, segs[2]!, value);
    } else if (path.startsWith("char/alternate_greetings/") || path.startsWith("character/alternate_greetings/")) {
      const rest = path.replace(/^(char|character)\/alternate_greetings\//, "");
      const idx = parseInt(rest, 10);
      if (!Number.isFinite(idx)) return { content: `Error: alternate_greetings index '${rest}' is not a number`, isError: true };
      result = await setAlternateGreeting(ctx, charId, idx, value);
    } else if (path.startsWith("char/") || path.startsWith("character/")) {
      const field = path.replace(/^(char|character)\//, "");
      if (field.includes("/")) return { content: `Error: '${path}' has unexpected segments; for extension paths use char/extensions/...`, isError: true };
      result = await setCharacterField(ctx, charId, field, value);
    } else if (path.startsWith("rx/") || path.startsWith("regex_script/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected rx/<scriptId>/<field>", isError: true };
      result = await setRegexScriptField(ctx, parts[0]!, parts[1]!, value);
    } else if (path.startsWith("wb/") || path.startsWith("world_book_entry/") || path.startsWith("world_book/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected wb/<id>/<field> (id = book or entry)", isError: true };
      const written = await setWorldBookField(ctx, parts[0]!, parts[1]!, value);
      if (typeof written !== "string" && written.report) presetReport = written.report;
      result = written;
    } else if (/^preset\/[^/]+\/block\/[^/]+\/[^/]+$/.test(path)) {
      const [, presetId, , blockId, field] = path.split("/");
      const written = await setPresetBlockField(ctx, presetId!, blockId!, field!, value);
      if (typeof written !== "string" && "report" in written && written.report) presetReport = written.report;
      result = written;
    } else if (/^presets?\/[^/]+\/(?:var|vars|variables)(?:\/|$)/.test(path)) {
      const [, presetId, , ...rest] = path.split("/");
      try { return await setPresetVars(ctx, presetId!, rest.length > 0 ? rest : null, value); }
      catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
    } else if (path.startsWith("preset/")) {
      const parts = path.split("/").slice(1);
      if (parts.length < 2) return { content: "Error: expected preset/<presetId>/<field>. Fields: name, provider, engine, parameters/<dotted.path>, prompts/<dotted.path>, metadata/<dotted.path>, var/<name>, block/<blockId>/<enabled|role|...>. For block content/name text use edit/rewrite.", isError: true };
      const written = await setPresetField(ctx, parts[0]!, parts.slice(1).join("."), value);
      if (typeof written !== "string" && written.report) presetReport = written.report;
      result = written;
    } else if (path.startsWith("persona/")) {
      const parts = path.split("/").slice(1);
      const addonSetting = parts.length === 4 && parts[1] === "addon" && parts[3] !== "content" && parts[3] !== "label";
      if (!addonSetting && parts.length !== 2) return { content: "Error: expected persona/<personaId>/<is_default|folder|attached_world_book_id> or persona/<personaId>/addon/<addonId>/<enabled|sort_order|outlet_name>. Persona world-book entries, add-on text (persona/<id>/addon/<addonId>/<content|label>), and name/title/description use edit/rewrite, not set.", isError: true };
      const written = addonSetting
        ? await setPersonaAddonField(ctx, parts[0]!, parts[2]!, parts[3]!, value)
        : await setPersonaAttachedWorldBook(ctx, parts[0]!, parts[1]!, value);
      if (typeof written !== "string" && written.report) presetReport = written.report;
      result = written;
    } else {
      return { content: `Error: unknown set path '${path}'. See \`read\` tool for grammar.`, isError: true };
    }

    if (typeof result === "string") return { content: `Error: ${result}`, isError: true };

    ctx.pushEdit({
      op: "edit",
      surface: result.surface as Exclude<EditRecord["surface"], "external">,
      surfaceId: result.surfaceId,
      surfaceLabel: result.label,
      field: result.field,
      before: result.before,
      after: result.after,
      // Char surfaces carry their owning character id in surfaceId, so derive
      // the scope from that (correct for char/<id>/ explicit addressing).
      // scopeForLeafKey on the friendly char/ path would mis-read the field
      // name as a character id.
      scope: result.scopeOverride
        ?? ((result.surface === "character_field" || result.surface === "alternate_greeting" || result.surface === "extension")
              ? characterScope(result.surfaceId)
              : scopeForLeafKey(path, ctx)),
      ...(result.valueEncoding !== undefined ? { valueEncoding: result.valueEncoding } : {}),
    } satisfies EditRecord);

    if (presetReport) return { content: JSON.stringify(presetReport, null, 2) };

    return {
      content: JSON.stringify({
        path: charId && charId !== ctx.characterId ? requestedPath : path,
        ...(copiedFrom ? { copied_from: copiedFrom } : {}),
        before_chars: result.before.length,
        after_chars: result.after.length,
        before_peek: result.before.slice(0, 120),
        after_peek: result.after.slice(0, 120),
      }, null, 2),
    };
  },
});
