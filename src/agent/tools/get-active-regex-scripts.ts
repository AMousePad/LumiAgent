import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const TARGETS = ["prompt", "response", "display"] as const;

const inputSchema = z.object({
  target: z.enum(TARGETS),
  chat_id: z.string().optional(),
  use_active_character: z.boolean().optional(),
}).strict();

export const getActiveRegexScriptsTool = defineTool({
  name: "get_active_regex_scripts",
  description: "Resolve the regex scripts that would actually fire for a given target (`prompt` runs on text being sent to the model, `response` runs on raw model output before it's stored, `display` runs at render time on stored content) under the active character + chat context. Merges global + character + chat scopes and orders by scope tier then sort_order — exactly the way Lumiverse runs them at prompt-assembly / response-bake / render time. Use this to figure out what's actually rewriting the model's output before you start digging into individual scripts.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      target: { type: "string", enum: [...TARGETS], description: "Which surface the scripts target." },
      chat_id: { type: "string", description: "Chat scope. Defaults to pinned chat." },
      use_active_character: { type: "boolean", description: "Bind to the active character. Defaults to true." },
    },
    required: ["target"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId ?? undefined;
    const useChar = input.use_active_character ?? true;
    try {
      const scripts = await ctx.spindle.regex_scripts.getActive({
        target: input.target,
        ...(useChar ? { characterId: ctx.characterId } : {}),
        ...(chatId ? { chatId } : {}),
        userId: ctx.userId,
      });
      const slim = scripts.map((s) => ({
        id: s.id,
        name: s.name,
        scope: s.scope,
        scope_id: s.scope_id ?? null,
        target: s.target,
        sort_order: s.sort_order,
        disabled: s.disabled,
        flags: s.flags,
        find_regex_chars: s.find_regex.length,
        replace_string_chars: s.replace_string.length,
        find_regex_peek: s.find_regex.slice(0, 200),
      }));
      const out = JSON.stringify({ target: input.target, count: slim.length, scripts: slim }, null, 2);
      return { content: await spillOrReturn(ctx, out, `get_active_regex_scripts(${input.target})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
