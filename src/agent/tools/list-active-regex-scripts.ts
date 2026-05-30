import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const TARGETS = ["prompt", "response", "display"] as const;

const inputSchema = z.object({
  target: z.enum(TARGETS),
  chat_id: z.string().optional(),
  character_id: z.string().optional(),
  use_active_character: z.boolean().optional(),
}).strict();

export const listActiveRegexScriptsTool = defineTool({
  name: "list_active_regex_scripts",
  description: `Lists regex scripts that would fire for a target under the active character + chat context.

Usage:
- \`target\`: \`prompt\` runs on text sent to the model, \`response\` runs on raw model output before storage, \`display\` runs at render time on stored content.
- Merges global + character + chat scopes and orders by scope tier then sort_order, matching Lumiverse's runtime ordering.
- Use to figure out what's rewriting the model's output before digging into individual scripts.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      target: { type: "string", enum: [...TARGETS], description: "Which surface the scripts target." },
      chat_id: { type: "string", description: "Chat scope. Defaults to pinned chat." },
      character_id: { type: "string", description: "Bind to this character. Defaults to the focused character." },
      use_active_character: { type: "boolean", description: "Bind to the active character. Defaults to true." },
    },
    required: ["target"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId ?? undefined;
    const useChar = input.use_active_character ?? true;
    // An explicit character_id always binds; use_active_character only governs
    // the focus FALLBACK. ANDing useChar with an explicit id silently dropped a
    // caller-supplied character (matches the resolve_macros fix).
    const target = input.character_id ?? (useChar ? (ctx.characterId ?? undefined) : undefined);
    try {
      const scripts = await ctx.spindle.regex_scripts.getActive({
        target: input.target,
        ...(target ? { characterId: target } : {}),
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
      return { content: await spillOrReturn(ctx, out, `list_active_regex_scripts(${input.target})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
