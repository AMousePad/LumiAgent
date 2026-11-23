import { z } from "zod";
import { defineTool } from "./_framework";
import { recordChange } from "./_change-history";
import { CHAT_ID_ARG, preview, resolveChat } from "./_chat";
import description from "../prompts/claude/tools/delete-chat-messages/description.txt";

const MAX_IDS = 100;
const MAX_LAST_N = 50;
const PREVIEW_CHARS = 100;

const inputSchema = z.object({
  chat_id: z.string().optional(),
  message_ids: z.array(z.string().min(1)).min(1).max(MAX_IDS).optional(),
  last_n: z.number().int().min(1).max(MAX_LAST_N).optional(),
}).strict();

export const deleteChatMessagesTool = defineTool({
  name: "delete_chat_messages",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      message_ids: { type: "array", items: { type: "string" }, maxItems: MAX_IDS, description: "Ids of the messages to delete. Use this or last_n." },
      last_n: { type: "integer", maximum: MAX_LAST_N, description: `Delete the newest N messages, up to ${MAX_LAST_N}. Use this or message_ids, and send 0 when passing message_ids.` },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    if (input.message_ids === undefined && input.last_n === undefined) {
      return { content: "Error: [INVALID_INPUT] pass message_ids or last_n. Nothing was deleted. Example: chats(action=delete_messages, last_n=2).", isError: true };
    }
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    const all = await ctx.spindle.chat.getMessages(chatId);
    const index = new Map(all.map((m, i) => [m.id, i] as const));
    let ids: string[];
    const newest = input.last_n !== undefined ? all.slice(-input.last_n).map((m) => m.id) : [];
    // Models that fill every argument send both selectors. That is only safe when they name the same messages.
    if (input.message_ids !== undefined && input.last_n !== undefined) {
      const named = new Set(input.message_ids);
      if (named.size !== newest.length || newest.some((id) => !named.has(id))) {
        return { content: `Error: [INVALID_INPUT] message_ids and last_n=${input.last_n} select different messages, so nothing was deleted. Send only one of them: last_n=0 with message_ids, or no message_ids with last_n.`, isError: true };
      }
    }
    if (input.last_n !== undefined) {
      ids = newest;
      if (ids.length === 0) return { content: `Error: [INVALID_INPUT] chat ${chatId} has no messages. Nothing was deleted.`, isError: true };
    } else {
      ids = [...new Set(input.message_ids!)];
      const missing = ids.filter((id) => !index.has(id));
      if (missing.length > 0) {
        return { content: `Error: [PATH_NOT_FOUND] ${missing.length} id(s) are not in chat ${chatId}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}. Nothing was deleted. Get ids from chats(action=messages, chat_id="${chatId}").`, isError: true };
      }
    }
    const targets = ids.map((id) => all[index.get(id)!]!).sort((a, b) => index.get(b.id)! - index.get(a.id)!);
    const removed: typeof targets = [];
    let failure: string | null = null;
    for (const m of targets) {
      if (ctx.signal.aborted) { failure = "the run was cancelled"; break; }
      try { await ctx.spindle.chat.deleteMessage(chatId, m.id); removed.push(m); }
      catch (err) { failure = `deleting ${m.id} failed: ${(err as Error).message}`; break; }
    }
    const rows = removed.map((m) => ({ id: m.id, idx: index.get(m.id)!, role: m.role, speaker_name: m.name, preview: preview(m.content, PREVIEW_CHARS) })).sort((a, b) => a.idx - b.idx);
    if (removed.length > 0) {
      const snapshot = [...removed].reverse().map((m) => ({ id: m.id, idx: index.get(m.id)!, role: m.role, speaker_name: m.name, content: m.content, active_swipe: m.swipe_id, swipes: m.swipes }));
      recordChange(ctx, { kind: "chat", id: chatId }, chat.name || chatId, `${removed.length} message${removed.length === 1 ? "" : "s"} deleted`, snapshot, null,
        "Lumiverse cannot restore deleted chat messages. The removed text is kept here for reference.");
    }
    if (failure !== null) {
      const left = targets.filter((m) => !removed.includes(m)).map((m) => m.id);
      return { content: `Error: [SPINDLE_ERROR] ${failure}. Deleted ${removed.length} of ${targets.length}${rows.length > 0 ? ` (${rows.map((r) => r.id).join(", ")}), which cannot be undone` : ""}. Still in the chat: ${left.join(", ")}. Retry with chats(action=delete_messages, message_ids=[...]) for those.`, isError: true };
    }
    return {
      content: JSON.stringify({
        chat_id: chatId,
        chat_name: chat.name,
        chat_source: source,
        deleted_count: rows.length,
        remaining_messages: all.length - rows.length,
        deleted: rows,
        note: "Deleted permanently. This cannot be undone. The removed text is saved in the Workshop history for reference.",
      }, null, 2),
    };
  },
});
