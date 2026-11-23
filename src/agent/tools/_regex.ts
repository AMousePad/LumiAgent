import type { RegexScriptCreateDTO, RegexScriptDTO, RegexScopeDTO } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";

const SCOPES: ReadonlySet<string> = new Set(["global", "character", "chat"]);
const TARGETS: ReadonlySet<string> = new Set(["prompt", "response", "display"]);
const PLACEMENTS: ReadonlySet<string> = new Set(["user_input", "ai_output", "world_info", "reasoning"]);
const MACRO_MODES: ReadonlySet<string> = new Set(["none", "find", "raw", "escaped", "after"]);
const PAGE = 200;

// Fields a create value may carry. Anything else is reported back as ignored
// so a dropped field never reads as applied.
const VALUE_KEYS: ReadonlySet<string> = new Set([
  "name", "find_regex", "replace_string", "flags", "placement", "target", "scope", "scope_id",
  "disabled", "description", "folder", "sort_order", "substitute_macros", "min_depth", "max_depth",
  "trim_strings", "run_on_edit", "preset_id", "copy_of", "copy_folder",
]);

type RegexRow = RegexScriptDTO & { actions?: unknown };
type ToolOut = { content: string; isError?: boolean };

const fail = (code: string, message: string): ToolOut => ({ content: `Error: [${code}] ${message}`, isError: true });

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim();
}

export async function listAllRegexScripts(ctx: ToolCtx, filter: { scope?: RegexScopeDTO; scopeId?: string } = {}): Promise<RegexScriptDTO[]> {
  const out: RegexScriptDTO[] = [];
  let offset = 0;
  for (;;) {
    ctx.signal.throwIfAborted();
    const r = await ctx.spindle.regex_scripts.list({
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.scopeId ? { scopeId: filter.scopeId } : {}),
      userId: ctx.userId, limit: PAGE, offset,
    });
    out.push(...r.data);
    if (r.data.length === 0 || out.length >= r.total) break;
    offset += r.data.length;
  }
  return out;
}

export async function countGlobalRegexScripts(ctx: ToolCtx): Promise<number> {
  const r = await ctx.spindle.regex_scripts.list({ scope: "global", userId: ctx.userId, limit: 1, offset: 0 });
  return r.total;
}

// One paged sequence over the character's scripts followed by the global ones.
export function visibleRegexReader(ctx: ToolCtx, characterId: string | null) {
  let charTotal: number | null = characterId ? null : 0;
  let globalTotal: number | null = null;
  return async (limit: number, offset: number): Promise<{ data: readonly RegexScriptDTO[]; total: number }> => {
    if (characterId && (charTotal === null || offset < charTotal)) {
      const page = await ctx.spindle.regex_scripts.list({ scope: "character", scopeId: characterId, userId: ctx.userId, limit, offset });
      charTotal = page.total;
      if (page.data.length > 0) {
        if (globalTotal === null) globalTotal = await countGlobalRegexScripts(ctx);
        return { data: page.data, total: charTotal + globalTotal };
      }
    }
    const base = charTotal ?? 0;
    const page = await ctx.spindle.regex_scripts.list({ scope: "global", userId: ctx.userId, limit, offset: Math.max(0, offset - base) });
    globalTotal = page.total;
    return { data: page.data, total: base + page.total };
  };
}

// Folder and bound preset id are searchable, so one query finds a folder or a preset's scripts.
export function regexSearchKey(s: RegexScriptDTO): string {
  return `${s.name}\n${s.folder ?? ""}\n${s.preset_id ?? ""}`;
}

export function targetList(s: RegexScriptDTO): string[] {
  const t = s.target as unknown;
  return Array.isArray(t) ? (t as string[]) : typeof t === "string" ? [t] : [];
}

function parseTargets(v: unknown): string[] | string {
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0) return "target must name at least one of prompt, response, display";
  for (const t of list) if (typeof t !== "string" || !TARGETS.has(t)) return `invalid target ${JSON.stringify(t)}. Valid: prompt, response, display`;
  return list as string[];
}

function parsePlacement(v: unknown): string[] | string {
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0) return "placement must name at least one of user_input, ai_output, world_info, reasoning";
  for (const p of list) if (typeof p !== "string" || !PLACEMENTS.has(p)) return `invalid placement ${JSON.stringify(p)}. Valid: user_input, ai_output, world_info, reasoning`;
  return list as string[];
}

async function resolveSources(ctx: ToolCtx, v: Record<string, unknown>): Promise<{ sources: RegexRow[]; folder?: string } | ToolOut> {
  if (typeof v.copy_folder === "string" && v.copy_folder.trim().length > 0) {
    const want = norm(v.copy_folder);
    const all = await listAllRegexScripts(ctx);
    let hits = all.filter((s) => norm(s.folder ?? "") === want);
    if (hits.length === 0) {
      const partial = all.filter((s) => (s.folder ?? "").length > 0 && norm(s.folder).includes(want));
      const names = [...new Set(partial.map((s) => s.folder))];
      if (names.length === 1) hits = partial;
      else if (names.length > 1) return fail("AMBIGUOUS", `'${v.copy_folder}' matches ${names.length} regex folders: ${names.slice(0, 20).map((n) => JSON.stringify(n)).join(", ")}. Pass one exact name.`);
    }
    if (hits.length === 0) return fail("PATH_NOT_FOUND", `no regex folder matches '${v.copy_folder}'. Find it with list({path:"rx", query}).`);
    return { sources: hits as RegexRow[], folder: hits[0]!.folder };
  }
  const ids = Array.isArray(v.copy_of) ? v.copy_of : v.copy_of !== undefined ? [v.copy_of] : [];
  const sources: RegexRow[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string" || raw.length === 0) return fail("INVALID_INPUT", "copy_of takes a script id or an array of script ids");
    const id = raw.replace(/^(?:rx|regex_script)\//, "");
    const s = await ctx.spindle.regex_scripts.get(id, ctx.userId);
    if (!s) return fail("PATH_NOT_FOUND", `regex script ${id} not found`);
    sources.push(s as RegexRow);
  }
  return { sources };
}

export async function createRegexScripts(ctx: ToolCtx, v: Record<string, unknown>): Promise<ToolOut> {
  const ignored = Object.keys(v).filter((k) => !VALUE_KEYS.has(k));
  const resolved = await resolveSources(ctx, v);
  if ("content" in resolved) return resolved;
  const { sources } = resolved;
  const copying = sources.length > 0;
  const many = sources.length > 1;

  if (!copying && (typeof v.name !== "string" || v.name.length === 0 || typeof v.find_regex !== "string")) {
    return fail("INVALID_INPUT", "regex script requires value.name and value.find_regex, or value.copy_of / value.copy_folder to copy existing scripts");
  }
  if (typeof v.copy_folder === "string" && v.copy_folder.trim().length > 0) {
    if (typeof v.folder !== "string" || v.folder.trim().length === 0) return fail("INVALID_INPUT", "copy_folder needs value.folder, the name of the destination folder");
    if (norm(v.folder) === norm(resolved.folder ?? "") && v.scope === undefined) return fail("INVALID_INPUT", "destination folder equals the source folder. Pass a different value.folder.");
  }
  if (many) {
    for (const k of ["name", "find_regex", "replace_string"]) if (v[k] !== undefined && !ignored.includes(k)) ignored.push(k);
  }

  const overrides: Partial<RegexScriptCreateDTO> = {};
  if (v.scope !== undefined) {
    if (typeof v.scope !== "string" || !SCOPES.has(v.scope)) return fail("INVALID_INPUT", `invalid scope ${JSON.stringify(v.scope)}. Valid: global, character, chat`);
    const explicitId = typeof v.scope_id === "string" && v.scope_id.length > 0 ? v.scope_id : null;
    if (v.scope === "global") { overrides.scope = "global"; overrides.scope_id = null; }
    else if (v.scope === "character") {
      const id = explicitId ?? ctx.characterId;
      if (!id) return fail("NO_TARGET", "scope 'character' needs value.scope_id or a focused character");
      overrides.scope = "character"; overrides.scope_id = id;
    } else {
      const id = explicitId ?? ctx.pinnedChatId;
      if (!id) return fail("NO_TARGET", "scope 'chat' needs value.scope_id or a pinned chat");
      overrides.scope = "chat"; overrides.scope_id = id;
    }
  }
  if (v.target !== undefined) {
    const t = parseTargets(v.target);
    if (typeof t === "string") return fail("INVALID_INPUT", t);
    overrides.target = (t.length === 1 ? t[0] : t) as unknown as RegexScriptCreateDTO["target"] & string;
  }
  if (v.placement !== undefined) {
    const p = parsePlacement(v.placement);
    if (typeof p === "string") return fail("INVALID_INPUT", p);
    overrides.placement = p as NonNullable<RegexScriptCreateDTO["placement"]>;
  }
  if (v.substitute_macros !== undefined) {
    if (typeof v.substitute_macros !== "string" || !MACRO_MODES.has(v.substitute_macros)) return fail("INVALID_INPUT", `invalid substitute_macros ${JSON.stringify(v.substitute_macros)}. Valid: none, find, raw, escaped, after`);
    overrides.substitute_macros = v.substitute_macros as NonNullable<RegexScriptCreateDTO["substitute_macros"]>;
  }
  if (typeof v.flags === "string") overrides.flags = v.flags;
  if (typeof v.disabled === "boolean") overrides.disabled = v.disabled;
  if (typeof v.description === "string") overrides.description = v.description;
  if (typeof v.folder === "string") overrides.folder = v.folder;
  if (typeof v.sort_order === "number") overrides.sort_order = v.sort_order;
  if (typeof v.min_depth === "number" || v.min_depth === null) overrides.min_depth = v.min_depth;
  if (typeof v.max_depth === "number" || v.max_depth === null) overrides.max_depth = v.max_depth;
  if (Array.isArray(v.trim_strings)) overrides.trim_strings = v.trim_strings.filter((x): x is string => typeof x === "string");
  if (typeof v.run_on_edit === "boolean") overrides.run_on_edit = v.run_on_edit;
  if (typeof v.preset_id === "string" && v.preset_id.length > 0) overrides.preset_id = v.preset_id.replace(/^preset\//, "");
  if (!many) {
    if (typeof v.name === "string" && v.name.length > 0) overrides.name = v.name;
    if (typeof v.find_regex === "string") overrides.find_regex = v.find_regex;
    if (typeof v.replace_string === "string") overrides.replace_string = v.replace_string;
  }

  const inputs: RegexScriptCreateDTO[] = [];
  if (!copying) {
    const fallbackScope: Partial<RegexScriptCreateDTO> = ctx.characterId
      ? { scope: "character", scope_id: ctx.characterId }
      : { scope: "global", scope_id: null };
    inputs.push({
      name: v.name as string, find_regex: v.find_regex as string,
      placement: ["ai_output"], substitute_macros: "none",
      ...fallbackScope, ...overrides,
    });
  } else {
    for (const s of sources) {
      const metadata = { ...(s.metadata ?? {}) };
      // Activation metadata is only valid on a preset-bound row.
      if (overrides.preset_id === undefined) delete metadata["prompt_activation"];
      inputs.push({
        name: s.name, find_regex: s.find_regex, replace_string: s.replace_string, flags: s.flags,
        placement: s.placement, scope: s.scope, scope_id: s.scope_id,
        target: targetList(s) as unknown as RegexScriptCreateDTO["target"] & string,
        min_depth: s.min_depth, max_depth: s.max_depth, trim_strings: s.trim_strings,
        run_on_edit: s.run_on_edit, substitute_macros: s.substitute_macros, disabled: s.disabled,
        sort_order: s.sort_order, description: s.description, folder: s.folder, metadata,
        ...(Array.isArray(s.actions) ? { actions: s.actions } : {}),
        ...overrides,
      } as RegexScriptCreateDTO);
    }
  }

  const created: RegexScriptDTO[] = [];
  let failure: string | null = null;
  for (const input of inputs) {
    ctx.signal.throwIfAborted();
    try {
      const s = await ctx.spindle.regex_scripts.create(input, ctx.userId);
      const scope: ScopeRef | undefined = ctx.characterId ? undefined : { kind: "regex_script", id: s.id };
      ctx.pushEdit({ op: "create", surface: "regex_script", surfaceId: s.id, surfaceLabel: s.name, snapshot: s, ...(scope ? { scope } : {}) } satisfies EditRecord);
      created.push(s);
    } catch (err) {
      failure = `'${input.name}': ${(err as Error).message}`;
      break;
    }
  }
  if (created.length === 0) return fail("SPINDLE_ERROR", failure ?? "nothing was created");

  const notes: string[] = [];
  if (failure) notes.push(`Stopped after ${created.length} of ${inputs.length}: ${failure}. The created scripts are kept and revertable.`);
  if (ignored.length > 0) notes.push(`Ignored value fields: ${ignored.join(", ")}.`);
  if (copying && overrides.preset_id === undefined && sources.some((s) => typeof s.preset_id === "string" && s.preset_id.length > 0)) {
    notes.push("Source scripts are bound to a preset and run only while it is selected. The copies run under every preset.");
  }
  if (overrides.preset_id !== undefined) {
    notes.push("preset_id only ties these scripts' lifetime to that preset: they are deleted with it. Scripts created here still run under every preset while enabled, the host does not switch them with the preset selection.");
  }
  const row = (s: RegexScriptDTO) => ({
    script_id: s.id, name: s.name, scope: s.scope, ...(s.scope_id ? { scope_id: s.scope_id } : {}),
    target: targetList(s).join(","), folder: s.folder ?? "", disabled: s.disabled,
    ...(s.preset_id ? { preset_id: s.preset_id } : {}),
  });
  if (!many) {
    return { content: JSON.stringify({ ...row(created[0]!), ...(copying ? { copied_from: sources[0]!.id } : {}), ...(notes.length > 0 ? { note: notes.join(" ") } : {}) }), ...(failure ? { isError: true } : {}) };
  }
  const first = created[0]!;
  return {
    content: JSON.stringify({
      created: created.length, of: inputs.length, folder: first.folder ?? "", scope: first.scope,
      disabled: created.filter((s) => s.disabled).length,
      scripts: created.map((s) => ({ script_id: s.id, name: s.name, target: targetList(s).join(",") })),
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    }, null, 2),
    ...(failure ? { isError: true } : {}),
  };
}
