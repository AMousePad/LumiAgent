import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-image-models/description.txt";
import argConnectionId from "../prompts/claude/tools/list-image-models/arg_connection_id.txt";

const inputSchema = z.object({
  connection_id: z.string().optional(),
}).strict();

export const listImageModelsTool = defineTool({
  name: "list_image_models",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      connection_id: { type: "string", description: argConnectionId },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute: async (input, ctx) => {
    const [connections, providers] = await Promise.all([
      ctx.spindle.imageGen.listConnections(ctx.userId).catch(() => []),
      ctx.spindle.imageGen.getProviders(ctx.userId).catch(() => []),
    ]);

    if (connections.length === 0) {
      return {
        content: "No image generation connections are configured. The user needs to add one in Lumiverse Settings before `generate_image` can run.",
        isError: true,
      };
    }

    let models: unknown = undefined;
    if (input.connection_id !== undefined) {
      try { models = await ctx.spindle.imageGen.getModels(input.connection_id, ctx.userId); }
      catch (err) { models = { error: (err as Error).message }; }
    }

    return {
      content: JSON.stringify({
        connections: connections.map((c) => ({
          id: c.id,
          name: c.name,
          provider: c.provider,
          model: c.model,
          is_default: c.is_default,
          has_api_key: c.has_api_key,
          default_parameters: c.default_parameters,
        })),
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          api_key_required: p.capabilities.apiKeyRequired,
          model_list_style: p.capabilities.modelListStyle,
          static_models: p.capabilities.staticModels ?? null,
          supports_preview_streaming: p.capabilities.websocketPreviewStreaming !== undefined,
          parameters: p.capabilities.parameters,
        })),
        ...(models !== undefined ? { models } : {}),
      }, null, 2),
    };
  },
});
