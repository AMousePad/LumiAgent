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

export const moduleDetachTool = defineTool({
  name: "module_detach",
  description: `Detach a LumiRealm module from a character. Removes its installed lorebook + regex artifacts and stops its triggers / bg-html / toggles from running for that character. The module envelope stays in the user's library (not deleted).

Wraps the \`detach_module\` WS op so artifact uninstall + refresh hooks fire.`,
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
    const { dialDetachModule } = await import("../../phoneline/transport");
    const res = await dialDetachModule(ctx.spindle, provider.id, {
      userId: ctx.userId,
      characterId: input.character_id,
      moduleId: input.module_id,
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "detach failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, character_id: input.character_id, module_id: input.module_id }) };
  },
});
