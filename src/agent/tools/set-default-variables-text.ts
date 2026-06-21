import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import description from "../prompts/claude/tools/set-default-variables-text/description.txt";

const inputSchema = z.object({
  character_id: z.string().min(1),
  text: z.string().nullable(),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const providers = await discoverProviders(ctx.spindle, ctx.userId);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const setDefaultVariablesTextTool = defineTool({
  name: "set_default_variables_text",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      character_id: { type: "string" },
      text: { type: ["string", "null"] },
    },
    required: ["character_id", "text"],
  },
  // Takes an explicit character_id, never reads ctx.characterId.
  requiresCharacter: false,
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
