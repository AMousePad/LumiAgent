import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
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
    const chatId = input.chat_id ?? ctx.pinnedChatId ?? undefined;
    // use_active_character governs the fallback to focus only. An explicit
    // character_id always binds {{char}} — otherwise passing `use_active_character:false`
    // would silently drop a caller-supplied id and resolve macros against
    // no character at all.
    const useFocus = input.use_active_character ?? true;
    const target = input.character_id ?? (useFocus ? (ctx.characterId ?? undefined) : undefined);
    try {
      const result = await ctx.spindle.macros.resolve(input.template, {
        ...(chatId ? { chatId } : {}),
        ...(target ? { characterId: target } : {}),
        userId: ctx.userId,
        commit: false,
      });
      const out = JSON.stringify({
        text: result.text,
        diagnostics: result.diagnostics,
      }, null, 2);
      return { content: await spillOrReturn(ctx, out, `resolve_macros(${input.template.length} chars)`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
