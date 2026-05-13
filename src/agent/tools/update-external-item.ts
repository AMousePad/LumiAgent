import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  provider_id: z.string().min(1),
  surface_id: z.string().min(1),
  item_id: z.string().min(1),
  field: z.string().min(1),
  value: z.unknown(),
});

export const updateExternalItemTool = defineTool({
  name: "update_external_item",
  description: "Wholesale-replace a value at a path inside an external provider's item. Use for non-string fields (arrays, objects, numbers) or when you genuinely want to overwrite the entire field. For long strings prefer edit_external_item.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      provider_id: { type: "string" },
      surface_id: { type: "string" },
      item_id: { type: "string" },
      field: { type: "string" },
      value: { description: "any JSON-serializable value" },
    },
    required: ["provider_id", "surface_id", "item_id", "field", "value"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const { provider_id: providerId, surface_id: surfaceId, item_id: itemId, field, value } = input;
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const { makeConsentPromptFn } = await import("../../phoneline/consent");
    const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
    const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
    const match = findSurface(providers, providerId, surfaceId);
    if (!match) return { content: `Error: unknown provider/surface: ${providerId}/${surfaceId}`, isError: true };
    const surfaceLabel = match.surface.label;
    const providerName = match.provider.manifest.extension.name;
    const { dialReadItem, dialWriteField } = await import("../../phoneline/transport");
    const readRes = await dialReadItem(ctx.spindle, providerId, {
      userId: ctx.userId, surfaceId, itemId, field,
    });
    const beforeStr = readRes.value === undefined ? "" : typeof readRes.value === "string" ? readRes.value : JSON.stringify(readRes.value, null, 2);
    const afterStr = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const writeRes = await dialWriteField(ctx.spindle, providerId, {
      userId: ctx.userId, surfaceId, itemId, field, value,
    });
    if (!writeRes.ok) return { content: `Error: write failed: ${writeRes.error ?? "unknown"}`, isError: true };
    ctx.pushEdit({
      op: "edit",
      surface: "external",
      providerId,
      providerName,
      externalSurfaceId: surfaceId,
      itemId,
      surfaceId: `${providerId}:${surfaceId}:${itemId}`,
      surfaceLabel: `${providerName} / ${surfaceLabel} / ${itemId}`,
      field,
      before: beforeStr,
      after: afterStr,
    });
    return { content: JSON.stringify({ provider_id: providerId, surface_id: surfaceId, item_id: itemId, field, ok: true }) };
  },
});
