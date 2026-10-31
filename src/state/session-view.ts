import { activitySnapshot } from "./assistant-activity";
import type { ChatMessage, AssistantBlock, AgentEvent, EditLogEntry } from "../types";
import { canRevertEdit } from "../types";

export const SESSION_PAGE_SIZE = 30;
const MESSAGE_TEXT_BUDGET = 12_000;
const MAX_BLOCKS = 60;

export function messageEditCounts(messages: readonly ChatMessage[], edits: readonly EditLogEntry[]) {
  const own = new Map<string, number>();
  for (const edit of edits) if (canRevertEdit(edit) && edit.assistantMessageId) own.set(edit.assistantMessageId, (own.get(edit.assistantMessageId) ?? 0) + 1);
  let following = 0;
  const counts = new Map<string, { own: number; following: number }>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    counts.set(message.id, { own: own.get(message.id) ?? 0, following });
    following += own.get(message.id) ?? 0;
  }
  return counts;
}

function smallValue(value: unknown, depth = 0, budget = { chars: 1500 }): unknown {
  if (budget.chars <= 0) return depth === 0 && value && typeof value === "object" ? { preview: "Open details to inspect" } : "…";
  if (typeof value === "string") { const text = value.slice(0, Math.min(512, budget.chars)); budget.chars -= text.length; return text; }
  if (depth > 3) return "[Open details to inspect]";
  if (Array.isArray(value)) return value.slice(0, 10).map(v => smallValue(v, depth + 1, budget));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 10).map(([k, v]) => { budget.chars -= k.length; return [k.slice(0, 100), smallValue(v, depth + 1, budget)]; }));
  return value;
}

export function projectMessage(message: ChatMessage): ChatMessage {
  if (message.role === "user") return { ...message, content: message.content.slice(0, MESSAGE_TEXT_BUDGET),
    ...(message.files ? { files: message.files.map(({ inlineContent, ...file }) => file) } : {}),
    preview: message.content.length > MESSAGE_TEXT_BUDGET ? { truncated: true, blocksBefore: 0 } : undefined };
  let remaining = 8000;
  let detailRemaining = 4000;
  const argsBudget = { chars: 2000 };
  let truncated = message.blocks.length > MAX_BLOCKS;
  const start = Math.max(0, message.blocks.length - MAX_BLOCKS);
  const truncatedTextBlocks: number[] = [];
  const textLimit = Math.max(1, Math.floor(8000 / Math.max(1, message.blocks.slice(start).filter(block => block.type === "text").length)));
  const text = (value: string, limit = remaining) => {
    const clipped = value.slice(0, Math.max(0, Math.min(limit, remaining)));
    remaining -= clipped.length;
    if (clipped.length < value.length) truncated = true;
    return clipped;
  };
  const blocks: AssistantBlock[] = message.blocks.slice(start).map((block, index) => {
    if (block.type === "tool") {
      const args = smallValue(block.args, 0, argsBudget) as Record<string, unknown>;
      const result = block.result?.slice(0, Math.min(detailRemaining, 1000));
      detailRemaining -= result?.length ?? 0;
      if (result !== block.result) truncated = true;
      return { ...block, args, result };
    }
    if (block.type === "warning" || block.type === "reasoning") {
      const value = block.type === "warning" ? block.message : block.content;
      const clipped = value.slice(0, Math.min(detailRemaining, 1000)); detailRemaining -= clipped.length;
      if (clipped !== value) truncated = true;
      return block.type === "warning" ? { ...block, message: clipped } : { ...block, content: clipped };
    }
    const content = text(block.content, textLimit);
    if (content.length < block.content.length) truncatedTextBlocks.push(start + index);
    return { ...block, content };
  });
  return { ...message, activity: activitySnapshot(message.activity), blocks, preview: { truncated, truncatedTextBlocks, blocksBefore: start, toolCount: message.blocks.reduce((count, block) => count + (block.type === "tool" ? 1 : 0), 0), hasContent: message.blocks.some(block => block.type === "tool" || (block.type === "text" && /\S/.test(block.content))) } };
}

export function projectAgentEvent(event: AgentEvent): AgentEvent {
  if (event.type === "edit_logged") return { ...event, entry: projectEdit(event.entry) };
  if (event.type === "tool_started") return { ...event, args: smallValue(event.args) as Record<string, unknown> };
  if (event.type === "tool_finished") return { ...event, result: event.result.slice(0, 1000) };
  if (event.type === "turn_completed" && event.cleanedContent !== undefined) return { ...event, cleanedContent: event.cleanedContent.slice(0, MESSAGE_TEXT_BUDGET) };
  return event;
}

export function projectEdit(entry: EditLogEntry, budget = { remaining: 4000 }): EditLogEntry {
  const record = entry.record;
  if (record.op === "edit") {
    const limit = Math.max(0, Math.min(2000, Math.floor(budget.remaining / 2)));
    const before = record.before.slice(0, limit), after = record.after.slice(0, limit);
    budget.remaining -= before.length + after.length;
    return before === record.before && after === record.after ? entry : { ...entry, preview: true, record: { ...record, before, after } };
  }
  const text = JSON.stringify(record.snapshot);
  if (text.length <= Math.min(4000, budget.remaining)) { budget.remaining -= text.length; return entry; }
  return { ...entry, preview: true, record: { ...record, snapshot: {} as typeof record.snapshot } };
}

export function sessionPage(messages: readonly ChatMessage[], before?: number) {
  const end = before === undefined ? messages.length : Math.min(messages.length, Math.max(0, Math.floor(before)));
  const start = Math.max(0, end - SESSION_PAGE_SIZE);
  return { messages: messages.slice(start, end).map(projectMessage), start, end, total: messages.length };
}

export function messageDetail(message: ChatMessage, blockIndex: number, offset: number, part: "content" | "args" = "content") {
  const index = Math.max(0, Math.min(message.role === "assistant" ? message.blocks.length - 1 : 0, Math.floor(blockIndex)));
  const block = message.role === "assistant" ? message.blocks[index] : undefined;
  let content = message.role === "user" ? message.content : "";
  let label = "Message";
  if (block?.type === "tool") { content = block.result ?? "Waiting for result"; label = block.name; }
  else if (block?.type === "text" || block?.type === "reasoning") { content = block.content; label = block.type === "reasoning" ? "Reasoning" : "Response"; }
  else if (block?.type === "warning") { content = block.message; label = "Notice"; }
  if (part === "args" && block?.type === "tool") { content = JSON.stringify(block.args, null, 2); label = `Arguments: ${block.name}`; }
  const start = Math.max(0, Math.min(content.length, Math.floor(offset)));
  return { label, blockIndex: index, blockCount: message.role === "assistant" ? message.blocks.length : 1,
    offset: start, total: content.length, content: content.slice(start, start + 24000),
    part, hasArgs: block?.type === "tool" };
}

export function messageActivity(message: ChatMessage, kind: "tools" | "timeline", start?: number, callId?: string) {
  const blocks = message.role === "assistant" ? message.blocks : [];
  const matching = blocks.map((block, blockIndex) => ({ block, blockIndex })).filter(item => item.block.type === "tool" || (kind === "timeline" && item.block.type === "reasoning"));
  const anchor = callId ? matching.findIndex(item => item.block.type === "tool" && item.block.call_id === callId) : -1;
  const first = anchor >= 0 ? Math.max(0, anchor - 5) : start === undefined ? Math.max(0, matching.length - 30) : Math.min(matching.length, Math.max(0, Math.floor(start)));
  const items = matching.slice(first, first + 30).map(({ block, blockIndex }) => ({ blockIndex, block: block.type === "tool" ? { ...block, args: smallValue(block.args) as Record<string, unknown>, result: block.result?.slice(0, 1000) } : { ...block, content: (block as Extract<AssistantBlock, { type: "reasoning" }>).content.slice(0, 3000) } }));
  return { start: first, end: first + items.length, total: matching.length, items };
}
