import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  source: z.union([
    z.object({ kind: z.literal("character"), character_id: z.string().min(1) }),
    z.object({ kind: z.literal("module"), module_id: z.string().min(1) }),
  ]),
  old_name: z.string().min(1),
  new_name: z.string().min(1),
});

async function findLumirealm(ctx: ToolCtx) {
  const { discoverProviders } = await import("../../phoneline/registry");
  const { makeConsentPromptFn } = await import("../../phoneline/consent");
  const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
  const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
  return providers.find((p) => p.id === "lumirealm") ?? null;
}

export const assetRenameTool = defineTool({
  name: "asset_rename",
  description: `Rename a LumiRealm asset (character-scoped or module-scoped). The new name is what \`{{img::NAME}}\` / \`{{emotion::NAME}}\` / \`<img="NAME">\` macros in regex \`replace_string\` and bg-html will reference. After rename, you MUST grep the card and update every reference to the old name.

Wraps the \`rename_asset\` WS op so the LumiRealm runtime refresh hooks fire (asset map propagation, attached-character invalidation).`,
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
      old_name: { type: "string" },
      new_name: { type: "string" },
    },
    required: ["source", "old_name", "new_name"],
  },
  requiresCharacter: true,
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
      action: { kind: "rename", oldName: input.old_name, newName: input.new_name },
    });
    if (!res.ok) return { content: `Error: ${res.error ?? "rename failed"}`, isError: true };
    return { content: JSON.stringify({ ok: true, old_name: input.old_name, new_name: input.new_name, source: input.source }) };
  },
});
