import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  source: z.union([
    z.object({ kind: z.literal("character"), character_id: z.string().min(1) }),
    z.object({ kind: z.literal("module"), module_id: z.string().min(1) }),
  ]),
  asset_name: z.string().min(1),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const { makeConsentPromptFn } = await import("../../phoneline/consent");
  const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
  const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const assetDeleteTool = defineTool({
  name: "asset_delete",
  description: `Delete a LumiRealm asset (character or module). Removes it from the asset_index. References to the asset name in regex replace_string / bg-html / macros will resolve to nothing after deletion, so grep for the name and clean those up.

Wraps the \`delete_asset\` WS op so the LumiRealm runtime refresh hooks fire.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      source: {
        oneOf: [
          { type: "object", properties: { kind: { const: "character" }, character_id: { type: "string" } }, required: ["kind", "character_id"] },
          { type: "object", properties: { kind: { const: "module" }, module_id: { type: "string" } }, required: ["kind", "module_id"] },
        ],
      },
      asset_name: { type: "string" },
    },
    required: ["source", "asset_name"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const provider = await findLumirealm(ctx);
    if (!provider) return { content: "Error: LumiRealm phone line not available (not installed or consent denied).", isError: true };
    const { dialAssetMutate } = await import("../../phoneline/transport");
    const source = input.source.kind === "character"
      ? { kind: "character" as const, characterId: input.source.character_id }
      : { kind: "module" as const, moduleId: input.source.module_id };
    const res = await dialAssetMutate(ctx.spindle, provider.id, {
      userId: ctx.userId,
      source,
      action: { kind: "delete", assetName: input.asset_name },
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "delete failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, asset_name: input.asset_name, source: input.source }) };
  },
});
