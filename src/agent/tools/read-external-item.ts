import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { markRead } from "./_gates";

const inputSchema = z.object({
  provider_id: z.string().min(1),
  surface_id: z.string().min(1),
  item_id: z.string().min(1),
  field: z.string().optional(),
});

export const readExternalItemTool = defineTool({
  name: "read_external_item",
  description: "Read a single external-provider item (e.g. LumiRealm payload field). Pass `field` to get one field, omit it for the whole item.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      provider_id: { type: "string" },
      surface_id: { type: "string" },
      item_id: { type: "string" },
      field: { type: "string", description: "Optional field name within the item" },
    },
    required: ["provider_id", "surface_id", "item_id"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const { discoverProviders } = await import("../../phoneline/registry");
    const { makeConsentPromptFn } = await import("../../phoneline/consent");
    const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
    const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
    const provider = providers.find((p) => p.id === input.provider_id);
    if (!provider) return { content: `Error: unknown provider: ${input.provider_id}`, isError: true };
    const { dialReadItem } = await import("../../phoneline/transport");
    const res = await dialReadItem(ctx.spindle, input.provider_id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      itemId: input.item_id,
      ...(input.field !== undefined ? { field: input.field } : {}),
    });
    const value = res.value;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const payload = JSON.stringify({
      provider_id: input.provider_id,
      surface_id: input.surface_id,
      item_id: input.item_id,
      field: input.field ?? null,
      value_chars: valueStr.length,
      value: valueStr,
    }, null, 2);
    if (input.field !== undefined) {
      markRead(ctx, `external_item:${input.provider_id}/${input.surface_id}/${input.item_id}/${input.field}`);
    }
    const out = await spillOrReturn(ctx, payload, `read_external_item:${input.provider_id}/${input.surface_id}/${input.item_id}`);
    return { content: out };
  },
});
