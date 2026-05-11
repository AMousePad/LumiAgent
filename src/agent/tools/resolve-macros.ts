import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  template: z.string().min(1),
  chat_id: z.string().optional(),
  use_active_character: z.boolean().optional(),
}).strict();

export const resolveMacrosTool = defineTool({
  name: "resolve_macros",
  description: "Resolve `{{macro}}` placeholders in arbitrary text using Lumiverse's macro engine. Always runs in non-committing dry mode (`commit: false`) so extension macro handlers don't side-effect. Pass chat_id (defaults to pinned) for chat-scoped macros (variables, history, etc.) and use_active_character to bind {{char}} / character fields to the currently active card. Returns { text, diagnostics }.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      template: { type: "string", description: "Template text containing {{macros}} to resolve." },
      chat_id: { type: "string", description: "Chat scope for variables and history. Defaults to pinned chat." },
      use_active_character: { type: "boolean", description: "Bind {{char}} and character fields to the active character. Defaults to true." },
    },
    required: ["template"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId ?? undefined;
    const useChar = input.use_active_character ?? true;
    try {
      const result = await ctx.spindle.macros.resolve(input.template, {
        ...(chatId ? { chatId } : {}),
        ...(useChar ? { characterId: ctx.characterId } : {}),
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
