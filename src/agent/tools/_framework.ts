import type { z, ZodType } from "zod";
import type { ToolCtx } from "./_context";

export interface ToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

export interface ToolDefinition<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly jsonSchema: Record<string, unknown>;
  readonly requiresRecentRead?: ReadGate;
  // True when the tool's execution is meaningless without an active character
  // (path-based card surface, card mutators, chat/ledger/phone-line ops, etc).
  // Filtered out of the schemas the LLM sees when state.characterId is null,
  // so the agent literally cannot call them in no-character sessions.
  readonly requiresCharacter?: boolean;
  // Grouped tools normalize per action. The merged schema has no per-action `required`, so an outer pass would strip required args.
  readonly normalizesOwnArgs?: boolean;
  // Both default false (safe). isReadOnly is a strict statement that the call
  // performs no spindle/userStorage writes and pushes nothing onto the edit
  // ledger. isConcurrencySafe means it's safe to run alongside other
  // concurrency-safe calls in the same batch, usually equivalent to
  // isReadOnly but tools with side-effects on independent keys may set it
  // without being read-only. Loop runs consecutive concurrency-safe calls
  // in parallel (cap 5).
  readonly isReadOnly?: (input: TInput) => boolean;
  readonly isConcurrencySafe?: (input: TInput) => boolean;
  // Pre-flight validation, called before execute(). Returning a coded error
  // short-circuits dispatch and surfaces to the model. Use for checks that
  // can decide pass/fail without performing side effects (recent-read gate,
  // shape checks, range checks). Heavier checks belong in execute().
  readonly validateInput?: (input: TInput, ctx: ToolCtx) => Promise<ValidationResult> | ValidationResult;
  readonly execute: (input: TInput, ctx: ToolCtx) => Promise<ToolResult>;
}

export type ValidationResult =
  | { readonly result: true }
  | { readonly result: false; readonly message: string; readonly errorCode: string };

export interface ReadGate {
  surface: (input: Record<string, unknown>) => string;
  hint: (key: string) => string;
  // Whole-leaf writers set this so a grep hit, which shows only matching lines, does not satisfy the gate.
  requiresFullRead?: boolean;
}

export function defineTool<TInput>(config: {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  jsonSchema: Record<string, unknown>;
  requiresRecentRead?: ReadGate;
  requiresCharacter?: boolean;
  normalizesOwnArgs?: boolean;
  isReadOnly?: (input: TInput) => boolean;
  isConcurrencySafe?: (input: TInput) => boolean;
  validateInput?: (input: TInput, ctx: ToolCtx) => Promise<ValidationResult> | ValidationResult;
  execute: (input: TInput, ctx: ToolCtx) => Promise<ToolResult>;
}): ToolDefinition<TInput> {
  return config;
}

// These keywords are rejected by provider routes that accept only an OpenAPI subset.
const NON_PORTABLE_SCHEMA_KEYS = new Set([
  "additionalProperties", "$schema", "$id", "$ref", "$defs", "definitions",
  "patternProperties", "unevaluatedProperties", "propertyNames",
]);

function stripNonPortableSchemaKeys(node: unknown): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (NON_PORTABLE_SCHEMA_KEYS.has(k)) continue;
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([name, schema]) => [name, stripNonPortableSchemaKeys(schema)]));
    } else if (k === "items") {
      out[k] = stripNonPortableSchemaKeys(v);
    } else if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(k) && Array.isArray(v)) {
      out[k] = v.map(stripNonPortableSchemaKeys);
    } else {
      out[k] = v;
    }
  }
  // Vertex requires a scalar type. Branches preserve JSON Schema null semantics on other providers.
  if (Array.isArray(out.type)) return { anyOf: out.type.map(type => ({ ...out, type })) };
  return out;
}

// jsonSchema is stable per ToolDefinition, so the deep walk runs once per tool.
const sanitizedSchemaCache = new WeakMap<Record<string, unknown>, Record<string, unknown>>();

function portableJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const hit = sanitizedSchemaCache.get(schema);
  if (hit) return hit;
  const cleaned = stripNonPortableSchemaKeys(schema) as Record<string, unknown>;
  sanitizedSchemaCache.set(schema, cleaned);
  return cleaned;
}

export class ToolRegistry {
  private readonly map = new Map<string, ToolDefinition>();

  register<T>(tool: ToolDefinition<T>): void {
    if (this.map.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' already registered.`);
    }
    this.map.set(tool.name, tool as ToolDefinition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.map.get(name);
  }

  list(): readonly ToolDefinition[] {
    return [...this.map.values()];
  }

  schemas(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: portableJsonSchema(t.jsonSchema),
    }));
  }

  schemaFor(name: string): { name: string; description: string; parameters: Record<string, unknown> } | undefined {
    const t = this.map.get(name);
    if (!t) return undefined;
    return { name: t.name, description: t.description, parameters: portableJsonSchema(t.jsonSchema) };
  }

  // True when the tool requires an active character. Used by the LLM-facing
  // schema build to drop char-required tools in no-character sessions.
  requiresCharacter(name: string): boolean {
    return this.map.get(name)?.requiresCharacter === true;
  }
}

export function formatZodError(err: z.ZodError, schema?: Record<string, unknown>): string {
  const lines = err.issues
    .map((i) => `  • ${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`);
  const props = schema?.properties;
  if (props && typeof props === "object" && err.issues.some((i) => i.code === "unrecognized_keys")) {
    const required = new Set((schema.required as string[] | undefined) ?? []);
    lines.push(`  Valid arguments: ${Object.keys(props).map((k) => k + (required.has(k) ? "*" : "")).join(", ")} (* required)`);
  }
  return lines.join("\n");
}

// A literal "" in these keys means "empty content" (delete the match, write an empty file), not "argument omitted".
const EMPTY_STRING_IS_CONTENT = new Set(["replace", "content", "new_content", "value", "text"]);

type JsonProp = { type?: unknown; items?: { type?: unknown }; anyOf?: unknown[] } | undefined;

function allowsNull(prop: JsonProp): boolean {
  if (!prop) return false;
  if (prop.type === "null" || (Array.isArray(prop.type) && prop.type.includes("null"))) return true;
  return Array.isArray(prop.anyOf) && prop.anyOf.some((b) => (b as { type?: unknown })?.type === "null");
}

function coerceToSchema(value: unknown, prop: JsonProp): unknown {
  const type = prop?.type;
  if (typeof type !== "string") return value;
  if (typeof value === "string") {
    const s = value.trim();
    if ((type === "integer" || type === "number") && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (type === "boolean" && (s === "true" || s === "false")) return s === "true";
    if ((type === "object" && s.startsWith("{")) || (type === "array" && s.startsWith("["))) {
      try {
        const parsed = JSON.parse(s);
        if (type === "array" ? Array.isArray(parsed) : parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch { /* leave as-is, the schema check reports it */ }
    }
    if (type === "array" && prop?.items?.type === "string" && s.length > 0 && !s.startsWith("[")) return [value];
  }
  if (type === "string" && typeof value === "number") return String(value);
  if ((type === "integer" || type === "number") && typeof value === "number") {
    const p = prop as { minimum?: unknown; maximum?: unknown };
    if (typeof p.maximum === "number" && value > p.maximum) return p.maximum;
    if (typeof p.minimum === "number" && value < p.minimum) return p.minimum;
  }
  return value;
}

function isPlaceholder(key: string, value: unknown, prop: JsonProp): boolean {
  if (value === null) return !allowsNull(prop);
  if (value === "") return !EMPTY_STRING_IS_CONTENT.has(key);
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

// Many models emit every visible optional field with a placeholder ("", null, [], {}) or stringify
// numbers, booleans and objects. Normalize those against the JSON schema before validation.
export function normalizeToolArgs(schema: Record<string, unknown>, args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const props = (schema.properties ?? {}) as Record<string, JsonProp>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(args as Record<string, unknown>)) {
    const value = coerceToSchema(raw, props[key]);
    if (!required.has(key) && isPlaceholder(key, value, props[key])) continue;
    out[key] = value;
  }
  return out;
}


// Models fill every declared patch field with "", null, [] or the value already stored. Only real changes get written.
export function cleanPatch(
  patch: Record<string, unknown>,
  before: Record<string, unknown>,
  keepEmpty: ReadonlySet<string> = new Set(),
): { patch: Record<string, unknown>; unchanged: string[]; summary: string } {
  const out: Record<string, unknown> = {};
  const unchanged: string[] = [];
  const shown: string[] = [];
  const short = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length > 60 ? `${s.slice(0, 57)}...` : s; };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (v === "" && !keepEmpty.has(k)) continue;
    if (Array.isArray(v) && v.length === 0 && !(Array.isArray(before[k]) && (before[k] as unknown[]).length === 0)) continue;
    if (JSON.stringify(v) === JSON.stringify(before[k] ?? null)) { unchanged.push(k); continue; }
    out[k] = v;
    shown.push(`${k}: ${short(before[k])} -> ${short(v)}`);
  }
  return { patch: out, unchanged, summary: shown.join("; ") };
}

export function emptyPatchError(unchanged: readonly string[], example: string): string {
  const same = unchanged.length > 0 ? ` Already equal: ${unchanged.join(", ")}.` : "";
  return `Error: [EMPTY_PATCH] patch changes nothing, so nothing was written.${same} Pass only the fields to change, e.g. ${example}.`;
}

const SOFT_PLACEHOLDERS = new Set<unknown>([0, false, "none", "null", "undefined", "n/a"]);

// A filler value like start_line:0 on an optional key fails a min(1) check that the JSON schema never advertised.
// Drop such keys when they are what breaks validation, so the tool default applies instead.
export function prepareToolArgs(tool: Pick<ToolDefinition, "inputSchema" | "jsonSchema" | "normalizesOwnArgs">, args: unknown): unknown {
  if (tool.normalizesOwnArgs) return args;
  const normalized = normalizeToolArgs(tool.jsonSchema, args);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
  const parsed = tool.inputSchema.safeParse(normalized);
  if (parsed.success) return normalized;
  const required = new Set((tool.jsonSchema.required as string[] | undefined) ?? []);
  const record = normalized as Record<string, unknown>;
  const out = { ...record };
  let dropped = false;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || required.has(key) || !(key in out)) continue;
    const v = out[key];
    const blank = typeof v === "string" && v.trim() === "" && !EMPTY_STRING_IS_CONTENT.has(key);
    if (SOFT_PLACEHOLDERS.has(v) || blank) { delete out[key]; dropped = true; }
  }
  return dropped ? out : normalized;
}
