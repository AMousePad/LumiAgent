import type { WorldBookEntryDTO } from "lumiverse-spindle-types";

export const CHARACTER_STRING_FIELDS = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "creator",
] as const;
export type CharacterStringField = typeof CHARACTER_STRING_FIELDS[number];

export const REGEX_SCRIPT_BIG_FIELDS = ["find_regex", "replace_string"] as const;
export type RegexScriptBigField = typeof REGEX_SCRIPT_BIG_FIELDS[number];

export function isCharacterStringField(s: string): s is CharacterStringField {
  return (CHARACTER_STRING_FIELDS as readonly string[]).includes(s);
}

export function isRegexScriptBigField(s: string): s is RegexScriptBigField {
  return (REGEX_SCRIPT_BIG_FIELDS as readonly string[]).includes(s);
}

export function wbLabel(e: WorldBookEntryDTO): string {
  const keys = Array.isArray(e.key) ? e.key : [];
  return e.comment || (keys.length > 0 ? keys.join("|") : `entry ${e.id}`);
}

// `key` / `keysecondary` are stored as JSON string arrays. The host stringifies
// whatever it receives, so a non-array (a model passing "a, b" or '["a","b"]')
// round-trips to a string that the entry editor cannot open and that the
// activated-list/DTO path silently coerces to []. Force a string[] at every
// write site.
export function coerceKeyList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter((v) => v.length > 0);
      } catch {
        // not JSON, fall through to comma split
      }
    }
    return s.split(",").map((v) => v.trim()).filter((v) => v.length > 0);
  }
  return [];
}

export const WB_ENTRY_KEY_FIELDS = new Set(["key", "keysecondary"]);

// Fields the host's updateEntry actually writes (mirrors its column whitelist
// plus the managed extensions/outlet_name). A write to any other field is a
// silent host no-op, so reject it instead of reporting a phantom success.
export const WB_ENTRY_WRITABLE_FIELDS = new Set([
  "key", "keysecondary", "content", "comment", "role", "group_name", "automation_id",
  "position", "depth", "order_value", "group_weight", "probability", "scan_depth",
  "priority", "sticky", "cooldown", "delay", "selective_logic",
  "selective", "constant", "disabled", "group_override", "case_sensitive", "match_whole_words",
  "use_regex", "prevent_recursion", "exclude_recursion", "delay_until_recursion",
  "use_probability", "vectorized", "extensions", "outlet_name",
]);
