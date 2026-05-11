import type { SpindleAPI } from "lumiverse-spindle-types";
import { ENDPOINTS, type SurfaceManifest } from "./protocol";

// Extensions that opt into the surface-provider protocol. Add new ids here.
export const KNOWN_PROVIDER_IDS: readonly string[] = ["lumirealm"];

export interface CachedProvider {
  readonly id: string;
  readonly manifest: SurfaceManifest;
}

let cache: CachedProvider[] | null = null;
let pending: Promise<CachedProvider[]> | null = null;

export async function discoverProviders(spindle: SpindleAPI): Promise<CachedProvider[]> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    const found: CachedProvider[] = [];
    await Promise.all(KNOWN_PROVIDER_IDS.map(async (id) => {
      try {
        const manifest = await spindle.rpcPool.read<SurfaceManifest>(ENDPOINTS.describe(id));
        if (manifest && manifest.extension && Array.isArray(manifest.surfaces)) {
          found.push({ id, manifest });
        }
      } catch {
        // Extension not installed, not enabled, or doesn't implement the bridge — skip.
      }
    }));
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

export function findSurface(providers: readonly CachedProvider[], providerId: string, surfaceId: string) {
  const prov = providers.find((p) => p.id === providerId);
  if (!prov) return null;
  const surf = prov.manifest.surfaces.find((s) => s.id === surfaceId);
  if (!surf) return null;
  return { provider: prov, surface: surf };
}
