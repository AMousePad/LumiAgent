declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import manifest from "../../spindle.json";

export const MINIMUM_LUMIVERSE_VERSION: string = manifest.minimum_lumiverse_version;

export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const core = v.split(/[-+]/)[0] ?? v;
    return core.split(".").map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

export interface HostVersionCheckResult {
  needsUpdate: boolean;
  hostVersion: string | null;
  minimum: string;
  message: string;
}

export function checkHostVersion(
  hostVersion: string | null,
  minimum: string,
): HostVersionCheckResult {
  if (!hostVersion) {
    return {
      needsUpdate: false,
      hostVersion: null,
      minimum,
      message: `Lumiverse version could not be determined, skipping minimum-version check (required minimum ${minimum})`,
    };
  }
  const cmp = compareVersions(hostVersion, minimum);
  if (cmp >= 0) {
    return {
      needsUpdate: false,
      hostVersion,
      minimum,
      message: `Lumiverse ${hostVersion} satisfies LumiAgent's minimum of ${minimum}`,
    };
  }
  return {
    needsUpdate: true,
    hostVersion,
    minimum,
    message: `LumiAgent requires Lumiverse ${minimum} or newer, but this host is running ${hostVersion}. Some features may fail or behave unexpectedly. Update Lumiverse for the intended experience.`,
  };
}

let cached: HostVersionCheckResult | null = null;

interface VersionLog {
  info(msg: string): void;
  warn(msg: string): void;
}

export async function initHostVersionCheck(log: VersionLog): Promise<HostVersionCheckResult> {
  let backend: string | null = null;
  let frontend: string | null = null;
  try {
    backend = await spindle.version.getBackend();
  } catch (err) {
    log.warn(`host-version: getBackend failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    frontend = await spindle.version.getFrontend();
  } catch (err) {
    log.warn(`host-version: getFrontend failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = checkHostVersion(backend, MINIMUM_LUMIVERSE_VERSION);
  cached = result;
  const tag = result.needsUpdate ? "WARN" : "ok";
  log.info(
    `host-version: lumiverse backend=${backend ?? "unknown"} frontend=${frontend ?? "unknown"} min=${MINIMUM_LUMIVERSE_VERSION} ${tag}`,
  );
  if (result.needsUpdate) log.warn(result.message);
  return result;
}

export function getHostVersionWarning(): HostVersionCheckResult | null {
  if (!cached || !cached.needsUpdate) return null;
  return cached;
}
