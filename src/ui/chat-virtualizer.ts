// DOM: scrollContainer > spacer (height=getTotalSize) > inner
// (absolute, translateY=items[0].start) > items in normal flow.
// _didMount once, _willUpdate at every sync (per-render contract).

import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";
import type { ChatMessage } from "../types";

const STICKY_THRESHOLD_PX = 80;
const DEFAULT_ESTIMATE = 220;
const OVERSCAN = 4;

export interface ChatVirtualizerDeps {
  // Needs overflow-y:auto and a height bound.
  readonly scrollContainer: HTMLElement;
  getMessages(): readonly ChatMessage[];
  // Returned node is cached and reused across re-syncs.
  renderMessage(msg: ChatMessage, index: number): HTMLElement;
  estimateSize?(msg: ChatMessage): number;
}

export class ChatVirtualizer {
  private readonly deps: ChatVirtualizerDeps;
  private readonly spacer: HTMLElement;
  private readonly inner: HTMLElement;
  private virt: Virtualizer<HTMLElement, HTMLElement>;
  private readonly nodeByKey = new Map<string, HTMLElement>();
  private cleanup: (() => void) | null = null;
  private stickyToBottom = true;
  private scrollListener: (() => void) | null = null;
  private forceBottomOnNextSync = false;
  private hasFirstRenderHappened = false;

  constructor(deps: ChatVirtualizerDeps) {
    this.deps = deps;

    deps.scrollContainer.style.overflowAnchor = "none";
    deps.scrollContainer.style.contain = "strict";

    this.spacer = document.createElement("div");
    this.spacer.className = "la-virt-spacer";
    this.spacer.style.position = "relative";
    this.spacer.style.width = "100%";
    deps.scrollContainer.appendChild(this.spacer);

    this.inner = document.createElement("div");
    this.inner.className = "la-virt-inner";
    this.inner.style.position = "absolute";
    this.inner.style.top = "0";
    this.inner.style.left = "0";
    this.inner.style.width = "100%";
    this.spacer.appendChild(this.inner);

    this.virt = new Virtualizer<HTMLElement, HTMLElement>({
      count: deps.getMessages().length,
      getScrollElement: () => deps.scrollContainer,
      estimateSize: (i) => {
        const m = deps.getMessages()[i];
        return m ? (deps.estimateSize?.(m) ?? DEFAULT_ESTIMATE) : DEFAULT_ESTIMATE;
      },
      getItemKey: (i) => deps.getMessages()[i]?.id ?? i,
      observeElementOffset,
      observeElementRect,
      scrollToFn: elementScroll,
      overscan: OVERSCAN,
      onChange: () => this.sync(),
    });

    this.cleanup = this.virt._didMount();

    this.scrollListener = () => this.updateStickiness();
    deps.scrollContainer.addEventListener("scroll", this.scrollListener, { passive: true });

    this.sync();
  }

  // Reflect a change in message count (append, splice). Call whenever
  // state.messages length changes or whenever message order shifts.
  setCount(): void {
    this.virt.setOptions({ ...this.virt.options, count: this.deps.getMessages().length });
    this.sync();
  }

  // Force the virtualizer to remeasure a single message. Tanstack's
  // ResizeObserver picks structural growth up automatically; explicit calls
  // are only needed right after a known mutation when you want next-frame
  // accurate layout.
  requestMeasure(messageId: string): void {
    const node = this.nodeByKey.get(messageId);
    if (node) this.virt.measureElement(node);
  }

  // Force a fresh render of `messageId` on the next sync. Used when the
  // message's content needs to be rebuilt from scratch.
  evict(messageId: string): void {
    const node = this.nodeByKey.get(messageId);
    if (node?.parentElement) node.remove();
    this.nodeByKey.delete(messageId);
  }

  // Drop all cached nodes. Cheap nuke for session change.
  clear(): void {
    for (const node of this.nodeByKey.values()) {
      if (node.parentElement) node.remove();
    }
    this.nodeByKey.clear();
  }

  // Drop every cached node except the one keyed by `messageId`. Used when a
  // message is in inline edit mode. Preserves the live textarea's focus and
  // cursor across a re-sync.
  clearExcept(messageId: string): void {
    const keep = this.nodeByKey.get(messageId);
    for (const [key, node] of this.nodeByKey) {
      if (key === messageId) continue;
      if (node.parentElement) node.remove();
    }
    this.nodeByKey.clear();
    if (keep) this.nodeByKey.set(messageId, keep);
  }

  scrollToBottom(): void {
    const count = this.deps.getMessages().length;
    if (count === 0) return;
    this.forceBottomOnNextSync = true;
    this.virt.scrollToIndex(count - 1, { align: "end" });
    this.stickyToBottom = true;
  }

  isNearBottom(): boolean {
    return this.stickyToBottom;
  }

  destroy(): void {
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    if (this.scrollListener) {
      this.deps.scrollContainer.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }
    this.clear();
    if (this.spacer.parentElement) this.spacer.parentElement.removeChild(this.spacer);
  }

  private updateStickiness(): void {
    const el = this.deps.scrollContainer;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.stickyToBottom = distanceFromBottom <= STICKY_THRESHOLD_PX;
  }

  // Wipe any per-item styles a previous (absolute-position) layout era may
  // have set on a cached node. Items in block-translation layout flow
  // naturally; carrying over an absolute style would break ordering and
  // create the same overflow bug the refactor fixes.
  private normaliseItemStyle(node: HTMLElement): void {
    if (node.style.position) node.style.position = "";
    if (node.style.top) node.style.top = "";
    if (node.style.left) node.style.left = "";
    if (node.style.right) node.style.right = "";
    if (node.style.transform) node.style.transform = "";
  }

  private sync(): void {
    // Flush observer state before reading virtual items. The official React
    // adapter wires this as `useLayoutEffect(() => instance._willUpdate())`
    // with no deps array, so it fires on every render. We mirror that here.
    this.virt._willUpdate();
    const items = this.virt.getVirtualItems();
    const totalSize = this.virt.getTotalSize();
    this.spacer.style.height = `${totalSize}px`;
    this.inner.style.transform = `translateY(${items[0]?.start ?? 0}px)`;

    const activeKeys = new Set<string>();
    for (const it of items) activeKeys.add(String(it.key));

    // Detach nodes that fell out of the active window. Cached so a scroll-
    // back doesn't pay the render cost twice.
    for (const [key, node] of this.nodeByKey) {
      if (!activeKeys.has(key) && node.parentElement === this.inner) {
        this.inner.removeChild(node);
      }
    }

    const messages = this.deps.getMessages();
    // Only move nodes whose DOM position is wrong. Re-attaching an already
    // positioned child detaches and reattaches it, blurring any focused
    // descendant (e.g. the inline-edit textarea on every ResizeObserver tick).
    let cursor: ChildNode | null = this.inner.firstChild;
    for (const item of items) {
      const key = String(item.key);
      const msg = messages[item.index];
      if (!msg) continue;
      let node = this.nodeByKey.get(key);
      if (!node) {
        node = this.deps.renderMessage(msg, item.index);
        node.setAttribute("data-virt-key", key);
        this.nodeByKey.set(key, node);
      }
      this.normaliseItemStyle(node);
      // tanstack reads data-index off the node to map a ResizeObserver entry
      // back to its item. Refresh every sync since splices can shift indices
      // while keys stay stable.
      node.setAttribute("data-index", String(item.index));
      if (node === cursor) {
        cursor = node.nextSibling;
      } else {
        // insertBefore(node, null) acts as appendChild.
        this.inner.insertBefore(node, cursor);
        cursor = node.nextSibling;
      }
      this.virt.measureElement(node);
    }

    const stickBottom = (): void => {
      const el = this.deps.scrollContainer;
      // Bypass scroll-behavior: smooth for programmatic stick so animation
      // queues don't fight the user's wheel events.
      const prevBehavior = el.style.scrollBehavior;
      el.style.scrollBehavior = "auto";
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      el.style.scrollBehavior = prevBehavior;
    };
    const isCurrentlyAtBottom = (): boolean => {
      const el = this.deps.scrollContainer;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      return distance >= 0 && distance <= STICKY_THRESHOLD_PX;
    };

    if (!this.hasFirstRenderHappened) {
      this.hasFirstRenderHappened = items.length > 0;
    } else if (this.forceBottomOnNextSync) {
      this.forceBottomOnNextSync = false;
      stickBottom();
    } else if (this.stickyToBottom && isCurrentlyAtBottom()) {
      stickBottom();
    } else if (!isCurrentlyAtBottom()) {
      // User moved away from bottom; refresh the flag so subsequent syncs
      // honor the new intent even before the scroll event fires.
      this.stickyToBottom = false;
    }
  }
}
