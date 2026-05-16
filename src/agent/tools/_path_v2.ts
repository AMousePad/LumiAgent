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

import type { CharacterUpdateDTO, RegexScriptUpdateDTO, WorldBookEntryUpdateDTO, PersonaUpdateDTO } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { characterScope } from "../../types";
import { CHARACTER_STRING_FIELDS, isCharacterStringField, wbLabel } from "./_surfaces";
import { parseExtensionPath, getAtPath, setAtPath } from "./_paths";

const PERSONA_STRING_FIELDS = ["name", "title", "description"] as const;

// Filing scope is derived from the leaf key prefix so it stays in one place
// instead of being threaded through every ResolvedLeaf literal. persona /
// chat / preset are always their own scope. wb / rx normally file under the
// active character, but with no character selected they file under the world
// book / regex script itself so the edit is still tracked and revertable.
export function scopeForLeafKey(key: string, ctx: ToolCtx): ScopeRef {
  if (key.startsWith("persona/")) return { kind: "persona", id: key.split("/")[1]! };
  if (key.startsWith("chat/")) return { kind: "chat", id: key.split("/")[1]! };
  if (key.startsWith("preset/")) return { kind: "preset", id: key.split("/")[1]! };
  if (ctx.characterId) return characterScope(ctx.characterId);
  if (key.startsWith("wb/")) return { kind: "world_book", id: key.split("/")[1]! };
  if (key.startsWith("rx/")) return { kind: "regex_script", id: key.split("/")[1]! };
  return characterScope(ctx.characterId);
}

export interface ResolvedLeaf {
  // Canonical key, normalized for the recent-read gate.
  readonly key: string;
  // Surface tag for analytics / ledger.
  readonly surface: "character_field" | "alternate_greeting" | "extension" | "regex_script" | "world_book_entry" | "persona_field" | "chat_message" | "preset_block";
  // surfaceId is the entity id (character id for char/extension, script id, entry id).
  readonly surfaceId: string;
  // Human-facing label for the workshop diff card.
  readonly surfaceLabel: string;
  // For extension/structured paths, the "field" sub-key; otherwise same as the trailing segment.
  readonly field: string;
  // Current value at the leaf.
  readonly value: string;
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
  return path.split("/").filter((s) => s.length > 0);
}

// Read the leaf currently addressed by `path`. Throws PathError if the path
// is malformed or doesn't resolve to a string. Used by `read` and `edit`
// (which calls read, mutates, calls write).
export async function resolveRead(ctx: ToolCtx, path: string): Promise<ResolvedLeaf> {
  const parts = splitTopLevel(path);
  if (parts.length < 2) throw new PathError(path, "expected at least <surface>/<...>");
  const head = parts[0]!;

  if (head === "char" || head === "character") {
    if (!ctx.characterId) throw new PathError(path, "no character is selected in this session; char/ paths need an active character (wb/, rx/, persona/, chat/, preset/ paths work without one)");
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) throw new PathError(path, `character ${ctx.characterId} not found`);
    const sub = parts[1]!;
    if (sub === "alternate_greetings") {
      const idxStr = parts[2];
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
        key: `char/alternate_greetings/${idx}`,
        surface: "alternate_greeting",
        surfaceId: ctx.characterId,
        surfaceLabel: `Greeting #${idx}`,
        field: String(idx),
        value,
      };
    }
    if (sub === "extensions") {
      const extPath = parts.slice(2).join(".");
      if (extPath.length === 0) throw new PathError(path, "extensions requires a sub-path");
      await assertExtensionReadAllowed(ctx, extPath);
      const segs = parseExtensionPath(extPath);
      const v = getAtPath(c.extensions ?? {}, segs);
      if (typeof v !== "string") {
        const shape = Array.isArray(v) ? "array" : typeof v;
        throw new PathError(path, `extension path resolves to ${shape}, not string. Use \`list({path: "char/extensions/${extPath}"})\` to walk its structure, or \`set({path, value})\` to write the whole subtree.`);
      }
      return {
        key: `char/extensions/${extPath}`,
        surface: "extension",
        surfaceId: ctx.characterId,
        surfaceLabel: `extensions.${extPath}`,
        field: extPath,
        value: v,
      };
    }
    if (parts.length !== 2) throw new PathError(path, `expected char/<field>, got ${parts.length} segments`);
    if (!isCharacterStringField(sub)) throw new PathError(path, `unknown character field '${sub}'. Valid: ${CHARACTER_STRING_FIELDS.join(", ")}`);
    const v = (c as unknown as Record<string, unknown>)[sub];
    if (typeof v !== "string") throw new PathError(path, `field '${sub}' is not a string`);
    return {
      key: `char/${sub}`,
      surface: "character_field",
      surfaceId: ctx.characterId,
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
    const patch: CharacterUpdateDTO = { [leaf.field]: nextValue } as CharacterUpdateDTO;
    await ctx.spindle.characters.update(ctx.characterId, patch, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "character_field", surfaceId: ctx.characterId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
    } satisfies EditRecord);
    return;
  }
  if (leaf.surface === "alternate_greeting") {
    const idx = parseInt(leaf.field, 10);
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) throw new Error("character not found");
    const arr = [...(c.alternate_greetings ?? [])];
    if (idx < 0 || idx >= arr.length) throw new Error(`alternate_greetings[${idx}] out of range`);
    arr[idx] = nextValue;
    await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "alternate_greeting", surfaceId: ctx.characterId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
    });
    return;
  }
  if (leaf.surface === "extension") {
    await assertExtensionWriteAllowed(ctx, leaf.field);
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) throw new Error("character not found");
    const segs = parseExtensionPath(leaf.field);
    const next = setAtPath(c.extensions ?? {}, segs, nextValue) as Record<string, unknown>;
    await ctx.spindle.characters.update(ctx.characterId, { extensions: next }, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "extension", surfaceId: ctx.characterId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
    });
    return;
  }
  if (leaf.surface === "regex_script") {
    await ctx.spindle.regex_scripts.update(leaf.surfaceId, { [leaf.field]: nextValue } as RegexScriptUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "regex_script", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: scopeForLeafKey(leaf.key, ctx),
    });
    return;
  }
  if (leaf.surface === "world_book_entry") {
    await ctx.spindle.world_books.entries.update(leaf.surfaceId, { [leaf.field]: nextValue } as WorldBookEntryUpdateDTO, ctx.userId);
    ctx.pushEdit({
      op: "edit", surface: "world_book_entry", surfaceId: leaf.surfaceId,
      surfaceLabel: leaf.surfaceLabel, field: leaf.field, before: leaf.value, after: nextValue,
      scope: scopeForLeafKey(leaf.key, ctx),
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
}

// Phone-line read/write access gates. Routes the extension's first path
// segment (`lumirealm`, etc.) to the owning provider's check_read /
// check_write op. Refusals throw ExtensionRefusedError carrying the bridge's
// redirect message verbatim so callers can surface it without rewrapping.

async function assertExtensionWriteAllowed(ctx: ToolCtx, extPath: string): Promise<void> {
  const { checkExtensionWrite } = await import("../../phoneline/gate");
  const res = await checkExtensionWrite(ctx.spindle, ctx.userId, ctx.characterId, extPath);
  if (!res.ok) throw new ExtensionRefusedError(`char/extensions/${extPath}`, "write", res.message ?? "extension refused write at this path");
}

async function assertExtensionReadAllowed(ctx: ToolCtx, extPath: string): Promise<void> {
  const { checkExtensionRead } = await import("../../phoneline/gate");
  const res = await checkExtensionRead(ctx.spindle, ctx.userId, ctx.characterId, extPath);
  if (!res.ok) throw new ExtensionRefusedError(`char/extensions/${extPath}`, "read", res.message ?? "extension refused read at this path");
}

// Export so update_character can run the same gate against its extensions patch.
export { assertExtensionWriteAllowed };

// All editable string leaves on the character + extensions + regex + lorebook,
// flat-listed by path. Used by the audit tool and (later) the path-based
// list/glob tool.
export async function* iterateAllLeaves(ctx: ToolCtx): AsyncGenerator<ResolvedLeaf> {
  const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
  if (!c) return;

  for (const field of CHARACTER_STRING_FIELDS) {
    const v = (c as unknown as Record<string, unknown>)[field];
    if (typeof v === "string") {
      yield { key: `char/${field}`, surface: "character_field", surfaceId: ctx.characterId, surfaceLabel: c.name, field, value: v };
    }
  }
  if (Array.isArray(c.alternate_greetings)) {
    for (let i = 0; i < c.alternate_greetings.length; i++) {
      const v = c.alternate_greetings[i];
      if (typeof v === "string") {
        yield { key: `char/alternate_greetings/${i}`, surface: "alternate_greeting", surfaceId: ctx.characterId, surfaceLabel: `Greeting #${i}`, field: String(i), value: v };
      }
    }
  }
  // Walk extensions deep tree for every string leaf. Phone-line manifests
  // declare path prefixes (derived/cached projections) to skip via the
  // shared search-excludes helper.
  const { walkStringLeaves: walk } = await import("./_walk");
  const { buildExtensionsSearchSkip } = await import("../../phoneline/search-excludes");
  const skip = await buildExtensionsSearchSkip(ctx.spindle, ctx.userId);
  for (const leaf of walk(c.extensions ?? {}, "", skip)) {
    yield { key: `char/extensions/${leaf.path}`, surface: "extension", surfaceId: ctx.characterId, surfaceLabel: `extensions.${leaf.path}`, field: leaf.path, value: leaf.text };
  }
  // Regex scripts (character scope).
  let rOff = 0;
  while (true) {
    const r = await ctx.spindle.regex_scripts.list({ scope: "character", scopeId: ctx.characterId, userId: ctx.userId, limit: 200, offset: rOff });
    for (const s of r.data) {
      if (typeof s.find_regex === "string") {
        yield { key: `rx/${s.id}/find_regex`, surface: "regex_script", surfaceId: s.id, surfaceLabel: s.name, field: "find_regex", value: s.find_regex };
      }
      if (typeof s.replace_string === "string") {
        yield { key: `rx/${s.id}/replace_string`, surface: "regex_script", surfaceId: s.id, surfaceLabel: s.name, field: "replace_string", value: s.replace_string };
      }
    }
    if (r.data.length === 0 || rOff + r.data.length >= r.total) break;
    rOff += r.data.length;
  }
  // World book entries (attached books only).
  for (const wbId of c.world_book_ids ?? []) {
    let wOff = 0;
    while (true) {
      const r = await ctx.spindle.world_books.entries.list(wbId, { limit: 500, userId: ctx.userId, offset: wOff });
      for (const e of r.data) {
        if (typeof e.content === "string") {
          yield { key: `wb/${e.id}/content`, surface: "world_book_entry", surfaceId: e.id, surfaceLabel: wbLabel(e), field: "content", value: e.content };
        }
        if (typeof e.comment === "string" && e.comment.length > 0) {
          yield { key: `wb/${e.id}/comment`, surface: "world_book_entry", surfaceId: e.id, surfaceLabel: wbLabel(e), field: "comment", value: e.comment };
        }
      }
      if (r.data.length === 0 || wOff + r.data.length >= r.total) break;
      wOff += r.data.length;
    }
  }
}

