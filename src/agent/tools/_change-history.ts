import type { ScopeRef } from "../../types";
import type { ToolCtx } from "./_context";

export function recordChange(ctx: ToolCtx, scope: ScopeRef, label: string, field: string, before: unknown, after: unknown, reason = "The host does not provide a safe restore operation for this change."): void {
  const previous = JSON.stringify(before ?? null, null, 2), next = JSON.stringify(after ?? null, null, 2);
  if (previous === next) return;
  ctx.pushEdit({ op: "edit", surface: "external", providerId: "lumiagent", providerName: "LumiAgent", externalSurfaceId: scope.kind, itemId: scope.id,
    surfaceId: `${scope.kind}:${scope.id}`, surfaceLabel: label, field, before: previous, after: next, scope, auditOnly: reason });
}

export async function observeChange<T>(ctx: ToolCtx, scope: ScopeRef, label: string, field: string, read: () => Promise<unknown>, action: () => Promise<T>, reason?: string): Promise<T> {
  const before = structuredClone(await read());
  try { return await action(); }
  finally { recordChange(ctx, scope, label, field, before, await read(), reason); }
}
