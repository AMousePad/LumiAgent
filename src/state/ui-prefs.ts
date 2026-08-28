import type { SpindleAPI } from "lumiverse-spindle-types";

const PREFS_PATH = "ui-prefs.json";
const SCHEMA_VERSION = 3;

export interface UiPrefs {
  readonly version: number;
  readonly connectionId: string | null;
  // Session the user last had open in the drawer. Restored on open / refresh
  // so the drawer doesn't reset to empty state when the user comes back, and
  // it follows the user across browsers (per-user backend storage).
  readonly lastSessionId: string | null;
  // The onboarding tour was opened at least once. Gates the empty-state
  // "Meet Mousey" chip; the menu entry stays available for retakes.
  readonly tutorialSeen: boolean;
  // Death easter egg: the mousey_die tool sets this, clicking the remains
  // clears it. While true the composer portrait is a blood pool and chat is
  // locked.
  readonly mouseyDead: boolean;
  // The "Do you want to meet Mousey?" modal fired once (any outcome).
  readonly meetPromptShown: boolean;
  // The tour was played through to the finale. Gates the meet-Mousey banner.
  readonly tutorialDone: boolean;
}

export function defaultUiPrefs(): UiPrefs {
  return { version: SCHEMA_VERSION, connectionId: null, lastSessionId: null, tutorialSeen: false, mouseyDead: false, meetPromptShown: false, tutorialDone: false };
}

export async function loadUiPrefs(spindle: SpindleAPI, userId: string): Promise<UiPrefs> {
  const stored = await spindle.userStorage.getJson<UiPrefs | null>(PREFS_PATH, { fallback: null, userId });
  if (!stored || typeof stored !== "object") return defaultUiPrefs();
  const s = stored as { connectionId?: unknown; lastSessionId?: unknown; tutorialSeen?: unknown; mouseyDead?: unknown; meetPromptShown?: unknown; tutorialDone?: unknown };
  return {
    version: SCHEMA_VERSION,
    connectionId: typeof s.connectionId === "string" && s.connectionId.length > 0 ? s.connectionId : null,
    lastSessionId: typeof s.lastSessionId === "string" && s.lastSessionId.length > 0 ? s.lastSessionId : null,
    tutorialSeen: s.tutorialSeen === true,
    mouseyDead: s.mouseyDead === true,
    meetPromptShown: s.meetPromptShown === true,
    tutorialDone: s.tutorialDone === true,
  };
}

export async function saveUiPrefs(spindle: SpindleAPI, prefs: UiPrefs, userId: string): Promise<void> {
  await spindle.userStorage.setJson(PREFS_PATH, prefs, { userId });
}
