import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { mountDrawer } from "./ui/drawer";
import { setupPermissionsModal } from "./ui/permissions-modal";
import { setupBridgeStatusBanner } from "./ui/bridge-status-banner";
import { setupVersionModal } from "./ui/version-modal";
import type { BackendToFrontend } from "./types";

export function setup(ctx: SpindleFrontendContext): void {
  mountDrawer(ctx);

  const log = (level: "info" | "warn" | "error", msg: string, err?: unknown): void => {
    const prefix = "[lumiagent]";
    if (level === "error") console.error(prefix, msg, err);
    else if (level === "warn") console.warn(prefix, msg);
    else console.log(prefix, msg);
  };
  const permissionsModal = setupPermissionsModal({ ctx, log });
  const bridgeBanner = setupBridgeStatusBanner({ ctx, log });
  const versionModal = setupVersionModal({ ctx });

  ctx.onBackendMessage((raw) => {
    const msg = raw as BackendToFrontend;
    permissionsModal.handleBackendMessage(msg);
    bridgeBanner.handleBackendMessage(msg);
    versionModal.handleBackendMessage(msg);
  });
}
