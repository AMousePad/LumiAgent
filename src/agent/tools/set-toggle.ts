import { recordChange } from "./_change-history";
import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import { CHAT_ID_ARG, NO_CHAT_TARGET, resolveChatId } from "./_chat";
import description from "../prompts/claude/tools/set-toggle/description.txt";
import argKey from "../prompts/claude/tools/set-toggle/arg_key.txt";

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

export const setToggleTool = defineTool({
  name: "set_toggle",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: CHAT_ID_ARG },
      key: { type: "string", description: argKey },
      value: { type: ["string", "null"] },
    },
    required: ["key", "value"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const target = await resolveChatId(ctx, input.chat_id);
    if (!target) return { content: NO_CHAT_TARGET, isError: true };
    const chatId = target.chatId;
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: "Error: [REFUSED_BY_EXTENSION] LumiRealm is not installed or has not granted access, nothing was written. Module toggles only exist with LumiRealm, so there is no other tool for this.", isError: true };
    const { dialSetToggle } = await import("../../phoneline/transport");
    const res = await dialSetToggle(ctx.spindle, provider.id, {
      userId: ctx.userId,
      chatId,
      key: input.key,
      value: input.value,
    });
    if (!res.ok) return { content: `Error: [REFUSED_BY_EXTENSION] ${res.error ?? "set_toggle failed"}. Nothing was written.`, isError: true };
    recordChange(ctx, { kind: "chat", id: chatId }, "Toggle", input.key, { snapshot: "unavailable" }, { key: input.key, value: input.value }, "The extension confirms the write but does not expose a prior-value snapshot for this operation.");
    return { content: JSON.stringify({ ok: true, key: input.key, value: input.value, macro_name: `toggle_${input.key}`, store: "LumiRealm per-user toggle preferences", applies_to: "every chat and character that uses this toggle key", refreshed_chat_id: chatId, chat_source: target.source }, null, 2) };
  },
});
