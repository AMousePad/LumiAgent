import type { SpindleAPI } from "lumiverse-spindle-types";

const PREFS_PATH = "ui-prefs.json";
const SCHEMA_VERSION = 2;

export interface UiPrefs {
  readonly version: number;
  readonly connectionId: string | null;
  // Session the user last had open in the drawer. Restored on open / refresh
  // so the drawer doesn't reset to empty state when the user comes back, and
  // it follows the user across browsers (per-user backend storage).
  readonly lastSessionId: string | null;
}

export function defaultUiPrefs(): UiPrefs {
  return { version: SCHEMA_VERSION, connectionId: null, lastSessionId: null };
}

export async function loadUiPrefs(spindle: SpindleAPI, userId: string): Promise<UiPrefs> {
  const stored = await spindle.userStorage.getJson<UiPrefs | null>(PREFS_PATH, { fallback: null, userId });
  if (!stored || typeof stored !== "object") return defaultUiPrefs();
  const s = stored as { connectionId?: unknown; lastSessionId?: unknown };
  return {
    version: SCHEMA_VERSION,
    connectionId: typeof s.connectionId === "string" && s.connectionId.length > 0 ? s.connectionId : null,
    lastSessionId: typeof s.lastSessionId === "string" && s.lastSessionId.length > 0 ? s.lastSessionId : null,
  };
}

export async function saveUiPrefs(spindle: SpindleAPI, prefs: UiPrefs, userId: string): Promise<void> {
  await spindle.userStorage.setJson(PREFS_PATH, prefs, { userId });
}
