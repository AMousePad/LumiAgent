import type { SpindleAPI } from "lumiverse-spindle-types";
import type { SurfaceDescriptor, SurfaceManifest } from "./protocol";
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

// Coerce legacy manifest shapes into the current protocol. Older extension
// builds returned `scope: {kind: "global"|"per_character"}` and carried
// `item_kind` / `fields[]` on each surface. Without normalization, the new
// external-* tools compare `surface.scope === "per_character"` against an
// object and silently fall through, sending a global query for a per-character
// surface; the system prompt also stringifies the object as `[object Object]`.
function normaliseSurface(s: unknown): SurfaceDescriptor | null {
  if (!s || typeof s !== "object") return null;
  const raw = s as Record<string, unknown>;
  if (typeof raw["id"] !== "string" || typeof raw["label"] !== "string") return null;
  const description = typeof raw["description"] === "string" ? raw["description"] : "";
  let scope: "global" | "per_character";
  if (raw["scope"] === "global" || raw["scope"] === "per_character") {
    scope = raw["scope"];
  } else if (raw["scope"] && typeof raw["scope"] === "object") {
    const k = (raw["scope"] as Record<string, unknown>)["kind"];
    if (k === "global" || k === "per_character") scope = k;
    else return null;
  } else {
    return null;
  }
  return { id: raw["id"], label: raw["label"], description, scope };
}

function normaliseManifest(raw: unknown): SurfaceManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const ext = m["extension"];
  if (!ext || typeof ext !== "object") return null;
  const extRec = ext as Record<string, unknown>;
  if (typeof extRec["id"] !== "string" || typeof extRec["name"] !== "string") return null;
  if (!Array.isArray(m["surfaces"])) return null;
  const surfaces: SurfaceDescriptor[] = [];
  for (const s of m["surfaces"]) {
    const normalised = normaliseSurface(s);
    if (normalised !== null) surfaces.push(normalised);
  }
  const out: SurfaceManifest = {
    extension: {
      id: extRec["id"],
      name: extRec["name"],
      ...(typeof extRec["version"] === "string" ? { version: extRec["version"] } : {}),
    },
    surfaces,
    ...(Array.isArray(m["excludeFromSearch"])
      ? { excludeFromSearch: (m["excludeFromSearch"] as unknown[]).filter((x): x is string => typeof x === "string") }
      : {}),
  };
  return out;
}

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
      let rawManifest: unknown;
      try {
        rawManifest = await dialDescribe(spindle, entry.identifier);
      } catch {
        continue;
      }
      const manifest = normaliseManifest(rawManifest);
      if (!manifest) continue;
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
  surfaceId: string,
) {
  // Surface ids are namespaced by provider in the protocol but in practice
  // unique across the (small) set of installed phoneline providers. First
  // match wins; logged as a warning if more than one provider declares the
  // same id (would surface a forward-compat issue).
  const matches = providers
    .map((p) => {
      const surface = p.manifest.surfaces.find((s) => s.id === surfaceId);
      return surface ? { provider: p, surface } : null;
    })
    .filter((m): m is { provider: CachedProvider; surface: CachedProvider["manifest"]["surfaces"][number] } => m !== null);
  if (matches.length === 0) return null;
  return matches[0]!;
}
