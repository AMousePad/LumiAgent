import type { ChatDTO } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import type { ToolResult } from "./_framework";

export type ChatSource = "argument" | "pinned" | "host_active";

export interface ResolvedChat {
  readonly chat: ChatDTO;
  readonly chatId: string;
  readonly source: ChatSource;
}

export const CHAT_ID_ARG = "Chat id from chats(action=list). Leave empty for the pinned chat, else the chat open in Lumiverse.";

// Models write these words where an id belongs. They mean "the default chat", never a real id.
const NO_ID_WORDS: ReadonlySet<string> = new Set(["active", "current", "pinned", "this", "default", "none", "null"]);

export function explicitChatId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id.length === 0 || NO_ID_WORDS.has(id.toLowerCase()) ? null : id;
}

const fail = (content: string): { error: ToolResult } => ({ error: { content, isError: true } });

export async function resolveChat(ctx: ToolCtx, raw: unknown): Promise<ResolvedChat | { error: ToolResult }> {
  const explicit = explicitChatId(raw);
  if (explicit) {
    const chat = await ctx.spindle.chats.get(explicit, ctx.userId);
    if (!chat) return fail(`Error: [PATH_NOT_FOUND] chat '${explicit}' not found. Call chats(action=list) for valid ids, or omit chat_id to use the pinned or open chat.`);
    return { chat, chatId: chat.id, source: "argument" };
  }
  if (ctx.pinnedChatId) {
    const chat = await ctx.spindle.chats.get(ctx.pinnedChatId, ctx.userId);
    if (!chat) return fail(`Error: [PATH_NOT_FOUND] the pinned chat '${ctx.pinnedChatId}' no longer exists. Call chats(action=list) and pass chat_id.`);
    return { chat, chatId: chat.id, source: "pinned" };
  }
  let active: ChatDTO | null = null;
  try { active = await ctx.spindle.chats.getActive(ctx.userId) ?? null; } catch { /* treated as no open chat */ }
  if (active) return { chat: active, chatId: active.id, source: "host_active" };
  return fail("Error: [NO_TARGET] no chat_id given, no chat is pinned and no chat is open in Lumiverse. Call chats(action=list) and pass chat_id.");
}

// For tools that only need an id: explicit, then pinned, then the chat open in Lumiverse.
export async function fallbackChatId(ctx: ToolCtx, raw: unknown): Promise<string | null> {
  const explicit = explicitChatId(raw);
  if (explicit) return explicit;
  if (ctx.pinnedChatId) return ctx.pinnedChatId;
  try { return (await ctx.spindle.chats.getActive(ctx.userId))?.id ?? null; } catch { return null; }
}

export interface WindowArgs {
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
  readonly last?: number | undefined;
}

export function messageWindow(total: number, args: WindowArgs, defaultLimit: number, maxLimit: number): { start: number; end: number } {
  if (args.last !== undefined && args.last > 0) {
    return { start: Math.max(0, total - Math.min(maxLimit, Math.floor(args.last))), end: total };
  }
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(args.limit ?? defaultLimit)));
  const raw = Math.floor(args.offset ?? 0);
  const start = raw < 0 ? Math.max(0, total + raw) : Math.min(raw, total);
  return { start, end: Math.min(total, start + limit) };
}

export function windowNote(action: "read" | "messages", total: number, start: number, end: number): string | undefined {
  if (start === 0 && end >= total) return undefined;
  if (end <= start) return `No messages at offset ${start}, the chat has ${total}. Latest: chats(action=${action}, last=20).`;
  if (end < total) {
    return `Partial window: messages ${start}-${end - 1} of ${total}, oldest first, ${total - end} newer ones not shown. Latest in one call: chats(action=${action}, last=20). Next page: offset=${end}.`;
  }
  return `Latest ${end - start} of ${total} messages. ${start} older ones not shown, page back with offset=${Math.max(0, start - (end - start))}.`;
}

export function preview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

export function messagePath(chatId: string, messageId: string): string {
  return `chat/${chatId}/msg/${messageId}/content`;
}

// Id only, no existence check: for tools whose host call validates the chat itself.
export async function resolveChatId(ctx: ToolCtx, raw: unknown): Promise<{ chatId: string; source: ChatSource } | null> {
  const explicit = explicitChatId(raw);
  if (explicit) return { chatId: explicit, source: "argument" };
  if (ctx.pinnedChatId) return { chatId: ctx.pinnedChatId, source: "pinned" };
  try {
    const active = await ctx.spindle.chats.getActive(ctx.userId);
    if (active) return { chatId: active.id, source: "host_active" };
  } catch { /* treated as no open chat */ }
  return null;
}

export const NO_CHAT_TARGET = "Error: [NO_TARGET] no chat_id given, no chat is pinned and no chat is open in Lumiverse. Call chats(action=list) and pass chat_id.";
