import type { SpindleAPI } from "lumiverse-spindle-types";

export function registerPhonelineProbe(spindle: SpindleAPI, onProbe: () => void): void {
  // Unrelated agent permissions must not become requirements for the bridge probe.
  spindle.rpcPool.handle("phoneline_probe", () => {
    onProbe();
    return { ok: true };
  }, { requires: ["characters"] });
}
