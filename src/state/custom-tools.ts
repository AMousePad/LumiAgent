import type { SpindleAPI } from "lumiverse-spindle-types";
import type { ToolCtx, ToolFn } from "../agent/tools";

// Declarative tool recipes the agent can author at runtime. Storage lives
// under `workspace/custom_tools/{name}/tool.json` with a sibling `tools.md`
// index that the agent maintains. Each recipe is a manifest plus an ordered
// list of built-in tool calls; the interpreter walks the list, substitutes
// `{{param}}` and `{{$var}}` references, and binds step results to `$var`
// names for downstream steps. No JS code is ever executed.

export const CUSTOM_TOOLS_DIR = "workspace/custom_tools";
export const CUSTOM_TOOLS_INDEX = `${CUSTOM_TOOLS_DIR}/tools.md`;
export const CUSTOM_TOOLS_MAX_STEPS = 400;
export const CUSTOM_TOOLS_MAX_DEPTH = 4;
export const CUSTOM_TOOLS_TIMEOUT_MS = 60_000;

// ─── Manifest schema ───

export interface CustomToolParam {
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: unknown;
}

export interface CustomToolStep {
  readonly call: string;
  readonly args?: Record<string, unknown>;
  readonly save_as?: string;
}

export interface CustomToolManifest {
  readonly name: string;
  readonly description: string;
  readonly params: Record<string, CustomToolParam>;
  readonly steps: readonly CustomToolStep[];
  // Optional return template. If omitted, the result of the final saved step
  // is returned. References work the same as in step args.
  readonly return?: unknown;
}

export function validateManifest(raw: unknown): CustomToolManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest must be an object");
  const m = raw as Record<string, unknown>;
  const name = m["name"];
  if (typeof name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/i.test(name)) {
    throw new Error("manifest.name must be a short identifier (a-z, 0-9, _)");
  }
  const description = m["description"];
  if (typeof description !== "string" || description.length < 4) {
    throw new Error("manifest.description must be a non-trivial string");
  }
  const params = (m["params"] ?? {}) as Record<string, unknown>;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("manifest.params must be an object");
  }
  for (const [k, v] of Object.entries(params)) {
    if (!v || typeof v !== "object") throw new Error(`params.${k} must be an object`);
    const t = (v as Record<string, unknown>)["type"];
    if (t !== "string" && t !== "number" && t !== "boolean" && t !== "object" && t !== "array") {
      throw new Error(`params.${k}.type must be one of string/number/boolean/object/array`);
    }
  }
  const stepsRaw = m["steps"];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    throw new Error("manifest.steps must be a non-empty array");
  }
  if (stepsRaw.length > CUSTOM_TOOLS_MAX_STEPS) {
    throw new Error(`manifest.steps exceeds ${CUSTOM_TOOLS_MAX_STEPS}`);
  }
  const steps: CustomToolStep[] = [];
  for (let i = 0; i < stepsRaw.length; i++) {
    const s = stepsRaw[i] as Record<string, unknown>;
    if (!s || typeof s !== "object") throw new Error(`step[${i}] must be an object`);
    const call = s["call"];
    if (typeof call !== "string") throw new Error(`step[${i}].call must be a string`);
    const args = s["args"];
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
      throw new Error(`step[${i}].args must be an object`);
    }
    const saveAs = s["save_as"];
    if (saveAs !== undefined && (typeof saveAs !== "string" || !/^[a-z][a-z0-9_]*$/i.test(saveAs))) {
      throw new Error(`step[${i}].save_as must be a short identifier`);
    }
    const step: CustomToolStep = { call };
    if (args !== undefined) (step as { args?: Record<string, unknown> }).args = args as Record<string, unknown>;
    if (saveAs !== undefined) (step as { save_as?: string }).save_as = saveAs;
    steps.push(step);
  }
  return {
    name,
    description,
    params: params as Record<string, CustomToolParam>,
    steps,
    return: m["return"],
  };
}

// ─── Storage ───

function manifestPath(name: string): string {
  return `${CUSTOM_TOOLS_DIR}/${name}/tool.json`;
}

export async function saveCustomTool(
  spindle: SpindleAPI,
  userId: string,
  manifest: CustomToolManifest,
): Promise<void> {
  await spindle.userStorage.setJson(manifestPath(manifest.name), manifest, { userId, indent: 2 });
}

export async function loadCustomTool(
  spindle: SpindleAPI,
  userId: string,
  name: string,
): Promise<CustomToolManifest | null> {
  const stored = await spindle.userStorage.getJson<unknown>(manifestPath(name), { fallback: null, userId });
  if (!stored) return null;
  try { return validateManifest(stored); } catch { return null; }
}

export async function deleteCustomTool(
  spindle: SpindleAPI,
  userId: string,
  name: string,
): Promise<boolean> {
  try {
    await spindle.userStorage.delete(manifestPath(name), userId);
    try { await spindle.userStorage.delete(`${CUSTOM_TOOLS_DIR}/${name}`, userId); } catch { /* dir may not exist as a separate entry */ }
    return true;
  } catch { return false; }
}

export async function listCustomTools(
  spindle: SpindleAPI,
  userId: string,
): Promise<readonly { name: string; description: string; paramCount: number; stepCount: number }[]> {
  let dirs: string[];
  try { dirs = await spindle.userStorage.list(`${CUSTOM_TOOLS_DIR}/`, userId); }
  catch { return []; }
  const out: { name: string; description: string; paramCount: number; stepCount: number }[] = [];
  for (const rel of dirs) {
    const name = rel.endsWith("/") ? rel.slice(0, -1) : rel;
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) continue;
    const m = await loadCustomTool(spindle, userId, name);
    if (!m) continue;
    out.push({
      name: m.name,
      description: m.description,
      paramCount: Object.keys(m.params).length,
      stepCount: m.steps.length,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readCustomToolsIndex(
  spindle: SpindleAPI,
  userId: string,
): Promise<string | null> {
  try {
    const text = await spindle.userStorage.read(CUSTOM_TOOLS_INDEX, userId);
    return text.length > 0 ? text : null;
  } catch { return null; }
}

// ─── Template substitution ───
//
// Refs look like `{{$body}}` for a top-level binding or
// `{{$pick.picks[0].path}}` to walk into the bound value. Identifiers,
// dotted accessors, and bracketed numeric indices. The dotted form is
// what makes piping useful, without it the only way to use a step's
// result was a whole-object substitution.

const REF_BODY = /\$?[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*|\[\d+\])*/.source;
const TEMPLATE_RE = new RegExp(`\\{\\{\\s*(${REF_BODY})\\s*\\}\\}`, "g");
const WHOLE_RE = new RegExp(`^\\s*\\{\\{\\s*(${REF_BODY})\\s*\\}\\}\\s*$`);

interface RefSegment { kind: "key" | "index"; value: string }

function parseRef(ref: string): { head: string; segments: RefSegment[] } {
  // First token is the binding name (with optional $ sigil); the rest are
  // dotted keys and bracketed indices.
  const stripped = ref.startsWith("$") ? ref.slice(1) : ref;
  const segs: RefSegment[] = [];
  let i = 0;
  while (i < stripped.length && /[A-Za-z0-9_$]/.test(stripped[i]!)) i++;
  const head = stripped.slice(0, i);
  while (i < stripped.length) {
    const ch = stripped[i]!;
    if (ch === ".") {
      i++;
      const start = i;
      while (i < stripped.length && /[A-Za-z0-9_$]/.test(stripped[i]!)) i++;
      segs.push({ kind: "key", value: stripped.slice(start, i) });
    } else if (ch === "[") {
      const close = stripped.indexOf("]", i);
      if (close < 0) throw new Error(`malformed ref '${ref}': unclosed bracket`);
      segs.push({ kind: "index", value: stripped.slice(i + 1, close) });
      i = close + 1;
    } else {
      throw new Error(`malformed ref '${ref}' near '${ch}'`);
    }
  }
  return { head, segments: segs };
}

function lookup(ref: string, scope: Record<string, unknown>): { found: boolean; value: unknown } {
  const { head, segments } = parseRef(ref);
  if (!Object.prototype.hasOwnProperty.call(scope, head)) return { found: false, value: undefined };
  let cur: unknown = scope[head];
  for (const seg of segments) {
    if (cur === null || cur === undefined) return { found: false, value: undefined };
    if (seg.kind === "key") {
      if (typeof cur !== "object" || Array.isArray(cur)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[seg.value];
    } else {
      if (!Array.isArray(cur)) return { found: false, value: undefined };
      cur = cur[parseInt(seg.value, 10)];
    }
  }
  return { found: true, value: cur };
}

function substituteValue(v: unknown, scope: Record<string, unknown>): unknown {
  if (typeof v === "string") return substituteString(v, scope);
  if (Array.isArray(v)) return v.map((item) => substituteValue(item, scope));
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) out[k] = substituteValue(vv, scope);
    return out;
  }
  return v;
}

function substituteString(s: string, scope: Record<string, unknown>): unknown {
  // Whole-string single-reference => return the raw value (not stringified).
  const whole = WHOLE_RE.exec(s);
  if (whole) {
    const ref = whole[1]!;
    const { found, value } = lookup(ref, scope);
    if (!found) {
      // `$` refs are pipeline bindings: not-found is a real bug. Bare refs
      // collide with Risu macros (`{{risu_date}}`), pass them through literal.
      if (ref.startsWith("$")) throw new Error(`unknown ref '{{${ref}}}'`);
      return s;
    }
    return value;
  }
  return s.replace(TEMPLATE_RE, (match, name: string) => {
    const { found, value } = lookup(name, scope);
    if (!found) {
      if (name.startsWith("$")) throw new Error(`unknown ref '{{${name}}}'`);
      return match;
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  });
}

// ─── Runner ───

export interface RunCustomToolOptions {
  readonly dispatch: Record<string, ToolFn>;
  readonly depth: number;
  readonly deadline: number;
  readonly stepBudget: { remaining: number };
}

function coerceParam(value: unknown, schema: CustomToolParam, name: string): unknown {
  const t = schema.type;
  if (value === undefined || value === null) {
    if (schema.required === false) return schema.default;
    if (schema.default !== undefined) return schema.default;
    throw new Error(`missing param '${name}'`);
  }
  const got = Array.isArray(value) ? "array" : typeof value;
  if (t === "object") {
    if (got !== "object" || Array.isArray(value)) throw new Error(`param '${name}' must be an object`);
    return value;
  }
  if (t === "array") {
    if (!Array.isArray(value)) throw new Error(`param '${name}' must be an array`);
    return value;
  }
  if (t === "string" && got !== "string") throw new Error(`param '${name}' must be a string`);
  if (t === "number" && got !== "number") throw new Error(`param '${name}' must be a number`);
  if (t === "boolean" && got !== "boolean") throw new Error(`param '${name}' must be a boolean`);
  return value;
}

function tryParseJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export async function runCustomTool(
  ctx: ToolCtx,
  manifest: CustomToolManifest,
  argsIn: Record<string, unknown>,
  opts: RunCustomToolOptions,
): Promise<unknown> {
  if (opts.depth > CUSTOM_TOOLS_MAX_DEPTH) {
    throw new Error(`custom tool '${manifest.name}' exceeded max recursion depth ${CUSTOM_TOOLS_MAX_DEPTH}`);
  }

  // Build the initial scope from validated params.
  const scope: Record<string, unknown> = {};
  for (const [pname, pschema] of Object.entries(manifest.params)) {
    scope[pname] = coerceParam((argsIn as Record<string, unknown>)[pname], pschema, pname);
  }

  let lastResult: unknown = null;
  const savedKeys: string[] = [];
  for (let i = 0; i < manifest.steps.length; i++) {
    if (Date.now() > opts.deadline) throw new Error(`custom tool '${manifest.name}' timed out`);
    if (opts.stepBudget.remaining <= 0) throw new Error(`custom tool '${manifest.name}' exceeded step budget`);
    opts.stepBudget.remaining -= 1;

    const step = manifest.steps[i]!;
    const callName = step.call;
    if (!Object.prototype.hasOwnProperty.call(opts.dispatch, callName)) {
      throw new Error(`step[${i}] references unknown tool '${callName}'`);
    }
    const fn = opts.dispatch[callName]!;
    const substitutedArgs = step.args ? (substituteValue(step.args, scope) as Record<string, unknown>) : {};

    // Built-in tools return JSON strings; we try to parse so downstream steps
    // can index into structured fields. Fall back to the raw string if not JSON.
    const raw = await fn(substitutedArgs, ctx);
    const parsed = typeof raw === "string" ? tryParseJSON(raw) : raw;
    lastResult = parsed;
    if (step.save_as) {
      scope[step.save_as] = parsed;
      if (!savedKeys.includes(step.save_as)) savedKeys.push(step.save_as);
    }
  }

  // 1. Explicit `return` wins.
  // 2. Otherwise, if the caller saved anything with `save_as`, return ALL
  //    bindings as an object. Anything else is a footgun: the previous
  //    "lastResult only" default silently discarded every saved value
  //    when the caller omitted `return`, costing a re-run.
  // 3. Fall back to lastResult only when no save_as was used.
  if (manifest.return !== undefined) return substituteValue(manifest.return, scope);
  if (savedKeys.length > 0) {
    const out: Record<string, unknown> = {};
    for (const k of savedKeys) out[k] = scope[k];
    return out;
  }
  return lastResult;
}
