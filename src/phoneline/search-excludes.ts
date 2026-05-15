import type { SpindleAPI } from "lumiverse-spindle-types";
import { discoverProviders } from "./registry";

// Build a path-prefix matcher from a flat list. A pattern matches a path
// when path === pattern, path.startsWith(pattern + '.'), or path.startsWith(
// pattern + '['), so segment boundaries are respected (no accidental match
// on a longer sibling name).
export function makePathSkipFn(prefixes: readonly string[]): (path: string) => boolean {
  if (prefixes.length === 0) return () => false;
  return (path) => {
    for (const p of prefixes) {
      if (path === p) return true;
      if (path.startsWith(`${p}.`)) return true;
      if (path.startsWith(`${p}[`)) return true;
    }
    return false;
  };
}

// Union the excludeFromSearch lists from every approved phone-line provider
// and return a skip predicate the find walkers can pass into _walk.
export async function buildExtensionsSearchSkip(
  spindle: SpindleAPI,
  userId: string,
): Promise<(path: string) => boolean> {
  try {
    const providers = await discoverProviders(spindle, userId);
    const all = providers.flatMap((p) => p.manifest.excludeFromSearch ?? []);
    return makePathSkipFn(all);
  } catch {
    return () => false;
  }
}
