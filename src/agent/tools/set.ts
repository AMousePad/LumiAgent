import { z } from "zod";
import type { CharacterUpdateDTO, RegexScriptUpdateDTO, WorldBookEntryUpdateDTO, WorldBookUpdateDTO, UserPresetUpdateDTO, PersonaUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { EditRecord } from "../../types";
import { isCharacterStringField, wbLabel } from "./_surfaces";
import { parseExtensionPath, setAtPath } from "./_paths";
import { ExtensionRefusedError, assertExtensionWriteAllowed, scopeForLeafKey, isAlternateFieldName, readAltFieldArray, writeAltFieldArray, ALTERNATE_FIELD_NAMES } from "./_path_v2";
import { encodeScalar } from "../../state/edit-log";

const inputSchema = z.object({
  path: z.string().min(3).describe("Slash-separated path. Same grammar as `read` / `edit`."),
  value: z.unknown().describe("The new value. Any JSON-encodable type (string, number, boolean, array, object, null). Wholesale replacement at the path."),
}).strict();

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v ?? null);
}

async function setCharacterField(ctx: ToolCtx, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  if (!isCharacterStringField(field)) return `[PATH_NOT_FOUND] unknown character field '${field}'`;
  if (typeof value !== "string") return `[INVALID_VALUE_TYPE] char/${field} expects a string value, got ${typeof value}`;
  const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
  if (!c) return "character not found";
  const before = (c as unknown as Record<string, unknown>)[field];
  const beforeStr = typeof before === "string" ? before : "";
  await ctx.spindle.characters.update(ctx.characterId, { [field]: value } as CharacterUpdateDTO, ctx.userId);
  return { before: beforeStr, after: value, label: c.name, surface: "character_field", surfaceId: ctx.characterId, field };
}

async function setAlternateGreeting(ctx: ToolCtx, idx: number, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  if (typeof value !== "string") return `[INVALID_VALUE_TYPE] alternate_greetings is a string array; non-string values not allowed`;
  const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
  if (!c) return "character not found";
  const arr = [...(c.alternate_greetings ?? [])];
  if (idx < 0 || idx >= arr.length) return `[OUT_OF_RANGE] alternate_greetings[${idx}] is past the end (length ${arr.length}). \`list({path: "char/alternate_greetings"})\` shows valid indices.`;
  const before = arr[idx] ?? "";
  arr[idx] = value;
  await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
  return { before, after: value, label: `Greeting #${idx}`, surface: "alternate_greeting", surfaceId: ctx.characterId, field: String(idx) };
}

async function setAlternateFieldLeaf(ctx: ToolCtx, field: string, variantId: string, leaf: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding: "json" } | string> {
  if (!isAlternateFieldName(field)) return `[PATH_NOT_FOUND] alternate_fields field must be one of ${ALTERNATE_FIELD_NAMES.join(", ")}, got '${field}'`;
  if (leaf !== "content" && leaf !== "label") return `[PATH_NOT_FOUND] alternate_fields leaf must be content or label, got '${leaf}'`;
  if (typeof value !== "string") return `[INVALID_VALUE_TYPE] alternate_fields.${leaf} expects a string, got ${typeof value}`;
  const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
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
  await ctx.spindle.characters.update(ctx.characterId, { extensions: nextExt }, ctx.userId);
  return {
    before: JSON.stringify(before),
    after: JSON.stringify(value),
    label: `${field} variant '${updated.label || `(unlabeled #${idx})`}' (${leaf})`,
    surface: "extension",
    surfaceId: ctx.characterId,
    field: `alternate_fields.${field}[${idx}].${leaf}`,
    valueEncoding: "json",
  };
}

async function setExtension(ctx: ToolCtx, dotted: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding: "json" } | string> {
  await assertExtensionWriteAllowed(ctx, dotted);
  const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
  if (!c) return "character not found";
  const segs = parseExtensionPath(dotted);
  // Get the previous value to record in the ledger.
  let cur: unknown = c.extensions ?? {};
  for (const seg of segs) {
    if (cur === null || cur === undefined) { cur = undefined; break; }
    if (seg.kind === "key") cur = (cur as Record<string, unknown>)[seg.value];
    else cur = Array.isArray(cur) ? cur[seg.value] : undefined;
  }
  const next = setAtPath(c.extensions ?? {}, segs, value) as Record<string, unknown>;
  await ctx.spindle.characters.update(ctx.characterId, { extensions: next }, ctx.userId);
  return {
    before: JSON.stringify(cur === undefined ? null : cur),
    after: JSON.stringify(value === undefined ? null : value),
    label: `extensions.${dotted}`,
    surface: "extension",
    surfaceId: ctx.characterId,
    field: dotted,
    valueEncoding: "json",
  };
}

async function setRegexScriptField(ctx: ToolCtx, scriptId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  const r = await ctx.spindle.regex_scripts.get(scriptId, ctx.userId);
  if (!r) return `regex script ${scriptId} not found`;
  const before = (r as unknown as Record<string, unknown>)[field];
  await ctx.spindle.regex_scripts.update(scriptId, { [field]: value } as RegexScriptUpdateDTO, ctx.userId);
  return { before: stringify(before), after: stringify(value), label: r.name, surface: "regex_script", surfaceId: scriptId, field };
}

async function setWorldBookField(ctx: ToolCtx, id: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  // wb/<id>/<field> is overloaded: id may be a book (name/description/metadata)
  // or an entry. Resolve by lookup so one path grammar covers both.
  const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
  if (book) {
    const before = (book as unknown as Record<string, unknown>)[field];
    await ctx.spindle.world_books.update(id, { [field]: value } as WorldBookUpdateDTO, ctx.userId);
    return { before: stringify(before), after: stringify(value), label: book.name, surface: "world_book", surfaceId: id, field };
  }
  const e = await ctx.spindle.world_books.entries.get(id, ctx.userId);
  if (!e) return `no world book or entry with id ${id}`;
  const before = (e as unknown as Record<string, unknown>)[field];
  await ctx.spindle.world_books.entries.update(id, { [field]: value } as WorldBookEntryUpdateDTO, ctx.userId);
  return { before: stringify(before), after: stringify(value), label: wbLabel(e), surface: "world_book_entry", surfaceId: id, field };
}

async function setPresetField(ctx: ToolCtx, presetId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  const p = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!p) return `preset ${presetId} not found`;
  const before = (p as unknown as Record<string, unknown>)[field];
  await ctx.spindle.presets.update(presetId, { [field]: value } as UserPresetUpdateDTO, ctx.userId);
  return { before: stringify(before), after: stringify(value), label: p.name, surface: "preset", surfaceId: presetId, field };
}

async function setPersonaAttachedWorldBook(ctx: ToolCtx, personaId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  if (field !== "attached_world_book_id") {
    return `[PATH_NOT_FOUND] persona/${personaId}/${field} is not settable via \`set\`. Only attached_world_book_id. For name / title / description use \`edit\` or \`rewrite\` on persona/${personaId}/<field>.`;
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
  description: `Wholesale write of any JSON value at a path. Use for structural changes the read/edit/rewrite trio can't make:

- Toggling a boolean (regex.disabled, world_book_entry.constant)
- Changing a number (priority, position, sort_order, depth)
- Replacing an array / object value (e.g. extensions.lumirealm.payload.scriptstate_defaults)
- Setting a typed value at an extension path that isn't a string
- Attaching / changing a persona's world book: \`set({path:"persona/<personaId>/attached_world_book_id", value:"<worldBookId>"})\`; \`value:null\` detaches

Path grammar matches \`read\` / \`edit\` / \`rewrite\`. The value field accepts any JSON-encodable type. For string-leaf paths, set is a wholesale alternative to \`rewrite\` (no read-gate, so use only when you don't need to anchor against current content).

Records before/after in the ledger like every other edit — fully revertable.

For multi-field atomic character updates use \`update_character({patch})\`.

Returns:
- \`path\` — path written.
- \`before_chars\`, \`after_chars\` — string length before vs after (non-string values are JSON-stringified for measurement).
- \`before_peek\`, \`after_peek\` — first 120 chars of each side, for verification.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Surface path. See description for grammar." },
      value: { description: "Any JSON-encodable value." },
    },
    required: ["path", "value"],
    additionalProperties: false,
  },
  // Path-targeted; char/ paths fail loudly without a character, wb/rx work.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const path = input.path.trim();
    const value = input.value;

    let result: { before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string; valueEncoding?: "json" } | string;

    if (path.startsWith("char/extensions/") || path.startsWith("character/extensions/")) {
      const dotted = path.replace(/^(char|character)\/extensions\//, "");
      if (dotted.length === 0) return { content: "Error: extensions path requires a sub-path", isError: true };
      try { result = await setExtension(ctx, dotted, value); }
      catch (err) {
        if (err instanceof ExtensionRefusedError) return { content: `Error: [REFUSED_BY_EXTENSION] ${err.message}`, isError: true };
        throw err;
      }
    } else if (path.startsWith("char/alternate_fields/") || path.startsWith("character/alternate_fields/")) {
      const rest = path.replace(/^(char|character)\/alternate_fields\//, "");
      const segs = rest.split("/");
      if (segs.length !== 3) return { content: "Error: expected char/alternate_fields/<field>/<variantId>/<content|label>", isError: true };
      result = await setAlternateFieldLeaf(ctx, segs[0]!, segs[1]!, segs[2]!, value);
    } else if (path.startsWith("char/alternate_greetings/") || path.startsWith("character/alternate_greetings/")) {
      const rest = path.replace(/^(char|character)\/alternate_greetings\//, "");
      const idx = parseInt(rest, 10);
      if (!Number.isFinite(idx)) return { content: `Error: alternate_greetings index '${rest}' is not a number`, isError: true };
      result = await setAlternateGreeting(ctx, idx, value);
    } else if (path.startsWith("char/") || path.startsWith("character/")) {
      const field = path.replace(/^(char|character)\//, "");
      if (field.includes("/")) return { content: `Error: '${path}' has unexpected segments; for extension paths use char/extensions/...`, isError: true };
      result = await setCharacterField(ctx, field, value);
    } else if (path.startsWith("rx/") || path.startsWith("regex_script/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected rx/<scriptId>/<field>", isError: true };
      result = await setRegexScriptField(ctx, parts[0]!, parts[1]!, value);
    } else if (path.startsWith("wb/") || path.startsWith("world_book_entry/") || path.startsWith("world_book/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected wb/<id>/<field> (id = book or entry)", isError: true };
      result = await setWorldBookField(ctx, parts[0]!, parts[1]!, value);
    } else if (path.startsWith("preset/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected preset/<presetId>/<field>. For block content/name use edit/rewrite on preset/<id>/block/<bid>/<field>.", isError: true };
      result = await setPresetField(ctx, parts[0]!, parts[1]!, value);
    } else if (path.startsWith("persona/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected persona/<personaId>/attached_world_book_id. Persona world-book entries and name/title/description use edit/rewrite, not set.", isError: true };
      result = await setPersonaAttachedWorldBook(ctx, parts[0]!, parts[1]!, value);
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
      scope: scopeForLeafKey(path, ctx),
      ...(result.valueEncoding !== undefined ? { valueEncoding: result.valueEncoding } : {}),
    } satisfies EditRecord);

    return {
      content: JSON.stringify({
        path,
        before_chars: result.before.length,
        after_chars: result.after.length,
        before_peek: result.before.slice(0, 120),
        after_peek: result.after.slice(0, 120),
      }, null, 2),
    };
  },
});
