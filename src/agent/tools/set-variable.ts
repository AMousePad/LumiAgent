import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/set-variable/description.txt";

const inputSchema = z.object({
  scope: z.enum(["chat", "local", "global"]),
  key: z.string().min(1).max(200),
  value: z.string().max(20_000).optional(),
  clear: z.boolean().optional(),
  chat_id: z.string().optional(),
}).strict().refine(
  (d) => (d.value !== undefined) !== (d.clear === true),
  { message: "pass exactly one of value / clear" },
);

export const setVariableTool = defineTool({
  name: "set_variable",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["chat", "local", "global"], description: "See description; the read-only `macro` scope of list_variables has its own tools." },
      key: { type: "string", minLength: 1, maxLength: 200 },
      value: { type: "string", maxLength: 20_000, description: "String value. Send numbers/booleans in string form." },
      clear: { type: "boolean", description: "Delete the key instead of setting it." },
      chat_id: { type: "string", description: "chat/local scopes only. Defaults to the pinned chat." },
    },
    required: ["scope", "key"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    try {
      const v = ctx.spindle.variables;
      let before: string | null = null;
      if (input.scope === "global") {
        before = (await v.global.has(input.key, ctx.userId)) ? await v.global.get(input.key, ctx.userId) : null;
        if (input.clear === true) await v.global.delete(input.key, ctx.userId);
        else await v.global.set(input.key, input.value!, ctx.userId);
      } else {
        const chatId = input.chat_id ?? ctx.pinnedChatId;
        if (!chatId) return { content: `Error: [NO_TARGET] ${input.scope} variables need a chat. Pass chat_id or pin a chat.`, isError: true };
        const bag = input.scope === "chat" ? v.chat : v.local;
        before = (await bag.has(chatId, input.key)) ? await bag.get(chatId, input.key) : null;
        if (input.clear === true) await bag.delete(chatId, input.key);
        else await bag.set(chatId, input.key, input.value!);
      }
      return {
        content: JSON.stringify({
          scope: input.scope,
          key: input.key,
          before,
          after: input.clear === true ? null : input.value,
        }, null, 2),
      };
    } catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
  },
});
