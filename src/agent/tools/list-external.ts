import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  surface_id: z.string().min(1),
});

export const listExternalTool = defineTool({
  name: "list_external",
  description: `Lists every item in an external provider's surface.

Usage:
- Per-character surfaces are filtered to items attached to the active character automatically.
- Use \`read_external\` to fetch one, \`grep_external\` to regex-search across all.

Returns:
- \`total\` — total item count after attachment filter.
- \`items\` — array of \`{id, label, brief?}\`. \`id\` is what you pass to \`read_external\` / \`edit_external\` as \`item_id\`. \`brief\` is provider-defined metadata (counts, flags, kind) varying per surface.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
    },
    required: ["surface_id"],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const providers = await discoverProviders(ctx.spindle, ctx.userId);
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
