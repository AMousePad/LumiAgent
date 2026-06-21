import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-external/description.txt";
import argCharacterId from "../prompts/claude/tools/list-external/arg_character_id.txt";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  character_id: z.string().optional(),
});

export const listExternalTool = defineTool({
  name: "list_external",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      character_id: { type: "string", description: argCharacterId },
    },
    required: ["surface_id"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const providers = await discoverProviders(ctx.spindle, ctx.userId);
    const match = findSurface(providers, input.surface_id);
    if (!match) return { content: `Error: unknown surface: ${input.surface_id}`, isError: true };
    const target = input.character_id ?? ctx.characterId;
    if (match.surface.scope === "per_character" && !target) {
      return { content: "Error: [NO_TARGET] this is a per-character surface; pass character_id or focus a character first.", isError: true };
    }
    const { dialListItems } = await import("../../phoneline/transport");
    const res = await dialListItems(ctx.spindle, match.provider.id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      ...(match.surface.scope === "per_character" && target ? { characterId: target } : {}),
    });
    return { content: JSON.stringify(res, null, 2) };
  },
});
