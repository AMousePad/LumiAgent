import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  surface_id: z.string().min(1),
});

export const listExternalTool = defineTool({
  name: "list_external",
  description: `Lists every item in an external provider's surface.

Usage:
- Returns id + label + brief metadata per item.
- Per-character surfaces are filtered to items attached to the active character automatically.
- Use \`read_external\` to fetch one, \`grep_external\` to regex-search across all.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
    },
    required: ["surface_id"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const { makeConsentPromptFn } = await import("../../phoneline/consent");
    const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
    const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
    const match = findSurface(providers, input.surface_id);
    if (!match) return { content: `Error: unknown surface: ${input.surface_id}`, isError: true };
    const { dialListItems } = await import("../../phoneline/transport");
    const res = await dialListItems(ctx.spindle, match.provider.id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      ...(match.surface.scope === "per_character" ? { characterId: ctx.characterId } : {}),
    });
    return { content: JSON.stringify(res, null, 2) };
  },
});
