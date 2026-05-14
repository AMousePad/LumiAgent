import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  pattern: z.string().min(1),
  ignore_case: z.boolean().optional(),
  field_prefix: z.string().optional(),
  head: z.number().int().positive().max(2000).optional(),
});

export const grepExternalTool = defineTool({
  name: "grep_external",
  description: `Regex-search every item in an external provider's surface.

Usage:
- Returns hits with item_id + item_label + field_path + line + match + preview.
- \`field_prefix\` scopes the walk to a path subtree, path-segment aware. Examples: \`module.regex\` matches \`module.regex\`, \`module.regex[0]\`, \`module.regex.x\`; does NOT match \`module.regex_v2\`.
- Per-character surfaces are filtered to items attached to the active character.
- \`head\` caps the hit count (default 200, max 2000); response includes \`truncated\` when hit.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      pattern: { type: "string", description: "JavaScript regex source. No flags, use `ignore_case` for /i." },
      ignore_case: { type: "boolean" },
      field_prefix: { type: "string", description: "Optional path-prefix filter, e.g. 'module.regex'." },
      head: { type: "integer", minimum: 1, maximum: 2000, description: "Max hits to return. Default 200." },
    },
    required: ["surface_id", "pattern"],
  },
  defaultSensitivity: "sensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const { discoverProviders, findSurface } = await import("../../phoneline/registry");
    const { makeConsentPromptFn } = await import("../../phoneline/consent");
    const promptFn = makeConsentPromptFn(ctx.callFrontend ?? (async () => ({ denied: true })));
    const providers = await discoverProviders(ctx.spindle, ctx.userId, promptFn);
    const match = findSurface(providers, input.surface_id);
    if (!match) return { content: `Error: unknown surface: ${input.surface_id}`, isError: true };
    const { dialGrepItems } = await import("../../phoneline/transport");
    const res = await dialGrepItems(ctx.spindle, match.provider.id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      pattern: input.pattern,
      ...(input.ignore_case !== undefined ? { ignoreCase: input.ignore_case } : {}),
      ...(input.field_prefix !== undefined ? { fieldPrefix: input.field_prefix } : {}),
      ...(input.head !== undefined ? { head: input.head } : {}),
      ...(match.surface.scope === "per_character" ? { characterId: ctx.characterId } : {}),
    });
    const payload = JSON.stringify({
      surface_id: input.surface_id,
      pattern: input.pattern,
      hit_count: res.hits.length,
      truncated: res.truncated,
      hits: res.hits,
    }, null, 2);
    const out = await spillOrReturn(ctx, payload, `grep_external:${input.surface_id}`);
    return { content: out };
  },
});
