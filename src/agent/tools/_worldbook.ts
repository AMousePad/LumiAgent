import type {
  PersonaDTO,
  PersonaUpdateDTO,
  WorldBookCreateDTO,
  WorldBookDTO,
  WorldBookEntryCreateDTO,
  WorldBookEntryDTO,
  WorldBookEntryUpdateDTO,
  WorldBookUpdateDTO,
} from "lumiverse-spindle-types";
import { type ToolCtx, resolveCharacterTarget, noTargetResult } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { characterScope } from "../../types";
import { encodeScalar } from "../../state/edit-log";
import { updateChatMetadataKey } from "../../state/chat-global-vars";
import { characterPages, mapInBatches } from "../../state/character-catalog";
import { wbLabel, coerceKeyList, WB_ENTRY_WRITABLE_FIELDS } from "./_surfaces";
import { listAllWorldBooks } from "./_path_v2";
import { recordChange } from "./_change-history";
import { matchesName, searchPage } from "./_name-search";

type ToolOut = { content: string; isError?: boolean };
type Fields = Record<string, unknown>;
export type AttachScope = "character" | "chat" | "global" | "persona";

const PAGE = 200;
const PEEK_CHARS = 200;
const TOP_N = 10;
const ROW_DETAIL_LIMIT = 60;
const ROW_LIMIT = 300;
const FILLED_PATCH_KEYS = 12;

const BOOL_FIELDS: ReadonlySet<string> = new Set([
  "selective", "constant", "disabled", "group_override", "case_sensitive", "match_whole_words",
  "use_regex", "prevent_recursion", "exclude_recursion", "delay_until_recursion", "use_probability", "vectorized",
]);
const INT_FIELDS: ReadonlySet<string> = new Set([
  "position", "depth", "order_value", "group_weight", "probability", "scan_depth",
  "priority", "sticky", "cooldown", "delay", "selective_logic",
]);
const TEXT_FIELDS: ReadonlySet<string> = new Set(["content", "comment", "group_name"]);
const NULLABLE_TEXT_FIELDS: ReadonlySet<string> = new Set(["role", "automation_id", "outlet_name"]);
const KEY_FIELDS: ReadonlySet<string> = new Set(["key", "keysecondary"]);
const ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant"]);
// Always-string fields keep the raw ledger encoding that edit, rewrite and earlier writes used, so history is not rebased.
const RAW_LEDGER_FIELDS: ReadonlySet<string> = new Set(["content", "comment", "group_name"]);
// The entry DTO never returns these, so a write to them cannot be compared.
const UNREADABLE_FIELDS: ReadonlySet<string> = new Set(["outlet_name"]);
// What update writes for a field named in clear. An empty value in patch never clears, a model may only be filling the schema.
const CLEAR_VALUES: Readonly<Record<string, unknown>> = {
  keysecondary: [], comment: "", group_name: "", role: null, scan_depth: null, automation_id: null, outlet_name: null,
};
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  keys: "key", keywords: "key", secondary_keys: "keysecondary", secondary_key: "keysecondary", key_secondary: "keysecondary",
  name: "comment", title: "comment", order: "order_value", insertion_order: "order_value",
};
const ENTRY_IDENTITY_KEYS: ReadonlySet<string> = new Set(["id", "world_book_id", "uid", "created_at", "updated_at", "revision"]);
const BOOK_FIELDS = ["name", "description", "metadata"] as const;
const BOOK_READ_ONLY: ReadonlySet<string> = new Set(["id", "created_at", "updated_at"]);
const BOOK_CREATE_KEYS: ReadonlySet<string> = new Set(["name", "description", "metadata", "copy_of", "entries", "attach", "target_id"]);
// These tie a book to the card it was imported from, so a copy carrying them would be deleted or overwritten with that card.
const BOOK_IDENTITY_METADATA: ReadonlySet<string> = new Set(["auto_managed_by_character", "source_character_id"]);
const ATTACH_SCOPES: ReadonlySet<string> = new Set(["character", "chat", "global", "persona"]);
const HOST_GAP_NOTE = "Entry folder, tags, outlet name and marker pin are not exposed to extensions, so the copies do not carry them.";

export const WB_POSITION_ENUM = "position: 0 World Info Before slot, 1 World Info After slot, 2 before author note, 3 after author note, 4 at depth (uses depth), 5 before examples, 6 after examples, 7 at marker, 8 outlet only";
export const WB_LOGIC_ENUM = "selective_logic (needs selective true and secondary keys): 0 AND all secondary keys match, 1 NOT any (none may match), 2 OR any one matches, 3 NOT all (at least one missing)";

const fail = (code: string, message: string): ToolOut => ({ content: `Error: [${code}] ${message}`, isError: true });
const isOut = (v: unknown): v is ToolOut => !!v && typeof v === "object" && "content" in (v as object) && !("id" in (v as object));
const errorText = (out: ToolOut): string => out.content.replace(/^Error: /, "");

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseJsonish(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return v;
  try { return JSON.parse(s); } catch { return v; }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function short(v: unknown, max = 80): string {
  const s = JSON.stringify(v ?? null);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function fieldOf(e: WorldBookEntryDTO, field: string): unknown {
  return (e as unknown as Record<string, unknown>)[field];
}

function fieldScope(ctx: ToolCtx, bookId: string): ScopeRef {
  return ctx.characterId ? characterScope(ctx.characterId) : { kind: "world_book", id: bookId };
}

function structuralScope(ctx: ToolCtx, bookId: string): { scope?: ScopeRef } {
  return ctx.characterId ? {} : { scope: { kind: "world_book", id: bookId } };
}

// ---------- lookup

export async function listAllEntries(ctx: ToolCtx, bookId: string): Promise<WorldBookEntryDTO[]> {
  const out: WorldBookEntryDTO[] = [];
  let offset = 0;
  for (;;) {
    ctx.signal.throwIfAborted();
    const page = await ctx.spindle.world_books.entries.list(bookId, { limit: PAGE, offset, userId: ctx.userId });
    out.push(...page.data);
    offset += page.data.length;
    if (page.data.length === 0 || out.length >= page.total) break;
  }
  return out;
}

// Accepts a book id, a wb/<id> path, or a name (exact, then unique substring).
export async function findWorldBook(ctx: ToolCtx, ref: unknown): Promise<WorldBookDTO | ToolOut> {
  if (typeof ref !== "string" || ref.trim().length === 0) return fail("INVALID_INPUT", "expected a world book id or name");
  const raw = ref.trim().replace(/^(?:wb|world_books?)\//, "");
  const direct = await ctx.spindle.world_books.get(raw, ctx.userId).catch(() => null);
  if (direct) return direct;
  const all = await listAllWorldBooks(ctx);
  const want = norm(raw);
  let hits = all.filter((b) => b.id === raw || norm(b.name) === want);
  if (hits.length === 0) hits = all.filter((b) => norm(b.name).includes(want));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    return fail("AMBIGUOUS", `'${raw}' matches ${hits.length} world books: ${hits.slice(0, 20).map((b) => `${JSON.stringify(b.name)} (wb/${b.id})`).join(", ")}. Pass one id.`);
  }
  const entry = await ctx.spindle.world_books.entries.get(raw, ctx.userId).catch(() => null);
  if (entry) {
    const parent = all.find((b) => b.id === entry.world_book_id);
    return fail("PATH_NOT_FOUND", `${raw} is an entry (${JSON.stringify(wbLabel(entry))}) in world book ${JSON.stringify(parent?.name ?? "")} (wb/${entry.world_book_id}), not a book. Its settings: inspect({path:"wb/${raw}"}). That book's entries: list({path:"wb/${entry.world_book_id}"}).`);
  }
  return fail("PATH_NOT_FOUND", `no world book matches '${raw}' among ${all.length} owned books. Search by name with list({path:"wb", query:"<part of the name>"}).`);
}

// ---------- field normalization

function canonicalField(name: string): { field: string; invert: boolean } | null {
  if (WB_ENTRY_WRITABLE_FIELDS.has(name)) return { field: name, invert: false };
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (snake === "enabled") return { field: "disabled", invert: true };
  if (WB_ENTRY_WRITABLE_FIELDS.has(snake)) return { field: snake, invert: false };
  const alias = FIELD_ALIASES[snake];
  return alias ? { field: alias, invert: false } : null;
}

function coerceValue(field: string, raw: unknown, invert: boolean): { value: unknown } | { error: string } {
  if (KEY_FIELDS.has(field)) {
    if (raw === null) return { value: [] };
    if (typeof raw === "string" || Array.isArray(raw)) return { value: coerceKeyList(raw) };
    return { error: `${field} expects an array of strings, got ${short(raw, 40)}` };
  }
  if (BOOL_FIELDS.has(field)) {
    let b: boolean | null = null;
    if (typeof raw === "boolean") b = raw;
    else if (typeof raw === "string" && /^(true|false)$/i.test(raw.trim())) b = raw.trim().toLowerCase() === "true";
    else if (raw === 1 || raw === 0) b = raw === 1;
    if (b === null) return { error: `${invert ? "enabled" : field} expects true or false, got ${short(raw, 40)}` };
    return { value: invert ? !b : b };
  }
  if (INT_FIELDS.has(field)) {
    if (raw === null && field === "scan_depth") return { value: null };
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    if (!Number.isInteger(n)) return { error: `${field} expects an integer${field === "scan_depth" ? " or null" : ""}, got ${short(raw, 40)}` };
    return { value: n };
  }
  if (TEXT_FIELDS.has(field)) {
    if (typeof raw === "string") return { value: raw };
    if (typeof raw === "number") return { value: String(raw) };
    if (raw === null && field !== "content") return { value: "" };
    return { error: `${field} expects a string, got ${short(raw, 40)}` };
  }
  if (NULLABLE_TEXT_FIELDS.has(field)) {
    if (raw === null || raw === "") return { value: null };
    if (typeof raw !== "string") return { error: `${field} expects a string or null, got ${short(raw, 40)}` };
    if (field !== "role") return { value: raw };
    const role = raw.trim().toLowerCase();
    return ROLES.has(role) ? { value: role } : { error: `role expects system, user, assistant or null, got ${short(raw, 40)}` };
  }
  if (field === "extensions") {
    const obj = parseJsonish(raw);
    return isRecord(obj) ? { value: obj } : { error: "extensions expects an object" };
  }
  return { error: `${field} is not writable` };
}

interface Normalized { fields: Fields; ignored: string[]; errors: string[]; dropped: string[] }

// placeholders: an update patch treats every empty value as "not set".
function normalizeFields(raw: Record<string, unknown>, control: ReadonlySet<string>, placeholders: boolean): Normalized {
  const out: Normalized = { fields: {}, ignored: [], errors: [], dropped: [] };
  for (const [name, value] of Object.entries(raw)) {
    if (control.has(name) || value === undefined) continue;
    const canon = canonicalField(name);
    if (!canon) { out.ignored.push(name); continue; }
    const { field, invert } = canon;
    if (placeholders) {
      const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);
      if (empty) { out.dropped.push(field); continue; }
    }
    const coerced = coerceValue(field, value, invert);
    if ("error" in coerced) out.errors.push(coerced.error);
    else out.fields[field] = coerced.value;
  }
  return out;
}

function toCreateInput(fields: Fields): WorldBookEntryCreateDTO {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) out[k] = v;
  return out as WorldBookEntryCreateDTO;
}

function createFieldsFromEntry(e: WorldBookEntryDTO): Fields {
  const out: Fields = {};
  for (const f of WB_ENTRY_WRITABLE_FIELDS) {
    const v = fieldOf(e, f);
    if (v !== undefined && v !== null) out[f] = structuredClone(v);
  }
  return out;
}

// ---------- reporting

export interface WbRow {
  path: string;
  type: string;
  label?: string;
  size?: number;
  entries?: number;
  attached?: boolean;
  global?: boolean;
  keys?: string[];
  secondary_keys?: string[];
  constant?: true;
  disabled?: true;
  position?: number;
  depth?: number;
  order_value?: number;
  selective?: true;
  selective_logic?: number;
  group_name?: string;
  role?: string;
  probability?: number;
  vectorized?: true;
}

function nonDefaultSettings(e: WorldBookEntryDTO): Partial<WbRow> {
  const out: Partial<WbRow> = {};
  if (e.constant) out.constant = true;
  if (e.disabled) out.disabled = true;
  if (e.position !== 0) out.position = e.position;
  if (e.position === 4) out.depth = e.depth;
  if (e.order_value !== 100) out.order_value = e.order_value;
  if (e.selective) out.selective = true;
  if (e.selective_logic !== 0) out.selective_logic = e.selective_logic;
  if (e.group_name) out.group_name = e.group_name;
  if (e.role) out.role = e.role;
  if (e.use_probability && e.probability < 100) out.probability = e.probability;
  if (e.vectorized) out.vectorized = true;
  return out;
}

function landedRow(e: WorldBookEntryDTO): Record<string, unknown> {
  const extra = nonDefaultSettings(e);
  return {
    entry_id: e.id, label: wbLabel(e), key: e.key ?? [], keysecondary: e.keysecondary ?? [],
    position: e.position, depth: e.depth, order_value: e.order_value,
    constant: e.constant, disabled: e.disabled, selective: e.selective,
    ...(extra.selective_logic !== undefined ? { selective_logic: extra.selective_logic } : {}),
    ...(extra.group_name ? { group_name: extra.group_name } : {}),
    ...(extra.role ? { role: extra.role } : {}),
    ...(extra.probability !== undefined ? { probability: extra.probability } : {}),
    ...(extra.vectorized ? { vectorized: true } : {}),
    content_chars: (e.content ?? "").length,
  };
}

function compactRow(e: WorldBookEntryDTO, detail: boolean): Record<string, unknown> {
  if (!detail) return { entry_id: e.id, label: wbLabel(e) };
  return { entry_id: e.id, label: wbLabel(e), ...(e.key?.length ? { key: e.key } : {}), ...nonDefaultSettings(e) };
}

// touched limits each rule to writes that involved it. null checks every rule.
function effectNotes(e: WorldBookEntryDTO, touched: ReadonlySet<string> | null): string[] {
  const hit = (...fields: string[]) => touched === null || fields.some((f) => touched.has(f));
  const notes: string[] = [];
  if (hit("keysecondary", "selective", "selective_logic") && (e.keysecondary ?? []).length > 0 && !e.selective) {
    notes.push("secondary keys are ignored while selective is false");
  }
  if (hit("probability", "use_probability") && e.probability < 100 && !e.use_probability) {
    notes.push(`probability ${e.probability} is ignored while use_probability is false`);
  }
  if (touched !== null && touched.has("depth") && e.position !== 4) {
    notes.push(`depth ${e.depth} only applies at position 4, this entry is at position ${e.position}`);
  }
  if (hit("position") && (e.position < 0 || e.position > 8)) {
    notes.push(`position ${e.position} is not a known slot (0 to 8), the host treats it as 0`);
  }
  if (hit("key", "constant", "vectorized") && (e.key ?? []).length === 0 && !e.constant && !e.vectorized) {
    notes.push("no key and not constant or vectorized, so it never activates");
  }
  return notes;
}

// A new entry is judged on every rule, since an omitted field is a choice too. Depth counts only when it was sent.
function newEntryTouched(sent: Fields): ReadonlySet<string> {
  return new Set([...Object.keys(sent), "key", "keysecondary", "selective", "constant", "vectorized", "probability", "use_probability", "position"]);
}

function tally(notes: Map<string, number>, items: readonly string[]): void {
  for (const n of items) notes.set(n, (notes.get(n) ?? 0) + 1);
}

function tallyText(notes: Map<string, number>, total: number): string[] {
  return [...notes].map(([text, n]) => (total > 1 ? `${n} of ${total} entries: ${text}.` : `This entry: ${text}.`));
}

// ---------- entry create, copy, move

async function createEntryRows(ctx: ToolCtx, bookId: string, inputs: readonly Fields[], record: boolean): Promise<{ created: WorldBookEntryDTO[]; failure: string | null }> {
  const created: WorldBookEntryDTO[] = [];
  for (let i = 0; i < inputs.length; i++) {
    ctx.signal.throwIfAborted();
    try {
      const e = await ctx.spindle.world_books.entries.create(bookId, toCreateInput(inputs[i]!), ctx.userId);
      if (record) {
        ctx.pushEdit({
          op: "create", surface: "world_book_entry", surfaceId: e.id, surfaceLabel: wbLabel(e), snapshot: e,
          ...structuralScope(ctx, bookId),
        } satisfies EditRecord);
      }
      created.push(e);
    } catch (err) {
      return { created, failure: `entry ${i + 1} of ${inputs.length}: ${(err as Error).message}` };
    }
  }
  return { created, failure: null };
}

function validateNewEntries(items: readonly unknown[]): { inputs: Fields[]; ignored: string[] } | ToolOut {
  const inputs: Fields[] = [];
  const ignored = new Set<string>();
  const errors: string[] = [];
  items.forEach((item, i) => {
    const at = items.length > 1 ? `entries[${i}]: ` : "";
    const obj = parseJsonish(item);
    if (!isRecord(obj)) { errors.push(`${at}expected an object of entry fields`); return; }
    const n = normalizeFields(obj, new Set(), false);
    for (const k of n.ignored) ignored.add(k);
    for (const e of n.errors) errors.push(`${at}${e}`);
    if (typeof n.fields["content"] !== "string") errors.push(`${at}entry requires content (a string)`);
    inputs.push(n.fields);
  });
  if (errors.length > 0) {
    return fail("INVALID_INPUT", `${errors.slice(0, 10).join(". ")}${errors.length > 10 ? `. And ${errors.length - 10} more` : ""}. Nothing was created.`);
  }
  return { inputs, ignored: [...ignored] };
}

// The host defaults every entry to order 100 and breaks ties on a random id, so a batch needs explicit values to keep its order.
function assignOrder(inputs: Fields[], start: number): string | null {
  if (inputs.length < 2) return null;
  let next = start;
  let assigned = 0;
  for (const input of inputs) {
    if (input["order_value"] === undefined) { input["order_value"] = next; assigned++; }
    next = Math.max(next, Number(input["order_value"])) + 1;
  }
  return assigned > 0 ? `order_value was assigned from ${start} upward in the given order for ${assigned} entries that omitted it.` : null;
}

async function resolveCopySources(ctx: ToolCtx, copyOf: unknown): Promise<WorldBookEntryDTO[] | ToolOut> {
  const refs = Array.isArray(copyOf) ? copyOf : [copyOf];
  const sources: WorldBookEntryDTO[] = [];
  const seen = new Set<string>();
  const add = (e: WorldBookEntryDTO) => { if (!seen.has(e.id)) { seen.add(e.id); sources.push(e); } };
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.trim().length === 0) return fail("INVALID_INPUT", "copy_of takes an entry id, an array of entry ids, or a book id to copy all of its entries");
    const id = ref.trim().replace(/^(?:wb|world_book_entry)\//, "").replace(/\/(?:content|comment)$/, "");
    const entry = await ctx.spindle.world_books.entries.get(id, ctx.userId).catch(() => null);
    if (entry) { add(entry); continue; }
    const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
    if (!book) return fail("PATH_NOT_FOUND", `copy_of: no entry or world book with id ${id}. Entry ids come from list({path:"wb/<bookId>"}).`);
    for (const e of await listAllEntries(ctx, book.id)) add(e);
  }
  if (sources.length === 0) return fail("INVALID_INPUT", "copy_of resolved to no entries");
  return sources;
}

function droppedFields(sources: readonly WorldBookEntryDTO[], created: readonly WorldBookEntryDTO[], overridden: ReadonlySet<string>): string | null {
  const counts = new Map<string, number>();
  created.forEach((made, i) => {
    const src = sources[i];
    if (!src) return;
    for (const k of Object.keys(src)) {
      if (ENTRY_IDENTITY_KEYS.has(k) || overridden.has(k)) continue;
      if (!same(fieldOf(src, k), fieldOf(made, k))) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  });
  if (counts.size === 0) return null;
  return `The host did not carry over: ${[...counts].map(([k, n]) => `${k} (${n} ${n === 1 ? "entry" : "entries"})`).join(", ")}.`;
}

export async function createWorldBookEntries(ctx: ToolCtx, bookRef: string, rawValue: unknown): Promise<ToolOut> {
  const book = await findWorldBook(ctx, bookRef);
  if (isOut(book)) return book;
  const value = parseJsonish(rawValue);
  const notes: string[] = [];
  const effects = new Map<string, number>();

  if (isRecord(value) && value["copy_of"] !== undefined) {
    const sources = await resolveCopySources(ctx, value["copy_of"]);
    if (isOut(sources)) return sources;
    const move = value["move"] === true || value["move"] === "true";
    const n = normalizeFields(value, new Set(["copy_of", "move"]), false);
    if (n.errors.length > 0) return fail("INVALID_INPUT", `${n.errors.join(". ")}. Nothing was created.`);
    const ignored = [...n.ignored];
    if (sources.length > 1) {
      for (const k of ["content", "comment"]) if (k in n.fields) { delete n.fields[k]; ignored.push(k); }
    }
    if (move) {
      const here = sources.filter((s) => s.world_book_id === book.id);
      if (here.length > 0) return fail("INVALID_INPUT", `move: ${here.length} of the ${sources.length} source entries are already in ${JSON.stringify(book.name)}. Drop move to duplicate them, or leave them out.`);
    }
    const inputs = sources.map((s) => {
      const fields = createFieldsFromEntry(s);
      for (const [k, v] of Object.entries(n.fields)) { if (v === null) delete fields[k]; else fields[k] = v; }
      return fields;
    });
    const { created, failure } = await createEntryRows(ctx, book.id, inputs, true);
    if (created.length === 0) return fail("SPINDLE_ERROR", failure ?? "nothing was created");
    const touched = new Set(Object.keys(n.fields));
    for (const e of created) tally(effects, effectNotes(e, touched));

    let moved = 0;
    const stuck: string[] = [];
    if (move && !failure) {
      for (const src of sources) {
        ctx.signal.throwIfAborted();
        try {
          await ctx.spindle.world_books.entries.delete(src.id, ctx.userId);
          ctx.pushEdit({
            op: "delete", surface: "world_book_entry", surfaceId: src.id, surfaceLabel: wbLabel(src), snapshot: src,
            ...structuralScope(ctx, src.world_book_id),
          } satisfies EditRecord);
          moved++;
        } catch (err) {
          stuck.push(`${wbLabel(src)} (${src.id}): ${(err as Error).message}`);
        }
      }
    }
    if (failure) notes.push(`Stopped after ${created.length} of ${inputs.length}: ${failure}. The copies made so far are kept and revertable.${move ? " No source was deleted." : ""}`);
    if (stuck.length > 0) notes.push(`${stuck.length} sources were copied but could not be deleted: ${stuck.slice(0, 5).join(", ")}.`);
    if (ignored.length > 0) notes.push(`Ignored value fields: ${ignored.join(", ")}.`);
    const dropped = droppedFields(sources, created, touched);
    if (dropped) notes.push(dropped);
    else if (!failure) notes.push("Each copy was compared with its source after the write: text, keys and settings match, so no read or inspect is needed to verify.");
    notes.push(...tallyText(effects, created.length), HOST_GAP_NOTE);
    const isError = failure !== null || stuck.length > 0;
    if (sources.length === 1) {
      return {
        content: JSON.stringify({
          ...landedRow(created[0]!), world_book_id: book.id, world_book: book.name,
          copied_from: sources[0]!.id, ...(move ? { moved: moved === 1, source_deleted: moved === 1 } : {}),
          note: notes.join(" "),
        }, null, 2),
        ...(isError ? { isError: true } : {}),
      };
    }
    return {
      content: JSON.stringify({
        copied: created.length, of: sources.length, ...(move ? { moved, sources_deleted: moved } : {}),
        world_book_id: book.id, world_book: book.name,
        entries: created.slice(0, ROW_LIMIT).map((e) => compactRow(e, created.length <= ROW_DETAIL_LIMIT)),
        ...(created.length > ROW_LIMIT ? { entries_omitted: created.length - ROW_LIMIT } : {}),
        note: notes.join(" "),
      }, null, 2),
      ...(isError ? { isError: true } : {}),
    };
  }

  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (isRecord(value) && Array.isArray(value["entries"])) {
    items = value["entries"];
    const extra = Object.keys(value).filter((k) => k !== "entries");
    if (extra.length > 0) notes.push(`Ignored value fields beside entries: ${extra.join(", ")}.`);
  } else if (isRecord(value)) items = [value];
  else return fail("INVALID_INPUT", 'entry value must be an object { content, key?, ... }, an array of such objects, or { copy_of: "<entryId>" }');
  if (items.length === 0) return fail("INVALID_INPUT", "no entries given");

  const valid = validateNewEntries(items);
  if (isOut(valid)) return valid;
  if (valid.inputs.length > 1 && valid.inputs.some((f) => f["order_value"] === undefined)) {
    const existing = await listAllEntries(ctx, book.id);
    const start = existing.length > 0 ? Math.max(...existing.map((e) => e.order_value)) + 1 : 100;
    const orderNote = assignOrder(valid.inputs, start);
    if (orderNote) notes.push(orderNote);
  }
  const { created, failure } = await createEntryRows(ctx, book.id, valid.inputs, true);
  if (created.length === 0) return fail("SPINDLE_ERROR", failure ?? "nothing was created");
  if (failure) notes.push(`Stopped after ${created.length} of ${valid.inputs.length}: ${failure}. The created entries are kept and revertable.`);
  if (valid.ignored.length > 0) notes.push(`Ignored value fields: ${valid.ignored.join(", ")}. Valid: ${[...WB_ENTRY_WRITABLE_FIELDS].join(", ")}.`);
  const differs = new Map<string, number>();
  created.forEach((e, i) => {
    const sent = valid.inputs[i]!;
    tally(effects, effectNotes(e, newEntryTouched(sent)));
    tally(differs, Object.keys(sent).filter((k) => !UNREADABLE_FIELDS.has(k) && sent[k] !== null && !same(sent[k], fieldOf(e, k))));
  });
  if (differs.size > 0) notes.push(`The host stored a different value than sent for: ${[...differs.keys()].join(", ")}. The rows show what landed.`);
  notes.push(...tallyText(effects, created.length));
  const note = notes.length > 0 ? { note: notes.join(" ") } : {};
  if (valid.inputs.length === 1) {
    return { content: JSON.stringify({ ...landedRow(created[0]!), world_book_id: book.id, world_book: book.name, ...note }, null, 2) };
  }
  return {
    content: JSON.stringify({
      created: created.length, of: valid.inputs.length, world_book_id: book.id, world_book: book.name,
      entries: created.slice(0, ROW_LIMIT).map((e) => compactRow(e, created.length <= ROW_DETAIL_LIMIT)),
      ...(created.length > ROW_LIMIT ? { entries_omitted: created.length - ROW_LIMIT } : {}),
      ...note,
    }, null, 2),
    ...(failure ? { isError: true } : {}),
  };
}

// ---------- book create and duplicate

export async function createWorldBook(ctx: ToolCtx, rawValue: unknown): Promise<ToolOut> {
  const parsed = parseJsonish(rawValue);
  const v: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const ignored = Object.keys(v).filter((k) => !BOOK_CREATE_KEYS.has(k));
  const notes: string[] = [];

  let source: WorldBookDTO | null = null;
  if (v["copy_of"] !== undefined) {
    const found = await findWorldBook(ctx, v["copy_of"]);
    if (isOut(found)) return found;
    source = found;
  }
  const given = typeof v["name"] === "string" && v["name"].trim().length > 0 ? v["name"] : undefined;
  const name = given ?? (source ? `${source.name} (Copy)` : undefined);
  if (!name) return fail("INVALID_INPUT", 'world book requires value.name, or value.copy_of ("<book id or name>") to duplicate an existing book');
  if (v["attach"] !== undefined && (typeof v["attach"] !== "string" || !ATTACH_SCOPES.has(v["attach"]))) {
    return fail("INVALID_INPUT", `invalid attach ${short(v["attach"], 40)}. Valid: character, chat, global, persona. Nothing was created.`);
  }
  const metadataIn = v["metadata"] === undefined ? undefined : parseJsonish(v["metadata"]);
  if (metadataIn !== undefined && !isRecord(metadataIn)) return fail("INVALID_INPUT", "metadata expects an object. Nothing was created.");

  let extra: Fields[] = [];
  if (v["entries"] !== undefined) {
    const list = parseJsonish(v["entries"]);
    if (!Array.isArray(list)) return fail("INVALID_INPUT", "entries expects an array of entry objects { content, key?, ... }. Nothing was created.");
    const valid = validateNewEntries(list);
    if (isOut(valid)) return valid;
    extra = valid.inputs;
    if (valid.ignored.length > 0) notes.push(`Ignored entry fields: ${valid.ignored.join(", ")}.`);
  }
  const sourceEntries = source ? await listAllEntries(ctx, source.id) : [];

  const create: WorldBookCreateDTO = { name };
  if (source) {
    create.description = source.description ?? "";
    const kept: Record<string, unknown> = {};
    const skipped: string[] = [];
    for (const [k, val] of Object.entries(structuredClone(source.metadata ?? {}))) {
      if (BOOK_IDENTITY_METADATA.has(k) || k.startsWith("_lumiverse_")) skipped.push(k);
      else kept[k] = val;
    }
    if (Object.keys(kept).length > 0) create.metadata = kept;
    if (skipped.length > 0) notes.push(`Metadata keys that bind the source to its origin were not copied: ${skipped.join(", ")}.`);
  }
  if (typeof v["description"] === "string") create.description = v["description"];
  if (metadataIn) create.metadata = { ...(create.metadata ?? {}), ...metadataIn };

  const book = await ctx.spindle.world_books.create(create, ctx.userId);
  const inputs = [...sourceEntries.map(createFieldsFromEntry), ...extra];
  const orderStart = sourceEntries.length > 0 ? Math.max(...sourceEntries.map((e) => e.order_value)) + 1 : 100;
  const orderNote = assignOrder(extra, orderStart);
  if (orderNote) notes.push(orderNote);
  let created: WorldBookEntryDTO[] = [];
  let failure: string | null = null;
  try {
    ({ created, failure } = await createEntryRows(ctx, book.id, inputs, false));
  } finally {
    ctx.pushEdit({
      op: "create", surface: "world_book", surfaceId: book.id, surfaceLabel: book.name,
      snapshot: { book, entries: created }, scope: { kind: "world_book", id: book.id },
    } satisfies EditRecord);
  }

  const out: Record<string, unknown> = { world_book_id: book.id, path: `wb/${book.id}`, name: book.name, entries: created.length };
  if (source) {
    out["copied_from"] = source.name;
    out["source_entries"] = sourceEntries.length;
    const dropped = droppedFields(sourceEntries, created, new Set());
    if (dropped) notes.push(dropped);
    if (sourceEntries.length > 0) notes.push(HOST_GAP_NOTE);
  }
  if (failure) notes.push(`Stopped after ${created.length} of ${inputs.length} entries: ${failure}. The book and the entries made so far are kept, and one revert removes them.`);
  if (extra.length > 0 && !failure) {
    const made = created.slice(sourceEntries.length);
    const effects = new Map<string, number>();
    made.forEach((e, i) => tally(effects, effectNotes(e, newEntryTouched(extra[i] ?? {}))));
    notes.push(...tallyText(effects, made.length));
    out["new_entries"] = made.slice(0, ROW_LIMIT).map((e) => compactRow(e, made.length <= ROW_DETAIL_LIMIT));
  }

  const attachedTo: string[] = [];
  if (typeof v["attach"] === "string") {
    const bound = await bindWorldBook(ctx, book.id, v["attach"] as AttachScope, "attach", typeof v["target_id"] === "string" ? v["target_id"] : undefined)
      .catch((err) => fail("SPINDLE_ERROR", (err as Error).message));
    if (isOut(bound)) out["attach_error"] = errorText(bound);
    else {
      attachedTo.push(bound.scope === "global" ? "global (every chat)" : `${bound.scope} ${bound.target ? `${JSON.stringify(bound.target)} ` : ""}(${bound.target_id})`);
      if (bound.replaced) notes.push(`It replaced ${JSON.stringify(bound.replaced.name)} (wb/${bound.replaced.id}) as that persona's book.`);
    }
  }
  out["attached_to"] = attachedTo;
  if (attachedTo.length === 0) {
    notes.push(`The book is not attached anywhere, so its entries never fire. Attach it with attach_world_book({world_book_id:"${book.id}", scope:"character"|"chat"|"global"|"persona"}).`);
  }
  if (ignored.length > 0) notes.push(`Ignored value fields: ${ignored.join(", ")}.`);
  if (notes.length > 0) out["note"] = notes.join(" ");
  return { content: JSON.stringify(out, null, 2), ...(failure ? { isError: true } : {}) };
}

// ---------- attach

interface BindResult {
  scope: AttachScope;
  target_id: string | null;
  target?: string;
  target_source?: string;
  changed: boolean;
  world_book_ids?: string[];
  replaced?: { id: string; name: string };
  note?: string;
}

// Returns the new list when the action changes it, else null.
function applyAction(current: string[], id: string, action: "attach" | "detach"): string[] | null {
  const has = current.includes(id);
  if (action === "attach") return has ? null : [...current, id];
  return has ? current.filter((x) => x !== id) : null;
}

async function bindWorldBook(ctx: ToolCtx, wbId: string, scope: AttachScope, action: "attach" | "detach", targetId?: string): Promise<BindResult | ToolOut> {
  if (scope === "character") {
    let target: string;
    try { target = resolveCharacterTarget(ctx, targetId); }
    catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
    const character = await ctx.spindle.characters.get(target, ctx.userId);
    if (!character) return fail("PATH_NOT_FOUND", `character '${target}' not found`);
    const current = (character.world_book_ids ?? []).filter((v): v is string => typeof v === "string");
    const next = applyAction(current, wbId, action);
    if (next) {
      await ctx.spindle.characters.update(target, { world_book_ids: next }, ctx.userId);
      ctx.pushEdit({ op: "edit", surface: "character_field", surfaceId: target, surfaceLabel: character.name, field: "world_book_ids", before: JSON.stringify(current), after: JSON.stringify(next), valueEncoding: "json", scope: { kind: "character", id: target } });
    }
    return { scope, target_id: target, target: character.name, changed: next !== null, world_book_ids: next ?? current };
  }

  if (scope === "chat") {
    let chatId = targetId ?? ctx.pinnedChatId ?? null;
    let source: string | undefined;
    if (!chatId) {
      const active = await ctx.spindle.chats.getActive(ctx.userId).catch(() => null);
      if (active) { chatId = active.id; source = "host active chat"; }
    }
    if (!chatId) return fail("NO_TARGET", "no target_id, no pinned chat and no chat open in the host. Pass target_id (a chat id).");
    const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
    if (!chat) return fail("PATH_NOT_FOUND", `chat '${chatId}' not found`);
    const idsOf = (raw: unknown) => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
    const current = idsOf((chat.metadata ?? {})["chat_world_book_ids"]);
    const written = await updateChatMetadataKey(ctx.spindle, chatId, "chat_world_book_ids", (raw) => applyAction(idsOf(raw), wbId, action) ?? undefined, ctx.userId);
    const next = written.changed ? idsOf(written.value) : null;
    if (next) recordChange(ctx, { kind: "chat", id: chatId }, "Chat lorebooks", "world_book_ids", current, next);
    const name = (chat as unknown as { name?: unknown }).name;
    return { scope, target_id: chatId, ...(typeof name === "string" && name ? { target: name } : {}), ...(source ? { target_source: source } : {}), changed: next !== null, world_book_ids: next ?? current };
  }

  if (scope === "persona") {
    let persona: PersonaDTO | null;
    let source: string | undefined;
    if (targetId) persona = await ctx.spindle.personas.get(targetId.replace(/^persona\//, ""), ctx.userId);
    else {
      persona = await ctx.spindle.personas.getActive(ctx.userId).catch(() => null);
      source = "active persona";
      if (!persona) { persona = await ctx.spindle.personas.getDefault(ctx.userId).catch(() => null); source = "default persona"; }
    }
    if (!persona) return fail(targetId ? "PATH_NOT_FOUND" : "NO_TARGET", targetId ? `persona '${targetId}' not found` : "no active or default persona. Pass target_id (a persona id).");
    const before = persona.attached_world_book_id ?? null;
    const nextId = action === "attach" ? wbId : before === wbId ? null : before;
    const base: BindResult = { scope, target_id: persona.id, target: persona.name, ...(source ? { target_source: source } : {}), changed: false, world_book_ids: before ? [before] : [] };
    if (nextId === before) {
      return action === "detach" && before ? { ...base, note: `That persona's book is wb/${before}, not this one. Nothing changed.` } : base;
    }
    // "" detaches host-side, the update DTO has no null.
    const updated = await ctx.spindle.personas.update(persona.id, { attached_world_book_id: nextId ?? "" } as PersonaUpdateDTO, ctx.userId);
    const landed = updated.attached_world_book_id ?? null;
    if (landed !== nextId) return fail("NOT_APPLIED", `the host kept persona ${JSON.stringify(persona.name)} on ${landed ? `wb/${landed}` : "no world book"}. Nothing changed.`);
    ctx.pushEdit({
      op: "edit", surface: "persona", surfaceId: persona.id, surfaceLabel: persona.name, field: "attached_world_book_id",
      before: encodeScalar("attached_world_book_id", before), after: encodeScalar("attached_world_book_id", nextId),
      scope: { kind: "persona", id: persona.id },
    } satisfies EditRecord);
    let replaced: { id: string; name: string } | undefined;
    if (action === "attach" && before) {
      const old = await ctx.spindle.world_books.get(before, ctx.userId).catch(() => null);
      replaced = { id: before, name: old?.name ?? "(deleted book)" };
    }
    return { ...base, changed: true, world_book_ids: nextId ? [nextId] : [], ...(replaced ? { replaced } : {}) };
  }

  const current = await ctx.spindle.world_books.getGlobal(ctx.userId);
  const has = current.includes(wbId);
  let next: string[] = current;
  let changed = false;
  if (action === "attach" && !has) { next = await ctx.spindle.world_books.activateGlobal(wbId, ctx.userId); changed = true; }
  else if (action === "detach" && has) { next = await ctx.spindle.world_books.deactivateGlobal(wbId, ctx.userId); changed = true; }
  if (changed) recordChange(ctx, { kind: "settings", id: "global-lorebooks" }, "Global lorebooks", "world_book_ids", current, next);
  return { scope, target_id: null, changed, world_book_ids: next };
}

export async function attachWorldBook(ctx: ToolCtx, input: { world_book_id: string; scope: AttachScope; action?: "attach" | "detach" | undefined; target_id?: string | undefined }): Promise<ToolOut> {
  const action = input.action ?? "attach";
  try {
    const found = await findWorldBook(ctx, input.world_book_id);
    let wbId: string;
    let name: string | undefined;
    if (isOut(found)) {
      // A deleted book can still be listed somewhere, so detach accepts an id that no longer resolves.
      if (action === "attach" || found.content.includes("[AMBIGUOUS]")) return found;
      wbId = input.world_book_id.trim().replace(/^(?:wb|world_books?)\//, "");
    } else { wbId = found.id; name = found.name; }
    const bound = await bindWorldBook(ctx, wbId, input.scope, action, input.target_id);
    if (isOut(bound)) return bound;
    const notes: string[] = [];
    if (bound.note) notes.push(bound.note);
    if (bound.replaced) notes.push(`A persona holds one book: this replaced ${JSON.stringify(bound.replaced.name)} (wb/${bound.replaced.id}).`);
    if (bound.target_source) notes.push(`No target_id was given, so the ${bound.target_source} was used.`);
    return {
      content: JSON.stringify({
        ok: true, scope: bound.scope, target_id: bound.target_id, ...(bound.target ? { target: bound.target } : {}),
        world_book_id: wbId, ...(name ? { world_book: name } : {}), action, changed: bound.changed,
        world_book_ids: bound.world_book_ids ?? [],
        ...(bound.replaced ? { replaced: bound.replaced } : {}),
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      }, null, 2),
    };
  } catch (err) {
    return { content: `Error: ${(err as Error).message}`, isError: true };
  }
}

// ---------- entry update

interface Change { field: string; before: unknown; after: unknown }
interface Applied { changed: Change[]; unchanged: string[]; notApplied: string[]; landed: WorldBookEntryDTO }

async function applyEntryFields(ctx: ToolCtx, before: WorldBookEntryDTO, fields: Fields): Promise<Applied> {
  const write: Fields = {};
  const unchanged: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!UNREADABLE_FIELDS.has(k) && same(v, fieldOf(before, k))) unchanged.push(k);
    else write[k] = v;
  }
  if (Object.keys(write).length === 0) return { changed: [], unchanged, notApplied: [], landed: before };
  const landed = await ctx.spindle.world_books.entries.update(before.id, write as WorldBookEntryUpdateDTO, ctx.userId);
  const changed: Change[] = [];
  const notApplied: string[] = [];
  for (const [k, v] of Object.entries(write)) {
    if (UNREADABLE_FIELDS.has(k)) { changed.push({ field: k, before: null, after: v }); continue; }
    const now = fieldOf(landed, k);
    if (same(now, fieldOf(before, k))) notApplied.push(k);
    else changed.push({ field: k, before: fieldOf(before, k), after: now });
  }
  return { changed, unchanged, notApplied, landed };
}

function ledgerValue(field: string, v: unknown): string {
  if (RAW_LEDGER_FIELDS.has(field)) return typeof v === "string" ? v : "";
  return JSON.stringify(v ?? null);
}

function entryEdit(ctx: ToolCtx, entry: WorldBookEntryDTO, c: Change): EditRecord {
  return {
    op: "edit", surface: "world_book_entry", surfaceId: entry.id, surfaceLabel: wbLabel(entry), field: c.field,
    before: ledgerValue(c.field, c.before), after: ledgerValue(c.field, c.after),
    ...(RAW_LEDGER_FIELDS.has(c.field) ? {} : { valueEncoding: "json" as const }),
    scope: fieldScope(ctx, entry.world_book_id),
  };
}

const changeText = (changes: readonly Change[]) => changes.map((c) => `${c.field}: ${short(c.before, 60)} -> ${short(c.after, 60)}`).join("; ");

function entryMatchesQuery(e: WorldBookEntryDTO, query: string): boolean {
  const hay = norm(`${e.comment ?? ""}\n${(e.key ?? []).join("\n")}\n${(e.keysecondary ?? []).join("\n")}\n${e.content ?? ""}`);
  return hay.includes(norm(query));
}

export interface UpdateEntriesInput {
  entry_id?: string | undefined;
  entry_ids?: readonly string[] | undefined;
  book_id?: string | undefined;
  query?: string | undefined;
  where?: Record<string, unknown> | undefined;
  patch?: Record<string, unknown> | undefined;
  clear?: readonly string[] | undefined;
}

export async function updateWorldBookEntries(ctx: ToolCtx, input: UpdateEntriesInput): Promise<ToolOut> {
  const rawPatch = input.patch ?? {};
  const n = normalizeFields(rawPatch, new Set(), true);
  if (n.ignored.length > 0) return fail("PATH_NOT_FOUND", `world book entry has no writable field(s): ${n.ignored.join(", ")}. Valid: ${[...WB_ENTRY_WRITABLE_FIELDS].join(", ")}. Nothing was written.`);
  if (n.errors.length > 0) return fail("INVALID_VALUE_TYPE", `${n.errors.join(". ")}. Nothing was written.`);
  const cleared = new Set<string>();
  for (const name of input.clear ?? []) {
    const field = canonicalField(name)?.field ?? name;
    if (!Object.hasOwn(CLEAR_VALUES, field)) {
      return fail("INVALID_INPUT", `'${name}' cannot be cleared here. Clearable: ${Object.keys(CLEAR_VALUES).join(", ")}. key and content change through set and rewrite on wb/<entryId>/<field>. Nothing was written.`);
    }
    n.fields[field] = CLEAR_VALUES[field];
    cleared.add(field);
  }
  // A patch that fills most of the schema is filler throughout, so the hint would only be noise there.
  const ignoredEmpty = Object.keys(rawPatch).length < FILLED_PATCH_KEYS ? n.dropped.filter((f) => Object.hasOwn(CLEAR_VALUES, f) && !cleared.has(f)) : [];
  const droppedNote = ignoredEmpty.length > 0
    ? `Empty values in patch change nothing, so ${ignoredEmpty.join(", ")} kept their values. To empty them pass clear: ${JSON.stringify(ignoredEmpty)}.`
    : null;
  if (Object.keys(n.fields).length === 0) {
    return fail("EMPTY_PATCH", `patch names no field to change, so nothing was written.${droppedNote ? ` ${droppedNote}` : ""} Pass only the fields to change, e.g. {"disabled": true}.`);
  }

  const ids = [...new Set([...(input.entry_id ? [input.entry_id] : []), ...(input.entry_ids ?? [])]
    .map((id) => id.trim().replace(/^(?:wb|world_book_entry)\//, "").replace(/\/[a-z_]+$/, "")).filter((id) => id.length > 0))];
  const notes: string[] = [];
  const targets: WorldBookEntryDTO[] = [];
  const failed: Array<{ entry_id: string; label?: string; error: string }> = [];
  const single = ids.length === 1 && !input.entry_ids?.length;

  if (ids.length > 0) {
    if (input.book_id) notes.push("book_id was ignored because entry ids were given.");
    for (const id of ids) {
      ctx.signal.throwIfAborted();
      const e = await ctx.spindle.world_books.entries.get(id, ctx.userId).catch(() => null);
      if (e) { targets.push(e); continue; }
      const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
      const error = book
        ? `${id} is the world book ${JSON.stringify(book.name)}, not an entry. To patch its entries pass book_id with an optional query.`
        : `world book entry ${id} not found`;
      if (single) return fail("PATH_NOT_FOUND", error);
      failed.push({ entry_id: id, error });
    }
  } else if (input.book_id) {
    const book = await findWorldBook(ctx, input.book_id);
    if (isOut(book)) return book;
    const where: Array<[string, boolean]> = [];
    for (const [k, raw] of Object.entries(input.where ?? {})) {
      if (raw === null || raw === undefined || raw === "") continue;
      const canon = canonicalField(k);
      if (!canon || !BOOL_FIELDS.has(canon.field)) return fail("INVALID_INPUT", `where takes boolean entry flags (constant, disabled, selective, vectorized), got '${k}'. Nothing was written.`);
      const c = coerceValue(canon.field, raw, canon.invert);
      if ("error" in c) return fail("INVALID_INPUT", `where.${c.error}. Nothing was written.`);
      where.push([canon.field, c.value as boolean]);
    }
    const query = (input.query ?? "").trim();
    const all = await listAllEntries(ctx, book.id);
    targets.push(...all.filter((e) => (query.length === 0 || entryMatchesQuery(e, query)) && where.every(([f, want]) => fieldOf(e, f) === want)));
    if (targets.length === 0) {
      const filter = [query ? `query ${JSON.stringify(query)}` : "", ...where.map(([f, w]) => `${f}=${w}`)].filter(Boolean).join(", ");
      return fail("NO_MATCH", `no entry in ${JSON.stringify(book.name)} matches ${filter || "the selection"} (${all.length} entries checked). Nothing was written. list({path:"wb/${book.id}"}) shows the entries.`);
    }
  } else {
    return fail("INVALID_INPUT", "pass entry_id, entry_ids, or book_id (with an optional query and where) to select the entries to patch");
  }

  const changedRows: Array<{ entry_id: string; label: string; changed: string }> = [];
  const unchangedRows: string[] = [];
  const effects = new Map<string, number>();
  const touched = new Set(Object.keys(n.fields));
  for (const before of targets) {
    ctx.signal.throwIfAborted();
    const label = wbLabel(before);
    try {
      const applied = await applyEntryFields(ctx, before, n.fields);
      for (const c of applied.changed) ctx.pushEdit(entryEdit(ctx, before, c));
      if (applied.changed.length > 0) {
        changedRows.push({ entry_id: before.id, label, changed: changeText(applied.changed) });
        tally(effects, effectNotes(applied.landed, touched));
      }
      if (applied.notApplied.length > 0) {
        failed.push({ entry_id: before.id, label, error: `[NOT_APPLIED] the host kept ${applied.notApplied.map((f) => `${f} at ${short(fieldOf(before, f), 40)}`).join(", ")}` });
      } else if (applied.changed.length === 0) unchangedRows.push(label);
    } catch (err) {
      failed.push({ entry_id: before.id, label, error: (err as Error).message });
    }
  }

  if (single && changedRows.length === 0) {
    if (failed.length > 0) return fail("NOT_APPLIED", `${failed[0]!.error.replace(/^\[NOT_APPLIED\] /, "")}. Nothing changed.`);
    return fail("EMPTY_PATCH", `patch changes nothing, so nothing was written. Already equal: ${Object.keys(n.fields).join(", ")}.`);
  }
  if (droppedNote) notes.push(droppedNote);
  notes.push(...tallyText(effects, changedRows.length));
  if (changedRows.length === 0 && failed.length === 0) notes.push("Every matched entry already had these values.");
  const uniform = changedRows.length > 1 && changedRows.every((r) => r.changed === changedRows[0]!.changed);
  const out: Record<string, unknown> = {
    matched: targets.length + failed.filter((f) => f.label === undefined).length,
    changed: changedRows.length, unchanged: unchangedRows.length, failed: failed.length,
    ...(uniform ? { change: changedRows[0]!.changed } : {}),
    changed_entries: changedRows.slice(0, ROW_LIMIT).map((r) => (uniform ? { entry_id: r.entry_id, label: r.label } : r)),
    ...(changedRows.length > ROW_LIMIT ? { changed_entries_omitted: changedRows.length - ROW_LIMIT } : {}),
    ...(unchangedRows.length > 0 ? { unchanged_entries: unchangedRows.slice(0, 50) } : {}),
    ...(failed.length > 0 ? { failed_entries: failed.slice(0, 50) } : {}),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
  return { content: JSON.stringify(out, null, 2), ...(failed.length > 0 ? { isError: true } : {}) };
}

// ---------- set

export interface WbSetResult {
  before: string;
  after: string;
  label: string;
  surface: EditRecord["surface"];
  surfaceId: string;
  field: string;
  scopeOverride?: ScopeRef;
  valueEncoding?: "json";
  report?: Record<string, unknown>;
}

function shown(v: unknown): unknown {
  return typeof v === "string" && v.length > PEEK_CHARS ? `${v.slice(0, 120)}... (${v.length} chars)` : v ?? null;
}

async function setBookField(ctx: ToolCtx, book: WorldBookDTO, field: string, value: unknown): Promise<WbSetResult | string> {
  if (BOOK_READ_ONLY.has(field)) return `[READ_ONLY] world book field '${field}' cannot be changed. Settable: ${BOOK_FIELDS.join(", ")}.`;
  if (!(BOOK_FIELDS as readonly string[]).includes(field)) {
    return `[PATH_NOT_FOUND] world book has no settable field '${field}'. Settable: ${BOOK_FIELDS.join(", ")}. Entry settings are set on wb/<entryId>/<field>, and attachment with attach_world_book.`;
  }
  const before = (book as unknown as Record<string, unknown>)[field];
  let next: unknown;
  if (field === "metadata") {
    const obj = parseJsonish(value);
    if (!isRecord(obj)) return "[INVALID_VALUE_TYPE] metadata expects an object. Its keys are merged into the existing metadata, and a key set to null is removed.";
    const merged: Record<string, unknown> = { ...(isRecord(before) ? before : {}) };
    for (const [k, v] of Object.entries(obj)) { if (v === null) delete merged[k]; else merged[k] = v; }
    next = merged;
  } else {
    if (typeof value !== "string") return `[INVALID_VALUE_TYPE] world book ${field} expects a string, got ${short(value, 40)}`;
    if (field === "name" && value.trim().length === 0) return "[INVALID_VALUE_TYPE] world book name cannot be empty";
    next = value;
  }
  const base = { label: book.name, surface: "world_book" as const, surfaceId: book.id, field, scopeOverride: { kind: "world_book" as const, id: book.id } };
  if (same(next, before)) return `[NO_CHANGE] world book ${field} is already ${short(before)}. Nothing was written.`;
  const updated = await ctx.spindle.world_books.update(book.id, { [field]: next } as WorldBookUpdateDTO, ctx.userId);
  const landed = (updated as unknown as Record<string, unknown>)[field];
  if (same(landed, before)) return `[NOT_APPLIED] the host kept world book ${field} at ${short(before)}. Nothing changed.`;
  return {
    ...base, before: encodeScalar(field, before), after: encodeScalar(field, landed),
    report: {
      path: `wb/${book.id}/${field}`, world_book: updated.name, before: shown(before), after: shown(landed),
      ...(same(landed, next) ? {} : { note: "The host stored a different value than sent. after shows what landed." }),
    },
  };
}

// wb/<id>/<field> is overloaded: the id may be a book or an entry, so it is resolved by lookup.
export async function setWorldBookField(ctx: ToolCtx, id: string, rawField: string, value: unknown): Promise<WbSetResult | string> {
  if (value === undefined) return "[INVALID_INPUT] set on a wb/ path needs a value";
  const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
  if (book) return setBookField(ctx, book, rawField, value);
  const e = await ctx.spindle.world_books.entries.get(id, ctx.userId).catch(() => null);
  if (!e) return `[PATH_NOT_FOUND] no world book or entry with id ${id}. Find a book with list({path:"wb", query}), its entries with list({path:"wb/<bookId>"}).`;
  const canon = canonicalField(rawField);
  if (!canon) return `[PATH_NOT_FOUND] world book entry has no writable field '${rawField}'. Valid: ${[...WB_ENTRY_WRITABLE_FIELDS].join(", ")}`;
  const field = canon.field;
  const coerced = coerceValue(field, value, canon.invert);
  if ("error" in coerced) return `[INVALID_VALUE_TYPE] ${coerced.error}`;
  const before = fieldOf(e, field);
  const applied = await applyEntryFields(ctx, e, { [field]: coerced.value });
  if (applied.notApplied.length > 0) return `[NOT_APPLIED] the host kept ${field} at ${short(before)}. Nothing changed.`;
  const change = applied.changed[0];
  if (!change) return `[NO_CHANGE] ${field} is already ${short(before)} on ${JSON.stringify(wbLabel(e))}. Nothing was written.`;
  const record = entryEdit(ctx, e, change) as Extract<EditRecord, { op: "edit" }>;
  const notes: string[] = [];
  if (UNREADABLE_FIELDS.has(field)) notes.push(`${field} cannot be read back through the extension API, so the stored value is unverified.`);
  else if (!same(change.after, coerced.value)) notes.push("The host stored a different value than sent. after shows what landed.");
  notes.push(...effectNotes(applied.landed, new Set([field])).map((t) => `This entry: ${t}.`));
  return {
    before: record.before, after: record.after, label: wbLabel(e), surface: "world_book_entry", surfaceId: e.id, field,
    ...(RAW_LEDGER_FIELDS.has(field) ? {} : { valueEncoding: "json" as const }),
    // Without a focused character the edit files under the owning book, never the entry id.
    ...(ctx.characterId ? {} : { scopeOverride: { kind: "world_book" as const, id: e.world_book_id } }),
    report: {
      path: `wb/${e.id}/${field}`, entry: wbLabel(e), world_book_id: e.world_book_id,
      before: shown(change.before), after: shown(change.after),
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    },
  };
}

// ---------- list

export async function listWorldBooks(ctx: ToolCtx, characterId: string | null, maxEntries: number, includeUnattached: boolean, offset = 0, query?: string): Promise<{ entries: WbRow[]; extra: Record<string, unknown> }> {
  const attached = new Set<string>();
  if (characterId !== null) {
    const c = await ctx.spindle.characters.get(characterId, ctx.userId);
    if (!c) throw new Error(`character ${characterId} not found`);
    for (const id of c.world_book_ids ?? []) attached.add(id);
  }
  // Global books fire in every chat even when attached is false.
  const globals = new Set(await ctx.spindle.world_books.getGlobal(ctx.userId).catch(() => [] as string[]));
  const searching = (query ?? "").trim().length > 0;
  const extra: Record<string, unknown> = {};
  let books: WorldBookDTO[] = [];

  if (searching) {
    const all = await listAllWorldBooks(ctx);
    const hits = all.filter((b) => matchesName(b.name, query) || b.id === query!.trim());
    hits.sort((a, b) => Number(attached.has(b.id)) - Number(attached.has(a.id)));
    books = hits.slice(offset, offset + maxEntries);
    extra["searched"] = `all ${all.length} owned world books`;
    if (hits.length === 0) extra["note"] = `No world book name contains ${JSON.stringify(query)}. The name may belong to a character, preset or regex folder, or the text may be inside an entry: grep({pattern, world_scope:"all"}).`;
  } else if (includeUnattached || characterId === null) {
    const page = await searchPage((limit, off) => ctx.spindle.world_books.list({ limit, offset: off, userId: ctx.userId }),
      (book) => book.name, { limit: maxEntries, offset }, ctx.signal);
    books = [...page.data];
  } else {
    let skipped = 0;
    for (const id of attached) {
      ctx.signal.throwIfAborted();
      const book = await ctx.spindle.world_books.get(id, ctx.userId);
      if (!book) continue;
      if (skipped++ < offset) continue;
      books.push(book);
      if (books.length >= maxEntries) break;
    }
    const total = await ctx.spindle.world_books.list({ limit: 1, offset: 0, userId: ctx.userId }).then((r) => r.total).catch(() => 0);
    const others = Math.max(0, total - attached.size);
    if (others > 0) {
      const otherGlobals = [...globals].filter((id) => !attached.has(id)).length;
      extra["other_books"] = others;
      extra["note"] = `Rows are the books attached to this character. ${others} other owned books are not attached to it (${otherGlobals} of them global, active in every chat). Find one by name with list({path:"wb", query}), or pass include_unattached to list them all.`;
    }
  }

  const counts = await mapInBatches(books, async (wb) => {
    ctx.signal.throwIfAborted();
    return (await ctx.spindle.world_books.entries.list(wb.id, { limit: 1, userId: ctx.userId })).total;
  });
  const entries = books.map((wb, i): WbRow => ({
    path: `wb/${wb.id}`, type: "world_book", label: wb.name, entries: counts[i] ?? 0,
    ...(characterId !== null ? { attached: attached.has(wb.id) } : {}),
    global: globals.has(wb.id),
  }));
  return { entries, extra };
}

export async function listWorldBookEntries(ctx: ToolCtx, bookRef: string, maxEntries: number, offset = 0, query?: string): Promise<WbRow[]> {
  const book = await findWorldBook(ctx, bookRef);
  if (isOut(book)) throw new Error(errorText(book));
  const page = await searchPage((limit, off) => ctx.spindle.world_books.entries.list(book.id, { limit, offset: off, userId: ctx.userId }),
    (e) => `${e.comment ?? ""}\n${(e.key ?? []).join("\n")}\n${(e.keysecondary ?? []).join("\n")}`, { limit: maxEntries, offset, query }, ctx.signal);
  return page.data.map((entry): WbRow => ({
    path: `wb/${entry.id}`, type: "wb_entry", label: wbLabel(entry), size: entry.content?.length ?? 0,
    ...(entry.key?.length ? { keys: entry.key } : {}),
    ...(entry.keysecondary?.length ? { secondary_keys: entry.keysecondary } : {}),
    ...nonDefaultSettings(entry),
  }));
}

// ---------- inspect

export interface WorldBookAttachments {
  global: boolean;
  characters: Array<{ id: string; name: string }>;
  personas: Array<{ id: string; name: string }>;
  pinned_chat?: string;
  incomplete?: string;
}

export async function worldBookAttachments(ctx: ToolCtx, bookId: string): Promise<WorldBookAttachments> {
  const out: WorldBookAttachments = { global: false, characters: [], personas: [] };
  const missed: string[] = [];
  try { out.global = (await ctx.spindle.world_books.getGlobal(ctx.userId)).includes(bookId); } catch { missed.push("global set"); }
  try {
    for await (const page of characterPages(ctx.spindle, ctx.userId)) {
      ctx.signal.throwIfAborted();
      for (const c of page) if ((c.world_book_ids ?? []).includes(bookId)) out.characters.push({ id: c.id, name: c.name });
    }
  } catch { ctx.signal.throwIfAborted(); missed.push("characters"); }
  try {
    for (let offset = 0; ; ) {
      const page = await ctx.spindle.personas.list({ limit: PAGE, offset, userId: ctx.userId });
      for (const p of page.data) if (p.attached_world_book_id === bookId) out.personas.push({ id: p.id, name: p.name });
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.total) break;
    }
  } catch { missed.push("personas"); }
  if (ctx.pinnedChatId) {
    const chat = await ctx.spindle.chats.get(ctx.pinnedChatId, ctx.userId).catch(() => null);
    const ids = (chat?.metadata ?? {})["chat_world_book_ids"];
    if (Array.isArray(ids) && ids.includes(bookId)) out.pinned_chat = ctx.pinnedChatId;
  }
  if (missed.length > 0) out.incomplete = `could not check: ${missed.join(", ")}`;
  return out;
}

function attachedAnywhere(a: WorldBookAttachments): boolean {
  return a.global || a.characters.length > 0 || a.personas.length > 0 || a.pinned_chat !== undefined;
}

async function inspectBook(ctx: ToolCtx, wb: WorldBookDTO): Promise<Record<string, unknown>> {
  const entries = await listAllEntries(ctx, wb.id);
  const attachedTo = await worldBookAttachments(ctx, wb.id);
  const top = [...entries]
    .sort((a, b) => (b.content?.length ?? 0) - (a.content?.length ?? 0))
    .slice(0, TOP_N)
    .map((e) => ({ path: `wb/${e.id}/content`, label: wbLabel(e), chars: e.content?.length ?? 0 }));
  return {
    path: `wb/${wb.id}`, name: wb.name, description: wb.description ?? "", metadata: wb.metadata ?? {},
    attached_to: attachedTo,
    entries: entries.length,
    disabled: entries.filter((e) => e.disabled).length,
    constant: entries.filter((e) => e.constant).length,
    vectorized: entries.filter((e) => e.vectorized).length,
    total_content_chars: entries.reduce((sum, e) => sum + (e.content?.length ?? 0), 0),
    largest: top,
    note: attachedAnywhere(attachedTo)
      ? "Bindings of chats other than the pinned one are not listed. list_chat_world_books shows every layer for one chat."
      : "Not attached to any character or persona and not global, so its entries fire only in a chat that binds it directly. Attach it with attach_world_book.",
  };
}

async function inspectEntry(ctx: ToolCtx, e: WorldBookEntryDTO): Promise<Record<string, unknown>> {
  const book = await ctx.spindle.world_books.get(e.world_book_id, ctx.userId).catch(() => null);
  const { content, ...settings } = e;
  const text = content ?? "";
  const notes = effectNotes(e, null).map((t) => `This entry: ${t}.`);
  return {
    path: `wb/${e.id}`, type: "wb_entry", label: wbLabel(e), world_book: book?.name ?? "", ...settings,
    content_chars: text.length, content_peek: text.slice(0, PEEK_CHARS), content_path: `wb/${e.id}/content`,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

// wb/<id> resolves book first, then entry.
export async function inspectWorldBookPath(ctx: ToolCtx, id: string): Promise<ToolOut> {
  const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
  if (book) return { content: JSON.stringify(await inspectBook(ctx, book), null, 2) };
  const entry = await ctx.spindle.world_books.entries.get(id, ctx.userId).catch(() => null);
  if (entry) return { content: JSON.stringify(await inspectEntry(ctx, entry), null, 2) };
  const byName = await findWorldBook(ctx, id);
  if (isOut(byName)) return byName;
  return { content: JSON.stringify(await inspectBook(ctx, byName), null, 2) };
}

// ---------- delete

export async function deleteWorldBookPath(ctx: ToolCtx, id: string): Promise<ToolOut> {
  const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
  if (book) {
    const entries = await listAllEntries(ctx, id);
    const wasAttached = await worldBookAttachments(ctx, id);
    await ctx.spindle.world_books.delete(id, ctx.userId);
    ctx.pushEdit({
      op: "delete", surface: "world_book", surfaceId: id, surfaceLabel: book.name,
      snapshot: { book, entries }, scope: { kind: "world_book", id },
    } satisfies EditRecord);
    return {
      content: JSON.stringify({
        world_book_id: id, name: book.name, deleted: true, entries_removed: entries.length, can_revert: true,
        was_attached: wasAttached,
        ...(attachedAnywhere(wasAttached)
          ? { note: "Everything listed in was_attached lost this book. A revert recreates the book under a new id and does not re-attach it, so attach it again with attach_world_book." }
          : {}),
      }, null, 2),
    };
  }
  const entry = await ctx.spindle.world_books.entries.get(id, ctx.userId).catch(() => null);
  if (!entry) return fail("PATH_NOT_FOUND", `no world book or entry with id ${id}. Find a book with list({path:"wb", query}), its entries with list({path:"wb/<bookId>"}).`);
  await ctx.spindle.world_books.entries.delete(id, ctx.userId);
  ctx.pushEdit({
    op: "delete", surface: "world_book_entry", surfaceId: id, surfaceLabel: wbLabel(entry), snapshot: entry,
    ...structuralScope(ctx, entry.world_book_id),
  } satisfies EditRecord);
  return { content: JSON.stringify({ entry_id: id, label: wbLabel(entry), world_book_id: entry.world_book_id, deleted: true, can_revert: true }) };
}

// ---------- grep

export async function unsearchedBooksNote(ctx: ToolCtx, characterId: string): Promise<string | null> {
  try {
    const [c, page] = await Promise.all([
      ctx.spindle.characters.get(characterId, ctx.userId),
      ctx.spindle.world_books.list({ limit: 1, offset: 0, userId: ctx.userId }),
    ]);
    const attached = new Set(c?.world_book_ids ?? []);
    const others = Math.max(0, page.total - attached.size);
    if (others === 0) return null;
    return `No match in this character or its ${attached.size} attached world books. ${others} other owned world books were not searched: pass world_scope "all" to include them.`;
  } catch {
    return null;
  }
}
