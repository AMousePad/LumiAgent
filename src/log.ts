import type { SpindleAPI } from "lumiverse-spindle-types";

// Process-global gate for diagnostic info logs. Set from the active user's
// settings on every settings load. The worker can serve multiple users, so a
// concurrent op for a different user briefly sees this user's verbosity. That
// is acceptable for an off-by-default diagnostic switch and avoids a storage
// read on every hot-loop log line.
let debugEnabled = false;

export function setDebugLogging(v: boolean): void {
  debugEnabled = v;
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

// Diagnostic info log. Silent unless the user enabled debug logging in
// settings. Real problems must still use spindle.log.warn / .error directly,
// those are always on.
export function dlog(spindle: SpindleAPI, msg: string): void {
  if (!debugEnabled) return;
  try { spindle.log.info(msg); } catch { /* logging must never throw */ }
}
