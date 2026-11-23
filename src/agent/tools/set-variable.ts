import { z } from "zod";
import { defineTool } from "./_framework";
import { CHAT_ID_ARG, resolveChat } from "./_chat";
import { VAR_STORES } from "./_variables";
import { writeChatGlobalVar } from "../../state/chat-global-vars";
import description from "../prompts/claude/tools/set-variable/description.txt";

const inputSchema = z.object({
  scope: z.enum(["chat", "local", "global"]),
  key: z.string().min(1).max(200),
  value: z.string().max(20_000).optional(),
  clear: z.boolean().optional(),
  chat_id: z.string().optional(),
}).strict().refine(
  (d) => (d.value !== undefined) !== (d.clear === true),
  { message: "pass exactly one of value or clear:true" },
);

const LOCAL_NOTE = "Saved, but no prompt will change: Lumiverse rebuilds {{getvar}} values for every prompt from preset variables and never loads this store. Use scope=chat for {{getchatvar}} and card variables, scope=global for {{getgvar}}, or set preset/<presetId>/var/<name> for a preset variable.";

export const setVariableTool = defineTool({
  name: "set_variable",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["chat", "global"], description: "chat is read by {{getchatvar}} and Risu / LumiRealm getvar. global is read by {{getgvar}} / {{getglobalvar}}. Both are stored on one chat." },
      key: { type: "string", minLength: 1, maxLength: 200 },
      value: { type: "string", maxLength: 20_000, description: "String value. Send numbers/booleans in string form." },
      clear: { type: "boolean", description: "Delete the key instead of setting it." },
      chat_id: { type: "string", description: CHAT_ID_ARG },
    },
    required: ["scope", "key"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    const after = input.clear === true ? null : input.value!;
    try {
      let before: string | null;
      if (input.scope === "global") {
        before = (await writeChatGlobalVar(ctx.spindle, chatId, input.key, after, ctx.userId)).before;
      } else {
        const bag = input.scope === "chat" ? ctx.spindle.variables.chat : ctx.spindle.variables.local;
        before = (await bag.has(chatId, input.key)) ? await bag.get(chatId, input.key) : null;
        if (after === null) { if (before !== null) await bag.delete(chatId, input.key); }
        else if (before !== after) await bag.set(chatId, input.key, after);
      }
      const ledgerKind = input.scope === "global" ? "chat_global" : input.scope;
      if (before !== after) ctx.pushEdit({ op: "edit", surface: "variable", surfaceId: `${ledgerKind}:${chatId}`, surfaceLabel: input.key, field: input.key, before: JSON.stringify(before), after: JSON.stringify(after), valueEncoding: "json", scope: { kind: "variables", id: chatId } });
      const info = VAR_STORES[input.scope];
      const note = before === after
        ? "The key already had this value. Nothing was written."
        : input.scope === "local"
          ? LOCAL_NOTE
          : input.scope === "global"
            ? "Applies to this chat only: Lumiverse keeps {{getgvar}} values per chat, other chats keep their own."
            : "Takes effect on the next generation in this chat. A card trigger that sets the same key can overwrite it.";
      return {
        content: JSON.stringify({
          scope: input.scope,
          key: input.key,
          before,
          after,
          changed: before !== after,
          chat_id: chatId,
          chat_name: chat.name,
          chat_source: source,
          store: info.store,
          read_by: info.read_by,
          reaches_prompts: info.reaches_prompts,
          note,
        }, null, 2),
      };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${input.scope} variable '${input.key}' in chat ${chatId} was not changed: ${(err as Error).message}`, isError: true };
    }
  },
});
