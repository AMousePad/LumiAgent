import type { SpindleAPI } from "lumiverse-spindle-types";
import type { SurfaceManifest } from "./protocol";
import { dialDescribe } from "./transport";
import { type ConsentPromptFn, resolvePairing } from "./consent";

// Recognised phone-line extensions. Both fields are pinned: identifier is the
// host-attested channel namespace, name MUST match the extension's describe
// response. Mismatch skips the dial silently before any consent UI fires.
export const KNOWN_PHONELINES: ReadonlyArray<{ identifier: string; name: string }> = [
  { identifier: "lumirealm", name: "LumiRealm" },
];

export interface CachedProvider {
  readonly id: string;
  readonly manifest: SurfaceManifest;
}

let cache: CachedProvider[] | null = null;
let pending: Promise<CachedProvider[]> | null = null;

export async function discoverProviders(
  spindle: SpindleAPI,
  userId: string,
  promptFn: ConsentPromptFn,
): Promise<CachedProvider[]> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    const found: CachedProvider[] = [];
    for (const entry of KNOWN_PHONELINES) {
      let manifest: SurfaceManifest;
      try {
        manifest = await dialDescribe(spindle, entry.identifier);
      } catch {
        continue;
      }
      if (!manifest || !manifest.extension || !Array.isArray(manifest.surfaces)) continue;
      if (manifest.extension.name !== entry.name) {
        try {
          spindle.log.warn(
            `phoneline: "${entry.identifier}" returned unexpected name "${manifest.extension.name}" ` +
            `(expected "${entry.name}"). Skipping. Legitimate rename requires a LumiAgent whitelist update.`,
          );
        } catch { /* logger may be unavailable mid-init */ }
        continue;
      }
      const trusted: SurfaceManifest = {
        ...manifest,
        extension: { ...manifest.extension, id: entry.identifier, name: entry.name },
      };
      const decision = await resolvePairing(spindle, userId, trusted, promptFn);
      if (!decision.allowed) continue;
      found.push({ id: entry.identifier, manifest: trusted });
    }
    cache = found;
    pending = null;
    return found;
  })();
  return pending;
}

export function invalidate(): void {
  cache = null;
  pending = null;
}

export function getCached(): readonly CachedProvider[] {
  return cache ?? [];
}

export function findSurface(
  providers: readonly CachedProvider[],
  providerId: string,
  surfaceId: string,
) {
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;
  const surface = provider.manifest.surfaces.find((s) => s.id === surfaceId);
  if (!surface) return null;
  return { provider, surface };
}
