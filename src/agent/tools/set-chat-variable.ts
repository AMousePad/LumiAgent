import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import description from "../prompts/claude/tools/set-chat-variable/description.txt";
import argValue from "../prompts/claude/tools/set-chat-variable/arg_value.txt";

const inputSchema = z.object({
  chat_id: z.string().min(1),
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
      chat_id: { type: "string" },
      key: { type: "string" },
      value: { type: ["string", "null"], description: argValue },
    },
    required: ["chat_id", "key", "value"],
  },
  // Chat-scoped (explicit chat_id, never reads ctx.characterId).
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: "Error: LumiRealm phone line not available (not installed or consent denied).", isError: true };
    const { dialSetChatVariable } = await import("../../phoneline/transport");
    const res = await dialSetChatVariable(ctx.spindle, provider.id, {
      userId: ctx.userId,
      chatId: input.chat_id,
      key: input.key,
      value: input.value,
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "set_chat_variable failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, chat_id: input.chat_id, key: input.key, value: input.value }) };
  },
});
