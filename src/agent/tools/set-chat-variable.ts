import { recordChange } from "./_change-history";
import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import { CHAT_ID_ARG, NO_CHAT_TARGET, resolveChatId } from "./_chat";
import description from "../prompts/claude/tools/set-chat-variable/description.txt";
import argValue from "../prompts/claude/tools/set-chat-variable/arg_value.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
  key: z.string().min(1),
  value: z.string().nullable(),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const providers = await discoverProviders(ctx.spindle, ctx.userId);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const setChatVariableTool = defineTool({
  name: "set_chat_variable",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      key: { type: "string" },
      value: { type: ["string", "null"], description: argValue },
    },
    required: ["key", "value"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const target = await resolveChatId(ctx, input.chat_id);
    if (!target) return { content: NO_CHAT_TARGET, isError: true };
    const chatId = target.chatId;
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: `Error: [REFUSED_BY_EXTENSION] LumiRealm is not installed or has not granted access, nothing was written. For a plain Lumiverse chat variable call variables(action=set, scope="chat", key="${input.key}") instead.`, isError: true };
    let before: string | null = null;
    let knownBefore = true;
    try { before = (await ctx.spindle.variables.chat.has(chatId, input.key)) ? await ctx.spindle.variables.chat.get(chatId, input.key) : null; }
    catch { knownBefore = false; }
    const { dialSetChatVariable } = await import("../../phoneline/transport");
    const res = await dialSetChatVariable(ctx.spindle, provider.id, {
      userId: ctx.userId,
      chatId,
      key: input.key,
      value: input.value,
    });
    if (!res.ok) {
      const why = res.error ?? "set_chat_variable failed";
      const hint = /not a Risu/i.test(why) ? ` This chat's card was not imported through LumiRealm. Call variables(action=set, scope="chat", key="${input.key}") instead.` : "";
      return { content: `Error: [REFUSED_BY_EXTENSION] ${why}. Nothing was written.${hint}`, isError: true };
    }
    recordChange(ctx, { kind: "chat", id: chatId }, "Chat variable", input.key, knownBefore ? { key: input.key, value: before } : { snapshot: "unavailable" }, { key: input.key, value: input.value },
      "Written through LumiRealm, which Workshop cannot revert. Call set_chat_variable again with the previous value to undo.");
    return { content: JSON.stringify({ ok: true, chat_id: chatId, chat_source: target.source, key: input.key, ...(knownBefore ? { before } : {}), after: input.value, store: "chat.metadata.chat_variables", read_by: "{{getchatvar}}, and Risu / LumiRealm getvar" }, null, 2) };
  },
});
