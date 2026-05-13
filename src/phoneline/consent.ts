import type { SpindleAPI } from "lumiverse-spindle-types";
import type { SurfaceManifest } from "./protocol";

// User-consent layer for phone-line pairings. Stored in LumiAgent's own
// userStorage namespace (no other extension can touch it). Keyed on the
// host-attested channel identifier.

export interface PairingDecision {
  readonly identifier: string;
  readonly displayName: string;
  readonly allowed: boolean;
  // Hash of the extension's describe response at the time of the user's last
  // decision. Re-prompt if the hash changes between sessions. CAVEAT: this
  // catches changes the extension reflects in its describe (surfaces, fields,
  // declared name/version). It does NOT catch a malicious update that keeps
  // describe identical but ships different code. Plugging that hole needs
  // host-attested install metadata, which is not currently exposed.
  readonly manifestHash: string;
  readonly decidedAt: number;
}

export interface ConsentPromptInput {
  readonly identifier: string;
  readonly displayName: string;
  readonly version: string | undefined;
  readonly kind: "initial" | "revalidate";
}

export type ConsentPromptFn = (input: ConsentPromptInput) => Promise<boolean>;

const STORAGE_PATH = "phoneline-pairings.json";

interface PairingsFile {
  readonly version: 1;
  readonly pairings: Record<string, PairingDecision>;
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashManifest(manifest: SurfaceManifest): Promise<string> {
  return sha256(JSON.stringify(manifest));
}

async function loadFile(spindle: SpindleAPI, userId: string): Promise<PairingsFile> {
  try {
    const raw = await spindle.userStorage.read(STORAGE_PATH, userId);
    if (typeof raw !== "string" || raw.length === 0) return { version: 1, pairings: {} };
    const parsed = JSON.parse(raw) as PairingsFile;
    if (parsed?.version === 1 && parsed.pairings && typeof parsed.pairings === "object") return parsed;
    return { version: 1, pairings: {} };
  } catch {
    return { version: 1, pairings: {} };
  }
}

async function saveFile(spindle: SpindleAPI, userId: string, file: PairingsFile): Promise<void> {
  await spindle.userStorage.write(STORAGE_PATH, JSON.stringify(file), userId);
}

export async function loadAllPairings(spindle: SpindleAPI, userId: string): Promise<Record<string, PairingDecision>> {
  return (await loadFile(spindle, userId)).pairings;
}

export async function loadPairing(
  spindle: SpindleAPI,
  userId: string,
  identifier: string,
): Promise<PairingDecision | null> {
  const all = await loadAllPairings(spindle, userId);
  return all[identifier] ?? null;
}

export async function savePairing(
  spindle: SpindleAPI,
  userId: string,
  decision: PairingDecision,
): Promise<void> {
  const file = await loadFile(spindle, userId);
  const pairings = { ...file.pairings, [decision.identifier]: decision };
  await saveFile(spindle, userId, { version: 1, pairings });
}

export async function deletePairing(
  spindle: SpindleAPI,
  userId: string,
  identifier: string,
): Promise<void> {
  const file = await loadFile(spindle, userId);
  if (!(identifier in file.pairings)) return;
  const pairings = { ...file.pairings };
  delete pairings[identifier];
  await saveFile(spindle, userId, { version: 1, pairings });
}

export async function resolvePairing(
  spindle: SpindleAPI,
  userId: string,
  manifest: SurfaceManifest,
  prompt: ConsentPromptFn,
): Promise<PairingDecision> {
  const identifier = manifest.extension.id;
  const displayName = manifest.extension.name;
  const currentHash = await hashManifest(manifest);
  const stored = await loadPairing(spindle, userId, identifier);
  if (stored && stored.manifestHash === currentHash) return stored;
  const allowed = await prompt({
    identifier,
    displayName,
    version: manifest.extension.version,
    kind: stored ? "revalidate" : "initial",
  });
  const decision: PairingDecision = {
    identifier,
    displayName,
    allowed,
    manifestHash: currentHash,
    decidedAt: Date.now(),
  };
  await savePairing(spindle, userId, decision);
  return decision;
}

// Backed by the backend↔frontend rpc channel. Modal timeout doubles as a
// default-deny: a stuck frontend never silently approves.
export function makeConsentPromptFn(
  callFrontend: (op: string, args: unknown, timeoutMs?: number) => Promise<unknown>,
  timeoutMs = 10 * 60_000,
): ConsentPromptFn {
  return async (input) => {
    try {
      const result = await callFrontend("phoneline_consent", input, timeoutMs);
      if (typeof result !== "object" || result === null) return false;
      const r = result as { allowed?: boolean };
      return r.allowed === true;
    } catch {
      return false;
    }
  };
}
