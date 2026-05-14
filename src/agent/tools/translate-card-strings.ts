import { z } from "zod";
import type { CharacterUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";

type Kind = "plain" | "html" | "lua";

interface OutgoingItem {
  readonly id: string;
  readonly text: string;
  readonly kind: Kind;
  // Provenance so we can route each translation back to its surface.
  readonly target:
    | { kind: "regex_replace_string"; scriptId: string; scriptName: string }
    | { kind: "regex_find_regex"; scriptId: string; scriptName: string }
    | { kind: "lumirealm_bghtml" }
    | { kind: "lumirealm_lua_script"; index: number }
    | { kind: "lumirealm_trigger_code"; index: number }
    | { kind: "lumirealm_scriptstate_default"; key: string }
    | { kind: "character_field"; field: string }
    | { kind: "alternate_greeting"; index: number }
    | { kind: "world_book_entry"; entryId: string };
}

interface TranslatedItem {
  readonly id: string;
  readonly text?: string;
  readonly error?: string;
}

interface TranslateBatchResponse {
  readonly translated: readonly TranslatedItem[];
  // Optional capability error from the frontend (e.g. Chrome Translator
  // model not available, language pair unsupported).
  readonly capabilityError?: string;
}

const INCLUDE_VALUES = [
  "regex_scripts",
  "lumirealm_bghtml",
  "lumirealm_lua",
  "lumirealm_scriptstate",
  "character_fields",
  "alternate_greetings",
  "world_book_entries",
] as const;

const inputSchema = z.object({
  source_lang: z.string().min(2).max(10).describe("BCP-47 source language tag (e.g. 'ko', 'ja', 'zh-Hans'). Chrome's Translator API picks the on-device model from this."),
  target_lang: z.string().min(2).max(10).describe("BCP-47 target language tag (e.g. 'en'). Same caveat as source_lang."),
  include: z.array(z.enum(INCLUDE_VALUES)).optional().describe("Which surfaces to translate. Default: regex_scripts + lumirealm_bghtml + lumirealm_lua + lumirealm_scriptstate. Skips alternate_greetings, character_fields, world_book_entries by default since those are prose you should review yourself."),
  dry_run: z.boolean().optional().describe("Collect translatable items but don't write any edits. Returns the would-translate manifest."),
  min_chars: z.number().int().min(0).max(1000).optional().describe("Skip strings shorter than this. Default 2."),
}).strict();

const DEFAULT_INCLUDE = ["regex_scripts", "lumirealm_bghtml", "lumirealm_lua", "lumirealm_scriptstate"] as const;
const DEFAULT_MIN_CHARS = 2;

function looksLikeRegexPattern(s: string): boolean {
  // `find_regex` is a regex pattern in /pattern/flags or bare-pattern form.
  // Translating it would change matching behavior; we don't touch it by default.
  // Heuristic: presence of regex metacharacters outside of character text.
  return /[\\^$|*+?(){}\[\]]/.test(s);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export const translateCardStringsTool = defineTool({
  name: "translate_card_strings",
  description: `Mechanical bulk translation via Chrome's on-device Translator API. No LLM tokens.

Usage:
- Ask the user before invoking on prose surfaces (greetings, descriptions, lorebook entries). Your own translation via \`edit\` / \`rewrite\` is higher quality there.
- \`dry_run: true\` returns the would-translate manifest without invoking Chrome or writing.
- \`include\` defaults to mechanical surfaces (regex_scripts + lumirealm_bghtml + lumirealm_lua + lumirealm_scriptstate). Prose surfaces are opt-in.
- Requires Chrome desktop with the Translator API for the source→target pair.
- After application, use \`list_session_edits\` + \`read\` to proof-check each touched path.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      source_lang: { type: "string", minLength: 2, maxLength: 10 },
      target_lang: { type: "string", minLength: 2, maxLength: 10 },
      include: { type: "array", items: { type: "string", enum: [...INCLUDE_VALUES] } },
      dry_run: { type: "boolean" },
      min_chars: { type: "integer", minimum: 0, maximum: 1000 },
    },
    required: ["source_lang", "target_lang"],
    additionalProperties: false,
  },
  defaultSensitivity: "insensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    if (!ctx.callFrontend) return { content: "Error: frontend translation bridge unavailable in this context.", isError: true };
    const include = new Set<typeof INCLUDE_VALUES[number]>(input.include ?? DEFAULT_INCLUDE);
    const minChars = input.min_chars ?? DEFAULT_MIN_CHARS;

    const items: OutgoingItem[] = [];
    let idCounter = 0;
    const mkId = () => `t_${(++idCounter).toString(36)}`;

    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found.`, isError: true };

    if (include.has("regex_scripts")) {
      const res = await ctx.spindle.regex_scripts.list({ scope: "character", scopeId: ctx.characterId, userId: ctx.userId, limit: 1000 });
      for (const r of res.data) {
        if (isNonEmptyString(r.replace_string) && r.replace_string.length >= minChars) {
          items.push({ id: mkId(), text: r.replace_string, kind: "plain", target: { kind: "regex_replace_string", scriptId: r.id, scriptName: r.name } });
        }
        if (isNonEmptyString(r.find_regex) && r.find_regex.length >= minChars && !looksLikeRegexPattern(r.find_regex)) {
          // Rare: some scripts use plain-text `find_regex` keywords. Only translate if it looks like text, not a pattern.
          items.push({ id: mkId(), text: r.find_regex, kind: "plain", target: { kind: "regex_find_regex", scriptId: r.id, scriptName: r.name } });
        }
      }
    }

    const ext = (c.extensions ?? {}) as Record<string, unknown>;
    const lumirealm = ext["lumirealm"] as Record<string, unknown> | undefined;
    const payload = lumirealm?.["payload"] as Record<string, unknown> | undefined;

    if (include.has("lumirealm_bghtml") && payload) {
      const bghtml = payload["background_html"];
      if (isNonEmptyString(bghtml) && bghtml.length >= minChars) {
        items.push({ id: mkId(), text: bghtml, kind: "html", target: { kind: "lumirealm_bghtml" } });
      }
    }

    if (include.has("lumirealm_lua") && payload) {
      const luaScripts = payload["lua_scripts"];
      if (Array.isArray(luaScripts)) {
        luaScripts.forEach((entry, i) => {
          const code = typeof entry === "string" ? entry : isNonEmptyString((entry as { code?: unknown })?.code) ? (entry as { code: string }).code : null;
          if (code !== null && code.length >= minChars) {
            items.push({ id: mkId(), text: code, kind: "lua", target: { kind: "lumirealm_lua_script", index: i } });
          }
        });
      }
      const triggers = payload["triggers"];
      if (Array.isArray(triggers)) {
        triggers.forEach((entry, i) => {
          const code = isNonEmptyString((entry as { code?: unknown })?.code) ? (entry as { code: string }).code : null;
          if (code !== null && code.length >= minChars) {
            items.push({ id: mkId(), text: code, kind: "lua", target: { kind: "lumirealm_trigger_code", index: i } });
          }
        });
      }
    }

    if (include.has("lumirealm_scriptstate") && payload) {
      const defaults = payload["scriptstate_defaults"];
      if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
        for (const [key, val] of Object.entries(defaults as Record<string, unknown>)) {
          if (isNonEmptyString(val) && val.length >= minChars) {
            items.push({ id: mkId(), text: val, kind: "plain", target: { kind: "lumirealm_scriptstate_default", key } });
          }
        }
      }
    }

    if (include.has("character_fields")) {
      const fields = ["first_mes", "description", "personality", "scenario", "mes_example"] as const;
      for (const f of fields) {
        const v = (c as unknown as Record<string, unknown>)[f];
        if (isNonEmptyString(v) && v.length >= minChars) {
          items.push({ id: mkId(), text: v, kind: "plain", target: { kind: "character_field", field: f } });
        }
      }
    }

    if (include.has("alternate_greetings") && Array.isArray(c.alternate_greetings)) {
      c.alternate_greetings.forEach((g, i) => {
        if (isNonEmptyString(g) && g.length >= minChars) {
          items.push({ id: mkId(), text: g, kind: "plain", target: { kind: "alternate_greeting", index: i } });
        }
      });
    }

    if (include.has("world_book_entries")) {
      for (const wbId of c.world_book_ids ?? []) {
        const entries = await ctx.spindle.world_books.entries.list(wbId, { userId: ctx.userId, limit: 1000 });
        for (const e of entries.data) {
          if (isNonEmptyString(e.content) && e.content.length >= minChars) {
            items.push({ id: mkId(), text: e.content, kind: "plain", target: { kind: "world_book_entry", entryId: e.id } });
          }
        }
      }
    }

    if (items.length === 0) {
      return { content: JSON.stringify({ translated: 0, manifest: [], note: "No translatable strings found in the requested scopes." }) };
    }

    if (input.dry_run) {
      return { content: JSON.stringify({
        dry_run: true,
        total: items.length,
        manifest: items.map((it) => ({ id: it.id, kind: it.kind, target: it.target, chars: it.text.length })),
        note: "Re-run without dry_run to apply translations.",
      }) };
    }

    let response: TranslateBatchResponse;
    try {
      const raw = await ctx.callFrontend(
        "translate_batch",
        { items: items.map(({ id, text, kind }) => ({ id, text, kind })), source_lang: input.source_lang, target_lang: input.target_lang },
        180_000,
      );
      response = raw as TranslateBatchResponse;
    } catch (err) {
      return { content: `Error: frontend translator failed: ${(err as Error).message}`, isError: true };
    }
    if (response.capabilityError) {
      return { content: `Error: Chrome Translator API unavailable: ${response.capabilityError}. Confirm Chrome desktop with on-device Translator support for ${input.source_lang}→${input.target_lang}.`, isError: true };
    }

    const byId = new Map<string, TranslatedItem>();
    for (const t of response.translated) byId.set(t.id, t);

    interface ScriptUpdate { id: string; name: string; patch: Record<string, string>; before: { replace_string?: string; find_regex?: string } }
    const regexUpdates = new Map<string, ScriptUpdate>();
    interface ExtensionMutation { path: string[]; before: string; after: string; label: string }
    const extensionMutations: ExtensionMutation[] = [];
    const charFieldMutations: Array<{ field: string; before: string; after: string }> = [];
    const altGreetingMutations: Array<{ index: number; before: string; after: string }> = [];
    const worldBookMutations: Array<{ entryId: string; before: string; after: string }> = [];
    let nextExtensionsRoot: Record<string, unknown> | null = null;
    const itemErrors: Array<{ id: string; target: OutgoingItem["target"]; error: string }> = [];

    for (const item of items) {
      const t = byId.get(item.id);
      if (!t || t.error || !isNonEmptyString(t.text)) {
        if (t?.error) itemErrors.push({ id: item.id, target: item.target, error: t.error });
        continue;
      }
      if (t.text === item.text) continue;
      const target = item.target;
      if (target.kind === "regex_replace_string" || target.kind === "regex_find_regex") {
        const existing = regexUpdates.get(target.scriptId) ?? { id: target.scriptId, name: target.scriptName, patch: {}, before: {} };
        if (target.kind === "regex_replace_string") { existing.patch["replace_string"] = t.text; existing.before.replace_string = item.text; }
        else { existing.patch["find_regex"] = t.text; existing.before.find_regex = item.text; }
        regexUpdates.set(target.scriptId, existing);
      } else if (target.kind === "lumirealm_bghtml") {
        extensionMutations.push({ path: ["lumirealm", "payload", "background_html"], before: item.text, after: t.text, label: "lumirealm.payload.background_html" });
      } else if (target.kind === "lumirealm_lua_script") {
        extensionMutations.push({ path: ["lumirealm", "payload", "lua_scripts", String(target.index), "code"], before: item.text, after: t.text, label: `lumirealm.payload.lua_scripts[${target.index}]` });
      } else if (target.kind === "lumirealm_trigger_code") {
        extensionMutations.push({ path: ["lumirealm", "payload", "triggers", String(target.index), "code"], before: item.text, after: t.text, label: `lumirealm.payload.triggers[${target.index}]` });
      } else if (target.kind === "lumirealm_scriptstate_default") {
        extensionMutations.push({ path: ["lumirealm", "payload", "scriptstate_defaults", target.key], before: item.text, after: t.text, label: `lumirealm.payload.scriptstate_defaults.${target.key}` });
      } else if (target.kind === "character_field") {
        charFieldMutations.push({ field: target.field, before: item.text, after: t.text });
      } else if (target.kind === "alternate_greeting") {
        altGreetingMutations.push({ index: target.index, before: item.text, after: t.text });
      } else if (target.kind === "world_book_entry") {
        worldBookMutations.push({ entryId: target.entryId, before: item.text, after: t.text });
      }
    }

    let regexApplied = 0;
    let extensionApplied = 0;
    let charFieldApplied = 0;
    let altGreetingApplied = 0;
    let worldBookApplied = 0;
    const writeErrors: Array<{ target: string; error: string }> = [];

    for (const [scriptId, upd] of regexUpdates) {
      try {
        await ctx.spindle.regex_scripts.update(scriptId, upd.patch as Record<string, unknown>, ctx.userId);
        if (upd.before.replace_string !== undefined && upd.patch["replace_string"] !== undefined) {
          ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: scriptId, surfaceLabel: upd.name, field: "replace_string", before: upd.before.replace_string, after: upd.patch["replace_string"] });
        }
        if (upd.before.find_regex !== undefined && upd.patch["find_regex"] !== undefined) {
          ctx.pushEdit({ op: "edit", surface: "regex_script", surfaceId: scriptId, surfaceLabel: upd.name, field: "find_regex", before: upd.before.find_regex, after: upd.patch["find_regex"] });
        }
        regexApplied++;
      } catch (err) {
        writeErrors.push({ target: `regex_script:${upd.name}`, error: (err as Error).message });
      }
    }

    if (extensionMutations.length > 0) {
      nextExtensionsRoot = JSON.parse(JSON.stringify(c.extensions ?? {})) as Record<string, unknown>;
      for (const m of extensionMutations) {
        let cur: unknown = nextExtensionsRoot;
        for (let i = 0; i < m.path.length - 1; i++) {
          const seg = m.path[i]!;
          if (cur === null || typeof cur !== "object") { cur = null; break; }
          const isIdx = /^\d+$/.test(seg);
          if (isIdx && Array.isArray(cur)) cur = cur[parseInt(seg, 10)];
          else if (!Array.isArray(cur)) cur = (cur as Record<string, unknown>)[seg];
          else cur = undefined;
        }
        const last = m.path[m.path.length - 1]!;
        if (cur !== null && typeof cur === "object") {
          if (Array.isArray(cur) && /^\d+$/.test(last)) (cur as unknown[])[parseInt(last, 10)] = m.after;
          else (cur as Record<string, unknown>)[last] = m.after;
        }
      }
      try {
        await ctx.spindle.characters.update(ctx.characterId, { extensions: nextExtensionsRoot } as CharacterUpdateDTO, ctx.userId);
        for (const m of extensionMutations) {
          ctx.pushEdit({ op: "edit", surface: "extension", surfaceId: ctx.characterId, surfaceLabel: m.label, field: m.path.join("."), before: m.before, after: m.after });
          extensionApplied++;
        }
      } catch (err) {
        writeErrors.push({ target: "character.extensions", error: (err as Error).message });
      }
    }

    if (charFieldMutations.length > 0) {
      const patch: Record<string, string> = {};
      for (const m of charFieldMutations) patch[m.field] = m.after;
      try {
        await ctx.spindle.characters.update(ctx.characterId, patch as CharacterUpdateDTO, ctx.userId);
        for (const m of charFieldMutations) {
          ctx.pushEdit({ op: "edit", surface: "character_field", surfaceId: ctx.characterId, surfaceLabel: c.name, field: m.field, before: m.before, after: m.after });
          charFieldApplied++;
        }
      } catch (err) {
        writeErrors.push({ target: "character.fields", error: (err as Error).message });
      }
    }

    if (altGreetingMutations.length > 0) {
      const arr = [...(c.alternate_greetings ?? [])];
      for (const m of altGreetingMutations) {
        if (m.index >= 0 && m.index < arr.length) arr[m.index] = m.after;
      }
      try {
        await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr } as CharacterUpdateDTO, ctx.userId);
        for (const m of altGreetingMutations) {
          ctx.pushEdit({ op: "edit", surface: "alternate_greeting", surfaceId: ctx.characterId, surfaceLabel: `Alt greeting #${m.index}`, field: String(m.index), before: m.before, after: m.after });
          altGreetingApplied++;
        }
      } catch (err) {
        writeErrors.push({ target: "alternate_greetings", error: (err as Error).message });
      }
    }

    for (const m of worldBookMutations) {
      try {
        const entry = await ctx.spindle.world_books.entries.get(m.entryId, ctx.userId);
        if (!entry) continue;
        await ctx.spindle.world_books.entries.update(m.entryId, { content: m.after } as Record<string, unknown>, ctx.userId);
        const label = entry.comment || entry.key?.[0] || m.entryId;
        ctx.pushEdit({ op: "edit", surface: "world_book_entry", surfaceId: m.entryId, surfaceLabel: label, field: "content", before: m.before, after: m.after });
        worldBookApplied++;
      } catch (err) {
        writeErrors.push({ target: `world_book_entry:${m.entryId}`, error: (err as Error).message });
      }
    }

    return {
      content: JSON.stringify({
        source_lang: input.source_lang,
        target_lang: input.target_lang,
        items_sent: items.length,
        items_translated: response.translated.filter((t) => isNonEmptyString(t.text)).length,
        items_unchanged: items.length - response.translated.filter((t) => isNonEmptyString(t.text) && t.text !== items.find((it) => it.id === t.id)?.text).length,
        applied: {
          regex_scripts: regexApplied,
          extensions: extensionApplied,
          character_fields: charFieldApplied,
          alternate_greetings: altGreetingApplied,
          world_book_entries: worldBookApplied,
        },
        item_errors: itemErrors,
        write_errors: writeErrors,
        note: `Translations applied as agent edits. Use list_session_edits to enumerate them, then \`read\` each touched path to proof-check. revert_session_edits can roll back if a translation is bad. ${writeErrors.length > 0 ? "Some writes failed — see write_errors." : ""}`,
      }),
    };
  },
});
