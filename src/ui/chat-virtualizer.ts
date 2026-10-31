import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";
import type { ChatMessage } from "../types";
import { disposeTree } from "./dom-lifecycle";

const END_THRESHOLD_PX = 2;
const DEFAULT_ESTIMATE = 220;
const OVERSCAN = 4;

export interface ChatVirtualizerDeps<T extends { id: string } = ChatMessage> {
  // Needs overflow-y:auto and a height bound.
  readonly scrollContainer: HTMLElement;
  getMessages(): readonly T[];
  // Returned node is cached and reused across re-syncs.
  renderMessage(msg: T, index: number): HTMLElement;
  estimateSize?(msg: T): number;
  initialPosition?: "start" | "end";
  followEnd?: boolean;
  containSize?: boolean;
}

export class ChatVirtualizer<T extends { id: string } = ChatMessage> {
  private readonly deps: ChatVirtualizerDeps<T>;
  private readonly spacer: HTMLElement;
  private readonly inner: HTMLElement;
  private virt: Virtualizer<HTMLElement, HTMLElement>;
  private readonly nodeByKey = new Map<string, HTMLElement>();
  private cleanup: (() => void) | null = null;
  private hasFirstRenderHappened = false;
  private readonly cancelUserScroll = (event: Event): void => {
    if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
    this.virt.cancelScroll();
  };

  constructor(deps: ChatVirtualizerDeps<T>) {
    this.deps = deps;

    deps.scrollContainer.style.overflowAnchor = "none";
    deps.scrollContainer.style.contain = deps.containSize === false ? "content" : "strict";

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
      anchorTo: deps.followEnd === false ? "start" : "end",
      followOnAppend: deps.followEnd !== false,
      scrollEndThreshold: END_THRESHOLD_PX,
      onChange: () => this.sync(),
    });

    this.cleanup = this.virt._didMount();
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      deps.scrollContainer.addEventListener(event, this.cancelUserScroll, { passive: true });
    }

    this.sync();
  }

  // Reflect a change in message count (append, splice). Call whenever
  // state.messages length changes or whenever message order shifts.
  setCount(): void {
    this.virt.setOptions({ ...this.virt.options, count: this.deps.getMessages().length, getItemKey: i => this.deps.getMessages()[i]?.id ?? i });
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
    if (node) disposeTree(node);
    if (node?.parentElement) node.remove();
    this.nodeByKey.delete(messageId);
  }

  // Drop all cached nodes. Cheap nuke for session change.
  clear(): void {
    for (const node of this.nodeByKey.values()) {
      disposeTree(node);
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
      disposeTree(node);
      if (node.parentElement) node.remove();
    }
    this.nodeByKey.clear();
    if (keep) this.nodeByKey.set(messageId, keep);
  }

  scrollToBottom(): void {
    const count = this.deps.getMessages().length;
    if (count === 0) return;
    this.virt.scrollToEnd();
  }

  scrollToItem(id: string): void {
    const index = this.deps.getMessages().findIndex(item => item.id === id);
    if (index < 0) return;
    this.virt.scrollToIndex(index, { align: "start" });
    this.sync();
  }

  isNearBottom(): boolean {
    return this.deps.followEnd !== false && this.virt.isAtEnd();
  }

  captureAnchor(): { id: string; offset: number } | null {
    const scrollTop = this.deps.scrollContainer.scrollTop;
    const item = this.virt.getVirtualItems().find(item => item.end > scrollTop);
    if (!item) return null;
    return { id: String(item.key), offset: scrollTop - item.start };
  }

  restoreAnchor(anchor: { id: string; offset: number }): void {
    this.hasFirstRenderHappened = true;
    this.virt.setOptions({ ...this.virt.options, count: this.deps.getMessages().length, getItemKey: i => this.deps.getMessages()[i]?.id ?? i });
    const index = this.deps.getMessages().findIndex(message => message.id === anchor.id);
    if (index < 0) { this.sync(); return; }
    const restore = () => {
      const offset = this.virt.getOffsetForIndex(index, "start");
      if (offset) this.virt.scrollToOffset(offset[0] + anchor.offset);
    };
    restore();
    this.sync();
    restore();
  }

  destroy(): void {
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      this.deps.scrollContainer.removeEventListener(event, this.cancelUserScroll);
    }
    this.clear();
    if (this.spacer.parentElement) this.spacer.parentElement.removeChild(this.spacer);
  }

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
        if (!node.contains(document.activeElement)) { disposeTree(node); this.nodeByKey.delete(key); }
      }
    }

    this.virt.measureElement(null);
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
        node = document.createElement("div");
        node.className = "la-virtual-row";
        node.style.display = "flow-root";
        node.append(this.deps.renderMessage(msg, item.index));
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

    if (!this.hasFirstRenderHappened && items.length > 0) {
      this.hasFirstRenderHappened = true;
      if (this.deps.initialPosition !== "start" && this.deps.followEnd !== false) this.scrollToBottom();
    }
  }
}
