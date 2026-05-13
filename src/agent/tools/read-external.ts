import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { markRead, markReadWithHash } from "./_gates";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  item_id: z.string().min(1),
  field: z.string().optional(),
});

export const readExternalTool = defineTool({
  name: "read_external",
  description: `Reads one item from an external provider's surface.

Usage:
- Pass \`field\` to read one field. Omit it for the whole item.
- A field-scoped read records the read in the recency gate so a subsequent \`edit_external\` on the same field can pass.
- Big results spill to a tmp handle.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      item_id: { type: "string" },
      field: { type: "string", description: "Optional field name within the item" },
    },
    required: ["surface_id", "item_id"],
  },
  defaultSensitivity: "sensitive",
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const { makeConsentPromptFn } = await import("../../phoneline/consent");
    const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
    const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
    const match = findSurface(providers, input.surface_id);
    if (!match) return { content: `Error: unknown surface: ${input.surface_id}`, isError: true };
    const { dialReadItem } = await import("../../phoneline/transport");
    const res = await dialReadItem(ctx.spindle, match.provider.id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      itemId: input.item_id,
      ...(input.field !== undefined ? { field: input.field } : {}),
    });
    const value = res.value;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const payload = JSON.stringify({
      surface_id: input.surface_id,
      item_id: input.item_id,
      field: input.field ?? null,
      value_chars: valueStr.length,
      value: valueStr,
    }, null, 2);
    if (input.field !== undefined) {
      const key = `external_item:${input.surface_id}/${input.item_id}/${input.field}`;
      // Hash the string value so edit_external's freshness gate can detect
      // drift between this read and the next write. Non-string field values
      // (arrays, objects) can't be hash-gated; record without a hash so the
      // recency gate still passes but the freshness check is skipped.
      if (typeof value === "string") markReadWithHash(ctx, key, value);
      else markRead(ctx, key);
    }
    const out = await spillOrReturn(ctx, payload, `read_external:${input.surface_id}/${input.item_id}`);
    return { content: out };
  },
});
