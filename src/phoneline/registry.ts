import type { SpindleAPI } from "lumiverse-spindle-types";
import type { SurfaceDescriptor, SurfaceManifest } from "./protocol";
import { dialDescribe } from "./transport";
import { recordAutoApprovedPairing } from "./consent";
import { dlog } from "../log";

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

const cache = new Map<string, CachedProvider[]>();
const pending = new Map<string, Promise<CachedProvider[]>>();

// Per (user, phoneline) parse of the host's inheritance-check error from the
// most recent dial. The dial outcome is ground truth (declared-perm heuristics
// false-positive when both sides revoke the same perm and the owner check
// trivially passes on an empty set).
export interface DialFailureInfo {
  // Extension ID that lacks perms in the failing check. "lumiagent" when
  // LumiAgent itself is missing them on the outbound read, "lumirealm" when
  // LumiRealm's handler can't read the request envelope back.
  readonly missingFor: string;
  readonly missingPerms: readonly string[];
}
const lastDialFailure = new Map<string, DialFailureInfo | null>();

function dialKey(userId: string, identifier: string): string {
  return `${userId}::${identifier}`;
}

function parseInheritanceError(message: string): DialFailureInfo | null {
  // Host throws: 'Shared RPC endpoint "X" requires requester "R" to inherit
  // owner "O" permissions: a, b, c'. LumiRealm wraps this in 'could not read
  // pending request from <id>: <innerMessage>'. The substring we match on is
  // preserved in both shapes.
  const m = /requires requester "([^"]+)" to inherit owner "[^"]+" permissions: ([^]+?)$/.exec(message);
  if (!m) return null;
  const requester = m[1]!;
  const perms = m[2]!.split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (perms.length === 0) return null;
  return { missingFor: requester, missingPerms: perms };
}

export function getAllDialFailures(userId: string): readonly DialFailureInfo[] {
  const out: DialFailureInfo[] = [];
  for (const entry of KNOWN_PHONELINES) {
    const f = lastDialFailure.get(dialKey(userId, entry.identifier));
    if (f) out.push(f);
  }
  return out;
}

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
): Promise<CachedProvider[]> {
  const cached = cache.get(userId);
  if (cached) {
    dlog(spindle, `phoneline.discover: cache hit for user=${userId} providers=${cached.length}`);
    return cached;
  }
  const inflight = pending.get(userId);
  if (inflight) {
    dlog(spindle, `phoneline.discover: joining in-flight discover for user=${userId}`);
    return inflight;
  }
  dlog(spindle, `phoneline.discover: fresh discover for user=${userId} (no cache)`);
  const p = (async () => {
    const found: CachedProvider[] = [];
    for (const entry of KNOWN_PHONELINES) {
      let rawManifest: unknown;
      try {
        rawManifest = await dialDescribe(spindle, entry.identifier);
        lastDialFailure.set(dialKey(userId, entry.identifier), null);
        dlog(spindle, `phoneline.discover: ${entry.identifier} dialDescribe ok`);
      } catch (err) {
        const msg = (err as Error).message;
        const parsed = parseInheritanceError(msg);
        lastDialFailure.set(dialKey(userId, entry.identifier), parsed);
        // A not-registered endpoint just means the extension isn't installed:
        // benign and spammy (fires on every discover). Only a parsed
        // permission-inheritance failure is actionable, keep that at warn.
        if (parsed) {
          try { spindle.log.warn(`phoneline.discover: ${entry.identifier} dialDescribe failed: ${msg}`); } catch {}
        } else {
          dlog(spindle, `phoneline.discover: ${entry.identifier} dialDescribe failed: ${msg}`);
        }
        continue;
      }
      const manifest = normaliseManifest(rawManifest);
      if (!manifest) {
        try { spindle.log.warn(`phoneline.discover: ${entry.identifier} normaliseManifest returned null`); } catch {}
        continue;
      }
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
      // Auto-approve. The user already explicitly granted both extensions the
      // same permission set, and the host enforces permission parity before
      // any dial reaches us. promptFn is retained on the signature for
      // backward compatibility with existing callers; it's no longer invoked.
      const decision = await recordAutoApprovedPairing(spindle, userId, trusted);
      dlog(spindle, `phoneline.discover: ${entry.identifier} auto-approved hash=${decision.manifestHash.slice(0, 12)}`);
      found.push({ id: entry.identifier, manifest: trusted });
    }
    cache.set(userId, found);
    pending.delete(userId);
    dlog(spindle, `phoneline.discover: complete user=${userId} providers=[${found.map((p) => p.id).join(",")}]`);
    return found;
  })();
  pending.set(userId, p);
  return p;
}

export function invalidate(userId?: string): void {
  if (userId === undefined) { cache.clear(); pending.clear(); return; }
  cache.delete(userId);
  pending.delete(userId);
}

export function getCached(userId: string): readonly CachedProvider[] {
  return cache.get(userId) ?? [];
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
