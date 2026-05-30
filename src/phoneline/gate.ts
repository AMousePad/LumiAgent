import type { SpindleAPI } from "lumiverse-spindle-types";
import { discoverProviders } from "./registry";
import { dialCheckWrite, dialCheckRead } from "./transport";
import { parseExtensionPath } from "../agent/tools/_paths";

// Resolve the owning provider id (first path key) through the SAME grammar the
// writer uses. A plain regex only matched identifier-leading paths, so a
// bracket-quoted first segment (`["lumirealm"].payload.x`) returned null and
// the gate fell open, bypassing check_write/check_read on a provider-owned
// subtree. parseExtensionPath resolves both forms to the same key.
function firstSegment(extPath: string): string | null {
  try {
    const first = parseExtensionPath(extPath)[0];
    return first && first.kind === "key" ? first.value : null;
  } catch {
    return null;
  }
}

export interface ExtensionAccessCheck {
  readonly ok: boolean;
  readonly message?: string;
}

export type ExtensionWriteCheck = ExtensionAccessCheck;

export async function checkExtensionWrite(
  spindle: SpindleAPI,
  userId: string,
  characterId: string,
  extPath: string,
): Promise<ExtensionAccessCheck> {
  const seg = firstSegment(extPath);
  if (!seg) return { ok: true };
  const providers = await discoverProviders(spindle, userId);
  const provider = providers.find((p) => p.id === seg);
  if (!provider) return { ok: true };
  try {
    const res = await dialCheckWrite(spindle, provider.id, userId, characterId, extPath);
    if (typeof res?.ok !== "boolean") return { ok: true };
    return res.message !== undefined ? { ok: res.ok, message: res.message } : { ok: res.ok };
  } catch {
    return { ok: true };
  }
}

// Symmetric to checkExtensionWrite for the read-side gate. Extensions that
// don't implement `check_read` (e.g. throw "unknown op") fall back to "allow"
// so we don't lock out callers against older bridges.
export async function checkExtensionRead(
  spindle: SpindleAPI,
  userId: string,
  characterId: string,
  extPath: string,
): Promise<ExtensionAccessCheck> {
  const seg = firstSegment(extPath);
  if (!seg) return { ok: true };
  const providers = await discoverProviders(spindle, userId);
  const provider = providers.find((p) => p.id === seg);
  if (!provider) return { ok: true };
  try {
    const res = await dialCheckRead(spindle, provider.id, userId, characterId, extPath);
    if (typeof res?.ok !== "boolean") return { ok: true };
    return res.message !== undefined ? { ok: res.ok, message: res.message } : { ok: res.ok };
  } catch {
    return { ok: true };
  }
}
