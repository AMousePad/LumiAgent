import type { ToolCtx } from './_context';
import type { ThemeAuthoringRequest, ThemeReferencesRequest } from 'lumiverse-spindle-types';
import { observeChange, recordChange } from './_change-history';


export async function themeRpc(ctx: ToolCtx, operation: string, args: unknown = {}): Promise<any> {
  if (['install', 'restore', 'backup'].includes(operation)) {
    return observeChange(ctx, { kind: 'theme', id: 'current' }, 'Theme', operation,
      () => themeRpcRaw(ctx, 'state'), () => themeRpcRaw(ctx, operation, args), 'Restore a saved backup from My Themes or use the theme restore tool.');
  }
  const result = await themeRpcRaw(ctx, operation, args);
  if (['import', 'asset_create_bundle', 'asset_upload', 'asset_update', 'asset_delete', 'asset_optimize'].includes(operation)) {
    const input = args as Record<string, unknown>;
    const receipt = JSON.parse(JSON.stringify({ request: input, result }, (key, value) => key === 'bytes' ? undefined : value));
    recordChange(ctx, { kind: 'theme', id: 'assets' }, 'Theme assets', operation, null, receipt, 'Asset history records the operation and metadata. Deleted or replaced bytes cannot be restored here.');
  }
  return result;
}

async function themeRpcRaw(ctx: ToolCtx, operation: string, args: unknown = {}): Promise<any> {
  ctx.signal.throwIfAborted();
  if (operation === 'selector' || operation === 'open_editor') {
    if (!ctx.callFrontend) throw new Error('This operation needs an open Lumiverse tab.');
    return ctx.callFrontend('theme_workbench', { operation, args }, 60_000);
  }
  const references = ctx.spindle.theme.references;
  if (['components', 'component', 'variables', 'search', 'read'].includes(operation)) {
    if (references?.version !== 1) throw new Error('Theme source references are unavailable on this host.');
    return references.request({ operation, args } as ThemeReferencesRequest);
  }
  const api = ctx.spindle.theme.authoring;
  if (!api || api.version !== 1) throw new Error('Backend theme authoring is unavailable. Update Lumiverse.');
  const result = await api.request({ operation, args } as ThemeAuthoringRequest, ctx.userId);
  return operation === 'state' ? { ...(result as Record<string, unknown>), capabilities: ['persistent-themes', ...(references?.version === 1 ? ['theme-references'] : [])] } : result;
}
