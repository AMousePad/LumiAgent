export class SessionCommands {
  private readonly busy = new Map<string, AbortController>();
  cancel(userId: string, sessionId: string): boolean {
    const controller = this.busy.get(JSON.stringify([userId, sessionId]));
    controller?.abort();
    return !!controller;
  }
  isCancelled(userId: string, sessionId: string): boolean {
    return this.busy.get(JSON.stringify([userId, sessionId]))?.signal.aborted ?? false;
  }
  async run(userId: string, sessionId: string, action: () => Promise<void>): Promise<boolean> {
    const key = JSON.stringify([userId, sessionId]);
    if (this.busy.has(key)) return false;
    this.busy.set(key, new AbortController());
    try { await action(); return true; }
    finally { this.busy.delete(key); }
  }
}
