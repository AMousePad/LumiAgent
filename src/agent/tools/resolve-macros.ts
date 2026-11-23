import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { explicitChatId } from "./_chat";
import description from "../prompts/claude/tools/resolve-macros/description.txt";
import argTemplate from "../prompts/claude/tools/resolve-macros/arg_template.txt";
import argChatId from "../prompts/claude/tools/resolve-macros/arg_chat_id.txt";
import argCharacterId from "../prompts/claude/tools/resolve-macros/arg_character_id.txt";
import argUseActiveCharacter from "../prompts/claude/tools/resolve-macros/arg_use_active_character.txt";

const inputSchema = z.object({
  template: z.string().min(1),
  chat_id: z.string().optional(),
  character_id: z.string().optional(),
  use_active_character: z.boolean().optional(),
}).strict();

export const resolveMacrosTool = defineTool({
  name: "resolve_macros",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      template: { type: "string", description: argTemplate },
      chat_id: { type: "string", description: argChatId },
      character_id: { type: "string", description: argCharacterId },
      use_active_character: { type: "boolean", description: argUseActiveCharacter },
    },
    required: ["template"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = explicitChatId(input.chat_id) ?? ctx.pinnedChatId ?? undefined;
    const useFocus = input.use_active_character ?? true;
    let target = input.character_id || undefined;
    let boundTo = target ? "character_id argument" : "none";
    let shown = target;
    try {
      // A chat already has a character. Passing the focused one would resolve {{char}} to the wrong card.
      if (!target && chatId) {
        const chat = await ctx.spindle.chats.get(chatId, ctx.userId);
        if (!chat) return { content: `Error: [PATH_NOT_FOUND] chat '${chatId}' not found. Call chats(action=list) for valid ids, or omit chat_id.`, isError: true };
        const meta = (chat.metadata ?? {}) as Record<string, unknown>;
        const members = Array.isArray(meta["character_ids"]) ? meta["character_ids"] as unknown[] : [];
        if (useFocus && ctx.characterId && (meta["group"] === true || meta["group"] === 1) && members.includes(ctx.characterId)) {
          target = shown = ctx.characterId;
          boundTo = "focused member of this group chat";
        } else {
          boundTo = chat.character_id ? "the chat's own character" : "none";
          shown = chat.character_id || undefined;
        }
      } else if (!target && useFocus && ctx.characterId) {
        target = shown = ctx.characterId;
        boundTo = "focused character";
      }
      const result = await ctx.spindle.macros.resolve(input.template, {
        ...(chatId ? { chatId } : {}),
        ...(target ? { characterId: target } : {}),
        userId: ctx.userId,
        commit: false,
      });
      const out = JSON.stringify({
        text: result.text,
        diagnostics: result.diagnostics,
        chat_id: chatId ?? null,
        char_bound_to: boundTo,
        ...(shown ? { character_id: shown } : {}),
      }, null, 2);
      return { content: await spillOrReturn(ctx, out, `resolve_macros(${input.template.length} chars)`) };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] macro resolution failed: ${(err as Error).message}`, isError: true };
    }
  },
});
