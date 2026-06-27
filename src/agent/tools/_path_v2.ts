// Path-based addressing for every editable string surface on a card.
//
// Grammar (forward-slash separated; first segment names the surface):
//
//   char/<field>                       -> top-level character string field
//                                          (description, first_mes, scenario, …)
//   char/alternate_greetings/<idx>     -> one greeting by 0-based index
//   char/extensions/<dotted>           -> a string leaf under character.extensions.*
//                                          dotted-path uses '.' separators and
//                                          [<n>] for array index (legacy form),
//                                          e.g. lumirealm.payload.triggers[0].effect[0].value
//   rx/<scriptId>/<field>              -> regex_script field ("find_regex" or "replace_string")
//   wb/<entryId>/<field>               -> world_book_entry field ("content" or "comment")
//
// Returned content for read/edit is always the raw string at the leaf.
// Writes go through the right spindle update call. The path is the same key
// used by the recent-read gate and the audit tool — one string, one surface,
// across read / edit / grep / inspect.

import type { CharacterUpdateDTO, RegexScriptUpdateDTO, WorldBookEntryUpdateDTO, PersonaUpdateDTO, WorldBookDTO, GlobalAddonUpdateDTO } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { characterScope } from "../../types";
import { CHARACTER_STRING_FIELDS, isCharacterStringField, wbLabel } from "./_surfaces";
import { parseExtensionPath, getAtPath, setAtPath } from "./_paths";

// Top-level char-subtree token set. parts[1] is one of these for the focused
// form `char/<field>...`; anything else is treated as an explicit character id
// for the form `char/<id>/<field>...`. UUIDs and other id forms never collide
// with this fixed token set.
const CHAR_SUBTREE_TOKENS: ReadonlySet<string> = new Set<string>([
  ...CHARACTER_STRING_FIELDS,
  "alternate_greetings",
  "alternate_fields",
  "extensions",
]);

export function isCharSubtreeToken(s: string): boolean {
  return CHAR_SUBTREE_TOKENS.has(s);
}

const PERSONA_STRING_FIELDS = ["name", "title", "description"] as const;

export const ALTERNATE_FIELD_NAMES = ["description", "personality", "scenario"] as const;
export type AlternateFieldName = typeof ALTERNATE_FIELD_NAMES[number];

export function isAlternateFieldName(s: string): s is AlternateFieldName {
  return (ALTERNATE_FIELD_NAMES as readonly string[]).includes(s);
}

export interface AltFieldVariant {
  readonly id: string;
  readonly label: string;
  readonly content: string;
}

export function readPersonaAddonEntry(metadata: unknown, addonId: string): Record<string, unknown> | null {
  const addons = (metadata as { addons?: unknown })?.addons;
  if (!Array.isArray(addons)) return null;
  const a = addons.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === addonId);
  return (a as Record<string, unknown>) ?? null;
}

export function writePersonaAddonMeta(metadata: unknown, addonId: string, field: string, value: string): Record<string, unknown> {
  const base = (metadata && typeof metadata === "object" && !Array.isArray(metadata)) ? { ...(metadata as Record<string, unknown>) } : {};
  const addons = Array.isArray(base.addons) ? base.addons.map((a) => ({ ...(a as object) })) : [];
  const idx = addons.findIndex((a) => (a as { id?: unknown })?.id === addonId);
  if (idx < 0) throw new Error(`persona add-on ${addonId} not found`);
  addons[idx] = { ...addons[idx], [field]: value };
  base.addons = addons;
  return base;
}

export function readAltFieldArray(extensions: unknown, field: AlternateFieldName): AltFieldVariant[] {
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) return [];
  const af = (extensions as Record<string, unknown>).alternate_fields;
  if (!af || typeof af !== "object" || Array.isArray(af)) return [];
  const arr = (af as Record<string, unknown>)[field];
  if (!Array.isArray(arr)) return [];
  const out: AltFieldVariant[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    const label = typeof r.label === "string" ? r.label : "";
    const content = typeof r.content === "string" ? r.content : "";
    out.push({ id, label, content });
  }
  return out;
}

export function writeAltFieldArray(
  extensions: Record<string, unknown> | undefined,
  field: AlternateFieldName,
  next: readonly AltFieldVariant[],
): Record<string, unknown> {
  const ext = { ...(extensions ?? {}) };
  const afRaw = (ext as Record<string, unknown>).alternate_fields;
  const af: Record<string, unknown> = (afRaw && typeof afRaw === "object" && !Array.isArray(afRaw))
    ? { ...(afRaw as Record<string, unknown>) }
    : {};
  af[field] = next.map((v) => ({ id: v.id, label: v.label, content: v.content }));
  ext.alternate_fields = af;
  return ext;
}

// Filing scope is derived from the leaf key prefix. Persona / chat / preset
// are their own scope. `char/<id>/...` carries the character id in the key
// (canonical form after resolver), so we read it straight from there and the
// scope is correct even when the agent addresses a character other than the
// session focus. wb / rx file under the focused character when present, else
// under their own scope.
// The host caps world_books.list at 200 rows per page (limit is min'd to 200),
// so a single large-limit call silently drops books past 200. Loop on offset.
export async function listAllWorldBooks(ctx: ToolCtx): Promise<WorldBookDTO[]> {
  const out: WorldBookDTO[] = [];
  let offset = 0;
  while (true) {
    const r = await ctx.spindle.world_books.list({ limit: 200, offset, userId: ctx.userId });
    out.push(...r.data);
    if (r.data.length === 0 || out.length >= r.total) break;
    offset += r.data.length;
  }
  return out;
}

export function scopeForLeafKey(key: string, ctx: ToolCtx): ScopeRef {
  if (key.startsWith("persona/")) return { kind: "persona", id: key.split("/")[1]! };
  if (key.startsWith("chat/")) return { kind: "chat", id: key.split("/")[1]! };
  if (key.startsWith("preset/")) return { kind: "preset", id: key.split("/")[1]! };
  if (key.startsWith("global_addon/")) return { kind: "global_addon", id: key.split("/")[1]! };
  if (key.startsWith("char/")) {
    const id = key.split("/")[1];
    if (id) return characterScope(id);
  }
  if (ctx.characterId) return characterScope(ctx.characterId);
  if (key.startsWith("wb/")) return { kind: "world_book", id: key.split("/")[1]! };
  if (key.startsWith("rx/")) return { kind: "regex_script", id: key.split("/")[1]! };
  return characterScope(ctx.characterId ?? "");
}

export interface ResolvedLeaf {
  // Canonical key, normalized for the recent-read gate.
  readonly key: string;
  // Surface tag for analytics / ledger.
  readonly surface: "character_field" | "alternate_greeting" | "extension" | "regex_script" | "world_book_entry" | "persona_field" | "persona_addon" | "chat_message" | "preset_block" | "global_addon";
  // surfaceId is the entity id (character id for char/extension, script id, entry id).
  readonly surfaceId: string;
  // Human-facing label for the workshop diff card.
  readonly surfaceLabel: string;
  // For extension/structured paths, the "field" sub-key; otherwise same as the trailing segment.
  readonly field: string;
  // Current value at the leaf.
  readonly value: string;
  // Filing-scope override resolved at read time. Used when the key alone
  // doesn't carry enough info, e.g. wb/<entryId>/... where scopeForLeafKey
  // would otherwise mis-file under entry id instead of book id in
  // no-character sessions.
  readonly scope?: ScopeRef;
}

export class PathError extends Error {
  constructor(public readonly path: string, msg: string) {
    super(`Path '${path}': ${msg}`);
    this.name = "PathError";
  }
}

// Array-index past end. Distinct from PathError so callers can surface
// `[OUT_OF_RANGE]` and direct the agent to `list` / `inspect` the array.
export class OutOfRangeError extends Error {
  constructor(public readonly path: string, msg: string) {
    super(`Path '${path}': ${msg}`);
    this.name = "OutOfRangeError";
  }
}

// Refusal from a phone-line extension's check_read / check_write op. Carries
// the redirect message verbatim so callers can surface the bridge's authoring
// guidance to the agent without rewrapping.
export class ExtensionRefusedError extends Error {
  constructor(
    public readonly path: string,
    public readonly mode: "read" | "write",
    msg: string,
  ) {
    super(msg);
    this.name = "ExtensionRefusedError";
  }
}

function splitTopLevel(path: string): readonly string[] {
  // Split on "/" but treat "[...]" bracket spans as opaque, so an extension
  // object key containing "/" (emitted bracket-quoted by walkStringLeaves)
  // survives instead of being shredded into wrong nested segments. Paths with
  // no "/" inside brackets split identically to a plain split.
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of path) {
    if (ch === "[") depth++;
    else if (ch === "]" && depth > 0) depth--;
    if (ch === "/" && depth === 0) {
      if (cur.length > 0) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

// Dispatch a `char/...` path into (characterId, subParts). Two forms:
//   char/<field>...        -> focused interp; characterId = ctx.characterId
//   char/<id>/<field>...   -> explicit; characterId = parts[1]
// Disambiguation: parts[1] in CHAR_SUBTREE_TOKENS means focused form. Else
// parts[1] is treated as a character id and parts[2..] is the sub-grammar.
// Returns NO_TARGET-shaped PathError when the focused form is used without
// a session focus.
interface CharDispatch { readonly characterId: string; readonly subParts: readonly string[]; }

function dispatchCharPath(ctx: ToolCtx, path: string, parts: readonly string[]): CharDispatch {
  const second = parts[1];
  if (second === undefined) throw new PathError(path, "expected char/<field> or char/<id>/<field>");
  if (CHAR_SUBTREE_TOKENS.has(second) || isCharacterStringField(second)) {
    if (!ctx.characterId) {
      throw new PathError(path, "[NO_TARGET] no character is focused in this session. Either pass `char/<id>/<field>` with an explicit character id (use `list_characters` to enumerate), or have the user pick a character via the selector.");
    }
    return { characterId: ctx.characterId, subParts: parts.slice(1) };
  }
  return { characterId: second, subParts: parts.slice(2) };
}

// Read the leaf currently addressed by `path`. Throws PathError if the path
// is malformed or doesn't resolve to a string. Used by `read` and `edit`
// (which calls read, mutates, calls write).
export async function resolveRead(ctx: ToolCtx, path: string): Promise<ResolvedLeaf> {
  const parts = splitTopLevel(path);
  if (parts.length < 2) throw new PathError(path, "expected at least <surface>/<...>");
  const head = parts[0]!;

  if (head === "char" || head === "character") {
    const { characterId, subParts } = dispatchCharPath(ctx, path, parts);
    const c = await ctx.spindle.characters.get(characterId, ctx.userId);
    if (!c) throw new PathError(path, `character ${characterId} not found`);
    const sub = subParts[0];
    if (sub === undefined) throw new PathError(path, "expected a field after char/<id>");
    if (sub === "alternate_greetings") {
      const idxStr = subParts[1];
      if (idxStr === undefined) throw new PathError(path, "alternate_greetings requires an index");
      const idx = parseInt(idxStr, 10);
      const arr = c.alternate_greetings ?? [];
      if (!Number.isFinite(idx) || idx < 0) {
        throw new PathError(path, `index '${idxStr}' is not a non-negative integer`);
      }
      if (idx >= arr.length) {
        throw new OutOfRangeError(path, `alternate_greetings index ${idx} is past the end (length ${arr.length}). \`list({path: "char/alternate_greetings"})\` shows valid indices.`);
      }
      const value = arr[idx] ?? "";
      return {
        key: `char/${characterId}/alternate_greetings/${idx}`,
        surface: "alternate_greeting",
        surfaceId: characterId,
        surfaceLabel: `Greeting #${idx}`,
        field: String(idx),
        value,
      };
    }
    if (sub === "alternate_fields") {
      const field = subParts[1];
      const variantId = subParts[2];
      const leafField = subParts[3];
      if (field === undefined) {
        throw new PathError(path, `expected char/alternate_fields/<field>/<variantId>/<content|label>. Valid fields: ${ALTERNATE_FIELD_NAMES.join(", ")}. Use \`list({path:"char/alternate_fields"})\` to discover.`);
      }
      if (!isAlternateFieldName(field)) {
        throw new PathError(path, `unknown alternate field '${field}'. Valid: ${ALTERNATE_FIELD_NAMES.join(", ")}`);
      }
      if (variantId === undefined || leafField === undefined || subParts.length !== 4) {
        throw new PathError(path, `expected char/alternate_fields/${field}/<variantId>/<content|label>. Use \`list({path:"char/alternate_fields/${field}"})\` to discover variant ids.`);
      }
      if (leafField !== "content" && leafField !== "label") {
        throw new PathError(path, `alternate_fields leaf must be content or label, got '${leafField}'`);
      }
      const variants = readAltFieldArray(c.extensions, field);
      const idx = variants.findIndex((v) => v.id === variantId);
      if (idx < 0) {
        throw new PathError(path, `variant '${variantId}' not found under alternate_fields.${field}. \`list({path:"char/alternate_fields/${field}"})\` shows valid ids.`);
      }
      const variant = variants[idx]!;
      const extDotted = `alternate_fields.${field}[${idx}].${leafField}`;
      const variantLabel = variant.label || `(unlabeled #${idx})`;
      return {
        key: `char/${characterId}/alternate_fields/${field}/${variantId}/${leafField}`,
        surface: "extension",
        surfaceId: characterId,
        surfaceLabel: `${field} variant '${variantLabel}' (${leafField})`,
        field: extDotted,
        value: variant[leafField],
      };
    }
    if (sub === "extensions") {
      const extPath = subParts.slice(1).join(".");
      if (extPath.length === 0) throw new PathError(path, "extensions requires a sub-path");
      await assertExtensionReadAllowed(ctx, characterId, extPath);
      const segs = parseExtensionPath(extPath);
      const v = getAtPath(c.extensions ?? {}, segs);
      if (typeof v !== "string") {
        const shape = Array.isArray(v) ? "array" : typeof v;
        throw new PathError(path, `extension path resolves to ${shape}, not string. Use \`list({path: "char/extensions/${extPath}"})\` to walk its structure, or \`set({path, value})\` to write the whole subtree.`);
      }
      return {
        key: `char/${characterId}/extensions/${extPath}`,
        surface: "extension",
        surfaceId: characterId,
        surfaceLabel: `extensions.${extPath}`,
        field: extPath,
        value: v,
      };
    }
    if (subParts.length !== 1) throw new PathError(path, `expected char/<field>, got ${subParts.length} subsegments`);
    if (!isCharacterStringField(sub)) throw new PathError(path, `unknown character field '${sub}'. Valid: ${CHARACTER_STRING_FIELDS.join(", ")}`);
    const v = (c as unknown as Record<string, unknown>)[sub];
    if (typeof v !== "string") throw new PathError(path, `field '${sub}' is not a string`);
    return {
      key: `char/${characterId}/${sub}`,
      surface: "character_field",
      surfaceId: characterId,
      surfaceLabel: c.name,
      field: sub,
      value: v,
    };
  }

  if (head === "rx" || head === "regex_script") {
    if (parts.length !== 3) throw new PathError(path, "expected rx/<scriptId>/<field>");
    const scriptId = parts[1]!;
    const field = parts[2]!;
    if (field !== "find_regex" && field !== "replace_string") {
      throw new PathError(path, `regex field must be find_regex or replace_string, got '${field}'`);
    }
    const s = await ctx.spindle.regex_scripts.get(scriptId, ctx.userId);
    if (!s) throw new PathError(path, `regex script ${scriptId} not found`);
    const v = (s as unknown as Record<string, unknown>)[field];
    if (typeof v !== "string") throw new PathError(path, `regex_script.${field} is not a string`);
    return {
      key: `rx/${scriptId}/${field}`,
      surface: "regex_script",
      surfaceId: scriptId,
      surfaceLabel: s.name,
      field,
      value: v,
    };
  }

  if (head === "wb" || head === "world_book_entry") {
    if (parts.length !== 3) throw new PathError(path, "expected wb/<entryId>/<field>");
    const entryId = parts[1]!;
    const field = parts[2]!;
    if (field !== "content" && field !== "comment") {
      throw new PathError(path, `world_book_entry field must be content or comment, got '${field}'`);
    }
    const e = await ctx.spindle.world_books.entries.get(entryId, ctx.userId);
    if (!e) throw new PathError(path, `world book entry ${entryId} not found`);
    const v = (e as unknown as Record<string, unknown>)[field];
    if (typeof v !== "string") throw new PathError(path, `entry.${field} is not a string`);
    return {
      key: `wb/${entryId}/${field}`,
      surface: "world_book_entry",
      surfaceId: entryId,
      surfaceLabel: wbLabel(e),
      field,
      value: v,
      // scopeForLeafKey can't tell a book id from an entry id off the key.
      // In a character session the scope override is unused (characterScope
      // wins); in a no-character session it routes the edit to the right
      // world_book ledger.
      ...(ctx.characterId ? {} : { scope: { kind: "world_book" as const, id: e.world_book_id } }),
    };
  }

  if (head === "persona") {
    const personaId = parts[1];
    if (personaId === undefined) throw new PathError(path, "expected persona/<personaId>/<field>");
    const p = await ctx.spindle.personas.get(personaId, ctx.userId);
    if (!p) throw new PathError(path, `persona ${personaId} not found`);
    if (parts[2] === "wb") {
      if (parts.length !== 5) throw new PathError(path, "expected persona/<personaId>/wb/<entryId>/<content|comment>");
      const entryId = parts[3]!;
      const field = parts[4]!;
      if (field !== "content" && field !== "comment") {
        throw new PathError(path, `persona world_book field must be content or comment, got '${field}'`);
      }
      const e = await ctx.spindle.world_books.entries.get(entryId, ctx.userId);
      if (!e) throw new PathError(path, `world book entry ${entryId} not found`);
      const wv = (e as unknown as Record<string, unknown>)[field];
      if (typeof wv !== "string") throw new PathError(path, `entry.${field} is not a string`);
      return {
        key: `persona/${personaId}/wb/${entryId}/${field}`,
        surface: "world_book_entry",
        surfaceId: entryId,
        surfaceLabel: `${p.name} · ${wbLabel(e)}`,
        field,
        value: wv,
        // File under the owning BOOK, not the persona. The same entry is also
        // reachable as wb/<entryId>/<field> (which files under world_book); without
        // this override the two path forms would split edits across two ledgers
        // and a revert on one would clobber the other.
        scope: { kind: "world_book", id: e.world_book_id },
      };
    }
    if (parts[2] === "addon") {
      if (parts.length !== 5) throw new PathError(path, "expected persona/<personaId>/addon/<addonId>/<content|label>");
      const addonId = parts[3]!;
      const field = parts[4]!;
      if (field !== "content" && field !== "label") {
        throw new PathError(path, `persona add-on field must be content or label, got '${field}'`);
      }
      const addon = readPersonaAddonEntry(p.metadata, addonId);
      if (!addon) throw new PathError(path, `persona add-on ${addonId} not found`);
      const av = addon[field];
      if (typeof av !== "string") throw new PathError(path, `add-on.${field} is not a string`);
      return {
        key: `persona/${personaId}/addon/${addonId}/${field}`,
        surface: "persona_addon",
        surfaceId: `${personaId}:${addonId}`,
        surfaceLabel: `${p.name} · ${typeof addon.label === "string" && addon.label ? addon.label : addonId}`,
        field,
        value: av,
        scope: { kind: "persona", id: personaId },
      };
    }
    if (parts.length !== 3) throw new PathError(path, `expected persona/<personaId>/<field>, got ${parts.length} segments`);
    const field = parts[2]!;
    if (!(PERSONA_STRING_FIELDS as readonly string[]).includes(field)) {
      throw new PathError(path, `unknown persona field '${field}'. Valid: ${PERSONA_STRING_FIELDS.join(", ")}`);
    }
    const pv = (p as unknown as Record<string, unknown>)[field];
    if (typeof pv !== "string") throw new PathError(path, `persona.${field} is not a string`);
    return {
      key: `persona/${personaId}/${field}`,
      surface: "persona_field",
      surfaceId: personaId,
      surfaceLabel: p.name,
      field,
      value: pv,
    };
  }

  if (head === "global_addon") {
    if (parts.length !== 3) throw new PathError(path, "expected global_addon/<id>/<content|label>");
    const addonId = parts[1]!;
    const field = parts[2]!;
    if (field !== "content" && field !== "label") {
      throw new PathError(path, `global add-on field must be content or label, got '${field}'`);
    }
    const a = await ctx.spindle.global_addons.get(addonId, ctx.userId);
    if (!a) throw new PathError(path, `global add-on ${addonId} not found`);
    const av = (a as unknown as Record<string, unknown>)[field];
    if (typeof av !== "string") throw new PathError(path, `add-on.${field} is not a string`);
    return {
      key: `global_addon/${addonId}/${field}`,
      surface: "global_addon",
      surfaceId: addonId,
      surfaceLabel: a.label || addonId,
      field,
      value: av,
      scope: { kind: "global_addon", id: addonId },
    };
  }

  if (head === "chat") {
    const chatId = parts[1];
    if (chatId === undefined || parts[2] !== "msg" || parts.length !== 5 || parts[4] !== "content") {
      throw new PathError(path, "expected chat/<chatId>/msg/<messageId>/content");
    }
    const messageId = parts[3]!;
    const msgs = await ctx.spindle.chat.getMessages(chatId);
    const m = msgs.find((x) => x.id === messageId);
    if (!m) throw new PathError(path, `message ${messageId} not found in chat ${chatId}`);
    return {
      key: `chat/${chatId}/msg/${messageId}/content`,
      surface: "chat_message",
      surfaceId: `${chatId}:${messageId}`,
      surfaceLabel: `${m.role} message`,
      field: "content",
      value: m.content,
    };
  }

  if (head === "preset") {
    const presetId = parts[1];
    if (presetId === undefined || parts[2] !== "block" || parts.length !== 5
      || (parts[4] !== "content" && parts[4] !== "name")) {
      throw new PathError(path, "expected preset/<presetId>/block/<blockId>/<content|name>");
    }
    const blockId = parts[3]!;
    const field = parts[4]!;
    const b = await ctx.spindle.presets.blocks.get(presetId, blockId, ctx.userId);
    if (!b) throw new PathError(path, `block ${blockId} not found in preset ${presetId}`);
    const bv = (b as unknown as Record<string, unknown>)[field];
    if (typeof bv !== "string") throw new PathError(path, `block.${field} is not a string`);
    return {
      key: `preset/${presetId}/block/${blockId}/${field}`,
      surface: "preset_block",
      surfaceId: `${presetId}:${blockId}`,
      surfaceLabel: `${b.name || "block"} (${field})`,
      field,
      value: bv,
    };
  }

  throw new PathError(path, `unknown surface prefix '${head}'. Expected one of: char, rx, wb, persona, chat, preset`);
}

// Write a new value back to the leaf. Caller has already produced `nextValue`
// (typically via find/replace or wholesale). We do the right spindle update,
// then push an EditRecord onto the ledger via ctx.pushEdit.
export async function resolveWrite(
  ctx: ToolCtx,
  leaf: ResolvedLeaf,
  nextValue: string,
): Promise<void> {
  if (leaf.surface === "character_field") {
    const charId = leaf.surfaceId;
    const patch: CharacterUpdateDTO = { [leaf.field]: nextValue } as CharacterUpdateDTO;
    await ctx.spindle.characters.update(charId, patch, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "character_field", surfaceId: charId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: characterScope(charId),
    } satisfies EditRecord);
    return;
  }
  if (leaf.surface === "alternate_greeting") {
    const charId = leaf.surfaceId;
    const idx = parseInt(leaf.field, 10);
    const c = await ctx.spindle.characters.get(charId, ctx.userId);
    if (!c) throw new Error("character not found");
    const arr = [...(c.alternate_greetings ?? [])];
    if (idx < 0 || idx >= arr.length) throw new Error(`alternate_greetings[${idx}] out of range`);
    arr[idx] = nextValue;
    await ctx.spindle.characters.update(charId, { alternate_greetings: arr }, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "alternate_greeting", surfaceId: charId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: characterScope(charId),
    });
    return;
  }
  if (leaf.surface === "extension") {
    const charId = leaf.surfaceId;
    await assertExtensionWriteAllowed(ctx, charId, leaf.field);
    const c = await ctx.spindle.characters.get(charId, ctx.userId);
    if (!c) throw new Error("character not found");
    const segs = parseExtensionPath(leaf.field);
    if (segs.length === 0 || segs[0]!.kind !== "key") {
      throw new Error(`extensions path must start with a named key, got '${leaf.field}'`);
    }
    const next = setAtPath(c.extensions ?? {}, segs, nextValue) as Record<string, unknown>;
    await ctx.spindle.characters.update(charId, { extensions: next }, ctx.userId);
    // JSON-encode so the file stays consistent with set-tool extension writes
    // and revertFieldEditV2 can decode through writeFieldValue.
    ctx.pushEdit({
      op: "edit", surface: "extension", surfaceId: charId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field,
      before: JSON.stringify(leaf.value), after: JSON.stringify(nextValue),
      valueEncoding: "json",
      scope: characterScope(charId),
    });
    return;
  }
  if (leaf.surface === "regex_script") {
    await ctx.spindle.regex_scripts.update(leaf.surfaceId, { [leaf.field]: nextValue } as RegexScriptUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "regex_script", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: leaf.scope ?? scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "world_book_entry") {
    await ctx.spindle.world_books.entries.update(leaf.surfaceId, { [leaf.field]: nextValue } as WorldBookEntryUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "world_book_entry", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: leaf.scope ?? scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "persona_field") {
    await ctx.spindle.personas.update(leaf.surfaceId, { [leaf.field]: nextValue } as PersonaUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "persona_field", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "persona_addon") {
    const [personaId, addonId] = leaf.surfaceId.split(":");
    const p = await ctx.spindle.personas.get(personaId!, ctx.userId);
    if (!p) throw new Error("persona not found");
    await ctx.spindle.personas.update(personaId!, { metadata: writePersonaAddonMeta(p.metadata, addonId!, leaf.field, nextValue) } as PersonaUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "persona_addon", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: leaf.scope ?? scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "global_addon") {
    await ctx.spindle.global_addons.update(leaf.surfaceId, { [leaf.field]: nextValue } as GlobalAddonUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "global_addon", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: leaf.scope ?? scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "chat_message") {
    const [chatId, messageId] = leaf.surfaceId.split(":");
    await ctx.spindle.chat.updateMessage(chatId!, messageId!, { content: nextValue });
    ctx.pushEdit({
      op: "edit", surface: "chat_message", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "preset_block") {
    const [presetId, blockId] = leaf.surfaceId.split(":");
    await ctx.spindle.presets.blocks.update(presetId!, blockId!, { [leaf.field]: nextValue }, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "preset_block", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
}

// Phone-line read/write access gates. Routes the extension's first path
// segment (`lumirealm`, etc.) to the owning provider's check_read /
// check_write op. Refusals throw ExtensionRefusedError carrying the bridge's
// redirect message verbatim so callers can surface it without rewrapping.

async function assertExtensionWriteAllowed(ctx: ToolCtx, characterId: string, extPath: string): Promise<void> {
  const { checkExtensionWrite } = await import("../../phoneline/gate");
  const res = await checkExtensionWrite(ctx.spindle, ctx.userId, characterId, extPath);
  if (!res.ok) throw new ExtensionRefusedError(`char/extensions/${extPath}`, "write", res.message ?? "extension refused write at this path");
}

async function assertExtensionReadAllowed(ctx: ToolCtx, characterId: string, extPath: string): Promise<void> {
  const { checkExtensionRead } = await import("../../phoneline/gate");
  const res = await checkExtensionRead(ctx.spindle, ctx.userId, characterId, extPath);
  if (!res.ok) throw new ExtensionRefusedError(`char/extensions/${extPath}`, "read", res.message ?? "extension refused read at this path");
}

// Export so update_character can run the same gate against its extensions patch.
export { assertExtensionWriteAllowed };

// All editable string leaves on one character + extensions + regex + lorebook,
// flat-listed by path. Takes the target character id explicitly (resolved by
// the caller from input.character_id or session focus), so whole-card tools
// (grep / audit / survey) can address any card in All Characters mode. Char
// leaf keys carry the id (`char/<id>/...`) so a result returned for a
// non-focused character round-trips through resolveRead unambiguously. rx / wb
// leaves carry a characterScope override so edits found here file under the
// owning character even when it differs from the session focus.
export async function* iterateAllLeaves(ctx: ToolCtx, characterId: string, opts?: { wbScope?: "attached" | "all" }): AsyncGenerator<ResolvedLeaf> {
  const c = await ctx.spindle.characters.get(characterId, ctx.userId);
  if (!c) return;
  const charScope = characterScope(characterId);

  for (const field of CHARACTER_STRING_FIELDS) {
    const v = (c as unknown as Record<string, unknown>)[field];
    if (typeof v === "string") {
      yield { key: `char/${characterId}/${field}`, surface: "character_field", surfaceId: characterId, surfaceLabel: c.name, field, value: v, scope: charScope };
    }
  }
  if (Array.isArray(c.alternate_greetings)) {
    for (let i = 0; i < c.alternate_greetings.length; i++) {
      const v = c.alternate_greetings[i];
      if (typeof v === "string") {
        yield { key: `char/${characterId}/alternate_greetings/${i}`, surface: "alternate_greeting", surfaceId: characterId, surfaceLabel: `Greeting #${i}`, field: String(i), value: v, scope: charScope };
      }
    }
  }
  // alternate_fields variants surface as their friendly by-id paths so audit /
  // grep filter on `char/alternate_fields/` matches them. The legacy extension
  // walker would also reach these leaves at `char/extensions/alternate_fields.<f>[<i>].<leaf>`,
  // so the skip predicate below masks that subtree to avoid double-yielding.
  for (const field of ALTERNATE_FIELD_NAMES) {
    const variants = readAltFieldArray(c.extensions, field);
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!;
      const labelText = v.label || `(unlabeled #${i})`;
      yield {
        key: `char/${characterId}/alternate_fields/${field}/${v.id}/content`,
        surface: "extension",
        surfaceId: characterId,
        surfaceLabel: `${field} variant '${labelText}' (content)`,
        field: `alternate_fields.${field}[${i}].content`,
        value: v.content,
        scope: charScope,
      };
      yield {
        key: `char/${characterId}/alternate_fields/${field}/${v.id}/label`,
        surface: "extension",
        surfaceId: characterId,
        surfaceLabel: `${field} variant '${labelText}' (label)`,
        field: `alternate_fields.${field}[${i}].label`,
        value: v.label,
        scope: charScope,
      };
    }
  }
  // Walk extensions deep tree for every string leaf. Phone-line manifests
  // declare path prefixes (derived/cached projections) to skip via the
  // shared search-excludes helper. alternate_fields gets masked here because
  // the friendly-path loop above already yielded those leaves.
  const { walkStringLeaves: walk } = await import("./_walk");
  const { buildExtensionsSearchSkip } = await import("../../phoneline/search-excludes");
  const phonelineSkip = await buildExtensionsSearchSkip(ctx.spindle, ctx.userId);
  const skip = (path: string): boolean => path === "alternate_fields" || path.startsWith("alternate_fields.") || phonelineSkip(path);
  for (const leaf of walk(c.extensions ?? {}, "", skip)) {
    yield { key: `char/${characterId}/extensions/${leaf.path}`, surface: "extension", surfaceId: characterId, surfaceLabel: `extensions.${leaf.path}`, field: leaf.path, value: leaf.text, scope: charScope };
  }
  // Regex scripts (character scope).
  let rOff = 0;
  while (true) {
    const r = await ctx.spindle.regex_scripts.list({ scope: "character", scopeId: characterId, userId: ctx.userId, limit: 200, offset: rOff });
    for (const s of r.data) {
      if (typeof s.find_regex === "string") {
        yield { key: `rx/${s.id}/find_regex`, surface: "regex_script", surfaceId: s.id, surfaceLabel: s.name, field: "find_regex", value: s.find_regex, scope: charScope };
      }
      if (typeof s.replace_string === "string") {
        yield { key: `rx/${s.id}/replace_string`, surface: "regex_script", surfaceId: s.id, surfaceLabel: s.name, field: "replace_string", value: s.replace_string, scope: charScope };
      }
    }
    if (r.data.length === 0 || rOff + r.data.length >= r.total) break;
    rOff += r.data.length;
  }
  // World book entries. Attached books always. wbScope "all" also walks every
  // other owned book (which default discovery never reaches), labeling the ones
  // actually in the global "Always Active" set distinctly from merely-unattached.
  const attachedSet = new Set(c.world_book_ids ?? []);
  const wbIds: string[] = [...attachedSet];
  let globalSet = new Set<string>();
  if (opts?.wbScope === "all") {
    globalSet = new Set(await ctx.spindle.world_books.getGlobal(ctx.userId).catch(() => [] as string[]));
    const owned = await listAllWorldBooks(ctx);
    for (const wb of owned) if (!attachedSet.has(wb.id)) wbIds.push(wb.id);
  }
  for (const wbId of wbIds) {
    const attached = attachedSet.has(wbId);
    // Unattached books aren't this character's; file edits under the book's own
    // ledger, not the focused character. Tag the label so the model sees scope.
    const wbScope: ScopeRef = attached ? charScope : { kind: "world_book", id: wbId };
    const tag = attached ? "" : globalSet.has(wbId) ? " [global]" : " [unattached]";
    let wOff = 0;
    while (true) {
      const r = await ctx.spindle.world_books.entries.list(wbId, { limit: 500, userId: ctx.userId, offset: wOff });
      for (const e of r.data) {
        if (typeof e.content === "string") {
          yield { key: `wb/${e.id}/content`, surface: "world_book_entry", surfaceId: e.id, surfaceLabel: `${wbLabel(e)}${tag}`, field: "content", value: e.content, scope: wbScope };
        }
        if (typeof e.comment === "string" && e.comment.length > 0) {
          yield { key: `wb/${e.id}/comment`, surface: "world_book_entry", surfaceId: e.id, surfaceLabel: `${wbLabel(e)}${tag}`, field: "comment", value: e.comment, scope: wbScope };
        }
      }
      if (r.data.length === 0 || wOff + r.data.length >= r.total) break;
      wOff += r.data.length;
    }
  }
}

