import type { BackendToFrontend } from "../types";

export interface SessionRevision { epoch: string; sequence: number }

export class SessionRevisions {
  private readonly epoch = crypto.randomUUID();
  private readonly sequences = new Map<string, number>();
  current(userId: string, sessionId: string): SessionRevision {
    return { epoch: this.epoch, sequence: this.sequences.get(JSON.stringify([userId, sessionId])) ?? 0 };
  }
  advance(userId: string, sessionId: string): SessionRevision {
    const next = this.current(userId, sessionId);
    next.sequence++;
    this.sequences.set(JSON.stringify([userId, sessionId]), next.sequence);
    return next;
  }
}

export function messageSessionId(message: BackendToFrontend): string | undefined {
  return "sessionId" in message ? message.sessionId : message.type === "session_status" ? message.status.sessionId : undefined;
}
