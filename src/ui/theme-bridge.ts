import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { SpindleThemePackDraft } from "lumiverse-spindle-types";

// ctx.theme only exists in the browser, so the backend's theme tools reach it
// through the frontend RPC bridge. Feature-detect per capability group: a host
// older than these versioned keys has no authoring surface at all.

function requireCapability(ctx: SpindleFrontendContext, key: string): void {
  const caps = (ctx.host?.capabilities ?? {}) as Record<string, unknown>;
  if (!caps[key]) throw new Error(`host does not support ${key}; update Lumiverse to use theme authoring`);
}

export function handleThemeCatalog(ctx: SpindleFrontendContext): {
  components: ReturnType<SpindleFrontendContext["theme"]["catalog"]["listComponents"]>;
  variables: ReturnType<SpindleFrontendContext["theme"]["catalog"]["listVariables"]>;
} {
  requireCapability(ctx, "theme-catalog-v1");
  return {
    components: ctx.theme.catalog.listComponents(),
    variables: ctx.theme.catalog.listVariables(),
  };
}

export async function handleThemeInstallPack(
  ctx: SpindleFrontendContext,
  args: unknown,
): Promise<unknown> {
  requireCapability(ctx, "theme-packs-v1");
  const a = args as {
    draft: SpindleThemePackDraft;
    apply?: boolean;
    save_to_library?: boolean;
  };
  const result = await ctx.theme.packs.installDraft(a.draft, {
    apply: a.apply !== false,
    saveToLibrary: a.save_to_library === true,
  });
  return result;
}
