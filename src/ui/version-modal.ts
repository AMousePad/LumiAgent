import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { BackendToFrontend } from "../types";

export interface VersionModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
}

export function setupVersionModal(opts: {
  ctx: SpindleFrontendContext;
}): VersionModalHandle {
  const { ctx } = opts;
  let shown = false;

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type !== "host_version_warning") return;
      if (shown) return;
      shown = true;
      ctx.ui.showConfirm({
        title: "Update Lumiverse",
        message: msg.message,
        confirmLabel: "OK",
        cancelLabel: "Dismiss",
        variant: "warning",
      }).catch(() => { /* */ });
    },
  };
}
