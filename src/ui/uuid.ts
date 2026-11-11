import type { SpindleFrontendUUIDAPI } from "lumiverse-spindle-types";

let hostUuid: SpindleFrontendUUIDAPI | undefined;

export function setHostUuid(api: SpindleFrontendUUIDAPI | undefined): void {
  hostUuid = api;
}

let sequence = 0;
const randomHex = (length: number): string => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export function createUuid(): string {
  if (hostUuid) return hostUuid.v4();

  // Hosts without frontend-uuid-v1 have no ctx.uuid, and the frontend cannot call crypto. These IDs only correlate requests in one tab, so they need uniqueness, not secrecy.
  const time = Date.now().toString(16).padStart(12, "0").slice(-12);
  sequence = (sequence + 1) & 0xfff;
  const variant = "89ab"[Math.floor(Math.random() * 4)];
  return `${time.slice(0, 8)}-${time.slice(8)}-4${sequence.toString(16).padStart(3, "0")}-${variant}${randomHex(3)}-${randomHex(12)}`;
}
