import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import description from "../prompts/claude/tools/grep-external/description.txt";
import argPattern from "../prompts/claude/tools/grep-external/arg_pattern.txt";
import argCharacterId from "../prompts/claude/tools/grep-external/arg_character_id.txt";
import argFieldPrefix from "../prompts/claude/tools/grep-external/arg_field_prefix.txt";
import argHead from "../prompts/claude/tools/grep-external/arg_head.txt";

const inputSchema = z.object({
  surface_id: z.string().min(1),
  pattern: z.string().min(1),
  character_id: z.string().optional(),
  ignore_case: z.boolean().optional(),
  field_prefix: z.string().optional(),
  head: z.number().int().positive().max(2000).optional(),
});

export const grepExternalTool = defineTool({
  name: "grep_external",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
      pattern: { type: "string", description: argPattern },
      character_id: { type: "string", description: argCharacterId },
      ignore_case: { type: "boolean" },
      field_prefix: { type: "string", description: argFieldPrefix },
      head: { type: "integer", minimum: 1, maximum: 2000, description: argHead },
    },
    required: ["surface_id", "pattern"],
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
    const { dialGrepItems } = await import("../../phoneline/transport");
    const res = await dialGrepItems(ctx.spindle, match.provider.id, {
      userId: ctx.userId,
      surfaceId: input.surface_id,
      pattern: input.pattern,
      ...(input.ignore_case !== undefined ? { ignoreCase: input.ignore_case } : {}),
      ...(input.field_prefix !== undefined ? { fieldPrefix: input.field_prefix } : {}),
      ...(input.head !== undefined ? { head: input.head } : {}),
      ...(match.surface.scope === "per_character" && target ? { characterId: target } : {}),
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
