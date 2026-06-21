import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import description from "../prompts/claude/tools/set-toggle/description.txt";
import argKey from "../prompts/claude/tools/set-toggle/arg_key.txt";

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

export const setToggleTool = defineTool({
  name: "set_toggle",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string" },
      key: { type: "string", description: argKey },
      value: { type: ["string", "null"] },
    },
    required: ["chat_id", "key", "value"],
  },
  // Chat-scoped (explicit chat_id, never reads ctx.characterId), so it must stay
  // available in no-character sessions like the other explicit-id tools.
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: "Error: LumiRealm phone line not available (not installed or consent denied).", isError: true };
    const { dialSetToggle } = await import("../../phoneline/transport");
    const res = await dialSetToggle(ctx.spindle, provider.id, {
      userId: ctx.userId,
      chatId: input.chat_id,
      key: input.key,
      value: input.value,
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "set_toggle failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, chat_id: input.chat_id, key: input.key, value: input.value }) };
  },
});
