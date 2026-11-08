import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-external/description.txt";
import argCharacterId from "../prompts/claude/tools/list-external/arg_character_id.txt";

const inputSchema = z.object({
  surface_id: z.string().min(1).optional(),
  character_id: z.string().optional(),
});

export const listExternalTool = defineTool({
  name: "list_external",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string", description: "Surface to list. Omit to list every connected extension and its surfaces." },
      character_id: { type: "string", description: argCharacterId },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const providers = await discoverProviders(ctx.spindle, ctx.userId);
    const catalog = providers.map((p) => ({
      extension: p.manifest.extension.name,
      surfaces: p.manifest.surfaces.map((s) => ({ surface_id: s.id, label: s.label, scope: s.scope, ...(s.description ? { description: s.description } : {}) })),
    }));
    if (input.surface_id === undefined) {
      return { content: JSON.stringify(catalog.length > 0 ? { providers: catalog } : { providers: [], note: "No extension is connected over the phone line, so there are no external surfaces." }, null, 2) };
    }
    const match = findSurface(providers, input.surface_id);
    if (!match) {
      const known = catalog.flatMap((c) => c.surfaces.map((s) => s.surface_id));
      return { content: `Error: unknown surface: ${input.surface_id}. ${known.length > 0 ? `Known surfaces: ${known.join(", ")}` : "No extension is connected, so there are no surfaces."}`, isError: true };
    }
    const target = input.character_id ?? ctx.characterId;
    if (match.surface.scope === "per_character" && !target) {
      return { content: "Error: [NO_TARGET] this is a per-character surface; pass character_id or focus a character first.", isError: true };
    }
    const { dialListItems } = await import("../../phoneline/transport");
    const res = await dialListItems(ctx.spindle, match.provider.id, {
      userId: ctx.userId,
      surfaceId: match.surface.id,
      ...(match.surface.scope === "per_character" && target ? { characterId: target } : {}),
    });
    return { content: JSON.stringify(res, null, 2) };
  },
});
