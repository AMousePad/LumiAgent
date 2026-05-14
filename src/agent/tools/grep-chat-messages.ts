import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import type { ToolCtx } from "./_context";

const CHAT_GREP_DEFAULT_MAX = 50;
const CHAT_GREP_MAX_CAP = 500;
const CHAT_GREP_PREVIEW_CHARS = 160;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  pattern: z.string(),
  flags: z.string().optional(),
  case_insensitive: z.boolean().optional(),
  max_matches: z.number().optional(),
});

function resolveChatId(input: { chat_id?: string | undefined }, ctx: ToolCtx): string | { error: string } {
  if (input.chat_id) return input.chat_id;
  if (!ctx.pinnedChatId) return { error: "No chat_id provided and no chat is pinned. Either pass chat_id or have the user pin a chat." };
  return ctx.pinnedChatId;
}

export const grepChatMessagesTool = defineTool({
  name: "grep_chat_messages",
  description: "Regex search across message contents. Returns hits with idx, id, role, line, match, preview. Use this for any 'where did we say X' question on a big chat, before falling back to read_chat_messages. Omit chat_id to use the pinned chat.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Optional. Omit to use the pinned chat." },
      pattern: { type: "string" },
      flags: { type: "string", description: "Extra regex flags. g is implied." },
      case_insensitive: { type: "boolean" },
      max_matches: { type: "number", description: `Default ${CHAT_GREP_DEFAULT_MAX}, cap ${CHAT_GREP_MAX_CAP}` },
    },
    required: ["pattern"],
  },
  defaultSensitivity: "sensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const resolved = resolveChatId(input, ctx);
    if (typeof resolved !== "string") return { content: `Error: ${resolved.error}`, isError: true };
    const chatId = resolved;
    const flagsExtra = input.flags ?? "";
    const caseInsensitive = input.case_insensitive ?? false;
    const cap = Math.min(CHAT_GREP_MAX_CAP, Math.max(1, Math.floor(input.max_matches ?? CHAT_GREP_DEFAULT_MAX)));
    let assembled = flagsExtra.includes("g") ? flagsExtra : `g${flagsExtra}`;
    if (caseInsensitive && !assembled.includes("i")) assembled = `${assembled}i`;
    let re: RegExp;
    try { re = new RegExp(input.pattern, assembled); } catch (e) {
      return { content: `Error: regex compile failed: ${(e as Error).message}`, isError: true };
    }

    const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
    if (!chat) return { content: `Error: chat ${chatId} not found`, isError: true };
    const all = await ctx.spindle.chat.getMessages(chatId);
    const hits: Array<{ idx: number; id: string; role: string; line: number; match: string; preview: string }> = [];
    let remaining = cap;
    for (let i = 0; i < all.length && remaining > 0; i++) {
      const m = all[i]!;
      const lines = m.content.split("\n");
      for (let li = 0; li < lines.length && remaining > 0; li++) {
        const line = lines[li]!;
        re.lastIndex = 0;
        let rm: RegExpExecArray | null;
        const matches: string[] = [];
        while ((rm = re.exec(line)) !== null) {
          matches.push(rm[0]);
          if (rm.index === re.lastIndex) re.lastIndex++;
        }
        if (matches.length === 0) continue;
        const preview = line.length > CHAT_GREP_PREVIEW_CHARS ? `${line.slice(0, CHAT_GREP_PREVIEW_CHARS - 5)} […]` : line;
        for (const mm of matches) {
          hits.push({ idx: i, id: m.id, role: m.role, line: li + 1, match: mm, preview });
          remaining--;
          if (remaining <= 0) break;
        }
      }
    }
    const payload = JSON.stringify({
      chat_id: chatId,
      chat_name: chat.name,
      pattern: input.pattern,
      flags: assembled,
      total_messages: all.length,
      match_count: hits.length,
      truncated: hits.length >= cap,
      hits,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `grep_chat_messages:${chatId}`);
    return { content: out };
  },
});
