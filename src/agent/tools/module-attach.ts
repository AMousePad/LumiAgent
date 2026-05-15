import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  character_id: z.string().min(1),
  module_id: z.string().min(1),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const providers = await discoverProviders(ctx.spindle, ctx.userId);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const moduleAttachTool = defineTool({
  name: "module_attach",
  description: `Attach a LumiRealm module to a character. Adds the module's lorebook + regex artifacts to the character and makes its triggers, bg-html embedding, and toggle DSL active in chats for that character. Use \`list_external({surface_id:"module_envelope"})\` first to see available modules.

Wraps the \`attach_module\` WS op so artifact install + refresh hooks fire.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      character_id: { type: "string" },
      module_id: { type: "string" },
    },
    required: ["character_id", "module_id"],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: "Error: LumiRealm phone line not available (not installed or consent denied).", isError: true };
    const { dialAttachModule } = await import("../../phoneline/transport");
    const res = await dialAttachModule(ctx.spindle, provider.id, {
      userId: ctx.userId,
      characterId: input.character_id,
      moduleId: input.module_id,
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "attach failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, character_id: input.character_id, module_id: input.module_id }) };
  },
});
