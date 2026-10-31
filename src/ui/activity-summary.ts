import { ChatVirtualizer } from "./chat-virtualizer";
import { onDispose } from "./dom-lifecycle";
import { ICON_CHEVRON_DOWN } from "./icons";

export interface ActivityStep {
  id: string;
  title: string;
  state: "running" | "done" | "error";
  render: () => HTMLElement;
}
export interface ActivityWindow { steps: ActivityStep[]; start: number; end: number; total: number }

export function createActivitySummary(options: { label?: string; className?: string; load?: (start?: number, callId?: string) => Promise<ActivityWindow> } = {}) {
  const root = document.createElement("details"); root.className = options.className ?? "la-activity-summary";
  const summary = document.createElement("summary");
  const indicator = document.createElement("span"); indicator.className = "la-activity-indicator"; indicator.setAttribute("aria-hidden", "true");
  const label = document.createElement("span"); label.className = "la-activity-label";
  const count = document.createElement("span"); count.className = "la-activity-count";
  const chevron = document.createElement("span"); chevron.className = "la-activity-chevron"; chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  summary.append(indicator, label, count, chevron);
  const body = document.createElement("div"); body.className = "la-activity-scroll"; body.tabIndex = 0; body.setAttribute("aria-label", options.label ?? "Tool activity");
  body.hidden = !!options.load;
  const status = document.createElement("div"); status.className = "la-activity-status"; status.setAttribute("role", "status");
  root.append(summary, status, body);
  let steps: ActivityStep[] = [], total = 0, start = 0, end = 0;
  let virtualizer: ChatVirtualizer<ActivityStep> | null = null;
  let busy = false, destroyed = false, initialized = false;
  let lastScroll = 0;
  let customLabel = options.label;
  let active = true;
  const expanded = new Set<string>();
  const refreshLabel = () => {
    const running = active ? steps.find(step => step.state === "running") : undefined, errors = steps.some(step => step.state === "error");
    root.dataset.state = running ? "running" : errors ? "error" : "done";
    label.textContent = customLabel ?? running?.title ?? "Activity";
    count.textContent = options.label ? "" : `${total} ${total === 1 ? "step" : "steps"}`;
  };
  const mount = () => {
    if (virtualizer || !root.open || body.hidden || destroyed) return;
    virtualizer = new ChatVirtualizer({ scrollContainer: body, getMessages: () => steps, renderMessage: step => {
      const row = step.render();
      const head = row.querySelector<HTMLElement>(".la-tool-head");
      if (head) {
        if (expanded.has(step.id)) head.click();
        head.addEventListener("click", () => {
          if (row.classList.contains("is-open")) { expanded.add(step.id); if (expanded.size > 90) expanded.delete(expanded.values().next().value!); }
          else expanded.delete(step.id);
        });
      }
      return row;
    }, estimateSize: () => 48, initialPosition: "start", followEnd: false, containSize: false });
    virtualizer.setCount();
  };
  const load = async (at?: number, callId?: string) => {
    if (!options.load || busy || destroyed) return;
    if (!virtualizer) body.hidden = true;
    busy = true; status.replaceChildren(); const spinner = document.createElement("span"); spinner.className = "la-pending-spinner"; spinner.setAttribute("aria-hidden", "true"); status.append(spinner, document.createTextNode("Loading…"));
    const anchor = virtualizer?.captureAnchor();
    try {
      const page = await options.load(at ?? (initialized ? undefined : 0), callId); if (destroyed) return;
      if (callId || !initialized || page.end < start || page.start > end) { steps = page.steps; start = page.start; end = page.end; virtualizer?.clear(); }
      else {
        const from = Math.min(start, page.start), to = Math.max(end, page.end);
        const combined: ActivityStep[] = [];
        for (let i = from; i < to; i++) { const step = steps[i - start] ?? page.steps[i - page.start]; if (step) combined.push(step); }
        steps = combined; start = from; end = to;
        if (steps.length > 90) {
          const trim = steps.length - 90;
          if (page.start < (at === undefined ? end : at + 30) && page.start === from && page.end < end) { steps.splice(-trim); end -= trim; }
          else { steps.splice(0, trim); start += trim; }
        }
      }
      initialized = true; total = page.total; body.hidden = total === 0; status.replaceChildren(); refreshLabel(); mount(); virtualizer?.setCount();
      if (callId) {
        virtualizer?.scrollToItem(callId);
        requestAnimationFrame(() => {
          const row = [...body.querySelectorAll<HTMLElement>("[data-virt-key]")].find(item => item.dataset.virtKey === callId);
          const card = row?.querySelector<HTMLElement>(".la-tool-card");
          if (card && !card.classList.contains("is-open")) card.querySelector<HTMLElement>(".la-tool-head")?.click();
          row?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
          card?.querySelector<HTMLElement>(".la-tool-head")?.focus({ preventScroll: true });
        });
      } else if (anchor && steps.some(step => step.id === anchor.id)) virtualizer?.restoreAnchor(anchor);
    } catch (error) {
      if (destroyed) return;
      body.hidden = !virtualizer || steps.length === 0;
      status.textContent = (error as Error).message;
      const retry = document.createElement("button"); retry.textContent = "Retry"; retry.onclick = () => void load(at, callId); status.append(retry);
    } finally { busy = false; }
  };
  body.addEventListener("scroll", () => {
    const direction = body.scrollTop - lastScroll; lastScroll = body.scrollTop;
    if (busy || !initialized) return;
    if (direction < 0 && body.scrollTop < 100 && start > 0) void load(Math.max(0, start - 30));
    else if (direction > 0 && body.scrollHeight - body.scrollTop - body.clientHeight < 100 && end < total) void load(end);
  }, { passive: true });
  root.addEventListener("toggle", () => {
    if (root.open) { if (!initialized && options.load) void load(); else mount(); }
    else { virtualizer?.destroy(); virtualizer = null; }
  });
  const destroy = () => { destroyed = true; virtualizer?.destroy(); virtualizer = null; steps = []; };
  onDispose(root, destroy); refreshLabel();
  return {
    root, destroy,
    setLabel(value: string) { customLabel = value; label.textContent = value; },
    setActive(value: boolean) { active = value; refreshLabel(); },
    refresh(id: string) { virtualizer?.evict(id); virtualizer?.setCount(); },
    reveal(id: string) { root.open = true; root.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); if (options.load) void load(undefined, id); else { mount(); virtualizer?.scrollToItem(id); requestAnimationFrame(() => body.querySelector<HTMLElement>(`[data-virt-key="${CSS.escape(id)}"] .la-tool-head`)?.click()); } },
    setTotal(value: number) { total = Math.max(total, value); refreshLabel(); },
    add(step: ActivityStep) {
      body.hidden = false;
      if (steps.some(item => item.id === step.id)) return;
      if (initialized && end < total) { total++; refreshLabel(); return; }
      steps.push(step); total++; end++;
      if (steps.length > 90 && steps[0]?.state !== "running") { steps.shift(); start++; }
      refreshLabel(); virtualizer?.setCount();
    },
    finish(id: string, error: boolean) { const step = steps.find(step => step.id === id); if (!step) return; step.state = error ? "error" : "done"; refreshLabel(); virtualizer?.evict(id); virtualizer?.setCount(); },
  };
}
