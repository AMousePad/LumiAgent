import type { CharacterCreateDTO, CharacterDTO, PersonaCreateDTO, PersonaDTO } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import type { EditRecord } from "../../types";
import { recordChange } from "./_change-history";
import { createRegexScripts, listAllRegexScripts } from "./_regex";
import { isCharSubtreeToken, listAllWorldBooks } from "./_path_v2";
import { listAllPresets } from "./_preset";
import { normaliseCharacterTags } from "./_surfaces";

type ToolOut = { content: string; isError?: boolean };

const fail = (code: string, message: string): ToolOut => ({ content: `Error: [${code}] ${message}`, isError: true });
const isFail = (v: unknown): v is ToolOut => !!v && typeof v === "object" && "content" in (v as object) && (v as ToolOut).isError === true;

const PAGE = 200;
const CANDIDATE_LIMIT = 12;
export const CHARACTER_TEXT_FIELDS = [
  "description", "personality", "scenario", "first_mes", "mes_example",
  "creator_notes", "system_prompt", "post_history_instructions", "creator",
] as const;

// Names models reach for from other card formats.
export const CHARACTER_FIELD_ALIASES: Readonly<Record<string, string>> = {
  first_message: "first_mes", greeting: "first_mes", first_msg: "first_mes",
  example_dialogue: "mes_example", example_messages: "mes_example", mes_examples: "mes_example", examples: "mes_example",
  creator_comment: "creator_notes", creatorcomment: "creator_notes", notes: "creator_notes",
  post_history: "post_history_instructions", jailbreak: "post_history_instructions",
  main_prompt: "system_prompt",
};

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim();
}

type Named = { id: string; name: string };

async function resolveByName<T extends Named>(
  kind: string,
  ref: string,
  get: (id: string) => Promise<T | null>,
  page: (limit: number, offset: number) => Promise<{ data: T[]; total: number }>,
  signal: AbortSignal,
  exactOnly: boolean,
  finder: string,
): Promise<T | ToolOut> {
  const raw = ref.trim().replace(new RegExp(`^(?:${kind}s?|char)/`), "").replace(/\/+$/, "");
  if (raw.length === 0) return fail("INVALID_INPUT", `${kind} reference is empty. Pass an id or a name.`);
  const direct = await get(raw).catch(() => null);
  if (direct) return direct;
  const want = norm(raw);
  const exact: T[] = [];
  const partial: T[] = [];
  let offset = 0;
  for (;;) {
    signal.throwIfAborted();
    const res = await page(PAGE, offset);
    for (const item of res.data) {
      const n = norm(item.name);
      if (n === want) exact.push(item);
      else if (n.includes(want)) partial.push(item);
    }
    offset += res.data.length;
    if (res.data.length === 0 || offset >= res.total) break;
  }
  const show = (rows: T[]) => rows.slice(0, CANDIDATE_LIMIT).map((r) => `${JSON.stringify(r.name)} (${r.id})`).join(", ");
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return fail("AMBIGUOUS", `${exact.length} ${kind}s are named ${JSON.stringify(raw)}: ${show(exact)}. Pass one id.`);
  if (partial.length === 1 && !exactOnly) return partial[0]!;
  if (partial.length > 0) {
    return fail(exactOnly ? "PATH_NOT_FOUND" : "AMBIGUOUS", `no ${kind} is named exactly ${JSON.stringify(raw)}. Close matches: ${show(partial)}. Pass one id.`);
  }
  return fail("PATH_NOT_FOUND", `no ${kind} matches ${JSON.stringify(raw)}. Find it with ${finder}.`);
}

export function findCharacter(ctx: ToolCtx, ref: string, exactOnly = false): Promise<CharacterDTO | ToolOut> {
  return resolveByName<CharacterDTO>(
    "character", ref,
    (id) => ctx.spindle.characters.get(id, ctx.userId),
    (limit, offset) => ctx.spindle.characters.list({ limit, offset, userId: ctx.userId }),
    ctx.signal, exactOnly, "list_characters({query})",
  );
}

export function findPersona(ctx: ToolCtx, ref: string, exactOnly = false): Promise<PersonaDTO | ToolOut> {
  return resolveByName<PersonaDTO>(
    "persona", ref,
    (id) => ctx.spindle.personas.get(id, ctx.userId),
    (limit, offset) => ctx.spindle.personas.list({ limit, offset, userId: ctx.userId }),
    ctx.signal, exactOnly, "personas({action:\"list\", query})",
  );
}

// Splits `char/<id>/<sub...>` into the focused form and its target. Null target means the path named no character.
export function splitCharacterPath(path: string, explicit?: string): { path: string; target: string | null } {
  const m = /^(?:char|character)\/([^/]+)\/(.+)$/.exec(path);
  if (m && !isCharSubtreeToken(m[1]!)) return { path: `char/${m[2]!}`, target: m[1]! };
  return { path: path.replace(/^character\//, "char/"), target: explicit && explicit.length > 0 ? explicit : null };
}

function sourceRef(v: Record<string, unknown>): string | null {
  const raw = v.copy_of ?? v.copy_from ?? v.duplicate_of;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

export function hasCopySource(v: Record<string, unknown>): boolean {
  return sourceRef(v) !== null;
}

// The host stores unknown book ids as given, which leaves a card attached to nothing.
export async function missingWorldBooks(ctx: ToolCtx, ids: readonly string[]): Promise<string[]> {
  const found = await Promise.all(ids.map((id) => ctx.spindle.world_books.get(id, ctx.userId).then((b) => !!b, () => false)));
  return ids.filter((_, i) => !found[i]);
}

export async function duplicateCharacter(ctx: ToolCtx, v: Record<string, unknown>): Promise<ToolOut> {
  const ref = sourceRef(v);
  if (!ref) return fail("INVALID_INPUT", "character copy needs copy_of: a character id or name");
  const src = await findCharacter(ctx, ref);
  if (isFail(src)) return src;

  const name = typeof v.name === "string" && v.name.trim().length > 0 ? v.name.trim() : `${src.name} (Copy)`;
  const dto: CharacterCreateDTO = {
    name,
    tags: [...(src.tags ?? [])],
    alternate_greetings: [...(src.alternate_greetings ?? [])],
    world_book_ids: [...(src.world_book_ids ?? [])],
    extensions: structuredClone(src.extensions ?? {}),
  };
  const overridden: string[] = [];
  for (const f of CHARACTER_TEXT_FIELDS) {
    const own = v[f];
    if (typeof own === "string" && own.length > 0) { (dto as unknown as Record<string, unknown>)[f] = own; overridden.push(f); }
    else (dto as unknown as Record<string, unknown>)[f] = (src as unknown as Record<string, unknown>)[f] ?? "";
  }
  const tags = Array.isArray(v.tags) && v.tags.length > 0 ? normaliseCharacterTags(v.tags) : null;
  if (tags) { dto.tags = tags; overridden.push("tags"); }
  if (Array.isArray(v.alternate_greetings) && v.alternate_greetings.length > 0 && v.alternate_greetings.every((g) => typeof g === "string")) {
    dto.alternate_greetings = v.alternate_greetings as string[]; overridden.push("alternate_greetings");
  }
  if (Array.isArray(v.world_book_ids) && v.world_book_ids.length > 0 && v.world_book_ids.every((g) => typeof g === "string")) {
    const missing = await missingWorldBooks(ctx, v.world_book_ids as string[]);
    if (missing.length > 0) return fail("PATH_NOT_FOUND", `world book ${missing.join(", ")} not found. Nothing was created. Find ids with list({path:"wb"}).`);
    dto.world_book_ids = v.world_book_ids as string[]; overridden.push("world_book_ids");
  }

  const created = await ctx.spindle.characters.create(dto, ctx.userId);
  recordChange(ctx, { kind: "character", id: created.id }, created.name, "created", null,
    { id: created.id, name: created.name, copied_from: src.id },
    `Remove the copy with delete({path:"char/${created.id}"}).`);

  const notCopied: string[] = ["chats", "folder placement"];
  let avatar: boolean | string = false;
  if (src.image_id) {
    try {
      const [bytes, meta] = await Promise.all([
        ctx.spindle.images.readBinary(src.image_id, ctx.userId),
        ctx.spindle.images.get(src.image_id, ctx.userId).catch(() => null),
      ]);
      await ctx.spindle.characters.setAvatar(created.id, {
        data: bytes,
        filename: meta?.original_filename || "avatar.png",
        mime_type: meta?.mime_type || "image/png",
      }, ctx.userId);
      avatar = true;
    } catch (err) {
      avatar = `not copied: ${(err as Error).message}`;
    }
  }

  let regexCopied = 0;
  let regexNote: string | null = null;
  const scripts = await listAllRegexScripts(ctx, { scope: "character", scopeId: src.id }).catch(() => []);
  if (scripts.length > 0) {
    const out = await createRegexScripts(ctx, { copy_of: scripts.map((s) => s.id), scope: "character", scope_id: created.id });
    if (out.isError && !/"created":|"script_id":/.test(out.content)) regexNote = out.content.slice(0, 300);
    else {
      const m = /"created":\s*(\d+)/.exec(out.content);
      regexCopied = m ? Number(m[1]) : 1;
      if (regexCopied < scripts.length) regexNote = `${regexCopied} of ${scripts.length} character regex scripts were copied.`;
    }
  }

  const gallery = await ctx.spindle.characters.getGallery?.(src.id, ctx.userId).catch(() => []) ?? [];
  if (gallery.length > 0) notCopied.push(`gallery (${gallery.length} image${gallery.length === 1 ? "" : "s"})`);

  const mismatched = CHARACTER_TEXT_FIELDS.filter((f) => (created as unknown as Record<string, unknown>)[f] !== (dto as unknown as Record<string, unknown>)[f]);
  const notes: string[] = [];
  if (v.extensions && typeof v.extensions === "object" && Object.keys(v.extensions).length > 0) notes.push("Ignored value field: extensions. The copy keeps the source's. Change single values with set on char/<id>/extensions/<dotted>.");
  if (mismatched.length > 0) notes.push(`The host stored different text for: ${mismatched.join(", ")}.`);
  if (regexNote) notes.push(regexNote);
  if (typeof avatar === "string") notes.push("The copy has no portrait.");
  notes.push("The original is unchanged. The copy is not focused.");

  return {
    content: JSON.stringify({
      created: { id: created.id, name: created.name },
      copied_from: { id: src.id, name: src.name },
      address_as: `char/${created.id}/<field>`,
      copied: {
        text_fields: CHARACTER_TEXT_FIELDS.filter((f) => typeof (created as unknown as Record<string, unknown>)[f] === "string" && ((created as unknown as Record<string, unknown>)[f] as string).length > 0),
        alternate_greetings: created.alternate_greetings?.length ?? 0,
        tags: created.tags?.length ?? 0,
        world_books: created.world_book_ids?.length ?? 0,
        extension_keys: Object.keys(created.extensions ?? {}).length,
        avatar,
        regex_scripts: regexCopied,
      },
      ...(overridden.length > 0 ? { overridden } : {}),
      not_copied: notCopied,
      note: notes.join(" "),
    }, null, 2),
  };
}

export async function deleteCharacter(ctx: ToolCtx, ref: string): Promise<ToolOut> {
  const c = await findCharacter(ctx, ref, true);
  if (isFail(c)) return c;
  const chats = await ctx.spindle.chats.list({ characterId: c.id, limit: 1, userId: ctx.userId }).then((r) => r.total).catch(() => null);
  const ok = await ctx.spindle.characters.delete(c.id, ctx.userId);
  if (!ok) return fail("NOT_APPLIED", `the host did not delete character ${c.id}. Nothing was changed.`);
  recordChange(ctx, { kind: "character", id: c.id }, c.name, "deleted",
    { id: c.id, name: c.name, chats, tags: c.tags, alternate_greetings: c.alternate_greetings?.length ?? 0 }, null,
    "The host removes the character's chats and images with the card, so it cannot be restored.");
  return {
    content: JSON.stringify({
      deleted: { id: c.id, name: c.name },
      ...(chats !== null ? { chats_deleted: chats } : {}),
      can_revert: false,
      ...(ctx.characterId === c.id ? { note: "This was the focused character. The user needs to pick another one." } : {}),
    }),
  };
}

const PERSONA_VALUE_KEYS: ReadonlySet<string> = new Set([
  "name", "title", "description", "folder", "is_default", "attached_world_book_id", "metadata", "copy_of", "copy_from", "duplicate_of",
]);

export async function createPersona(ctx: ToolCtx, v: Record<string, unknown>): Promise<ToolOut> {
  const ignored = Object.keys(v).filter((k) => !PERSONA_VALUE_KEYS.has(k));
  const ref = sourceRef(v);
  let src: PersonaDTO | null = null;
  if (ref) {
    const found = await findPersona(ctx, ref);
    if (isFail(found)) return found;
    src = found;
  }
  const name = typeof v.name === "string" && v.name.trim().length > 0 ? v.name.trim() : src ? `${src.name} (Copy)` : null;
  if (!name) return fail("INVALID_INPUT", "persona requires value.name, or value.copy_of to duplicate an existing persona");

  const create: PersonaCreateDTO = { name };
  if (src) {
    create.title = src.title;
    create.description = src.description;
    create.folder = src.folder;
    if (src.attached_world_book_id) create.attached_world_book_id = src.attached_world_book_id;
    create.metadata = Object.fromEntries(Object.entries(structuredClone(src.metadata ?? {})).filter(([k]) => !k.startsWith("_lumiverse_")));
  }
  if (typeof v.title === "string" && (v.title.length > 0 || !src)) create.title = v.title;
  if (typeof v.description === "string" && (v.description.length > 0 || !src)) create.description = v.description;
  if (typeof v.folder === "string" && (v.folder.length > 0 || !src)) create.folder = v.folder;
  if (v.is_default === true || v.is_default === "true") create.is_default = true;
  if (typeof v.attached_world_book_id === "string" && v.attached_world_book_id.length > 0) {
    const book = await ctx.spindle.world_books.get(v.attached_world_book_id, ctx.userId).catch(() => null);
    if (!book) return fail("PATH_NOT_FOUND", `world book '${v.attached_world_book_id}' not found. Nothing was created.`);
    create.attached_world_book_id = v.attached_world_book_id;
  }
  if (v.metadata && typeof v.metadata === "object" && !Array.isArray(v.metadata) && Object.keys(v.metadata).length > 0) {
    create.metadata = { ...(create.metadata ?? {}), ...(v.metadata as Record<string, unknown>) };
  }

  const p = await ctx.spindle.personas.create(create, ctx.userId);
  ctx.pushEdit({
    op: "create", surface: "persona", surfaceId: p.id, surfaceLabel: p.name,
    snapshot: p, scope: { kind: "persona", id: p.id },
  } satisfies EditRecord);

  const meta = (p.metadata ?? {}) as Record<string, unknown>;
  const notes: string[] = [];
  const notCopied: string[] = [];
  if (src) {
    if (src.image_id) notCopied.push("portrait");
    notCopied.push("pronouns", "narrator flag");
    notes.push("The host offers no way to copy these through an extension. The user can set them in the persona editor.");
  }
  if (ignored.length > 0) notes.push(`Ignored value fields: ${ignored.join(", ")}.`);
  return {
    content: JSON.stringify({
      persona_id: p.id, name: p.name,
      ...(src ? { copied_from: { id: src.id, name: src.name } } : {}),
      title: p.title, folder: p.folder, description_chars: p.description.length,
      is_default: p.is_default, attached_world_book_id: p.attached_world_book_id,
      addons: Array.isArray(meta.addons) ? meta.addons.length : 0,
      global_addons: Array.isArray(meta.attached_global_addons) ? meta.attached_global_addons.length : 0,
      ...(notCopied.length > 0 ? { not_copied: notCopied } : {}),
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    }),
  };
}

type AddonRow = Record<string, unknown> & { id: string };
type AddonWrite = { before: string; after: string; label: string; surface: "persona"; surfaceId: string; field: string; report: Record<string, unknown> };

function addonList(meta: Record<string, unknown>): AddonRow[] {
  return (Array.isArray(meta.addons) ? meta.addons : []).filter((a): a is AddonRow => !!a && typeof a === "object" && typeof (a as AddonRow).id === "string");
}

// Add-ons live inside persona metadata, so every change is one whole-metadata write and one ledger entry.
async function writeAddons(ctx: ToolCtx, p: PersonaDTO, next: AddonRow[]): Promise<{ before: string; after: string }> {
  const before = structuredClone(p.metadata ?? {});
  const after = { ...before, addons: next };
  const updated = await ctx.spindle.personas.update(p.id, { metadata: after }, ctx.userId);
  return { before: JSON.stringify(before), after: JSON.stringify(updated.metadata ?? after) };
}

function pushAddonEdit(ctx: ToolCtx, p: PersonaDTO, w: { before: string; after: string }): void {
  ctx.pushEdit({
    op: "edit", surface: "persona", surfaceId: p.id, surfaceLabel: p.name, field: "metadata",
    before: w.before, after: w.after, scope: { kind: "persona", id: p.id },
  } satisfies EditRecord);
}

export async function createPersonaAddon(ctx: ToolCtx, personaRef: string, v: Record<string, unknown>, bare?: string): Promise<ToolOut> {
  const p = await findPersona(ctx, personaRef);
  if (isFail(p)) return p;
  const content = typeof bare === "string" ? bare : typeof v.content === "string" ? v.content : null;
  if (content === null) return fail("INVALID_INPUT", "persona add-on requires value.content (value.label, enabled and outlet_name are optional)");
  const known = new Set(["content", "label", "enabled", "outlet_name", "sort_order"]);
  const ignored = Object.keys(v).filter((k) => !known.has(k));
  const addons = addonList(p.metadata ?? {});
  const order = addons.reduce((m, a) => Math.max(m, typeof a.sort_order === "number" ? a.sort_order : 0), -1) + 1;
  const addon: AddonRow = {
    id: await ctx.spindle.uuid.v4(),
    label: typeof v.label === "string" ? v.label : "",
    content,
    enabled: v.enabled !== false && v.enabled !== "false",
    sort_order: typeof v.sort_order === "number" ? v.sort_order : order,
    ...(typeof v.outlet_name === "string" && v.outlet_name.length > 0 ? { outlet_name: v.outlet_name } : {}),
  };
  pushAddonEdit(ctx, p, await writeAddons(ctx, p, [...addons, addon]));
  return {
    content: JSON.stringify({
      persona: { id: p.id, name: p.name }, addon_id: addon.id, path: `persona/${p.id}/addon/${addon.id}/content`,
      label: addon.label, enabled: addon.enabled, content_chars: content.length, total: addons.length + 1,
      ...(ignored.length > 0 ? { note: `Ignored value fields: ${ignored.join(", ")}.` } : {}),
    }),
  };
}

export async function deletePersonaAddon(ctx: ToolCtx, personaRef: string, addonId: string): Promise<ToolOut> {
  const p = await findPersona(ctx, personaRef);
  if (isFail(p)) return p;
  const addons = addonList(p.metadata ?? {});
  const hit = addons.find((a) => a.id === addonId);
  if (!hit) {
    const have = addons.map((a) => `${JSON.stringify(a.label ?? "")} (${a.id})`).join(", ") || "none";
    return fail("PATH_NOT_FOUND", `persona add-on ${addonId} not found on ${p.name}. Its add-ons: ${have}.`);
  }
  pushAddonEdit(ctx, p, await writeAddons(ctx, p, addons.filter((a) => a.id !== addonId)));
  return { content: JSON.stringify({ persona: { id: p.id, name: p.name }, addon_id: addonId, label: hit.label ?? "", deleted: true, remaining: addons.length - 1, can_revert: true }) };
}

export async function setPersonaAddonField(ctx: ToolCtx, personaId: string, addonId: string, field: string, value: unknown): Promise<AddonWrite | string> {
  const p = await ctx.spindle.personas.get(personaId, ctx.userId);
  if (!p) return `[PATH_NOT_FOUND] persona ${personaId} not found. Find its id with personas({action:"list", query}).`;
  const addons = addonList(p.metadata ?? {});
  const idx = addons.findIndex((a) => a.id === addonId);
  if (idx < 0) return `[PATH_NOT_FOUND] persona add-on ${addonId} not found on ${p.name}. personas({action:"read"}) lists them under resolved_addons.`;
  let next: unknown;
  if (field === "enabled") {
    next = value === true || value === "true" ? true : value === false || value === "false" ? false : null;
    if (next === null) return "[INVALID_VALUE_TYPE] enabled expects true or false.";
  } else if (field === "sort_order") {
    if (typeof value !== "number") return "[INVALID_VALUE_TYPE] sort_order expects a number.";
    next = value;
  } else if (field === "outlet_name") {
    if (value !== null && typeof value !== "string") return "[INVALID_VALUE_TYPE] outlet_name expects a string, or null to send the text back into {{persona}}.";
    next = value === "" ? null : value;
  } else {
    return `[PATH_NOT_FOUND] add-on field '${field}' is not settable. Settable: enabled, sort_order, outlet_name. Text uses edit or rewrite on .../content and .../label.`;
  }
  const row = { ...addons[idx]!, [field]: next };
  const w = await writeAddons(ctx, p, addons.map((a, i) => (i === idx ? row : a)));
  return {
    ...w, label: p.name, surface: "persona", surfaceId: personaId, field: "metadata",
    report: { path: `persona/${personaId}/addon/${addonId}/${field}`, persona: p.name, addon: row.label ?? "", before: addons[idx]![field] ?? null, after: next },
  };
}

// Where else a name the user gave exists, so a missed character lookup answers the next question in the same call.
export async function findNameElsewhere(ctx: ToolCtx, query: string): Promise<Record<string, unknown> | null> {
  const want = norm(query);
  if (want.length === 0) return null;
  const hit = (name: string | null | undefined) => typeof name === "string" && norm(name).includes(want);
  const cap = <T,>(rows: T[]) => rows.slice(0, 5);
  const [presets, books, personas, scripts] = await Promise.all([
    listAllPresets(ctx).catch(() => []),
    listAllWorldBooks(ctx).catch(() => []),
    ctx.spindle.personas.list({ limit: 500, offset: 0, userId: ctx.userId }).then((r) => r.data).catch(() => []),
    listAllRegexScripts(ctx).catch(() => []),
  ]);
  const out: Record<string, unknown> = {};
  const p = presets.filter((x) => hit(x.name));
  if (p.length > 0) out["presets"] = cap(p.map((x) => ({ path: `preset/${x.id}`, name: x.name })));
  const b = books.filter((x) => hit(x.name));
  if (b.length > 0) out["lorebooks"] = cap(b.map((x) => ({ path: `wb/${x.id}`, name: x.name })));
  const u = personas.filter((x) => hit(x.name));
  if (u.length > 0) out["personas"] = cap(u.map((x) => ({ path: `persona/${x.id}`, name: x.name })));
  const folders = [...new Set(scripts.map((s) => s.folder ?? "").filter((f) => hit(f)))];
  if (folders.length > 0) out["regex_folders"] = cap(folders);
  return Object.keys(out).length > 0 ? out : null;
}

// What the confirmation dialog shows for a whole-card delete: the name and the chats that go with it, not a bare id.
export async function describeCharacterDelete(ctx: ToolCtx, path: string): Promise<{ target: string } | ToolOut> {
  const c = await findCharacter(ctx, path.trim().replace(/\/+$/, ""), true);
  if (isFail(c)) return c;
  const chats = await ctx.spindle.chats.list({ characterId: c.id, limit: 1, userId: ctx.userId }).then((r) => r.total).catch(() => null);
  const withChats = chats === null ? "" : chats === 0 ? ", no chats" : `, with ${chats} chat${chats === 1 ? "" : "s"}`;
  return { target: `${c.name} (${c.id})${withChats}` };
}
