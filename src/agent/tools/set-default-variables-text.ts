import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  character_id: z.string().min(1),
  text: z.string().nullable(),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const { makeConsentPromptFn } = await import("../../phoneline/consent");
  const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
  const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const setDefaultVariablesTextTool = defineTool({
  name: "set_default_variables_text",
  description: `Set or clear the per-user override of LumiRealm default variables. This is the Risu-parity master text shown in State → Variables → Default for the current user only. Pass \`null\` to revert to the card-side baseline.

For changes that EVERY user of the card should see, edit \`char/extensions/lumirealm.payload.scriptstate_defaults\` (the card-side baseline object) instead.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      character_id: { type: "string" },
      text: { type: ["string", "null"] },
    },
    required: ["character_id", "text"],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: "Error: LumiRealm phone line not available (not installed or consent denied).", isError: true };
    const { dialSetDefaultVariablesText } = await import("../../phoneline/transport");
    const res = await dialSetDefaultVariablesText(ctx.spindle, provider.id, {
      userId: ctx.userId,
      characterId: input.character_id,
      text: input.text,
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "set_default_variables_text failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, character_id: input.character_id, cleared: input.text === null }) };
  },
});
