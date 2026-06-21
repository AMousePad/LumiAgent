import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { markRead, markReadWithHash } from "./_gates";
import description from "../prompts/claude/tools/read-external/description.txt";
import argField from "../prompts/claude/tools/read-external/arg_field.txt";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  item_id: z.string().min(1),
  field: z.string().optional(),
});

export const readExternalTool = defineTool({
  name: "read_external",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      item_id: { type: "string" },
      field: { type: "string", description: argField },
    },
    required: ["surface_id", "item_id"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const providers = await discoverProviders(ctx.spindle, ctx.userId);
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
    // value is `unknown` and may be undefined (missing field). JSON.stringify(undefined)
    // returns the JS value undefined, not a string, so `.length` below would throw.
    const valueStr = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
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
