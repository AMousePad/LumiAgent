import type { ChatMessage } from "../types";

export interface HistoryPage {
  start: number;
  end: number;
  total: number;
  messages: readonly ChatMessage[];
}

export const HISTORY_WINDOW_SIZE = 90;

export function mergeHistoryPage(current: HistoryPage, incoming: HistoryPage, direction: "before" | "after"): HistoryPage | null {
  if (incoming.end < current.start || incoming.start > current.end) return null;
  const start = Math.min(current.start, incoming.start);
  const end = Math.max(current.end, incoming.end);
  const messages: ChatMessage[] = [];
  for (let i = start; i < end; i++) {
    const existing = current.messages[i - current.start];
    const overlap = incoming.messages[i - incoming.start];
    if (existing && overlap && existing.id !== overlap.id) return null;
    const message = existing ?? incoming.messages[i - incoming.start];
    if (!message) return null;
    messages.push(message);
  }
  const trim = Math.max(0, messages.length - HISTORY_WINDOW_SIZE);
  return direction === "before"
    ? { start, end: end - trim, total: incoming.total, messages: messages.slice(0, HISTORY_WINDOW_SIZE) }
    : { start: start + trim, end, total: incoming.total, messages: messages.slice(trim) };
}
