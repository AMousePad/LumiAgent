import { z } from "zod";
import type {
  WorldBookCreateDTO,
  WorldBookEntryCreateDTO,
  RegexScriptCreateDTO,
  RegexPlacementDTO,
  RegexScopeDTO,
  RegexMacroModeDTO,
  PersonaCreateDTO,
  UserPresetCreateDTO,
  PromptBlockCreateDTO,
} from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { wbLabel, coerceKeyList } from "./_surfaces";
import { ALTERNATE_FIELD_NAMES, isAlternateFieldName, readAltFieldArray, writeAltFieldArray, type AltFieldVariant } from "./_path_v2";

const inputSchema = z.object({
  path: z.string().min(2).describe("Container to create a child in. See description for the grammar."),
  value: z.unknown().optional().describe("The new entity's fields (object), or a string for a greeting."),
}).strict();

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export const createTool = defineTool({
  name: "create",
  description: `Create a new entity inside a container, addressed by the same path grammar as \`read\` / \`edit\` / \`set\`. The path names the PARENT container; \`value\` carries the new entity's fields. Structural, fully revertible (revert deletes what was created).

Containers:
- \`wb\` -> a world book. value: { name, description?, metadata? }
- \`wb/<bookId>/entry\` -> an entry in that book. value: { content (required), key?, keysecondary?, comment?, constant?, disabled?, position?, order_value?, probability? }
- \`rx\` -> a regex script scoped to the active character. value: { name, find_regex, replace_string?, flags?, placement?, target?, disabled?, description? }
- \`persona\` -> a user persona. value: { name (required), title?, description?, folder?, is_default?, attached_world_book_id? }
- \`preset\` -> a prompt preset. value: { name (required), provider (required), engine?, parameters?, prompts?, metadata? }
- \`preset/<presetId>/block\` -> a prompt block. value: PromptBlock fields { name?, content?, role?, enabled?, position?, depth?, ... } plus optional \`index\` for placement.
- \`char/alternate_greetings\` -> an alternate greeting. value: a string, or { content, index? }.
- \`char/alternate_fields/<field>\` -> a variant for description / personality / scenario. value: { content (required), label?, index? } (or a bare string for content).

Returns the new id (and book/preset id for nested creates).`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Parent container path. See description." },
      value: { description: "New entity fields (object) or a string for a greeting." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Path-targeted. rx / char paths fail loudly without a character; everything
  // else (wb, persona, preset) works in a no-character session.
  requiresCharacter: false,
  execute: async (input, ctx: ToolCtx) => {
    const path = input.path.trim().replace(/^character\//, "char/");
    const parts = path.split("/").filter((p) => p.length > 0);
    const v = asObject(input.value);

    // wb -> world book
    if (path === "wb" || path === "world_book") {
      const name = typeof v.name === "string" ? v.name : undefined;
      if (!name) return { content: "Error: [INVALID_INPUT] world book requires value.name", isError: true };
      const create: WorldBookCreateDTO = { name };
      if (typeof v.description === "string") create.description = v.description;
      if (v.metadata && typeof v.metadata === "object") create.metadata = v.metadata as Record<string, unknown>;
      const book = await ctx.spindle.world_books.create(create, ctx.userId);
      ctx.pushEdit({
        op: "create", surface: "world_book", surfaceId: book.id, surfaceLabel: book.name,
        snapshot: { book, entries: [] }, scope: { kind: "world_book", id: book.id },
      } satisfies EditRecord);
      return { content: JSON.stringify({ world_book_id: book.id, name: book.name }) };
    }

    // wb/<bookId>/entry -> entry in that book
    if ((parts[0] === "wb" || parts[0] === "world_book") && parts[2] === "entry" && parts.length === 3) {
      const bookId = parts[1]!;
      const content = typeof v.content === "string" ? v.content : undefined;
      if (content === undefined) return { content: "Error: [INVALID_INPUT] entry requires value.content", isError: true };
      const create: WorldBookEntryCreateDTO = { content };
      // Accept a model passing keys as a comma string or JSON-array string, not
      // only a real array. A non-array reaches the host as a stringified scalar
      // and the entry's key column becomes unparseable.
      if (v.key !== undefined) create.key = coerceKeyList(v.key);
      if (v.keysecondary !== undefined) create.keysecondary = coerceKeyList(v.keysecondary);
      if (typeof v.comment === "string") create.comment = v.comment;
      if (typeof v.constant === "boolean") create.constant = v.constant;
      if (typeof v.disabled === "boolean") create.disabled = v.disabled;
      if (typeof v.position === "number") create.position = v.position;
      if (typeof v.order_value === "number") create.order_value = v.order_value;
      if (typeof v.probability === "number") create.probability = v.probability;
      const e = await ctx.spindle.world_books.entries.create(bookId, create, ctx.userId);
      // Character-attached book: file under the session character (no scope =
      // session default). Standalone book: file under the book's own scope so
      // it stays tracked + revertable with no character selected.
      const scope: ScopeRef | undefined = ctx.characterId ? undefined : { kind: "world_book", id: bookId };
      ctx.pushEdit({
        op: "create", surface: "world_book_entry", surfaceId: e.id, surfaceLabel: wbLabel(e), snapshot: e,
        ...(scope ? { scope } : {}),
      } satisfies EditRecord);
      return { content: JSON.stringify({ entry_id: e.id, world_book_id: e.world_book_id, content_chars: e.content.length }) };
    }

    // rx -> regex script (character-scoped)
    if (path === "rx" || path === "regex_script") {
      if (!ctx.characterId) return { content: "Error: [INVALID_INPUT] regex script create needs an active character", isError: true };
      const name = typeof v.name === "string" ? v.name : undefined;
      const find = typeof v.find_regex === "string" ? v.find_regex : undefined;
      if (!name || !find) return { content: "Error: [INVALID_INPUT] regex script requires value.name and value.find_regex", isError: true };
      const create: RegexScriptCreateDTO = {
        name, find_regex: find,
        scope: "character" as RegexScopeDTO,
        scope_id: ctx.characterId,
        placement: (Array.isArray(v.placement) ? v.placement : ["ai_output"]) as RegexPlacementDTO[],
        substitute_macros: "none" as RegexMacroModeDTO,
      };
      if (typeof v.replace_string === "string") create.replace_string = v.replace_string;
      if (typeof v.flags === "string") create.flags = v.flags;
      if (typeof v.target === "string") create.target = v.target as RegexScriptCreateDTO["target"] & string;
      if (typeof v.disabled === "boolean") create.disabled = v.disabled;
      if (typeof v.description === "string") create.description = v.description;
      const s = await ctx.spindle.regex_scripts.create(create, ctx.userId);
      ctx.pushEdit({ op: "create", surface: "regex_script", surfaceId: s.id, surfaceLabel: s.name, snapshot: s } satisfies EditRecord);
      return { content: JSON.stringify({ script_id: s.id, name: s.name }) };
    }

    // persona
    if (path === "persona") {
      const name = typeof v.name === "string" ? v.name : undefined;
      if (!name) return { content: "Error: [INVALID_INPUT] persona requires value.name", isError: true };
      const create: PersonaCreateDTO = { name };
      if (typeof v.title === "string") create.title = v.title;
      if (typeof v.description === "string") create.description = v.description;
      if (typeof v.folder === "string") create.folder = v.folder;
      if (typeof v.is_default === "boolean") create.is_default = v.is_default;
      if (typeof v.attached_world_book_id === "string") create.attached_world_book_id = v.attached_world_book_id;
      const p = await ctx.spindle.personas.create(create, ctx.userId);
      ctx.pushEdit({
        op: "create", surface: "persona", surfaceId: p.id, surfaceLabel: p.name,
        snapshot: p, scope: { kind: "persona", id: p.id },
      } satisfies EditRecord);
      return { content: JSON.stringify({ persona_id: p.id, name: p.name }) };
    }

    // preset
    if (path === "preset") {
      const name = typeof v.name === "string" ? v.name : undefined;
      const provider = typeof v.provider === "string" ? v.provider : undefined;
      if (!name || !provider) return { content: "Error: [INVALID_INPUT] preset requires value.name and value.provider", isError: true };
      const create: UserPresetCreateDTO = { name, provider };
      if (typeof v.engine === "string") create.engine = v.engine;
      if (v.parameters && typeof v.parameters === "object") create.parameters = v.parameters as Record<string, unknown>;
      if (v.prompts && typeof v.prompts === "object") create.prompts = v.prompts as Record<string, unknown>;
      if (v.metadata && typeof v.metadata === "object") create.metadata = v.metadata as Record<string, unknown>;
      const p = await ctx.spindle.presets.create(create, ctx.userId);
      ctx.pushEdit({
        op: "create", surface: "preset", surfaceId: p.id, surfaceLabel: p.name,
        snapshot: { preset: p, blocks: [] }, scope: { kind: "preset", id: p.id },
      } satisfies EditRecord);
      return { content: JSON.stringify({ preset_id: p.id, name: p.name }) };
    }

    // preset/<presetId>/block -> prompt block
    if (parts[0] === "preset" && parts[2] === "block" && parts.length === 3) {
      const presetId = parts[1]!;
      const { index, ...blockFields } = v as { index?: unknown } & Record<string, unknown>;
      const opts: { index?: number; userId?: string } = { userId: ctx.userId };
      if (typeof index === "number") opts.index = index;
      const b = await ctx.spindle.presets.blocks.create(presetId, blockFields as PromptBlockCreateDTO, opts);
      ctx.pushEdit({
        op: "create", surface: "preset_block", surfaceId: `${presetId}:${b.id}`,
        surfaceLabel: `${b.name || "block"}`, snapshot: b, scope: { kind: "preset", id: presetId },
      } satisfies EditRecord);
      return { content: JSON.stringify({ preset_id: presetId, block_id: b.id, name: b.name }) };
    }

    // char/alternate_fields/<field> -> add a variant for description / personality / scenario
    if (parts[0] === "char" && parts[1] === "alternate_fields" && parts.length === 3) {
      if (!ctx.characterId) return { content: "Error: [INVALID_INPUT] no active character", isError: true };
      const field = parts[2]!;
      if (!isAlternateFieldName(field)) {
        return { content: `Error: [INVALID_INPUT] alternate_fields field must be one of ${ALTERNATE_FIELD_NAMES.join(", ")}, got '${field}'`, isError: true };
      }
      const label = typeof v.label === "string" ? v.label : "";
      const content = typeof input.value === "string"
        ? input.value
        : typeof v.content === "string" ? v.content : undefined;
      if (content === undefined) return { content: "Error: [INVALID_INPUT] variant requires value.content (or pass a string for content; value.label optional)", isError: true };
      const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
      if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
      const before = readAltFieldArray(c.extensions, field);
      const newVariant: AltFieldVariant = { id: crypto.randomUUID(), label, content };
      const requested = typeof v.index === "number" ? v.index : undefined;
      const at = requested === undefined ? before.length : Math.max(0, Math.min(before.length, Math.floor(requested)));
      const after = [...before];
      after.splice(at, 0, newVariant);
      const nextExt = writeAltFieldArray(c.extensions, field, after);
      await ctx.spindle.characters.update(ctx.characterId, { extensions: nextExt }, ctx.userId);
      ctx.pushEdit({
        op: "create", surface: "alternate_field_variant", surfaceId: newVariant.id,
        surfaceLabel: `${field} variant '${label || "(unlabeled)"}'`,
        snapshot: { altField: field, variant: { id: newVariant.id, label, content }, index: at },
      } satisfies EditRecord);
      return { content: JSON.stringify({ field, variant_id: newVariant.id, index: at, total: after.length, content_chars: content.length }) };
    }

    // char/alternate_greetings -> append/insert a greeting
    if (path === "char/alternate_greetings") {
      if (!ctx.characterId) return { content: "Error: [INVALID_INPUT] no active character", isError: true };
      const content = typeof input.value === "string"
        ? input.value
        : typeof v.content === "string" ? v.content : undefined;
      if (content === undefined) return { content: "Error: [INVALID_INPUT] greeting requires a string value or value.content", isError: true };
      const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
      if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
      const arr = [...(c.alternate_greetings ?? [])];
      const requested = typeof v.index === "number" ? v.index : undefined;
      const at = requested === undefined ? arr.length : Math.max(0, Math.min(arr.length, Math.floor(requested)));
      arr.splice(at, 0, content);
      await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
      ctx.pushEdit({
        op: "create", surface: "alternate_greeting", surfaceId: String(at),
        surfaceLabel: `alternate_greetings[${at}]`, snapshot: { greeting: content },
      } satisfies EditRecord);
      return { content: JSON.stringify({ index: at, total: arr.length, chars: content.length }) };
    }

    return { content: `Error: [PATH_NOT_FOUND] cannot create at '${path}'. Valid containers: wb, wb/<bookId>/entry, rx, persona, preset, preset/<presetId>/block, char/alternate_greetings, char/alternate_fields/<field>`, isError: true };
  },
});
