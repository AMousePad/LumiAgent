import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  chat_id: z.string().min(1),
  key: z.string().min(1),
  value: z.string().nullable(),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const { makeConsentPromptFn } = await import("../../phoneline/consent");
  const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
  const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const setChatVariableTool = defineTool({
  name: "set_chat_variable",
  description: `Set or clear a chat-scope LOCAL variable. Writes to \`chat.metadata.macro_variables.local[key]\` for the named chat. Pass \`null\` for value to delete.

This is a per-chat runtime patch, not a card-level edit. Trigger \`setvar\` effects will overwrite this when they fire. For values that should survive every trigger run (the card-side baseline), edit \`char/extensions/lumirealm.payload.scriptstate_defaults\` instead.

Lua state keys (\`__name\`) need a valid JSON string in \`value\`; the runtime won't re-encode.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string" },
      key: { type: "string" },
      value: { type: ["string", "null"], description: "string value to set, or null to delete the key." },
    },
    required: ["chat_id", "key", "value"],
  },
  defaultSensitivity: "insensitive",
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
