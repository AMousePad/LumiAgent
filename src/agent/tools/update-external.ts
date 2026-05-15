import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  item_id: z.string().min(1),
  field: z.string().min(1),
  value: z.unknown(),
});

export const updateExternalTool = defineTool({
  name: "update_external",
  description: `Wholesale-replaces a value at one field on an external provider's item.

Usage:
- Use for non-string fields (arrays, objects, numbers) or when overwriting the entire field.
- For find/replace inside a long string field, prefer \`edit_external\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      item_id: { type: "string" },
      field: { type: "string" },
      value: { description: "any JSON-serializable value" },
    },
    required: ["surface_id", "item_id", "field", "value"],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const { surface_id: surfaceId, item_id: itemId, field, value } = input;
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const providers = await discoverProviders(ctx.spindle, ctx.userId);
    const match = findSurface(providers, surfaceId);
    if (!match) return { content: `Error: unknown surface: ${surfaceId}`, isError: true };
    const surfaceLabel = match.surface.label;
    const providerName = match.provider.manifest.extension.name;
    const { dialReadItem, dialWriteField } = await import("../../phoneline/transport");
    const readRes = await dialReadItem(ctx.spindle, match.provider.id, {
      userId: ctx.userId, surfaceId, itemId, field,
    });
    const beforeStr = readRes.value === undefined ? "" : typeof readRes.value === "string" ? readRes.value : JSON.stringify(readRes.value, null, 2);
    const afterStr = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const writeRes = await dialWriteField(ctx.spindle, match.provider.id, {
      userId: ctx.userId, surfaceId, itemId, field, value,
    });
    if (!writeRes.ok) return { content: `Error: write failed: ${writeRes.error ?? "unknown"}`, isError: true };
    ctx.pushEdit({
      op: "edit",
      surface: "external",
      providerId: match.provider.id,
      providerName,
      externalSurfaceId: surfaceId,
      itemId,
      surfaceId: `${match.provider.id}:${surfaceId}:${itemId}`,
      surfaceLabel: `${providerName} / ${surfaceLabel} / ${itemId}`,
      field,
      before: beforeStr,
      after: afterStr,
    });
    return { content: JSON.stringify({ surface_id: surfaceId, item_id: itemId, field, ok: true }) };
  },
});
