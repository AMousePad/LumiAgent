import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  provider_id: z.string().min(1),
  surface_id: z.string().min(1),
});

export const listExternalItemsTool = defineTool({
  name: "list_external_items",
  description: "Enumerate items in an external provider's surface (e.g. all LumiRealm modules attached to the active character). Returns id + label + brief metadata for each. Use the active character's id implicitly when the surface is per_character scoped.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      provider_id: { type: "string" },
      surface_id: { type: "string" },
    },
    required: ["provider_id", "surface_id"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const { makeConsentPromptFn } = await import("../../phoneline/consent");
    const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
    const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
    const match = findSurface(providers, input.provider_id, input.surface_id);
    if (!match) return { content: `Error: unknown provider/surface: ${input.provider_id}/${input.surface_id}`, isError: true };
    const { dialListItems } = await import("../../phoneline/transport");
    const res = await dialListItems(ctx.spindle, input.provider_id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      ...(match.surface.scope.kind === "per_character" ? { characterId: ctx.characterId } : {}),
    });
    return { content: JSON.stringify(res, null, 2) };
  },
});
