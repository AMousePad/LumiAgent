import { z } from "zod";
import type { CharacterUpdateDTO, RegexScriptUpdateDTO, WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { EditRecord } from "../../types";
import { isCharacterStringField, wbLabel } from "./_surfaces";
import { parseExtensionPath, setAtPath } from "./_paths";

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

async function setExtension(ctx: ToolCtx, dotted: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
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
  return { before: stringify(cur), after: stringify(value), label: `extensions.${dotted}`, surface: "extension", surfaceId: ctx.characterId, field: dotted };
}

async function setRegexScriptField(ctx: ToolCtx, scriptId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  const r = await ctx.spindle.regex_scripts.get(scriptId, ctx.userId);
  if (!r) return `regex script ${scriptId} not found`;
  const before = (r as unknown as Record<string, unknown>)[field];
  await ctx.spindle.regex_scripts.update(scriptId, { [field]: value } as RegexScriptUpdateDTO, ctx.userId);
  return { before: stringify(before), after: stringify(value), label: r.name, surface: "regex_script", surfaceId: scriptId, field };
}

async function setWorldBookEntryField(ctx: ToolCtx, entryId: string, field: string, value: unknown): Promise<{ before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string> {
  const e = await ctx.spindle.world_books.entries.get(entryId, ctx.userId);
  if (!e) return `world book entry ${entryId} not found`;
  const before = (e as unknown as Record<string, unknown>)[field];
  await ctx.spindle.world_books.entries.update(entryId, { [field]: value } as WorldBookEntryUpdateDTO, ctx.userId);
  return { before: stringify(before), after: stringify(value), label: wbLabel(e), surface: "world_book_entry", surfaceId: entryId, field };
}

export const setTool = defineTool({
  name: "set",
  description: `Wholesale write of any JSON value at a path. Use for STRUCTURAL changes the read/edit/rewrite trio can't make:

- Toggling a boolean (regex.disabled, world_book_entry.constant)
- Changing a number (priority, position, sort_order, depth)
- Replacing an array / object value (extensions.lumirealm.payload.lua_scripts, scriptstate_defaults)
- Setting a typed value at an extension path that isn't a string

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
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const path = input.path.trim();
    const value = input.value;

    let result: { before: string; after: string; label: string; surface: EditRecord["surface"]; surfaceId: string; field: string } | string;

    if (path.startsWith("char/extensions/") || path.startsWith("character/extensions/")) {
      const dotted = path.replace(/^(char|character)\/extensions\//, "");
      if (dotted.length === 0) return { content: "Error: extensions path requires a sub-path", isError: true };
      result = await setExtension(ctx, dotted, value);
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
    } else if (path.startsWith("wb/") || path.startsWith("world_book_entry/")) {
      const parts = path.split("/").slice(1);
      if (parts.length !== 2) return { content: "Error: expected wb/<entryId>/<field>", isError: true };
      result = await setWorldBookEntryField(ctx, parts[0]!, parts[1]!, value);
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
