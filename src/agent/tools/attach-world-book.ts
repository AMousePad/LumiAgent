import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveCharacterTarget, noTargetResult } from "./_context";
import description from "../prompts/claude/tools/attach-world-book/description.txt";
import argWorldBookId from "../prompts/claude/tools/attach-world-book/arg_world_book_id.txt";
import argScope from "../prompts/claude/tools/attach-world-book/arg_scope.txt";
import argAction from "../prompts/claude/tools/attach-world-book/arg_action.txt";
import argTargetId from "../prompts/claude/tools/attach-world-book/arg_target_id.txt";

// Three of the four binding layers are the same operation: add/remove a book id
// from a string[]. Character lives on the card's `world_book_ids`, chat on
// `chat.metadata.chat_world_book_ids` ("This Chat Only"), global on the
// `globalWorldBooks` setting (Always Active). Persona is the odd one (a single
// `attached_world_book_id`), so it stays on the path tools (`set persona/<id>/...`).
const inputSchema = z.object({
  world_book_id: z.string().min(1),
  scope: z.enum(["character", "chat", "global"]),
  action: z.enum(["attach", "detach"]).optional(),
  target_id: z.string().optional(),
}).strict();

export const attachWorldBookTool = defineTool({
  name: "attach_world_book",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      world_book_id: { type: "string", description: argWorldBookId },
      scope: { type: "string", enum: ["character", "chat", "global"], description: argScope },
      action: { type: "string", enum: ["attach", "detach"], description: argAction },
      target_id: { type: "string", description: argTargetId },
    },
    required: ["world_book_id", "scope"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const wbId = input.world_book_id;
    const action = input.action ?? "attach";
    try {
      if (action === "attach") {
        const wb = await ctx.spindle.world_books.get(wbId, ctx.userId);
        if (!wb) return { content: `Error: world book '${wbId}' not found`, isError: true };
      }

      if (input.scope === "character") {
        let target: string;
        try { target = resolveCharacterTarget(ctx, input.target_id); }
        catch (err) { const nt = noTargetResult(err); if (nt) return nt; throw err; }
        const character = await ctx.spindle.characters.get(target, ctx.userId);
        if (!character) return { content: `Error: character '${target}' not found`, isError: true };
        const current = (character.world_book_ids ?? []).filter((v): v is string => typeof v === "string");
        const next = applyAction(current, wbId, action);
        if (next) await ctx.spindle.characters.update(target, { world_book_ids: next }, ctx.userId);
        return result("character", target, wbId, action, next ?? current, next !== null);
      }

      if (input.scope === "chat") {
        const chatId = input.target_id ?? ctx.pinnedChatId;
        if (!chatId) return { content: "Error: no target_id and no pinned chat. Pin a chat or pass target_id.", isError: true };
        const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
        if (!chat) return { content: `Error: chat '${chatId}' not found`, isError: true };
        const metadata = { ...(chat.metadata ?? {}) } as Record<string, unknown>;
        const raw = metadata["chat_world_book_ids"];
        const current = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
        const next = applyAction(current, wbId, action);
        if (next) {
          // chats.update replaces the whole metadata blob, so write it back merged.
          metadata["chat_world_book_ids"] = next;
          await ctx.spindle.chats.update(chatId, { metadata }, ctx.userId);
        }
        return result("chat", chatId, wbId, action, next ?? current, next !== null);
      }

      // global
      const current = await ctx.spindle.world_books.getGlobal(ctx.userId);
      const has = current.includes(wbId);
      let next: string[] = current;
      let changed = false;
      if (action === "attach" && !has) { next = await ctx.spindle.world_books.activateGlobal(wbId, ctx.userId); changed = true; }
      else if (action === "detach" && has) { next = await ctx.spindle.world_books.deactivateGlobal(wbId, ctx.userId); changed = true; }
      return result("global", null, wbId, action, next, changed);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});

// Returns the new list when the action changes it, else null (no-op).
function applyAction(current: string[], id: string, action: "attach" | "detach"): string[] | null {
  const has = current.includes(id);
  if (action === "attach") return has ? null : [...current, id];
  return has ? current.filter((x) => x !== id) : null;
}

function result(scope: string, targetId: string | null, wbId: string, action: string, ids: string[], changed: boolean) {
  return { content: JSON.stringify({ ok: true, scope, target_id: targetId, world_book_id: wbId, action, changed, world_book_ids: ids }, null, 2) };
}
