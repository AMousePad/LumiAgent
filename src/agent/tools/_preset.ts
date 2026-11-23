import type {
  PromptBlockCreateDTO,
  PromptBlockSnapshotDTO,
  PromptVariableDefDTO,
  UserPresetCreateDTO,
  UserPresetDTO,
  UserPresetUpdateDTO,
} from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import type { EditRecord } from "../../types";
import { encodeScalar } from "../../state/edit-log";
import { parseExtensionPath, getAtPath, setAtPath } from "./_paths";
import { listAllRegexScripts } from "./_regex";
import { walkStringLeaves } from "./_walk";

type ToolOut = { content: string; isError?: boolean };
type StoredValues = Record<string, Record<string, unknown>>;
type Block = PromptBlockSnapshotDTO;

export const PRESET_FIELDS: ReadonlySet<string> = new Set(["name", "provider", "engine", "parameters", "prompt_order", "prompts", "metadata"]);
const OBJECT_FIELDS: ReadonlySet<string> = new Set(["parameters", "prompts", "metadata"]);
const BLOCK_ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant", "user_append", "assistant_append"]);
const BLOCK_POSITIONS: ReadonlySet<string> = new Set(["pre_history", "post_history", "in_history"]);
const BLOCK_KEYS: ReadonlySet<string> = new Set([
  "name", "content", "role", "enabled", "position", "depth", "marker", "isLocked", "color",
  "injectionTrigger", "characterTagTrigger", "group", "categoryMode", "variables",
]);
const BLOCK_CONTROL_KEYS: ReadonlySet<string> = new Set(["index", "after", "before", "copy_of"]);
const PRESET_CREATE_KEYS: ReadonlySet<string> = new Set(["name", "provider", "engine", "parameters", "prompts", "prompt_order", "metadata", "description", "copy_of"]);
const SEALED_KEYS = ["sealed", "sealedKey", "sealedSource", "sealedOriginPresetId", "sealedOriginVersion", "sealedSha256"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 200;
const INSPECT_BLOCK_ROWS = 40;

const fail = (code: string, message: string): ToolOut => ({ content: `Error: [${code}] ${message}`, isError: true });
const isOut = (v: unknown): v is ToolOut => !!v && typeof v === "object" && typeof (v as ToolOut).content === "string" && "content" in (v as object) && !("id" in (v as object));

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function listAllPresets(ctx: ToolCtx): Promise<UserPresetDTO[]> {
  const out: UserPresetDTO[] = [];
  let offset = 0;
  for (;;) {
    ctx.signal.throwIfAborted();
    const page = await ctx.spindle.presets.list({ limit: PAGE, offset, userId: ctx.userId });
    out.push(...page.data);
    if (page.data.length === 0 || out.length >= page.total) break;
    offset += page.data.length;
  }
  return out;
}

// Accepts a preset id, a preset/<id> path, or a name (exact, then unique substring).
export async function findPreset(ctx: ToolCtx, ref: unknown): Promise<UserPresetDTO | ToolOut> {
  if (typeof ref !== "string" || ref.trim().length === 0) return fail("INVALID_INPUT", "expected a preset id or preset name");
  const raw = ref.trim().replace(/^presets?\//, "");
  const idPart = raw.split("/")[0]!;
  if (UUID_RE.test(idPart)) {
    const p = await ctx.spindle.presets.get(idPart, ctx.userId);
    if (p) return p;
  }
  const all = await listAllPresets(ctx);
  const want = norm(raw);
  let hits = all.filter((p) => p.id === raw || norm(p.name) === want);
  if (hits.length === 0) hits = all.filter((p) => norm(p.name).includes(want));
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) return fail("PATH_NOT_FOUND", `no preset matches '${ref}'. Presets: ${all.slice(0, 30).map((p) => JSON.stringify(p.name)).join(", ") || "(none)"}`);
  return fail("AMBIGUOUS", `'${ref}' matches ${hits.length} presets: ${hits.slice(0, 20).map((p) => `${JSON.stringify(p.name)} (preset/${p.id})`).join(", ")}. Pass one id.`);
}

function blocksOf(p: UserPresetDTO): Block[] {
  return Array.isArray(p.prompt_order) ? p.prompt_order.filter((b) => isRecord(b)) : [];
}

function storedValues(p: UserPresetDTO): StoredValues {
  const raw = (p.metadata ?? {})["promptVariables"];
  return isRecord(raw) ? (raw as StoredValues) : {};
}

// ---------- variables

export interface PresetVar {
  readonly block: Block;
  readonly def: PromptVariableDefDTO;
  readonly raw: unknown;
}

export function presetVars(p: UserPresetDTO): PresetVar[] {
  const values = storedValues(p);
  const out: PresetVar[] = [];
  for (const block of blocksOf(p)) {
    if (!Array.isArray(block.variables)) continue;
    const bucket = isRecord(values[block.id]) ? values[block.id]! : {};
    for (const def of block.variables) {
      if (!def || typeof def.name !== "string" || def.name.length === 0) continue;
      out.push({ block, def, raw: Object.prototype.hasOwnProperty.call(bucket, def.name) ? bucket[def.name] : undefined });
    }
  }
  return out;
}

function optionsOf(def: PromptVariableDefDTO): Array<{ id: string; label: string; value: string }> {
  const o = (def as { options?: unknown }).options;
  return Array.isArray(o) ? o.filter((x) => isRecord(x) && typeof x["id"] === "string") as Array<{ id: string; label: string; value: string }> : [];
}

function clampNum(v: number, min: unknown, max: unknown): number {
  if (typeof min === "number" && v < min) return min;
  if (typeof max === "number" && v > max) return max;
  return v;
}

function optionLabel(o: { id: string; label: string }): string {
  return typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
}

// Mirrors the host's coercion so the reported value is the one generation uses.
function effective(def: PromptVariableDefDTO, raw: unknown): unknown {
  const d = def as Record<string, unknown>;
  switch (def.type) {
    case "text":
    case "textarea":
      return raw === undefined || raw === null ? String(d["defaultValue"] ?? "") : String(raw);
    case "number":
    case "slider": {
      const fallback = typeof d["defaultValue"] === "number" ? (d["defaultValue"] as number) : 0;
      const n = raw === undefined || raw === null ? fallback : Number(raw);
      return clampNum(Number.isFinite(n) ? n : fallback, d["min"], d["max"]);
    }
    case "range": {
      const pick = (v: unknown): [number, number] | null => {
        if (!Array.isArray(v) || v.length !== 2) return null;
        const a = Number(v[0]), b = Number(v[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        const ca = clampNum(a, d["min"], d["max"]), cb = clampNum(b, d["min"], d["max"]);
        return ca <= cb ? [ca, cb] : [cb, ca];
      };
      return pick(raw) ?? pick(d["defaultValue"]) ?? [d["min"], d["max"]];
    }
    case "select": {
      const options = optionsOf(def);
      const valid = new Set(options.map((o) => o.id));
      const fallback = valid.has(String(d["defaultValue"])) ? String(d["defaultValue"]) : options[0]?.id ?? "";
      const candidate = raw === undefined || raw === null ? fallback : String(raw);
      const id = valid.has(candidate) ? candidate : fallback;
      const match = options.find((o) => o.id === id);
      return match ? optionLabel(match) : "";
    }
    case "switch": {
      if (raw === undefined || raw === null) return d["defaultValue"] === 1;
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "number") return raw === 1;
      const s = String(raw).trim().toLowerCase();
      return s === "1" || s === "true" || s === "on" || s === "yes";
    }
    case "multiselect": {
      const options = optionsOf(def);
      let ids: string[];
      if (Array.isArray(raw)) ids = raw.map(String);
      else if (raw === undefined || raw === null) ids = Array.isArray(d["defaultValue"]) ? (d["defaultValue"] as unknown[]).map(String) : [];
      else if (typeof raw === "string" && raw.length > 0) ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
      else ids = [];
      const chosen = new Set(ids);
      return options.filter((o) => chosen.has(o.id)).map(optionLabel);
    }
    default:
      return raw ?? null;
  }
}

function duplicateNames(vars: readonly PresetVar[]): Set<string> {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const v of vars) { if (seen.has(v.def.name)) dup.add(v.def.name); seen.add(v.def.name); }
  return dup;
}

function varPath(presetId: string, v: PresetVar, dup: ReadonlySet<string>): string {
  return dup.has(v.def.name) ? `preset/${presetId}/var/${v.block.id}/${v.def.name}` : `preset/${presetId}/var/${v.def.name}`;
}

function varRow(presetId: string, v: PresetVar, dup: ReadonlySet<string>): Record<string, unknown> {
  const d = v.def as Record<string, unknown>;
  const value = effective(v.def, v.raw);
  const fallback = effective(v.def, undefined);
  const row: Record<string, unknown> = {
    path: varPath(presetId, v, dup),
    label: typeof v.def.label === "string" && v.def.label.length > 0 ? v.def.label : v.def.name,
    type: v.def.type,
    value: typeof value === "string" ? clip(value, 240) : value,
  };
  if (JSON.stringify(value) !== JSON.stringify(fallback)) row["default"] = typeof fallback === "string" ? clip(fallback, 120) : fallback;
  if (v.def.type === "select" || v.def.type === "multiselect") {
    const labels = optionsOf(v.def).map(optionLabel);
    row["options"] = labels.length > 40 ? [...labels.slice(0, 40), `(+${labels.length - 40} more)`] : labels;
  }
  for (const k of ["min", "max", "step"]) if (typeof d[k] === "number") row[k] = d[k];
  row["block"] = v.block.name || "block";
  if (v.block.enabled === false) row["block_enabled"] = false;
  if (typeof d["description"] === "string" && (d["description"] as string).length > 0) row["description"] = clip(d["description"] as string, 160);
  return row;
}

export function presetVarTable(p: UserPresetDTO, query?: string): Record<string, unknown> {
  const vars = presetVars(p);
  const dup = duplicateNames(vars);
  const q = norm(query ?? "");
  const rows = vars
    .filter((v) => q.length === 0 || norm(`${v.def.label ?? ""} ${v.def.name} ${v.block.name ?? ""}`).includes(q))
    .map((v) => varRow(p.id, v, dup));
  const off = rows.filter((r) => r["block_enabled"] === false).length;
  return {
    path: `preset/${p.id}/var`,
    preset: p.name,
    count: rows.length,
    ...(q.length > 0 ? { of: vars.length } : {}),
    variables: rows,
    note: vars.length === 0
      ? "This preset defines no settings variables. Its behaviour is controlled by enabling or disabling blocks: list({path:\"preset/<id>\"})."
      : `Change one with set({path:"<row path>", value}) or several with set({path:"preset/${p.id}/var", value:{"<label or name>": value}}). select takes an option label, multiselect an array of labels or {add:[...], remove:[...]}, switch true/false.${off > 0 ? ` ${off} belong to a disabled block and have no effect until that block is enabled.` : ""}`,
  };
}

function resolveVar(presetId: string, vars: readonly PresetVar[], key: string, blockId?: string): PresetVar | string {
  const dup = duplicateNames(vars);
  const pool = blockId ? vars.filter((v) => v.block.id === blockId) : vars;
  if (blockId && pool.length === 0) return `block ${blockId} has no variables in this preset`;
  const want = norm(key);
  let hits = pool.filter((v) => v.def.name === key);
  if (hits.length === 0) hits = pool.filter((v) => norm(v.def.name) === want || norm(v.def.label ?? "") === want);
  if (hits.length === 0) hits = pool.filter((v) => norm(v.def.label ?? "").includes(want) || norm(v.def.name).includes(want));
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) {
    return `no variable matches '${key}'. Variables: ${pool.slice(0, 60).map((v) => `${JSON.stringify(v.def.label || v.def.name)} (${v.def.name})`).join(", ")}`;
  }
  return `'${key}' matches ${hits.length} variables: ${hits.slice(0, 12).map((v) => `${JSON.stringify(v.def.label || v.def.name)} in block ${JSON.stringify(v.block.name)} at ${varPath(presetId, v, dup)}`).join(", ")}. Use one exact path.`;
}

function resolveOption(def: PromptVariableDefDTO, wanted: unknown): string | { error: string } {
  const options = optionsOf(def);
  const text = String(wanted);
  const want = norm(text);
  let hits = options.filter((o) => o.id === text);
  if (hits.length === 0) hits = options.filter((o) => norm(optionLabel(o)) === want);
  if (hits.length === 0) hits = options.filter((o) => typeof o.value === "string" && o.value === text);
  if (hits.length === 0) hits = options.filter((o) => norm(optionLabel(o)).includes(want));
  if (hits.length === 1) return hits[0]!.id;
  const labels = options.slice(0, 60).map((o) => JSON.stringify(optionLabel(o))).join(", ");
  return { error: hits.length === 0 ? `'${text}' is not an option. Options: ${labels}` : `'${text}' matches ${hits.length} options: ${hits.map((o) => JSON.stringify(optionLabel(o))).join(", ")}` };
}

function toStored(def: PromptVariableDefDTO, value: unknown, raw: unknown): { stored: unknown } | string {
  const d = def as Record<string, unknown>;
  const label = JSON.stringify(def.label || def.name);
  switch (def.type) {
    case "text":
    case "textarea":
      if (typeof value === "string") return { stored: value };
      if (typeof value === "number" || typeof value === "boolean") return { stored: String(value) };
      return `${label} is text. Pass a string.`;
    case "number":
    case "slider": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim().length > 0 ? Number(value) : NaN;
      if (!Number.isFinite(n)) return `${label} is a number. Got ${JSON.stringify(value)}.`;
      const min = d["min"], max = d["max"];
      if ((typeof min === "number" && n < min) || (typeof max === "number" && n > max)) {
        return `${label} must be between ${typeof min === "number" ? min : "-inf"} and ${typeof max === "number" ? max : "inf"}. Got ${n}.`;
      }
      return { stored: n };
    }
    case "range": {
      const pair = Array.isArray(value) ? value : isRecord(value) ? [value["min"] ?? value["from"], value["max"] ?? value["to"]] : null;
      if (!pair || pair.length !== 2) return `${label} is a range. Pass [low, high].`;
      const a = Number(pair[0]), b = Number(pair[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return `${label} is a range. Pass two numbers [low, high].`;
      const min = d["min"], max = d["max"];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if ((typeof min === "number" && lo < min) || (typeof max === "number" && hi > max)) return `${label} must stay within ${String(min)} to ${String(max)}. Got [${lo}, ${hi}].`;
      return { stored: [lo, hi] };
    }
    case "switch": {
      if (typeof value === "boolean") return { stored: value ? 1 : 0 };
      if (value === 1 || value === 0) return { stored: value };
      const s = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (["1", "true", "on", "yes", "enabled", "enable"].includes(s)) return { stored: 1 };
      if (["0", "false", "off", "no", "disabled", "disable"].includes(s)) return { stored: 0 };
      return `${label} is a switch. Pass true or false.`;
    }
    case "select": {
      if (value === null || value === undefined || Array.isArray(value) || typeof value === "object") return `${label} is a select. Pass one option label.`;
      const id = resolveOption(def, value);
      return typeof id === "string" ? { stored: id } : `${label}: ${id.error}`;
    }
    case "multiselect": {
      const options = optionsOf(def);
      const resolveAll = (list: unknown[]): string[] | string => {
        const ids: string[] = [];
        for (const item of list) {
          const id = resolveOption(def, item);
          if (typeof id !== "string") return `${label}: ${id.error}`;
          ids.push(id);
        }
        return ids;
      };
      const validIds = new Set(options.map((o) => o.id));
      let chosen: Set<string>;
      if (isRecord(value) && ("add" in value || "remove" in value)) {
        const currentIds = Array.isArray(raw) ? raw.map(String) : Array.isArray(d["defaultValue"]) ? (d["defaultValue"] as unknown[]).map(String) : [];
        chosen = new Set(currentIds.filter((id) => validIds.has(id)));
        const toList = (x: unknown): unknown[] => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x]);
        const add = resolveAll(toList(value["add"]));
        if (typeof add === "string") return add;
        const remove = resolveAll(toList(value["remove"]));
        if (typeof remove === "string") return remove;
        for (const id of add) chosen.add(id);
        for (const id of remove) chosen.delete(id);
      } else {
        const list = Array.isArray(value) ? value : typeof value === "string" ? (value.length > 0 ? [value] : []) : null;
        if (!list) return `${label} is a multiselect. Pass an array of option labels, or {add:[...], remove:[...]}.`;
        const ids = resolveAll(list);
        if (typeof ids === "string") return ids;
        chosen = new Set(ids);
      }
      return { stored: options.filter((o) => chosen.has(o.id)).map((o) => o.id) };
    }
    default:
      return `${label} has unsupported type '${String((def as { type?: unknown }).type)}'.`;
  }
}

export async function setPresetVars(ctx: ToolCtx, presetId: string, target: string[] | null, value: unknown): Promise<ToolOut> {
  const p = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!p) return fail("PATH_NOT_FOUND", `preset ${presetId} not found`);
  const vars = presetVars(p);
  if (vars.length === 0) return fail("PATH_NOT_FOUND", `preset ${JSON.stringify(p.name)} defines no settings variables. Its options are blocks: list({path:"preset/${presetId}"}) and toggle with set({path:"preset/${presetId}/block/<blockId>/enabled", value}).`);

  const wanted: Array<{ key: string; blockId?: string; value: unknown }> = [];
  if (target && target.length > 0) {
    if (target.length > 2) return fail("INVALID_INPUT", `expected preset/${presetId}/var/<name or label> or preset/${presetId}/var/<blockId>/<name>`);
    wanted.push(target.length === 2 ? { blockId: target[0]!, key: target[1]!, value } : { key: target[0]!, value });
  } else {
    let map = value;
    if (typeof map === "string" && map.trim().startsWith("{")) { try { map = JSON.parse(map); } catch { /* reported below */ } }
    if (!isRecord(map) || Object.keys(map).length === 0) return fail("INVALID_INPUT", `set on preset/${presetId}/var takes an object of {"<label or name>": value}. For one variable use preset/${presetId}/var/<name>.`);
    for (const [key, v] of Object.entries(map)) wanted.push({ key, value: v });
  }

  const next: StoredValues = {};
  for (const [blockId, bucket] of Object.entries(storedValues(p))) next[blockId] = { ...(isRecord(bucket) ? bucket : {}) };
  const changes: Array<{ v: PresetVar; stored: unknown; from: unknown }> = [];
  const errors: string[] = [];
  for (const w of wanted) {
    const v = resolveVar(presetId, vars, w.key, w.blockId);
    if (typeof v === "string") { errors.push(v); continue; }
    const parsed = toStored(v.def, w.value, next[v.block.id]?.[v.def.name] ?? v.raw);
    if (typeof parsed === "string") { errors.push(parsed); continue; }
    const from = effective(v.def, next[v.block.id]?.[v.def.name] ?? v.raw);
    (next[v.block.id] ??= {})[v.def.name] = parsed.stored;
    changes.push({ v, stored: parsed.stored, from });
  }
  if (errors.length > 0) return fail("INVALID_INPUT", `${errors.join(" | ")}${changes.length > 0 ? " Nothing was written." : ""}`);

  const updated = await ctx.spindle.presets.update(presetId, { metadata: { ...(p.metadata ?? {}), promptVariables: next }, expected_cache_revision: p.cache_revision ?? 0 } as UserPresetUpdateDTO, ctx.userId);
  const landed = storedValues(updated);
  const lost = changes.filter((c) => JSON.stringify(landed[c.v.block.id]?.[c.v.def.name]) !== JSON.stringify(c.stored));
  const before = encodeScalar("metadata", p.metadata ?? {});
  const after = encodeScalar("metadata", updated.metadata ?? {});
  if (before !== after) {
    ctx.pushEdit({
      op: "edit", surface: "preset", surfaceId: presetId, surfaceLabel: p.name, field: "metadata",
      before, after, scope: { kind: "preset", id: presetId },
    } satisfies EditRecord);
  }
  if (lost.length > 0) return fail("NOT_APPLIED", `the host did not keep: ${lost.map((c) => c.v.def.name).join(", ")}.`);

  const disabled = [...new Set(changes.filter((c) => c.v.block.enabled === false).map((c) => c.v.block.name || "block"))];
  return {
    content: JSON.stringify({
      preset: p.name,
      changed: changes.map((c) => {
        const to = effective(c.v.def, c.stored);
        return { variable: c.v.def.label || c.v.def.name, from: c.from, to, ...(JSON.stringify(c.from) === JSON.stringify(to) ? { unchanged: true } : {}) };
      }),
      ...(disabled.length > 0 ? { note: `Saved, but block${disabled.length > 1 ? "s" : ""} ${disabled.map((n) => JSON.stringify(n)).join(", ")} ${disabled.length > 1 ? "are" : "is"} disabled, so ${disabled.length > 1 ? "these values have" : "this value has"} no effect until enabled.` } : {}),
    }, null, 2),
  };
}

// ---------- preset fields

export interface PresetFieldWrite {
  before: string;
  after: string;
  label: string;
  surface: "preset";
  surfaceId: string;
  field: string;
  report?: Record<string, unknown>;
}

function keySummary(v: unknown): string {
  if (!isRecord(v)) return "(not an object)";
  return Object.entries(v).map(([k, x]) => (isRecord(x) ? `${k}{${Object.keys(x).slice(0, 24).join(",")}}` : k)).join(", ") || "(empty)";
}

export async function setPresetField(ctx: ToolCtx, presetId: string, rawField: string, value: unknown): Promise<PresetFieldWrite | string> {
  const dot = rawField.search(/[.[]/);
  const field = dot < 0 ? rawField : rawField.slice(0, dot);
  const sub = dot < 0 ? "" : rawField.slice(dot).replace(/^\./, "");
  if (!PRESET_FIELDS.has(field)) {
    return `[PATH_NOT_FOUND] preset has no field '${field}'. Fields: name, provider, engine, parameters, prompts, metadata, prompt_order. Sampler values live at preset/${presetId}/parameters/samplerOverrides/<key>, settings variables at preset/${presetId}/var/<name>, block switches at preset/${presetId}/block/<blockId>/enabled.`;
  }
  const p = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!p) return `[PATH_NOT_FOUND] preset ${presetId} not found`;
  const before = (p as unknown as Record<string, unknown>)[field];
  let next: unknown;
  let report: Record<string, unknown> | undefined;
  let segs: ReturnType<typeof parseExtensionPath> = [];

  if (sub.length > 0) {
    if (!OBJECT_FIELDS.has(field)) return `[PATH_NOT_FOUND] preset.${field} has no sub-fields. Set preset/${presetId}/${field} directly.`;
    try { segs = parseExtensionPath(sub); } catch (err) { return `[PATH_NOT_FOUND] ${(err as Error).message}`; }
    const old = getAtPath(before ?? {}, segs);
    if (old === undefined && field !== "metadata") {
      const parent = getAtPath(before ?? {}, segs.slice(0, -1));
      return `[PATH_NOT_FOUND] ${field}.${sub} does not exist in this preset. Keys ${segs.length > 1 ? `under ${field}.${sub.slice(0, sub.lastIndexOf("."))}` : `in ${field}`}: ${keySummary(parent)}. All of ${field}: ${keySummary(before)}.`;
    }
    if (typeof old === "number" && typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) value = Number(value);
    if (typeof old === "boolean" && (value === "true" || value === "false")) value = value === "true";
    if ((typeof old === "number" || typeof old === "boolean") && value !== null && typeof value !== typeof old) {
      return `[INVALID_VALUE_TYPE] ${field}.${sub} is a ${typeof old} (currently ${JSON.stringify(old)}). Got ${JSON.stringify(value)}.`;
    }
    next = setAtPath(before ?? {}, segs, value);
    report = { path: `preset/${presetId}/${field}/${sub.replace(/\./g, "/")}`, preset: p.name, before: old ?? null, after: value };
  } else {
    // A JSON-encoded string sent for an object field would otherwise overwrite it with a string.
    if (before && typeof before === "object" && typeof value === "string") {
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { parsed = undefined; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) !== Array.isArray(before)) {
        return `[INVALID_VALUE_TYPE] preset.${field} is ${Array.isArray(before) ? "an array" : "an object"}. Pass value as a JSON ${Array.isArray(before) ? "array" : "object"}, not a string. To change one value inside it use preset/${presetId}/${field}/<dotted.path>.`;
      }
      value = parsed;
    }
    if (OBJECT_FIELDS.has(field) && isRecord(before)) {
      if (!isRecord(value)) return `[INVALID_VALUE_TYPE] preset.${field} is an object. To change one value inside it use preset/${presetId}/${field}/<dotted.path>.`;
      const dropped = Object.keys(before).filter((k) => !(k in (value as Record<string, unknown>)));
      if (dropped.length > 0) {
        return `[WOULD_DROP_KEYS] replacing ${field} wholesale would delete ${dropped.join(", ")}. To change one value use preset/${presetId}/${field}/<dotted.path>, e.g. ${field}/${dropped[0]}. Current shape: ${keySummary(before)}.`;
      }
    }
    if ((field === "name" || field === "provider" || field === "engine") && (typeof value !== "string" || value.trim().length === 0)) {
      return `[INVALID_VALUE_TYPE] preset.${field} takes a non-empty string.`;
    }
    next = value;
  }

  // The host rejects a stale expected_cache_revision, so a concurrent user edit fails instead of being overwritten.
  const updated = await ctx.spindle.presets.update(presetId, { [field]: next, expected_cache_revision: p.cache_revision ?? 0 } as UserPresetUpdateDTO, ctx.userId);
  const landed = (updated as unknown as Record<string, unknown>)[field];
  if (sub.length > 0 && JSON.stringify(getAtPath(landed ?? {}, segs)) !== JSON.stringify(value)) {
    return `[NOT_APPLIED] the host did not keep ${field}.${sub}. Stored value: ${clip(JSON.stringify(getAtPath(landed ?? {}, segs) ?? null), 200)}.`;
  }
  return {
    before: encodeScalar(field, before), after: encodeScalar(field, landed),
    label: p.name, surface: "preset", surfaceId: presetId, field,
    ...(report ? { report } : {}),
  };
}

// ---------- duplicate / create

function cleanBlock(b: Block, dropIdentity: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(b as unknown as Record<string, unknown>) };
  for (const k of SEALED_KEYS) delete out[k];
  if (dropIdentity) { delete out["id"]; delete out["stashId"]; }
  return out;
}

async function activePresetId(ctx: ToolCtx, chatId?: string | null): Promise<{ preset_id: string | null; source: string } | null> {
  try {
    const a = await ctx.spindle.presets.getActive(chatId ?? undefined, ctx.userId);
    return a ? { preset_id: a.preset_id, source: a.source } : null;
  } catch { return null; }
}

export async function describeActivePreset(ctx: ToolCtx, presets: readonly UserPresetDTO[]): Promise<Record<string, unknown> | null> {
  const selected = await activePresetId(ctx);
  const chat = ctx.pinnedChatId ? await activePresetId(ctx, ctx.pinnedChatId) : null;
  const name = (id: string | null | undefined) => (id ? presets.find((p) => p.id === id)?.name ?? null : null);
  if (!selected && !chat) return null;
  const out: Record<string, unknown> = {};
  if (selected) out["selected"] = selected.preset_id ? { path: `preset/${selected.preset_id}`, name: name(selected.preset_id) } : null;
  if (chat) {
    out["pinned_chat_uses"] = chat.preset_id
      ? { path: `preset/${chat.preset_id}`, name: name(chat.preset_id), ...(chat.source !== "none" ? { chosen_by: `${chat.source} profile` } : {}) }
      : null;
  }
  return out;
}

export async function createPreset(ctx: ToolCtx, v: Record<string, unknown>): Promise<ToolOut> {
  const ignored = Object.keys(v).filter((k) => !PRESET_CREATE_KEYS.has(k));
  const name = typeof v.name === "string" && v.name.trim().length > 0 ? v.name : undefined;
  let source: UserPresetDTO | null = null;
  if (v.copy_of !== undefined) {
    const found = await findPreset(ctx, v.copy_of);
    if (isOut(found)) return found;
    source = found;
  }
  if (!name) return fail("INVALID_INPUT", source ? "a duplicate needs value.name, the name of the copy" : "preset requires value.name and value.provider, or value.copy_of to duplicate an existing preset");
  const provider = typeof v.provider === "string" && v.provider.length > 0 ? v.provider : source?.provider;
  if (!provider) return fail("INVALID_INPUT", "preset requires value.provider. Existing presets use \"loom\". To duplicate one pass value.copy_of.");

  const create: UserPresetCreateDTO = { name, provider };
  if (source) {
    create.engine = source.engine;
    create.parameters = structuredClone(source.parameters ?? {});
    create.prompts = structuredClone(source.prompts ?? {});
    create.prompt_order = blocksOf(source).map((b) => cleanBlock(structuredClone(b), false)) as unknown as NonNullable<UserPresetCreateDTO["prompt_order"]>;
    // Hub provenance keys tie a preset to its published original, so a copy starts without them.
    const metadata = Object.fromEntries(Object.entries(structuredClone(source.metadata ?? {})).filter(([k]) => !k.startsWith("_lumiverse_")));
    metadata["isDefault"] = false;
    metadata["lastProfileKey"] = null;
    create.metadata = metadata;
  }
  if (typeof v.engine === "string") create.engine = v.engine;
  if (isRecord(v.parameters)) create.parameters = v.parameters;
  if (isRecord(v.prompts)) create.prompts = v.prompts;
  if (Array.isArray(v.prompt_order)) create.prompt_order = v.prompt_order as NonNullable<UserPresetCreateDTO["prompt_order"]>;
  if (isRecord(v.metadata)) create.metadata = { ...(create.metadata ?? {}), ...v.metadata };
  if (typeof v.description === "string") create.metadata = { ...(create.metadata ?? {}), description: v.description };

  const p = await ctx.spindle.presets.create(create, ctx.userId);
  ctx.pushEdit({
    op: "create", surface: "preset", surfaceId: p.id, surfaceLabel: p.name,
    snapshot: { preset: { ...p, prompt_order: [] }, blocks: [] }, scope: { kind: "preset", id: p.id },
  } satisfies EditRecord);

  const notes: string[] = [];
  if (ignored.length > 0) notes.push(`Ignored value fields: ${ignored.join(", ")}.`);
  const blocks = blocksOf(p);
  const out: Record<string, unknown> = { preset_id: p.id, path: `preset/${p.id}`, name: p.name, provider: p.provider, blocks: blocks.length };
  if (source) {
    const srcBlocks = blocksOf(source);
    const srcValues = Object.values(storedValues(source)).reduce((n, b) => n + Object.keys(b ?? {}).length, 0);
    const gotValues = Object.values(storedValues(p)).reduce((n, b) => n + Object.keys(b ?? {}).length, 0);
    out["copied_from"] = source.name;
    out["blocks_enabled"] = blocks.filter((b) => b.enabled !== false).length;
    out["variables"] = presetVars(p).length;
    out["variable_values_copied"] = gotValues;
    if (blocks.length !== srcBlocks.length) notes.push(`Source has ${srcBlocks.length} blocks, the copy has ${blocks.length}.`);
    if (gotValues !== srcValues) notes.push(`Source stores ${srcValues} variable values, the copy stores ${gotValues}.`);
    const sealed = srcBlocks.filter((b) => b.sealed === true).length;
    if (sealed > 0) notes.push(`${sealed} sealed blocks load their text through the source's hub link and render empty in the copy.`);
    const bound = (await listAllRegexScripts(ctx).catch(() => [])).filter((s) => s.preset_id === source!.id);
    if (bound.length > 0) {
      const folder = bound.find((s) => (s.folder ?? "").length > 0)?.folder;
      // The host runs an extension-created script under every preset, so copying these here would double them up.
      notes.push(`${bound.length} regex scripts${folder ? ` (folder ${JSON.stringify(folder)})` : ""} are bound to the source preset and run only while it is selected, so the copy runs without them. Do not copy them with create: scripts made here run under every preset, not only the copy. Tell the user, who can duplicate them for the new preset in the Regex panel.`);
    }
    notes.push("The copy is not selected. The user picks it in the preset picker.");
  }
  if (notes.length > 0) out["note"] = notes.join(" ");
  return { content: JSON.stringify(out, null, 2) };
}

function resolveBlockRef(blocks: readonly Block[], ref: unknown, what: string): number | string {
  if (typeof ref !== "string" || ref.trim().length === 0) return `${what} takes a block id or block name`;
  const id = ref.trim().replace(/^preset\/[^/]+\/block\//, "").replace(/\/(content|name)$/, "");
  const byId = blocks.findIndex((b) => b.id === id);
  if (byId >= 0) return byId;
  const want = norm(ref);
  let hits = blocks.map((b, i) => ({ b, i })).filter((x) => norm(x.b.name ?? "") === want);
  if (hits.length === 0) hits = blocks.map((b, i) => ({ b, i })).filter((x) => norm(x.b.name ?? "").includes(want));
  if (hits.length === 1) return hits[0]!.i;
  if (hits.length === 0) return `${what}: no block matches '${ref}'. Find it with list({path:"preset/<presetId>", query}).`;
  return `${what}: '${ref}' matches ${hits.length} blocks: ${hits.slice(0, 12).map((x) => `${JSON.stringify(x.b.name)} (${x.b.id}, position ${x.i})`).join(", ")}. Pass one block id.`;
}

export async function createPresetBlocks(ctx: ToolCtx, presetId: string, v: Record<string, unknown>): Promise<ToolOut> {
  const dst = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!dst) return fail("PATH_NOT_FOUND", `preset ${presetId} not found`);
  const dstBlocks = blocksOf(dst);
  const ignored = Object.keys(v).filter((k) => !BLOCK_KEYS.has(k) && !BLOCK_CONTROL_KEYS.has(k));
  if (v.role !== undefined && (typeof v.role !== "string" || !BLOCK_ROLES.has(v.role))) return fail("INVALID_INPUT", `invalid role ${JSON.stringify(v.role)}. Valid: ${[...BLOCK_ROLES].join(", ")}`);
  if (v.position !== undefined && (typeof v.position !== "string" || !BLOCK_POSITIONS.has(v.position))) return fail("INVALID_INPUT", `invalid position ${JSON.stringify(v.position)}. Valid: ${[...BLOCK_POSITIONS].join(", ")}. To place the block in the list use index, after or before.`);

  let index: number | undefined;
  if (v.after !== undefined) {
    const at = resolveBlockRef(dstBlocks, v.after, "after");
    if (typeof at === "string") return fail("INVALID_INPUT", at);
    index = at + 1;
  } else if (v.before !== undefined) {
    const at = resolveBlockRef(dstBlocks, v.before, "before");
    if (typeof at === "string") return fail("INVALID_INPUT", at);
    index = at;
  } else if (typeof v.index === "number" && Number.isFinite(v.index)) {
    index = Math.max(0, Math.min(dstBlocks.length, Math.floor(v.index)));
  }

  const overrides: Record<string, unknown> = {};
  for (const k of BLOCK_KEYS) if (v[k] !== undefined) overrides[k] = v[k];

  type Source = { block: Block; values: Record<string, unknown> | null; from: string };
  const sources: Source[] = [];
  const refs = Array.isArray(v.copy_of) ? v.copy_of : v.copy_of !== undefined ? [v.copy_of] : [];
  const srcCache = new Map<string, UserPresetDTO>([[presetId, dst]]);
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length === 0) return fail("INVALID_INPUT", "copy_of takes preset/<presetId>/block/<blockId>, or an array of them");
    const m = /^preset\/([^/]+)\/block\/([^/]+)/.exec(ref.trim());
    const srcId = m ? m[1]! : presetId;
    let src = srcCache.get(srcId);
    if (!src) {
      const got = await ctx.spindle.presets.get(srcId, ctx.userId);
      if (!got) return fail("PATH_NOT_FOUND", `preset ${srcId} not found`);
      src = got;
      srcCache.set(srcId, src);
    }
    const at = resolveBlockRef(blocksOf(src), m ? m[2]! : ref, "copy_of");
    if (typeof at === "string") return fail("PATH_NOT_FOUND", at);
    const block = blocksOf(src)[at]!;
    const bucket = storedValues(src)[block.id];
    sources.push({ block, values: isRecord(bucket) && Object.keys(bucket).length > 0 ? bucket : null, from: `preset/${srcId}/block/${block.id}` });
  }
  if (sources.length > 1) for (const k of ["name", "content"]) if (overrides[k] !== undefined) { delete overrides[k]; ignored.push(k); }

  const inputs: Array<{ fields: Record<string, unknown>; source: Source | null }> = sources.length > 0
    ? sources.map((s) => ({ fields: { ...cleanBlock(structuredClone(s.block), true), ...overrides }, source: s }))
    : [{ fields: overrides, source: null }];

  const created: Array<{ block: Block; index: number; source: Source | null }> = [];
  const carried: StoredValues = {};
  let failure: string | null = null;
  for (let i = 0; i < inputs.length; i++) {
    ctx.signal.throwIfAborted();
    const input = inputs[i]!;
    const at = index === undefined ? undefined : index + i;
    try {
      const b = await ctx.spindle.presets.blocks.create(presetId, input.fields as PromptBlockCreateDTO, { ...(at !== undefined ? { index: at } : {}), userId: ctx.userId });
      ctx.pushEdit({
        op: "create", surface: "preset_block", surfaceId: `${presetId}:${b.id}`,
        surfaceLabel: `${b.name || "block"}`, snapshot: b, scope: { kind: "preset", id: presetId },
      } satisfies EditRecord);
      if (input.source?.values && Array.isArray(b.variables) && b.variables.length > 0) carried[b.id] = { ...input.source.values };
      created.push({ block: b, index: at ?? dstBlocks.length + i, source: input.source });
    } catch (err) {
      failure = `${JSON.stringify(input.fields["name"] ?? "block")}: ${(err as Error).message}`;
      break;
    }
  }
  if (created.length === 0) return fail("SPINDLE_ERROR", failure ?? "nothing was created");

  const notes: string[] = [];
  if (Object.keys(carried).length > 0) {
    try {
      const live = await ctx.spindle.presets.get(presetId, ctx.userId);
      if (live) {
        await ctx.spindle.presets.update(presetId, {
          metadata: { ...(live.metadata ?? {}), promptVariables: { ...storedValues(live), ...carried } },
          expected_cache_revision: live.cache_revision ?? 0,
        } as UserPresetUpdateDTO, ctx.userId);
      }
    } catch (err) {
      notes.push(`Blocks were copied but their variable values were not: ${(err as Error).message}. Set them at preset/${presetId}/var.`);
    }
  }
  if (failure) notes.push(`Stopped after ${created.length} of ${inputs.length}: ${failure}. The created blocks are kept and revertable.`);
  if (ignored.length > 0) notes.push(`Ignored value fields: ${ignored.join(", ")}.`);
  const row = (c: (typeof created)[number]) => ({
    block_id: c.block.id, path: `preset/${presetId}/block/${c.block.id}`, name: c.block.name, index: c.index,
    enabled: c.block.enabled !== false, chars: typeof c.block.content === "string" ? c.block.content.length : 0,
    ...(Array.isArray(c.block.variables) && c.block.variables.length > 0 ? { variables: c.block.variables.length } : {}),
    ...(c.source ? { copied_from: c.source.from } : {}),
  });
  const body = created.length === 1
    ? { preset_id: presetId, ...row(created[0]!) }
    : { preset_id: presetId, created: created.length, of: inputs.length, blocks: created.map(row) };
  return { content: JSON.stringify({ ...body, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) }, null, 2), ...(failure ? { isError: true } : {}) };
}

export async function movePresetBlock(ctx: ToolCtx, presetId: string, blockId: string, mode: string, value: unknown): Promise<PresetFieldWrite | string> {
  const p = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!p) return `[PATH_NOT_FOUND] preset ${presetId} not found`;
  const blocks = blocksOf(p);
  const from = blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return `[PATH_NOT_FOUND] block ${blockId} not in preset ${presetId}`;
  const rest = blocks.filter((_, i) => i !== from);
  let to: number;
  if (mode === "index") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim().length > 0 ? Number(value) : NaN;
    if (!Number.isFinite(n)) return `[INVALID_VALUE_TYPE] index takes a number from 0 to ${blocks.length - 1}. To place relative to another block set .../after or .../before to its name or id.`;
    to = Math.max(0, Math.min(rest.length, Math.floor(n)));
  } else {
    const at = resolveBlockRef(rest, value, mode);
    if (typeof at === "string") return `[INVALID_INPUT] ${at}`;
    to = mode === "after" ? at + 1 : at;
  }
  const next = [...rest.slice(0, to), blocks[from]!, ...rest.slice(to)];
  const updated = await ctx.spindle.presets.update(presetId, { prompt_order: next as unknown as NonNullable<UserPresetCreateDTO["prompt_order"]>, expected_cache_revision: p.cache_revision ?? 0 } as UserPresetUpdateDTO, ctx.userId);
  const landed = blocksOf(updated);
  const index = landed.findIndex((b) => b.id === blockId);
  return {
    before: encodeScalar("prompt_order", p.prompt_order), after: encodeScalar("prompt_order", updated.prompt_order),
    label: p.name, surface: "preset", surfaceId: presetId, field: "prompt_order",
    report: {
      preset: p.name, block: blocks[from]!.name, from_index: from, index,
      ...(index > 0 ? { now_after: landed[index - 1]!.name } : {}),
      ...(index < landed.length - 1 ? { now_before: landed[index + 1]!.name } : {}),
    },
  };
}

// ---------- overview

export async function inspectPreset(ctx: ToolCtx, presetId: string): Promise<Record<string, unknown> | string> {
  const p = await ctx.spindle.presets.get(presetId, ctx.userId);
  if (!p) return `[PATH_NOT_FOUND] preset ${presetId} not found. list({path:"preset"}) shows the ids.`;
  const blocks = Array.isArray(p.prompt_order) ? blocksOf(p) : await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
  const categories: Array<{ name: string; mode?: string; blocks: number; enabled: number }> = [];
  let current: { name: string; mode?: string; blocks: number; enabled: number } | null = null;
  for (const b of blocks) {
    if (b.marker === "category") {
      current = { name: b.name || "category", ...(typeof b.categoryMode === "string" ? { mode: b.categoryMode } : {}), blocks: 0, enabled: 0 };
      categories.push(current);
    } else if (current) {
      current.blocks++;
      if (b.enabled !== false) current.enabled++;
    }
  }
  const vars = presetVars(p);
  const active = await describeActivePreset(ctx, [p]).catch(() => null);
  const params = isRecord(p.parameters) ? p.parameters : {};
  const description = (p.metadata ?? {})["description"];
  return {
    path: `preset/${p.id}`,
    name: p.name,
    provider: p.provider,
    engine: p.engine,
    ...(typeof description === "string" && description.length > 0 ? { description: clip(description, 300) } : {}),
    ...(active ? { is_selected: (active["selected"] as { path?: string } | null)?.path === `preset/${p.id}` } : {}),
    ...(active && "pinned_chat_uses" in active ? { used_by_pinned_chat: (active["pinned_chat_uses"] as { path?: string } | null)?.path === `preset/${p.id}` } : {}),
    blocks: blocks.length,
    blocks_enabled: blocks.filter((b) => b.enabled !== false).length,
    ...(categories.length > 0 ? { categories: categories.length > 60 ? [...categories.slice(0, 60), { name: `(+${categories.length - 60} more)`, blocks: 0, enabled: 0 }] : categories } : {}),
    variables: vars.length,
    ...(blocks.length <= INSPECT_BLOCK_ROWS ? { block_rows: blocks.map((b, index) => ({ path: `preset/${p.id}/block/${b.id}`, label: b.name || "block", index, enabled: b.enabled !== false, chars: typeof b.content === "string" ? b.content.length : 0 })) } : {}),
    prompt_paths: [...walkStringLeaves(p.prompts ?? {})].map((leaf) => `preset/${p.id}/prompts/${leaf.path}`),
    ...(isRecord(params["samplerOverrides"]) ? { sampler: params["samplerOverrides"], sampler_path: `preset/${p.id}/parameters/samplerOverrides/<key>` } : { parameters: params }),
    note: `Blocks: list({path:"preset/${p.id}", query}). ${vars.length > 0 ? `Settings variables with current values: list({path:"preset/${p.id}/var"}). ` : ""}Duplicate: create({path:"preset", value:{copy_of:"${p.id}", name}}).`,
  };
}
