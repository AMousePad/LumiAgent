// Path-prefix guard for writes under character.extensions.lumirealm.
//
// LumiRealm stores content in layers: a frozen source snapshot
// (`source.*`), a translator-output payload (`payload.*`), and translator
// projections (`regex_scripts`, canonical character fields). Only the
// authoring layer for each content kind is user-editable in LumiRealm's
// Viewer; every other layer is regenerated. Writes to derived layers are
// either ignored on the next translator schema bump or never reach the
// live runtime, which manifests as "I edited it and nothing changed".
//
// This guard refuses those writes and redirects to the correct surface.

export interface LumirealmWriteGuard {
  readonly ok: boolean;
  readonly message?: string;
}

const CANONICAL_MIRROR_FIELDS: readonly string[] = [
  "first_mes",
  "description",
  "personality",
  "scenario",
  "system_prompt",
  "post_history_instructions",
  "mes_example",
];

const COUPLING_REMINDER =
  "REMEMBER: card content is deeply coupled across surfaces. A change here may propagate to UI (bg-html, status panels, portals), Lore (world book entries that key on names or phrases), Prose (greetings, mes_example, persona-facing fields), and Regex (find_regex patterns that anchor on shape, replace_string content that injects HTML or text). After ANY edit, scan for collisions with: regex find_regex patterns, world book key arrays, alternate_greetings parallel forms, payload.additional_assets references, portal_candidates, and any in-bg CSS classes referenced by regex display rules.";

export function checkLumirealmWritePath(extPath: string): LumirealmWriteGuard {
  if (extPath !== "lumirealm" && !extPath.startsWith("lumirealm.") && !extPath.startsWith("lumirealm[")) {
    return { ok: true };
  }

  if (extPath === "lumirealm.source" || extPath.startsWith("lumirealm.source.") || extPath.startsWith("lumirealm.source[")) {
    return {
      ok: false,
      message:
        "lumirealm.source.* is a FROZEN .charx import snapshot. It is the input to the translator pipeline, never the authoring surface. The translator regenerates payload.* and the top-level regex_scripts from it on every schema bump; writes here are pointless and the wrong layer to reach for.\n\n" +
        "Use the AUTHORING surface that matches your content kind:\n" +
        "- HTML / status panel CSS → edit lumirealm.payload.background_html_source\n" +
        "- Trigger Lua / JS → edit lumirealm.payload.triggers[i].effect[k].code on the effect whose type is 'triggerlua' or 'triggercode'\n" +
        "- Character-scoped regex → edit top-level regex_scripts via edit_regex_script_field / update_regex_script\n" +
        "- Lorebook → edit top-level world_book entries via edit_world_book_entry / update_world_book_entry\n" +
        "- Canonical character fields (first_mes, description, etc.) → edit top-level character via update_character / edit_character_field / rewrite_alternate_greeting\n\n" +
        COUPLING_REMINDER,
    };
  }

  if (
    extPath === "lumirealm.regex_scripts" ||
    extPath.startsWith("lumirealm.regex_scripts.") ||
    extPath.startsWith("lumirealm.regex_scripts[")
  ) {
    return {
      ok: false,
      message:
        "lumirealm.regex_scripts is a translator-projection CACHE; it is not what fires at runtime. The LIVE regex scripts that actually run live at the top-level regex_scripts.* surface. Use list_regex_scripts, read_regex_script_field, edit_regex_script_field, update_regex_script. Edits to this cache get clobbered on the next translator schema bump.\n\n" +
        COUPLING_REMINDER,
    };
  }

  if (extPath === "lumirealm.payload.background_html") {
    return {
      ok: false,
      message:
        "lumirealm.payload.background_html is the TRANSLATED runtime output; LumiRealm regenerates it from lumirealm.payload.background_html_source on every save and on every translator schema bump. Edits here are clobbered.\n\n" +
        "Edit lumirealm.payload.background_html_source instead (use edit_character_extension or update_character_extension on that path). If background_html_source does not yet exist on this card, write to it anyway — LumiRealm seeds it from the card-side baseline on first edit.\n\n" +
        "Bg-html / CSS content is the most cross-coupled surface on the card. " + COUPLING_REMINDER,
    };
  }

  if (
    extPath === "lumirealm.payload.lua_scripts" ||
    extPath.startsWith("lumirealm.payload.lua_scripts.") ||
    extPath.startsWith("lumirealm.payload.lua_scripts[")
  ) {
    return {
      ok: false,
      message:
        "lumirealm.payload.lua_scripts is a .charx import artifact (Risu module libraries). LumiRealm's Viewer does not let the user edit it; it is not an authoring surface.\n\n" +
        "User-authored Lua lives on a specific TRIGGER's effect array: lumirealm.payload.triggers[i].effect[k].code where effect.type === 'triggerlua' (or 'triggercode' for JS). Find the trigger that owns the function you want to change and edit its effect.code.\n\n" +
        "If the same function appears in BOTH lua_scripts and a triggerlua effect, those are TWO COPIES of conceptually-the-same code; the trigger copy is the one that runs in trigger context. Edits to lua_scripts alone will not change trigger behaviour. " + COUPLING_REMINDER,
    };
  }

  for (const f of CANONICAL_MIRROR_FIELDS) {
    if (extPath === `lumirealm.payload.${f}`) {
      return {
        ok: false,
        message:
          `lumirealm.payload.${f} is a translator-output mirror of the canonical character field. The LIVE field that the LLM actually sees in the prompt is character.${f} at the top level.\n\n` +
          `Use update_character({ patch: { ${f}: <new text> } }) for wholesale replacement, or edit_character_field({ field: '${f}', find, replace }) for find/replace.\n\n` +
          (f === "first_mes"
            ? "For greetings: first_mes is greeting #1; alternate_greetings[0..N-2] are #2..#N. Use rewrite_alternate_greeting for whole-greeting overwrites.\n\n"
            : "") +
          COUPLING_REMINDER,
      };
    }
  }

  if (extPath === "lumirealm.user_overrides" || extPath.startsWith("lumirealm.user_overrides.") || extPath.startsWith("lumirealm.user_overrides[")) {
    return {
      ok: false,
      message:
        "lumirealm.user_overrides.* is per-user UI configuration (default-variable overrides, attached module IDs, portal decisions, low-level-access consent). The user manages these through the LumiRealm UI; never edit them in response to a translation, refactor, or content request.",
    };
  }

  return { ok: true };
}
