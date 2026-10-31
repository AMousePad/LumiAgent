export class FrontendBinding {
  private current: string | undefined;
  private readonly candidates = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private disconnected = false;

  constructor(readonly userId: string, frontendSessionId?: string) {
    this.current = frontendSessionId;
  }

  loaded(frontendSessionId: string): void {
    if (this.disposed) return;
    this.candidates.delete(frontendSessionId);
    this.candidates.add(frontendSessionId);
    if (this.candidates.size > 8) this.candidates.delete(this.candidates.values().next().value!);
    if (!this.current) {
      this.current = frontendSessionId;
      this.disconnected = false;
      for (const notify of this.listeners) notify();
    }
  }

  closed(frontendSessionId: string): void {
    this.candidates.delete(frontendSessionId);
    if (this.current !== frontendSessionId) return;
    this.current = [...this.candidates].at(-1);
    this.disconnected = !this.current;
  }

  async target(signal: AbortSignal, timeoutMs = 30000): Promise<string | undefined> {
    signal.throwIfAborted();
    if (this.disposed) throw new Error("The generation has ended.");
    if (!this.disconnected) return this.current;
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.listeners.delete(check); signal.removeEventListener("abort", check); };
      const check = () => {
        if (signal.aborted || this.disposed) { clean(); reject(new Error("Browser reconnection cancelled.")); }
        else if (this.current) { clean(); resolve(this.current); }
      };
      const timer = setTimeout(() => { clean(); reject(new Error("Open this conversation in Lumiverse to reconnect browser tools.")); }, timeoutMs);
      this.listeners.add(check);
      signal.addEventListener("abort", check, { once: true });
      check();
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const notify of this.listeners) notify();
    this.candidates.clear();
  }
}
