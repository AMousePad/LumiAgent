import type { BackendToFrontend, FrontendToBackend } from "../types";
import type { ScopeRef } from "../types";
import type { messageActivity, messageDetail } from "../state/session-view";

export type ActivityPage = ReturnType<typeof messageActivity>;
export type MessageDetail = ReturnType<typeof messageDetail>;
export interface MessageSource {
  activity(kind: "tools" | "timeline", start?: number, callId?: string): Promise<ActivityPage>;
  detail(blockIndex: number, offset: number, part?: "content" | "args"): Promise<MessageDetail>;
}
export class MessageReader {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly send: (message: FrontendToBackend) => void) {}
  edit(scope: ScopeRef, editId: string, part: "before" | "after", offset: number): Promise<{ content: string; total: number }> {
    return this.request({ type: "read_edit_content", requestId: crypto.randomUUID(), scope, editId, part, offset });
  }
  source(sessionId: string, messageId: string): MessageSource {
    return {
      activity: (kind, start, callId) => this.request({ type: "read_message_activity", sessionId, messageId, requestId: crypto.randomUUID(), kind, ...(start === undefined ? {} : { start }), ...(callId ? { callId } : {}) }),
      detail: (blockIndex, offset, part = "content") => this.request({ type: "read_message_detail", sessionId, messageId, requestId: crypto.randomUUID(), blockIndex, offset, part }),
    };
  }
  private request<T>(message: Extract<FrontendToBackend, { type: "read_message_activity" | "read_message_detail" | "read_edit_content" }>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.requestId); reject(new Error("Couldn’t load this content")); }, 15000);
      this.pending.set(message.requestId, { resolve: value => resolve(value as T), reject, timer });
      try { this.send(message); } catch (error) { clearTimeout(timer); this.pending.delete(message.requestId); reject(error); }
    });
  }
  receive(message: BackendToFrontend): void {
    if (message.type !== "message_detail" && message.type !== "message_activity" && message.type !== "edit_content") return;
    const request = this.pending.get(message.requestId); if (!request) return;
    clearTimeout(request.timer); this.pending.delete(message.requestId);
    const value = message.type === "message_activity" ? message.page : message.detail;
    if (value) request.resolve(value); else request.reject(new Error("This message is no longer available"));
  }
  destroy(): void { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("Conversation closed")); } this.pending.clear(); }
}
