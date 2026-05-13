import type { SpindleAPI } from "lumiverse-spindle-types";
import { discoverProviders } from "./registry";
import { dialCheckWrite } from "./transport";
import type { ConsentPromptFn } from "./consent";

function firstSegment(extPath: string): string | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(extPath);
  return m ? m[1]! : null;
}

export interface ExtensionWriteCheck {
  readonly ok: boolean;
  readonly message?: string;
}

export async function checkExtensionWrite(
  spindle: SpindleAPI,
  userId: string,
  characterId: string,
  extPath: string,
  promptFn: ConsentPromptFn,
): Promise<ExtensionWriteCheck> {
  const seg = firstSegment(extPath);
  if (!seg) return { ok: true };
  const providers = await discoverProviders(spindle, userId, promptFn);
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
