import { z } from "zod";
import type { ChatDTO } from "lumiverse-spindle-types";
import { defineTool, type ToolResult } from "./_framework";
import { spillOrReturn } from "./_io";
import { markGrepHit } from "./_gates";
import type { ToolCtx } from "./_context";
import { CHAT_ID_ARG, explicitChatId, messagePath, resolveChat } from "./_chat";
import { chatIncludesCharacter, isGroupChat, listAllChats } from "../../state/chat-catalog";
import { fillPrompt } from "../prompts/_fill";
import description from "../prompts/claude/tools/grep-chat-messages/description.txt";
import argFlags from "../prompts/claude/tools/grep-chat-messages/arg_flags.txt";
import argMaxMatches from "../prompts/claude/tools/grep-chat-messages/arg_max_matches.txt";

const CHAT_GREP_DEFAULT_MAX = 50;
const CHAT_GREP_MAX_CAP = 500;
const CHAT_GREP_PREVIEW_CHARS = 160;
const CROSS_CHAT_MAX_CHATS = 60;
const CROSS_CHAT_PREVIEWS_PER_CHAT = 3;
const CROSS_CHAT_BATCH = 4;

// A preview cut from the line start loses the match on long roleplay paragraphs.
function previewAround(line: string, index: number, length: number): string {
  if (line.length <= CHAT_GREP_PREVIEW_CHARS) return line;
  const side = Math.max(20, Math.floor((CHAT_GREP_PREVIEW_CHARS - length) / 2));
  const start = Math.max(0, index - side);
  const end = Math.min(line.length, index + length + side);
  return `${start > 0 ? "[…] " : ""}${line.slice(start, end)}${end < line.length ? " […]" : ""}`;
}

const inputSchema = z.object({
  chat_id: z.string().optional(),
  pattern: z.string(),
  flags: z.string().optional(),
  case_insensitive: z.boolean().optional(),
  max_matches: z.number().optional(),
  all_chats: z.boolean().optional(),
  character_id: z.string().optional(),
});

interface Hit { idx: number; id: string; path: string; role: string; speaker_name: string; line: number; match: string; preview: string }

interface ScanMessage { id: string; role: string; name: string; content: string }

// The count stays exact past the row cap so the result can say how much was cut.
function scan(chatId: string, all: readonly ScanMessage[], re: RegExp, keep: number): { count: number; hits: Hit[]; matched: ScanMessage[] } {
  const hits: Hit[] = [];
  const matched: ScanMessage[] = [];
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const m = all[i]!;
    const lines = m.content.split("\n");
    let any = false;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      re.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = re.exec(line)) !== null) {
        count++;
        any = true;
        if (hits.length < keep) {
          hits.push({ idx: i, id: m.id, path: messagePath(chatId, m.id), role: m.role, speaker_name: m.name, line: li + 1, match: rm[0], preview: previewAround(line, rm.index, rm[0].length) });
        }
        if (rm.index === re.lastIndex) re.lastIndex++;
      }
    }
    if (any) matched.push(m);
  }
  return { count, hits, matched };
}

async function searchManyChats(
  ctx: ToolCtx,
  re: RegExp,
  input: { pattern: string; character_id?: string | undefined; chat_id?: string | undefined },
  flags: string,
  cap: number,
): Promise<ToolResult> {
  const catalog = (await listAllChats(ctx.spindle, ctx.userId))
    .filter((chat) => chat.metadata?.["temporary"] !== true)
    .filter((chat) => !input.character_id || chatIncludesCharacter(chat, input.character_id))
    .sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
  if (catalog.length === 0) {
    const why = input.character_id ? `no chats contain character '${input.character_id}'. Check the id with list_characters` : "the library has no chats";
    return { content: `Error: [PATH_NOT_FOUND] ${why}. Nothing was searched.`, isError: true };
  }
  const queue: ChatDTO[] = catalog.slice(0, CROSS_CHAT_MAX_CHATS);
  const rows: Array<{ chat_id: string; chat_name: string; is_group: boolean; updated_at: number; total_messages: number; match_count: number; previews: Hit[] }> = [];
  const unreadable: string[] = [];
  let scanned = 0;
  let previewsLeft = cap;
  let cancelled = false;
  for (let i = 0; i < queue.length; i += CROSS_CHAT_BATCH) {
    if (ctx.signal.aborted) { cancelled = true; break; }
    const batch = queue.slice(i, i + CROSS_CHAT_BATCH);
    const results = await Promise.all(batch.map(async (chat) => {
      try { return { chat, all: await ctx.spindle.chat.getMessages(chat.id) }; }
      catch { return { chat, all: null }; }
    }));
    for (const { chat, all } of results) {
      if (all === null) { unreadable.push(chat.id); continue; }
      scanned++;
      const found = scan(chat.id, all, new RegExp(re.source, re.flags), Math.min(CROSS_CHAT_PREVIEWS_PER_CHAT, Math.max(0, previewsLeft)));
      if (found.count === 0) continue;
      previewsLeft -= found.hits.length;
      rows.push({ chat_id: chat.id, chat_name: chat.name, is_group: isGroupChat(chat), updated_at: chat.updated_at, total_messages: all.length, match_count: found.count, previews: found.hits });
    }
  }
  rows.sort((a, b) => b.match_count - a.match_count || b.updated_at - a.updated_at);
  const notes: string[] = ["Previews show the first matches per chat. For every hit in one chat call chats(action=search, chat_id=<id>, pattern=...)."];
  if (catalog.length > queue.length) notes.push(`Only the ${queue.length} most recently updated of ${catalog.length} chats were scanned. Narrow with character_id, or search an older chat by chat_id.`);
  if (previewsLeft <= 0) notes.push(`Preview cap of ${cap} reached, later chats list counts only. Raise max_matches for more previews.`);
  if (cancelled) notes.push("The run was cancelled before every chat was scanned.");
  if (unreadable.length > 0) notes.push(`${unreadable.length} chat(s) could not be read and were skipped: ${unreadable.slice(0, 5).join(", ")}.`);
  if (explicitChatId(input.chat_id)) notes.push("chat_id was ignored because all_chats or character_id was given.");
  notes.push("Only the active swipe of each message is searched.");
  const payload = JSON.stringify({
    scope: input.character_id ? `chats containing character ${input.character_id}` : "all chats",
    pattern: input.pattern,
    flags,
    chats_total: catalog.length,
    chats_scanned: scanned,
    chats_with_matches: rows.length,
    total_matches: rows.reduce((n, r) => n + r.match_count, 0),
    note: notes.join(" "),
    chats: rows,
  }, null, 2);
  return { content: await spillOrReturn(ctx, payload, "grep_chat_messages:all_chats") };
}

export const grepChatMessagesTool = defineTool({
  name: "grep_chat_messages",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      pattern: { type: "string", description: "JavaScript regex. Plain words work as written." },
      flags: { type: "string", description: argFlags },
      case_insensitive: { type: "boolean" },
      max_matches: { type: "number", description: fillPrompt(argMaxMatches, { CHAT_GREP_DEFAULT_MAX, CHAT_GREP_MAX_CAP }) },
      all_chats: { type: "boolean", description: `Search every chat instead of one, newest ${CROSS_CHAT_MAX_CHATS} first. Returns per-chat match counts and a few previews.` },
      character_id: { type: "string", description: "Search every chat that contains this character, including group chats." },
    },
    required: ["pattern"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const flagsExtra = input.flags ?? "";
    const caseInsensitive = input.case_insensitive ?? false;
    const cap = Math.min(CHAT_GREP_MAX_CAP, Math.max(1, Math.floor(input.max_matches ?? CHAT_GREP_DEFAULT_MAX)));
    let assembled = flagsExtra.includes("g") ? flagsExtra : `g${flagsExtra}`;
    if (caseInsensitive && !assembled.includes("i")) assembled = `${assembled}i`;
    let re: RegExp;
    try { re = new RegExp(input.pattern, assembled); } catch (e) {
      return { content: `Error: [INVALID_INPUT] regex compile failed: ${(e as Error).message}. Escape special characters or simplify the pattern, then retry.`, isError: true };
    }
    if (input.all_chats === true || (input.character_id !== undefined && input.character_id.length > 0)) {
      return searchManyChats(ctx, re, input, assembled, cap);
    }

    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    const all = await ctx.spindle.chat.getMessages(chatId);
    const found = scan(chatId, all, re, cap);
    for (const m of found.matched) markGrepHit(ctx, messagePath(chatId, m.id), m.content);
    const payload = JSON.stringify({
      chat_id: chatId,
      chat_name: chat.name,
      chat_source: source,
      pattern: input.pattern,
      flags: assembled,
      total_messages: all.length,
      match_count: found.count,
      returned: found.hits.length,
      truncated: found.count > found.hits.length,
      note: `Only the active swipe of each message is searched. ${found.count === 0 ? "No match here. To look in other chats add all_chats=true or character_id." : "A hit lets you edit its path directly."}`,
      hits: found.hits,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `grep_chat_messages:${chatId}`);
    return { content: out };
  },
});
