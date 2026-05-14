declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

export const REQUIRED_PERMISSIONS: readonly string[] = [
  "generation",
  "characters",
  "world_books",
  "regex_scripts",
  "chats",
  "chat_mutation",
  "ui_panels",
  "personas",
  "databanks",
];

export const PERMISSION_PURPOSE: Readonly<Record<string, string>> = {
  generation: "dispatch LLM calls for the agent loop",
  characters: "read and edit character cards",
  world_books: "read and edit lorebooks",
  regex_scripts: "read and edit regex scripts",
  chats: "read chats and message history",
  chat_mutation: "edit pinned chat messages when the agent acts on them",
  ui_panels: "mount the LumiAgent drawer",
  personas: "read the active persona for {{user}} resolution",
  databanks: "read databank documents",
};

interface PermLog {
  info(msg: string): void;
  warn(msg: string): void;
}

const granted = new Set<string>();
let loaded = false;
const missingChangeListeners = new Set<(missing: readonly string[]) => void>();

function computeMissing(): readonly string[] {
  return REQUIRED_PERMISSIONS.filter((p) => !granted.has(p));
}

export async function initPermissions(log: PermLog): Promise<void> {
  const api = (spindle as unknown as { permissions?: unknown }).permissions as
    | {
        getGranted?: () => Promise<string[]>;
        onChanged?: (
          h: (detail: { permission: string; granted: boolean; allGranted: string[] }) => void,
        ) => () => void;
      }
    | undefined;
  if (!api?.getGranted) {
    log.warn("permissions.init: spindle.permissions API unavailable on this host");
    return;
  }
  try {
    const list = await api.getGranted();
    for (const p of list) granted.add(p);
    loaded = true;
    log.info(`permissions.init: granted=[${[...granted].join(",")}]`);
  } catch (err) {
    log.warn(`permissions.init: getGranted failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (api.onChanged) {
    try {
      api.onChanged((detail) => {
        granted.clear();
        for (const p of detail.allGranted) granted.add(p);
        const missing = computeMissing();
        log.info(
          `permissions.changed: ${detail.permission}=${detail.granted ? "granted" : "revoked"} ` +
            `granted=[${detail.allGranted.join(",")}] missing=[${missing.join(",")}]`,
        );
        for (const fn of missingChangeListeners) {
          try {
            fn(missing);
          } catch (err) {
            log.warn(
              `permissions.changed: listener threw: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      });
    } catch (err) {
      log.warn(
        `permissions.init: onChanged subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export function isPermissionsLoaded(): boolean {
  return loaded;
}

export function getMissingPermissions(): readonly string[] {
  if (!loaded) return [];
  return computeMissing();
}

export function getMissingPermissionPurposes(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of getMissingPermissions()) out[p] = PERMISSION_PURPOSE[p] ?? p;
  return out;
}

export function subscribeToMissingChanges(
  handler: (missing: readonly string[]) => void,
): () => void {
  missingChangeListeners.add(handler);
  return () => {
    missingChangeListeners.delete(handler);
  };
}
