import type { MessageDetail } from "./message-reader";
import { ChatVirtualizer } from "./chat-virtualizer";
import { onDispose } from "./dom-lifecycle";
import { renderMarkdown } from "./markdown";

export function mountInlineContent(root: HTMLElement, read: (offset: number) => Promise<Pick<MessageDetail, "content" | "total">>, markdown = false): void {
  let disposed = false;
  let virtualizer: ChatVirtualizer<{ id: string; offset: number }> | null = null;
  onDispose(root, () => { disposed = true; virtualizer?.destroy(); });
  const render = async (target: HTMLElement, offset: number, initialize = false) => {
    target.querySelector(".la-inline-feedback")?.remove();
    const feedback = document.createElement("div");
    feedback.className = "la-inline-feedback";
    feedback.setAttribute("role", "status");
    if (!target.hasChildNodes()) {
      const spinner = document.createElement("span");
      spinner.className = "la-pending-spinner";
      spinner.setAttribute("aria-label", "Loading content");
      feedback.append(spinner);
    }
    target.append(feedback);
    target.setAttribute("aria-busy", "true");
    let detached = false;
    if (!initialize) onDispose(target, () => { detached = true; });
    try {
      const detail = await read(offset); if (disposed || detached) return;
      target.replaceChildren();
      if (initialize && detail.total > 24000) {
        root.classList.add("la-inline-scroll");
        const chunks = Array.from({ length: Math.ceil(detail.total / 24000) }, (_, index) => ({ id: String(index), offset: index * 24000 }));
        virtualizer = new ChatVirtualizer({ scrollContainer: root, getMessages: () => chunks, initialPosition: "start", followEnd: false, estimateSize: () => 1200, renderMessage(chunk) {
          const body = document.createElement("div"); body.className = "la-inline-chunk";
          if (chunk.offset === 0) fill(body, detail.content); else void render(body, chunk.offset);
          return body;
        } });
        virtualizer.setCount();
      } else fill(target, detail.content);
    } catch (error) {
      if (disposed || detached) return;
      const retry = document.createElement("button"); retry.className = "la-inline-retry"; retry.textContent = "Retry"; retry.onclick = () => void render(target, offset, initialize);
      feedback.replaceChildren(document.createTextNode((error as Error).message), retry);
    } finally { target.removeAttribute("aria-busy"); }
  };
  const fill = (target: HTMLElement, content: string) => {
    if (markdown) target.replaceChildren(renderMarkdown(content));
    else { const pre = document.createElement("pre"); pre.textContent = content; target.replaceChildren(pre); }
  };
  void render(root, 0, true);
}
