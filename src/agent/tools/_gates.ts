import type { ToolCtx } from "./_context";
import type { ReadGate } from "./_framework";
import { sha256 } from "../../state/patch-stack";

const RECENT_READ_WINDOW_MS = 10 * 60_000;

export function ensureRecentRead(
  ctx: ToolCtx,
  gate: ReadGate,
  input: Record<string, unknown>,
): string | null {
  const surface = gate.surface(input);
  const age = ctx.recentReads.ageMs(surface);
  if (age !== null && age <= RECENT_READ_WINDOW_MS) return null;
  return `Error: [NOT_READ_RECENTLY] this edit targets '${surface}', which you haven't read in this turn. ${gate.hint(surface)} Re-read it first, then retry the edit using bytes copied verbatim from the read output.`;
}

export function markRead(ctx: ToolCtx, key: string): void {
  ctx.recentReads.record(key);
}

export function markReadWithHash(ctx: ToolCtx, key: string, value: string): void {
  ctx.recentReads.record(key, sha256(value));
}

// Fail loudly when the spindle's current value at `key` differs from what the
// agent last saw. Returns null on match, or when no hash was recorded yet
// (legacy callers don't store hashes, so absence means "no claim").
// Callers should already have passed ensureRecentRead.
export function ensureFreshRead(
  ctx: ToolCtx,
  key: string,
  currentValue: string,
): string | null {
  const cached = ctx.recentReads.getHash(key);
  if (cached === null) return null;
  const current = sha256(currentValue);
  if (cached === current) return null;
  return `Error: [STALE_READ] the leaf at '${key}' has changed since you read it. Your read saw a value hashing to ${cached.slice(0, 12)}…; the spindle now serves ${current.slice(0, 12)}…. Another agent, the user, or a prior edit in this same turn modified the field. Re-read it (\`read\` on '${key}') and base your next write on the fresh bytes.`;
}

// Refresh the cached hash to match the post-write content so consecutive
// edits on the same path keep working without an intervening read.
export function refreshReadHash(ctx: ToolCtx, key: string, newValue: string): void {
  ctx.recentReads.updateHash(key, sha256(newValue));
}
