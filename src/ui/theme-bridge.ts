import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { ThemeInspectionOptions } from "lumiverse-spindle-types";

export async function handleThemeWorkbench(ctx: SpindleFrontendContext, request: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const { operation, args = {} } = request as { operation: string; args: ThemeInspectionOptions & { target?: 'global' | 'assets' | 'component'; componentId?: string } };
  if (operation === 'open_editor') return { opened: ctx.theme.openEditor(args) };
  if (operation === 'selector') {
    const inspect = ctx.theme.inspect;
    if (!ctx.host.capabilities['theme-inspection-v1'] || !inspect) throw new Error('Theme inspection is unavailable. Update Lumiverse.');
    return inspect(args as ThemeInspectionOptions);
  }
  throw new Error('This theme operation uses the backend API.');
}
