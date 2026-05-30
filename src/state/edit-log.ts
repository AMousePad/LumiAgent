import type {
  SpindleAPI,
  CharacterDTO,
  CharacterUpdateDTO,
  WorldBookEntryDTO,
  WorldBookEntryUpdateDTO,
  WorldBookEntryCreateDTO,
  RegexScriptDTO,
  RegexScriptUpdateDTO,
  RegexScriptCreateDTO,
  PersonaUpdateDTO,
  PersonaDTO,
  PersonaCreateDTO,
  WorldBookDTO,
  WorldBookCreateDTO,
  WorldBookUpdateDTO,
  UserPresetDTO,
  UserPresetCreateDTO,
  UserPresetUpdateDTO,
  PromptBlockDTO,
  PromptBlockCreateDTO,
} from "lumiverse-spindle-types";
import type { WorldBookSnapshot, PresetSnapshot, AlternateFieldVariantSnapshot } from "../types";
import type { EditLogEntry, EditRecord, RevertOutcomeWire, ScopeRef } from "../types";
import { characterScope } from "../types";
import type { ScopedLedger } from "./ledger";
import { findPatch, findStructural, findExternal, persistLedgerNow, purgeIdsInMemory } from "./ledger";
import { tryRevert, recordExternalDrift, sha256, currentValue, purgeRevertedPatches } from "./patch-stack";

export interface RevertResult {
  readonly success: boolean;
  readonly error?: string | undefined;
}

const SAMPLE_CHARS = 160;
function sample(s: string): string {
  if (s.length <= SAMPLE_CHARS) return s;
  return s.slice(0, SAMPLE_CHARS) + "...";
}

function parseExternalValue(stored: string): unknown {
  if (stored === "") return "";
  const trimmed = stored.trimStart();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"'))) return stored;
  try { return JSON.parse(stored); } catch { return stored; }
}

let editIdCounter = 0;

export function makeEditId(): string {
  editIdCounter++;
  const r = Math.random().toString(36).slice(2, 8);
  return `edit_${Date.now().toString(36)}_${editIdCounter}_${r}`;
}

export function newEditEntry(
  sessionId: string,
  scope: ScopeRef,
  toolCallId: string,
  toolName: string,
  turn: number,
  record: EditRecord,
  assistantMessageId?: string,
): EditLogEntry {
  return {
    id: makeEditId(),
    ts: Date.now(),
    sessionId,
    scope,
    ...(assistantMessageId !== undefined ? { assistantMessageId } : {}),
    toolCallId,
    toolName,
    turn,
    record,
    reverted: false,
  };
}

function entryUpdateFromDTO(e: WorldBookEntryDTO): WorldBookEntryUpdateDTO {
  const out: WorldBookEntryUpdateDTO = {
    key: e.key,
    keysecondary: e.keysecondary,
    content: e.content,
    comment: e.comment,
    position: e.position,
    depth: e.depth,
    order_value: e.order_value,
    selective: e.selective,
    constant: e.constant,
    disabled: e.disabled,
    group_name: e.group_name,
    group_override: e.group_override,
    group_weight: e.group_weight,
    probability: e.probability,
    case_sensitive: e.case_sensitive,
    match_whole_words: e.match_whole_words,
    use_regex: e.use_regex,
    prevent_recursion: e.prevent_recursion,
    exclude_recursion: e.exclude_recursion,
    delay_until_recursion: e.delay_until_recursion,
    priority: e.priority,
    sticky: e.sticky,
    cooldown: e.cooldown,
    delay: e.delay,
    selective_logic: e.selective_logic,
    use_probability: e.use_probability,
    vectorized: e.vectorized,
    extensions: e.extensions,
  };
  if (e.scan_depth !== null) out.scan_depth = e.scan_depth;
  if (e.automation_id !== null) out.automation_id = e.automation_id;
  if (e.role !== null) out.role = e.role;
  return out;
}

function entryCreateFromDTO(e: WorldBookEntryDTO): WorldBookEntryCreateDTO {
  return entryUpdateFromDTO(e) as WorldBookEntryCreateDTO;
}

function regexUpdateFromDTO(r: RegexScriptDTO): RegexScriptUpdateDTO {
  return {
    name: r.name,
    find_regex: r.find_regex,
    replace_string: r.replace_string,
    flags: r.flags,
    placement: r.placement,
    scope: r.scope,
    scope_id: r.scope_id,
    target: r.target,
    min_depth: r.min_depth,
    max_depth: r.max_depth,
    trim_strings: r.trim_strings,
    run_on_edit: r.run_on_edit,
    substitute_macros: r.substitute_macros,
    disabled: r.disabled,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder,
    metadata: r.metadata,
  };
}

function personaCreateFromDTO(p: PersonaDTO): PersonaCreateDTO {
  // Truthiness gates would drop deliberately-blank fields (description: "",
  // is_default: false, attached_world_book_id: "" / null for detached) — on
  // revert the spindle would substitute its own defaults instead of restoring
  // the user's chosen blank state. Use undefined-checks instead so the create
  // DTO mirrors the snapshot.
  const out: PersonaCreateDTO = { name: p.name };
  if (p.title !== undefined) out.title = p.title;
  if (p.description !== undefined) out.description = p.description;
  if (p.folder !== undefined) out.folder = p.folder;
  if (p.is_default !== undefined) out.is_default = p.is_default;
  if (p.attached_world_book_id !== undefined && p.attached_world_book_id !== null) out.attached_world_book_id = p.attached_world_book_id;
  if (p.metadata && Object.keys(p.metadata).length > 0) out.metadata = p.metadata;
  return out;
}

function regexCreateFromDTO(r: RegexScriptDTO): RegexScriptCreateDTO {
  return {
    name: r.name,
    find_regex: r.find_regex,
    replace_string: r.replace_string,
    flags: r.flags,
    placement: r.placement,
    scope: r.scope,
    scope_id: r.scope_id,
    target: r.target,
    min_depth: r.min_depth,
    max_depth: r.max_depth,
    trim_strings: r.trim_strings,
    run_on_edit: r.run_on_edit,
    substitute_macros: r.substitute_macros,
    disabled: r.disabled,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder,
    metadata: r.metadata,
    script_id: r.script_id,
  };
}

// Container-level (world_book / preset) fields that are plain strings. Every
// other field (metadata, parameters, prompt_order, prompts) round-trips as
// JSON so object / array values survive a revert losslessly.
const SCALAR_STRING_FIELDS: ReadonlySet<string> = new Set(["name", "description", "provider", "engine"]);

export function encodeScalar(field: string, v: unknown): string {
  if (SCALAR_STRING_FIELDS.has(field) && typeof v === "string") return v;
  return JSON.stringify(v ?? null);
}

export function decodeScalar(field: string, s: string): unknown {
  if (SCALAR_STRING_FIELDS.has(field)) return s;
  try { return JSON.parse(s); } catch { return s; }
}

function personaScalarUpdate(field: string, decoded: unknown): PersonaUpdateDTO {
  return { [field]: decoded == null ? "" : String(decoded) } as PersonaUpdateDTO;
}

function worldBookCreateFromDTO(b: WorldBookDTO): WorldBookCreateDTO {
  const out: WorldBookCreateDTO = { name: b.name };
  if (b.description) out.description = b.description;
  if (b.metadata && Object.keys(b.metadata).length > 0) out.metadata = b.metadata;
  return out;
}

function presetCreateFromDTO(p: UserPresetDTO): UserPresetCreateDTO {
  const out: UserPresetCreateDTO = { name: p.name, provider: p.provider };
  if (p.engine) out.engine = p.engine;
  if (p.parameters) out.parameters = p.parameters;
  if (p.prompts) out.prompts = p.prompts;
  if (p.metadata) out.metadata = p.metadata;
  return out;
}

function blockCreateFromDTO(b: PromptBlockDTO): PromptBlockCreateDTO {
  const { id: _id, ...rest } = b;
  void _id;
  return rest as PromptBlockCreateDTO;
}

type PathSegment = { kind: "key"; value: string } | { kind: "index"; value: number };

function altFieldArrayOf(extensions: unknown, altField: string): { id: string; label: string; content: string }[] {
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) return [];
  const af = (extensions as Record<string, unknown>).alternate_fields;
  if (!af || typeof af !== "object" || Array.isArray(af)) return [];
  const arr = (af as Record<string, unknown>)[altField];
  if (!Array.isArray(arr)) return [];
  const out: { id: string; label: string; content: string }[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    out.push({ id, label: typeof r.label === "string" ? r.label : "", content: typeof r.content === "string" ? r.content : "" });
  }
  return out;
}

function writeAltFieldArrayLocal(extensions: unknown, altField: string, next: readonly { id: string; label: string; content: string }[]): Record<string, unknown> {
  const ext: Record<string, unknown> = (extensions && typeof extensions === "object" && !Array.isArray(extensions))
    ? { ...(extensions as Record<string, unknown>) }
    : {};
  const afRaw = ext.alternate_fields;
  const af: Record<string, unknown> = (afRaw && typeof afRaw === "object" && !Array.isArray(afRaw))
    ? { ...(afRaw as Record<string, unknown>) }
    : {};
  af[altField] = next.map((v) => ({ id: v.id, label: v.label, content: v.content }));
  ext.alternate_fields = af;
  return ext;
}

function removeVariantById(extensions: unknown, altField: string, variantId: string): Record<string, unknown> {
  const arr = altFieldArrayOf(extensions, altField);
  const next = arr.filter((v) => v.id !== variantId);
  return writeAltFieldArrayLocal(extensions, altField, next);
}

function insertVariant(extensions: unknown, altField: string, variant: { id: string; label: string; content: string }, index: number): Record<string, unknown> {
  const arr = altFieldArrayOf(extensions, altField);
  if (arr.some((v) => v.id === variant.id)) return writeAltFieldArrayLocal(extensions, altField, arr);
  const at = Math.max(0, Math.min(arr.length, index));
  const next = [...arr.slice(0, at), variant, ...arr.slice(at)];
  return writeAltFieldArrayLocal(extensions, altField, next);
}

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === ".") { i++; continue; }
    if (ch === "[") {
      const end = path.indexOf("]", i);
      if (end < 0) throw new Error(`unclosed bracket in path at index ${i}`);
      const inner = path.slice(i + 1, end);
      if (/^\d+$/.test(inner)) {
        segments.push({ kind: "index", value: parseInt(inner, 10) });
      } else if ((inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith('"') && inner.endsWith('"'))) {
        segments.push({ kind: "key", value: inner.slice(1, -1) });
      } else {
        throw new Error(`bracket contents must be a number or quoted string: [${inner}]`);
      }
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    const key = path.slice(i, j);
    if (key.length === 0) throw new Error(`empty key at index ${i}`);
    segments.push({ kind: "key", value: key });
    i = j;
  }
  return segments;
}

function setAtPath(root: unknown, segments: readonly PathSegment[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  if (head!.kind === "index") {
    const arr = Array.isArray(root) ? [...root] : [];
    arr[head!.value] = setAtPath(arr[head!.value], rest, value);
    return arr;
  }
  const obj = (root && typeof root === "object" && !Array.isArray(root)) ? { ...(root as Record<string, unknown>) } : {};
  obj[head!.value] = setAtPath(obj[head!.value], rest, value);
  return obj;
}

export async function revertEdit(
  spindle: SpindleAPI,
  entry: EditLogEntry,
  characterId: string,
  userId: string,
): Promise<RevertResult> {
  const r = entry.record;
  try {
    if (r.op === "edit" && r.surface === "external") {
      // External provider revert routes through the owning extension's phone
      // line. Branch sits before the EditEdit one since EditEdit excludes
      // surface === "external" via the type union.
      const { dialWriteField } = await import("../phoneline/transport");
      const beforeValue = parseExternalValue(r.before);
      const res = await dialWriteField(spindle, r.providerId, {
        userId,
        surfaceId: r.externalSurfaceId,
        itemId: r.itemId,
        field: r.field,
        value: beforeValue,
      });
      if (res.ok) return { success: true };
      return { success: false, error: res.error ?? "write failed" };
    }
    // op:edit non-external records are reverted by revertFieldEditV2 through
    // the patch stack. revertEdit only handles op:create / op:delete (and the
    // op:edit + surface:external branch above). The previous per-surface
    // op:edit switch here was dead code that drifted out of sync with V2.
    if (r.op === "create") {
      if (r.surface === "world_book_entry") {
        await spindle.world_books.entries.delete(r.surfaceId, userId);
        return { success: true };
      }
      if (r.surface === "regex_script") {
        await spindle.regex_scripts.delete(r.surfaceId, userId);
        return { success: true };
      }
      if (r.surface === "alternate_greeting") {
        const c = await spindle.characters.get(characterId, userId);
        if (!c) return { success: false, error: "character not found" };
        const arr = [...(c.alternate_greetings ?? [])];
        // surfaceId is the index at create-time. If greetings have been added
        // or removed before that index since, the position has shifted and a
        // raw splice would silently remove the wrong entry. Find the snapshot
        // content first; fall back to the index only if the original isn't
        // matchable (e.g., it was edited after create).
        const snap = r.snapshot as { greeting: string };
        const storedIdx = parseInt(r.surfaceId, 10);
        let idx = arr.indexOf(snap.greeting);
        if (idx < 0) idx = storedIdx;
        if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
        await spindle.characters.update(characterId, { alternate_greetings: arr }, userId);
        return { success: true };
      }
      if (r.surface === "alternate_field_variant") {
        const snap = r.snapshot as AlternateFieldVariantSnapshot;
        const c = await spindle.characters.get(characterId, userId);
        if (!c) return { success: false, error: "character not found" };
        const nextExt = removeVariantById(c.extensions, snap.altField, snap.variant.id);
        await spindle.characters.update(characterId, { extensions: nextExt }, userId);
        return { success: true };
      }
      if (r.surface === "persona") {
        await spindle.personas.delete(r.surfaceId, userId);
        return { success: true };
      }
      if (r.surface === "world_book") {
        await spindle.world_books.delete(r.surfaceId, userId);
        return { success: true };
      }
      if (r.surface === "preset") {
        await spindle.presets.delete(r.surfaceId, userId);
        return { success: true };
      }
      if (r.surface === "preset_block") {
        const [presetId, blockId] = r.surfaceId.split(":");
        await spindle.presets.blocks.delete(presetId!, blockId!, userId);
        return { success: true };
      }
    } else if (r.op === "delete") {
      if (r.surface === "world_book_entry") {
        const snap = r.snapshot as WorldBookEntryDTO;
        await spindle.world_books.entries.create(snap.world_book_id, entryCreateFromDTO(snap), userId);
        return { success: true };
      }
      if (r.surface === "regex_script") {
        const snap = r.snapshot as RegexScriptDTO;
        await spindle.regex_scripts.create(regexCreateFromDTO(snap), userId);
        return { success: true };
      }
      if (r.surface === "alternate_greeting") {
        const snap = r.snapshot as { greeting: string; index: number };
        const c = await spindle.characters.get(characterId, userId);
        if (!c) return { success: false, error: "character not found" };
        const arr = [...(c.alternate_greetings ?? [])];
        // Idempotent: if the user manually re-added the same greeting after
        // the original delete, don't splice a second copy in.
        if (arr.includes(snap.greeting)) return { success: true };
        const target = Math.max(0, Math.min(arr.length, snap.index));
        arr.splice(target, 0, snap.greeting);
        await spindle.characters.update(characterId, { alternate_greetings: arr }, userId);
        return { success: true };
      }
      if (r.surface === "alternate_field_variant") {
        const snap = r.snapshot as AlternateFieldVariantSnapshot;
        const c = await spindle.characters.get(characterId, userId);
        if (!c) return { success: false, error: "character not found" };
        const nextExt = insertVariant(c.extensions, snap.altField, snap.variant, snap.index);
        await spindle.characters.update(characterId, { extensions: nextExt }, userId);
        return { success: true };
      }
      if (r.surface === "persona") {
        await spindle.personas.create(personaCreateFromDTO(r.snapshot as PersonaDTO), userId);
        return { success: true };
      }
      if (r.surface === "world_book") {
        // Book delete cascades its entries, so the snapshot carries both.
        // The recreated book gets a fresh id; any character world_book_ids
        // pointing at the old id stay stale (same caveat as persona revert).
        const snap = r.snapshot as WorldBookSnapshot;
        const book = await spindle.world_books.create(worldBookCreateFromDTO(snap.book), userId);
        for (const e of snap.entries) {
          await spindle.world_books.entries.create(book.id, entryCreateFromDTO(e), userId);
        }
        return { success: true };
      }
      if (r.surface === "preset") {
        const snap = r.snapshot as PresetSnapshot;
        const preset = await spindle.presets.create(presetCreateFromDTO(snap.preset), userId);
        for (let i = 0; i < snap.blocks.length; i++) {
          await spindle.presets.blocks.create(preset.id, blockCreateFromDTO(snap.blocks[i]!), { index: i, userId });
        }
        return { success: true };
      }
      if (r.surface === "preset_block") {
        const snap = r.snapshot as PromptBlockDTO & { __presetId: string; __index: number };
        await spindle.presets.blocks.create(snap.__presetId, blockCreateFromDTO(snap), { index: snap.__index, userId });
        return { success: true };
      }
    }
    return { success: false, error: `unsupported revert op for ${r.op}/${(r as { surface?: string }).surface ?? "?"}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function getAtPath(obj: unknown, segments: readonly PathSegment[]): unknown {
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (seg.kind === "key") {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg.value];
    } else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.value];
    }
  }
  return cur;
}

export async function readLiveValue(
  spindle: SpindleAPI,
  entry: EditLogEntry,
  characterId: string,
  userId: string,
): Promise<string | null> {
  const r = entry.record;
  if (r.op !== "edit") return null;
  // External surfaces: the owning extension owns its own concurrency model.
  if (r.surface === "external") return null;
  switch (r.surface) {
    case "character_field": {
      const c = await spindle.characters.get(characterId, userId);
      if (!c) return null;
      const v = (c as unknown as Record<string, unknown>)[r.field];
      return typeof v === "string" ? v : null;
    }
    case "alternate_greeting": {
      const idx = parseInt(r.field, 10);
      const c = await spindle.characters.get(characterId, userId);
      if (!c) return null;
      const arr = c.alternate_greetings ?? [];
      if (idx < 0 || idx >= arr.length) return null;
      return arr[idx] ?? null;
    }
    case "world_book_entry": {
      const e = await spindle.world_books.entries.get(r.surfaceId, userId);
      if (!e) return null;
      const v = (e as unknown as Record<string, unknown>)[r.field];
      return typeof v === "string" ? v : null;
    }
    case "regex_script": {
      const s = await spindle.regex_scripts.get(r.surfaceId, userId);
      if (!s) return null;
      const v = (s as unknown as Record<string, unknown>)[r.field];
      return typeof v === "string" ? v : null;
    }
    case "persona_field": {
      const p = await spindle.personas.get(r.surfaceId, userId);
      if (!p) return null;
      const v = (p as unknown as Record<string, unknown>)[r.field];
      return typeof v === "string" ? v : null;
    }
    case "chat_message": {
      const [chatId, mid] = r.surfaceId.split(":");
      const msgs = await spindle.chat.getMessages(chatId!);
      const m = msgs.find((x) => x.id === mid);
      return m ? m.content : null;
    }
    case "extension": {
      const c = await spindle.characters.get(characterId, userId);
      if (!c) return null;
      const segs = parsePath(r.field);
      const v = getAtPath(c.extensions ?? {}, segs);
      if (r.valueEncoding === "json") {
        return JSON.stringify(v === undefined ? null : v);
      }
      return typeof v === "string" ? v : null;
    }
    case "preset_block": {
      const [presetId, blockId] = r.surfaceId.split(":");
      const b = await spindle.presets.blocks.get(presetId!, blockId!, userId);
      if (!b) return null;
      const v = (b as unknown as Record<string, unknown>)[r.field];
      return typeof v === "string" ? v : null;
    }
    case "world_book": {
      const b = await spindle.world_books.get(r.surfaceId, userId);
      if (!b) return null;
      return encodeScalar(r.field, (b as unknown as Record<string, unknown>)[r.field]);
    }
    case "preset": {
      const p = await spindle.presets.get(r.surfaceId, userId);
      if (!p) return null;
      return encodeScalar(r.field, (p as unknown as Record<string, unknown>)[r.field]);
    }
    case "persona": {
      const p = await spindle.personas.get(r.surfaceId, userId);
      if (!p) return null;
      return encodeScalar(r.field, (p as unknown as Record<string, unknown>)[r.field]);
    }
    default:
      return null;
  }
}

// Revert via the v2 patch-stack path for field edits. Looks up the (file,
// patch) in the ledger, fetches live value to detect external drift, then
// calls tryRevert. On success writes the recomputed value back to the
// spindle. Cascade-reverted patches (later patches that no longer apply
// without the target) are reported back to the UI.
async function revertFieldEditV2(
  spindle: SpindleAPI,
  ledger: ScopedLedger,
  editId: string,
  characterId: string,
  userId: string,
  force: boolean,
): Promise<RevertOutcomeWire> {
  const located = findPatch(ledger, editId);
  if (!located) return { kind: "failed", editId, error: "patch not found in ledger" };
  const { file, patch } = located;
  if (patch.reverted) return { kind: "noop_already_reverted", editId };

  const entryView: EditLogEntry = {
    id: editId, ts: patch.ts, sessionId: patch.sessionId ?? "", scope: characterScope(characterId),
    toolCallId: patch.toolCallId ?? "", toolName: patch.toolName ?? patch.description,
    turn: patch.turn ?? 0, reverted: false,
    record: {
      op: "edit",
      surface: file.key.surface as Exclude<EditRecord["surface"], "external">,
      surfaceId: file.key.surfaceId, surfaceLabel: file.surfaceLabel,
      field: file.key.field, before: "", after: "",
      ...(file.valueEncoding !== undefined ? { valueEncoding: file.valueEncoding } : {}),
    },
  };
  const live = await readLiveValue(spindle, entryView, characterId, userId);
  if (live === null) return { kind: "failed", editId, error: "surface no longer exists" };

  // If the spindle value has drifted from our expected hash, an external edit
  // slipped in. Fold it in first so the timeline is honest, then proceed.
  // expectedSample captures what the agent thought was there BEFORE folding,
  // so the UI can show the user what changed externally.
  if (sha256(live) !== file.expectedHash) {
    const expected = currentValue(file) ?? file.base;
    const drift = recordExternalDrift(file, live);
    if (drift) await persistLedgerNow(spindle, ledger, userId);
    if (!force) {
      return {
        kind: "external_diverged",
        editId,
        currentSample: sample(live),
        expectedSample: sample(expected),
      };
    }
  }

  // Snapshot the file state so we can roll back cleanly if the spindle write
  // fails (tryRevert mutates patches[i].reverted + file.expectedHash in
  // place, and ledgerCache hands out the same FileState by reference).
  const savedPatches = file.patches.map((p) => ({ reverted: p.reverted, revertedAt: p.revertedAt }));
  const savedExpectedHash = file.expectedHash;

  const res = tryRevert(file, editId, live);
  if (res.kind === "noop") return { kind: "noop_already_reverted", editId };
  if (res.kind === "external_diverged") {
    // Concurrent-writer scenario: another caller mutated `file` after our
    // drift-fold above. Surface it so the UI can ask the user to retry.
    return {
      kind: "external_diverged", editId,
      currentSample: sample(live),
      expectedSample: sample(currentValue(file) ?? file.base),
    };
  }
  // Clean (possibly with cascade): write the recomputed value to the spindle,
  // persist the ledger so reverted flags + expectedHash survive.
  try {
    await writeFieldValue(spindle, file.key.surface, file.key.surfaceId, file.key.field, res.recomputed, characterId, userId, file.valueEncoding);
  } catch (err) {
    for (let i = 0; i < file.patches.length; i++) {
      const saved = savedPatches[i];
      const p = file.patches[i];
      if (!saved || !p) continue;
      p.reverted = saved.reverted;
      if (saved.revertedAt !== undefined) p.revertedAt = saved.revertedAt;
      else delete p.revertedAt;
    }
    file.expectedHash = savedExpectedHash;
    return { kind: "failed", editId, error: (err as Error).message };
  }
  // Reverts are permanent. Drop the target + every cascade collateral from
  // the patch stack so the ledger only carries live history.
  const removedIds = purgeRevertedPatches(file);
  await persistLedgerNow(spindle, ledger, userId);
  // res.cascaded may be a subset of removedIds (purge also drops any patches
  // that became reverted in earlier flows on the same file but weren't yet
  // purged). Surface the full removal set so the UI can splice mirror state.
  void removedIds;
  return res.cascaded.length > 0
    ? { kind: "clean", editId, cascadedEditIds: res.cascaded }
    : { kind: "clean", editId };
}

export async function writeFieldValue(
  spindle: SpindleAPI,
  surface: string,
  surfaceId: string,
  field: string,
  value: string,
  characterId: string,
  userId: string,
  valueEncoding?: "json",
): Promise<void> {
  switch (surface) {
    case "character_field": {
      await spindle.characters.update(characterId, { [field]: value } as CharacterUpdateDTO, userId);
      return;
    }
    case "alternate_greeting": {
      const idx = parseInt(field, 10);
      const c = await spindle.characters.get(characterId, userId);
      if (!c) throw new Error("character not found");
      const arr = [...(c.alternate_greetings ?? [])];
      if (idx < 0 || idx >= arr.length) throw new Error(`index ${idx} out of range`);
      arr[idx] = value;
      await spindle.characters.update(characterId, { alternate_greetings: arr }, userId);
      return;
    }
    case "world_book_entry": {
      await spindle.world_books.entries.update(surfaceId, { [field]: value } as WorldBookEntryUpdateDTO, userId);
      return;
    }
    case "regex_script": {
      await spindle.regex_scripts.update(surfaceId, { [field]: value } as RegexScriptUpdateDTO, userId);
      return;
    }
    case "persona_field": {
      await spindle.personas.update(surfaceId, { [field]: value } as PersonaUpdateDTO, userId);
      return;
    }
    case "chat_message": {
      const [chatId, mid] = surfaceId.split(":");
      await spindle.chat.updateMessage(chatId!, mid!, { content: value });
      return;
    }
    case "extension": {
      const c = await spindle.characters.get(characterId, userId);
      if (!c) throw new Error("character not found");
      const segs = parsePath(field);
      // valueEncoding="json" comes from setExtension / resolveWrite — decode
      // so non-string leaves (arrays, objects, etc.) round-trip on revert.
      const parsed: unknown = valueEncoding === "json" ? JSON.parse(value) : value;
      const next = setAtPath(c.extensions ?? {}, segs, parsed) as Record<string, unknown>;
      await spindle.characters.update(characterId, { extensions: next }, userId);
      return;
    }
    case "preset_block": {
      const [presetId, blockId] = surfaceId.split(":");
      await spindle.presets.blocks.update(presetId!, blockId!, { [field]: value }, userId);
      return;
    }
    case "world_book": {
      await spindle.world_books.update(surfaceId, { [field]: decodeScalar(field, value) } as WorldBookUpdateDTO, userId);
      return;
    }
    case "preset": {
      await spindle.presets.update(surfaceId, { [field]: decodeScalar(field, value) } as UserPresetUpdateDTO, userId);
      return;
    }
    case "persona": {
      await spindle.personas.update(surfaceId, personaScalarUpdate(field, decodeScalar(field, value)), userId);
      return;
    }
    default:
      throw new Error(`unsupported surface for write: ${surface}`);
  }
}

export async function revertEditWithCheck(
  spindle: SpindleAPI,
  ledger: ScopedLedger,
  editId: string,
  characterId: string,
  userId: string,
  force: boolean,
): Promise<RevertOutcomeWire> {
  // Field edit lives on the patch stack.
  if (findPatch(ledger, editId)) {
    return revertFieldEditV2(spindle, ledger, editId, characterId, userId, force);
  }
  // Structural (create/delete) and external edits keep the v1 revert path.
  const struct = findStructural(ledger, editId);
  if (struct) {
    const entry: EditLogEntry = {
      id: editId, ts: struct.ts, sessionId: struct.sessionId ?? "", scope: characterScope(characterId),
      toolCallId: struct.toolCallId ?? "", toolName: struct.op, turn: 0, reverted: false,
      record: struct.op === "create"
        ? { op: "create", surface: struct.surface, surfaceId: struct.surfaceId, surfaceLabel: struct.surfaceLabel, snapshot: struct.snapshot as never }
        : { op: "delete", surface: struct.surface, surfaceId: struct.surfaceId, surfaceLabel: struct.surfaceLabel, snapshot: struct.snapshot as never },
    };
    const res = await revertEdit(spindle, entry, characterId, userId);
    if (!res.success) return { kind: "failed", editId, error: res.error ?? "unknown" };
    purgeIdsInMemory(ledger, [editId]);
    await persistLedgerNow(spindle, ledger, userId);
    return { kind: "clean", editId };
  }
  const ext = findExternal(ledger, editId);
  if (ext) {
    const res = await revertEdit(spindle, ext, characterId, userId);
    if (!res.success) return { kind: "failed", editId, error: res.error ?? "unknown" };
    purgeIdsInMemory(ledger, [editId]);
    await persistLedgerNow(spindle, ledger, userId);
    return { kind: "clean", editId };
  }
  void force;
  return { kind: "failed", editId, error: "edit not found in character ledger" };
}

export type { CharacterDTO, WorldBookEntryDTO, RegexScriptDTO };
