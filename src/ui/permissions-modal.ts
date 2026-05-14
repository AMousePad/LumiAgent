import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import type { BackendToFrontend } from "../types";

export interface PermissionsModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export function setupPermissionsModal(opts: {
  ctx: SpindleFrontendContext;
  log: (level: "info" | "warn" | "error", msg: string, err?: unknown) => void;
}): PermissionsModalHandle {
  const { ctx, log } = opts;
  let current: SpindleModalHandle | null = null;
  let lastShownKey: string | null = null;

  function show(
    msg: Extract<BackendToFrontend, { type: "notify_missing_permissions" }>,
  ): void {
    if (msg.missing.length === 0) {
      if (current) {
        try { current.dismiss(); } catch { /* */ }
        current = null;
      }
      lastShownKey = null;
      return;
    }
    const key = [...msg.missing].sort().join(",");
    if (key === lastShownKey) return;
    lastShownKey = key;
    if (current) {
      try { current.dismiss(); } catch { /* */ }
      current = null;
    }

    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({ title: "LumiAgent: missing permissions", width: 520 });
    } catch (err) {
      log("error", "permissions-modal: showModal failed", err);
      return;
    }
    current = modal;

    const root = modal.root;
    root.classList.add("la-perm-modal");

    const lead = document.createElement("p");
    lead.className = "la-perm-lead";
    lead.textContent = msg.missing.length === 1
      ? "LumiAgent needs one permission that hasn't been granted."
      : `LumiAgent needs ${msg.missing.length} permissions that haven't been granted.`;
    root.appendChild(lead);

    const list = document.createElement("ul");
    list.className = "la-perm-list";
    for (const perm of msg.missing) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "la-perm-name";
      name.textContent = perm;
      li.appendChild(name);
      const purpose = msg.purposes[perm];
      if (purpose) li.appendChild(document.createTextNode(`: ${purpose}`));
      list.appendChild(li);
    }
    root.appendChild(list);

    const note = document.createElement("div");
    note.className = "la-perm-note";
    note.appendChild(document.createTextNode("Grant them, then toggle LumiAgent "));
    const emphasis = document.createElement("span");
    emphasis.className = "la-perm-emphasize";
    emphasis.textContent = "off and back on";
    note.appendChild(emphasis);
    note.appendChild(document.createTextNode(" in the Extensions panel."));
    root.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "la-perm-actions";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "la-perm-ok";
    okBtn.textContent = "Got it";
    okBtn.addEventListener("click", () => {
      try { modal.dismiss(); } catch { /* */ }
    });
    actions.appendChild(okBtn);
    root.appendChild(actions);

    modal.onDismiss(() => {
      if (current === modal) current = null;
    });

    queueMicrotask(() => { try { okBtn.focus(); } catch { /* */ } });
  }

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type === "notify_missing_permissions") show(msg);
    },
    destroy(): void {
      if (current) {
        try { current.dismiss(); } catch { /* */ }
        current = null;
      }
    },
  };
}
