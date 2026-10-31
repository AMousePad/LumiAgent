import { ChatVirtualizer } from "./chat-virtualizer";
import { RequestFeedback } from "./request-feedback";

export function mountRecordPicker<T extends { id: string }>(root: HTMLElement, options: { label: string; search(item: T): string; render(item: T): HTMLElement; reload(): void }) {
  root.classList.add("la-modal-body");
  const search = document.createElement("input"); search.type = "search"; search.className = "la-picker-search"; search.placeholder = options.label; search.setAttribute("aria-label", options.label);
  const status = document.createElement("div"); status.className = "la-picker-status"; status.setAttribute("role", "status");
  const list = document.createElement("div"); list.className = "la-picker-list";
  root.append(search, status, list);
  const feedback = new RequestFeedback(list);
  let items: readonly T[] = [], visible: readonly T[] = [];
  const virtualizer = new ChatVirtualizer({ scrollContainer: list, getMessages: () => visible, renderMessage: options.render, estimateSize: () => 76, initialPosition: "start", followEnd: false });
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase(); visible = items.filter(item => options.search(item).toLocaleLowerCase().includes(query));
    status.textContent = visible.length ? "" : query ? "No matches" : "No conversations yet";
    virtualizer.clear(); virtualizer.setCount();
  };
  search.oninput = () => { list.scrollTop = 0; render(); };
  const refresh = () => { feedback.begin("list", { label: "Loading conversations…", position: "center", retry: refresh }); options.reload(); };
  return { refresh, setItems(next: readonly T[]) { items = next; feedback.clear(); render(); }, destroy() { feedback.destroy(); virtualizer.destroy(); }, focus() { search.focus(); } };
}
