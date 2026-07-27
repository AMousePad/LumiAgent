import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import type { ChangeApprovalRequestWire, ChangeApprovalResultWire } from "../types";

interface PendingApproval {
  readonly rpcId: string;
  readonly input: ChangeApprovalRequestWire;
  readonly resolve: (result: ChangeApprovalResultWire) => void;
  settled: boolean;
  settleActive?: (result: ChangeApprovalResultWire, dismiss: boolean) => void;
}

export interface ChangeApprovalController {
  show(rpcId: string, input: ChangeApprovalRequestWire): Promise<ChangeApprovalResultWire>;
  cancel(rpcId: string, reason: string): void;
  destroy(): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isValidInput(input: ChangeApprovalRequestWire): boolean {
  return !!input
    && typeof input.sessionId === "string"
    && typeof input.assistantMessageId === "string"
    && typeof input.toolName === "string"
    && typeof input.summary === "string"
    && typeof input.target === "string"
    && typeof input.details === "string"
    && Array.isArray(input.invocationPath)
    && typeof input.expiresAt === "number";
}

export function createChangeApprovalController(ctx: SpindleFrontendContext): ChangeApprovalController {
  const queue: PendingApproval[] = [];
  const pending = new Map<string, PendingApproval>();
  let active: PendingApproval | null = null;
  let destroyed = false;

  const pump = (): void => {
    if (destroyed || active) return;
    let item: PendingApproval | undefined;
    while ((item = queue.shift()) !== undefined && item.settled) {
      // Skip requests cancelled before reaching the front of the queue.
    }
    if (!item || item.settled) return;
    if (item.input.expiresAt <= Date.now()) {
      item.settled = true;
      pending.delete(item.rpcId);
      item.resolve({ approved: false, reason: "dismissed" });
      queueMicrotask(pump);
      return;
    }
    active = item;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let handle: SpindleModalHandle;
    try {
      handle = ctx.ui.showModal({
        title: item.input.severity === "destructive" ? "Approve destructive change" : "Approve change",
        width: 680,
        maxHeight: 760,
      });
    } catch {
      item.settled = true;
      pending.delete(item.rpcId);
      active = null;
      item.resolve({ approved: false, reason: "dismissed" });
      queueMicrotask(pump);
      return;
    }

    const root = handle.root;
    root.classList.add("la-approval");
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    const titleId = `la-approval-title-${item.rpcId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    root.setAttribute("aria-labelledby", titleId);

    const heading = el("h3", "la-approval-title", item.input.summary);
    heading.id = titleId;
    const meta = el("div", "la-approval-meta");
    meta.append(
      el("span", `la-approval-chip ${item.input.severity === "destructive" ? "is-danger" : ""}`, item.input.action),
      el("code", "la-approval-tool", item.input.toolName),
    );
    const targetLabel = el("div", "la-approval-label", "Target");
    const target = el("code", "la-approval-target", item.input.target);
    const sessionLabel = el("div", "la-approval-label", "Session");
    const session = el("code", "la-approval-target", item.input.sessionId);
    const pathLabel = el("div", "la-approval-label", "Invocation");
    const path = el("code", "la-approval-target", item.input.invocationPath.join(" -> "));
    const detailsLabel = el("div", "la-approval-label", "Proposed arguments");
    const details = el("pre", "la-approval-details");
    details.textContent = item.input.details;
    const note = el("p", "la-approval-note", "Rejecting leaves the target unchanged. Earlier chat history remains untouched.");

    const actions = el("div", "la-approval-actions");
    const reject = el("button", "la-btn la-btn-ghost", "Reject") as HTMLButtonElement;
    reject.type = "button";
    const approve = el(
      "button",
      `la-btn ${item.input.severity === "destructive" ? "la-btn-danger" : "la-btn-primary"}`,
      item.input.severity === "destructive" ? "Approve destructive change" : "Approve change",
    ) as HTMLButtonElement;
    approve.type = "button";
    actions.append(reject, approve);
    root.append(heading, meta, targetLabel, target, sessionLabel, session, pathLabel, path, detailsLabel, details, note, actions);

    let offDismiss: (() => void) | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    const restoreFocus = (): void => {
      queueMicrotask(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
    const settle = (result: ChangeApprovalResultWire, dismiss: boolean): void => {
      if (item!.settled) return;
      item!.settled = true;
      pending.delete(item!.rpcId);
      document.removeEventListener("keydown", onKey, true);
      if (expiryTimer) clearTimeout(expiryTimer);
      offDismiss?.();
      if (active === item) active = null;
      if (dismiss) handle.dismiss();
      restoreFocus();
      item!.resolve(result);
      queueMicrotask(pump);
    };
    item.settleActive = settle;

    const focusable = (): HTMLElement[] => Array.from(
      root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"),
    ).filter((node) => node.offsetParent !== null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle({ approved: false, reason: "dismissed" }, true);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) {
        event.preventDefault();
        reject.focus();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (!root.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    offDismiss = handle.onDismiss(() => settle({ approved: false, reason: "dismissed" }, false));
    expiryTimer = setTimeout(
      () => settle({ approved: false, reason: "dismissed" }, true),
      Math.max(0, item.input.expiresAt - Date.now()),
    );
    document.addEventListener("keydown", onKey, true);
    reject.addEventListener("click", () => settle({ approved: false, reason: "rejected" }, true));
    approve.addEventListener("click", () => settle({ approved: true }, true));
    requestAnimationFrame(() => reject.focus());
  };

  return {
    show(rpcId, input) {
      if (destroyed || !isValidInput(input)) {
        return Promise.resolve({ approved: false, reason: "unloaded" });
      }
      const prior = pending.get(rpcId);
      if (prior) return Promise.resolve({ approved: false, reason: "dismissed" });
      return new Promise<ChangeApprovalResultWire>((resolve) => {
        const item: PendingApproval = { rpcId, input, resolve, settled: false };
        pending.set(rpcId, item);
        queue.push(item);
        pump();
      });
    },
    cancel(rpcId, reason) {
      const item = pending.get(rpcId);
      if (!item || item.settled) return;
      const result: ChangeApprovalResultWire = {
        approved: false,
        reason: reason === "Frontend reloaded" ? "unloaded" : "dismissed",
      };
      if (item.settleActive) item.settleActive(result, true);
      else {
        item.settled = true;
        pending.delete(rpcId);
        item.resolve(result);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const item of [...pending.values()]) {
        if (item.settleActive) item.settleActive({ approved: false, reason: "unloaded" }, true);
        else {
          item.settled = true;
          pending.delete(item.rpcId);
          item.resolve({ approved: false, reason: "unloaded" });
        }
      }
    },
  };
}
