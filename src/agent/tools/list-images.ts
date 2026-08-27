import { z } from "zod";
import type { ImageListOptionsDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { resolveCharacterTargetOptional } from "./_context";
import description from "../prompts/claude/tools/list-images/description.txt";
import argCharacterId from "../prompts/claude/tools/list-images/arg_character_id.txt";
import argChatId from "../prompts/claude/tools/list-images/arg_chat_id.txt";
import argOnlyOwned from "../prompts/claude/tools/list-images/arg_only_owned.txt";

const inputSchema = z.object({
  character_id: z.string().optional(),
  chat_id: z.string().optional(),
  only_owned: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listImagesTool = defineTool({
  name: "list_images",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      character_id: { type: "string", description: argCharacterId },
      chat_id: { type: "string", description: argChatId },
      only_owned: { type: "boolean", description: argOnlyOwned },
      limit: { type: "integer", minimum: 1, maximum: 500, description: "Max rows. Default 100." },
      offset: { type: "integer", minimum: 0 },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute: async (input, ctx) => {
    // "all" is the explicit whole-library opt-out; otherwise scope to the focus
    // so a bare call answers "what art does this card have".
    const charFilter = input.character_id === "all"
      ? null
      : (input.character_id ?? resolveCharacterTargetOptional(ctx) ?? null);

    const opts: ImageListOptionsDTO = {
      limit: input.limit ?? 100,
      offset: input.offset ?? 0,
      userId: ctx.userId,
      ...(charFilter !== null ? { characterId: charFilter } : {}),
      ...(input.chat_id !== undefined ? { chatId: input.chat_id } : {}),
      ...(input.only_owned === true ? { onlyOwned: true } : {}),
    };

    let res;
    try { res = await ctx.spindle.images.list(opts); }
    catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }

    return {
      content: JSON.stringify({
        total: res.total,
        returned: res.data.length,
        character_filter: charFilter,
        images: res.data.map((i) => ({
          id: i.id,
          filename: i.original_filename,
          mime_type: i.mime_type,
          width: i.width,
          height: i.height,
          owner_character_id: i.owner_character_id,
          owner_chat_id: i.owner_chat_id,
          owner_extension: i.owner_extension_identifier,
          url: i.url,
          created_at: i.created_at,
        })),
      }, null, 2),
    };
  },
});
