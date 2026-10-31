import type { SessionRevision } from "../state/session-sync";

export class SessionSync {
  sessionId: string | null = null;
  requestId: string | null = null;
  revision: SessionRevision | null = null;
  requestedAt = 0;
  private before: number | undefined;

  request(sessionId: string, before?: number): string | null {
    if (sessionId === this.sessionId && this.requestId && before === this.before && Date.now() - this.requestedAt < 15000) return null;
    if (sessionId !== this.sessionId) this.revision = null;
    this.sessionId = sessionId;
    this.before = before;
    this.requestId = crypto.randomUUID();
    this.requestedAt = Date.now();
    return this.requestId;
  }

  snapshot(sessionId: string, requestId: string | undefined, revision: SessionRevision | undefined): boolean {
    if (sessionId !== this.sessionId || requestId !== this.requestId || !revision) return false;
    if (this.revision?.epoch === revision.epoch && this.revision.sequence > revision.sequence) return false;
    this.revision = revision;
    this.requestId = null;
    return true;
  }

  event(sessionId: string, revision: SessionRevision | undefined): "apply" | "ignore" | "resync" {
    if (sessionId !== this.sessionId || this.requestId) return "ignore";
    if (!revision) return "resync";
    if (!this.revision) { this.revision = revision; return "apply"; }
    if (this.revision.epoch !== revision.epoch) return "resync";
    if (revision.sequence <= this.revision.sequence) return "ignore";
    if (revision.sequence !== this.revision.sequence + 1) return "resync";
    this.revision = revision;
    return "apply";
  }

  probe(sessionId: string, revision: SessionRevision | undefined): "current" | "ignore" | "resync" {
    if (sessionId !== this.sessionId || this.requestId || !revision) return "ignore";
    if (!this.revision || this.revision.epoch !== revision.epoch || revision.sequence > this.revision.sequence) return "resync";
    return revision.sequence === this.revision.sequence ? "current" : "ignore";
  }
}
