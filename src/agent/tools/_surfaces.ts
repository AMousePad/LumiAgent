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
  return e.comment || (e.key.length > 0 ? e.key.join("|") : `entry ${e.id}`);
}
