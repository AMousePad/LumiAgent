export class RequestFeedback {
  private readonly root = document.createElement("div");
  private readonly spinner = document.createElement("span");
  private readonly label = document.createElement("span");
  private readonly retry = document.createElement("button");
  private id: string | null = null;
  private reveal: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement) {
    this.root.className = "la-request-feedback";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.hidden = true;
    this.spinner.className = "la-pending-spinner";
    this.spinner.setAttribute("aria-hidden", "true");
    this.retry.type = "button";
    this.retry.hidden = true;
    this.root.append(this.spinner, this.label, this.retry);
    parent.append(this.root);
  }

  begin(id: string, options: {
    label: string;
    position: "top" | "bottom" | "center";
    retry: () => void;
    timeoutMessage?: string;
    retryLabel?: string;
    onTimeout?: () => void;
  }): void {
    this.clear();
    this.id = id;
    this.root.dataset.position = options.position;
    this.root.dataset.state = "loading";
    this.spinner.hidden = false;
    this.label.textContent = options.label;
    this.retry.hidden = true;
    this.retry.textContent = options.retryLabel ?? "Retry";
    this.retry.onclick = options.retry;
    this.reveal = setTimeout(() => { if (this.id === id) this.root.hidden = false; }, 150);
    this.deadline = setTimeout(() => {
      if (this.id !== id) return;
      this.fail(id, options.timeoutMessage ?? "Couldn’t load messages");
      options.onTimeout?.();
    }, 15000);
  }

  fail(id: string, message: string): void {
    if (this.id !== id) return;
    clearTimeout(this.reveal);
    clearTimeout(this.deadline);
    this.root.hidden = false;
    this.root.dataset.state = "error";
    this.spinner.hidden = true;
    this.label.textContent = message;
    this.retry.hidden = false;
  }

  finish(id: string): void { if (this.id === id) this.clear(); }

  clear(): void {
    clearTimeout(this.reveal);
    clearTimeout(this.deadline);
    this.id = null;
    this.root.hidden = true;
    this.retry.onclick = null;
  }

  destroy(): void { this.clear(); this.root.remove(); }
}
