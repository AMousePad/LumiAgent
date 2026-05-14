import { z } from "zod";
import { defineTool } from "./_framework";
import { wbLabel } from "./_surfaces";
import type { WorldBookEntryCreateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  world_book_id: z.string().optional(),
  key: z.array(z.string()).optional(),
  keysecondary: z.array(z.string()).optional(),
  content: z.string(),
  comment: z.string().optional(),
  constant: z.boolean().optional(),
  disabled: z.boolean().optional(),
  position: z.number().optional(),
  order_value: z.number().optional(),
  probability: z.number().optional(),
});

export const createWorldBookEntryTool = defineTool({
  name: "create_world_book_entry",
  description: "Create a new world book entry. Defaults to the character's first attached world book; specify world_book_id to target a different one. Returns the new entry's id.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      world_book_id: { type: "string", description: "world book to add the entry to. Defaults to character.world_book_ids[0]." },
      key: { type: "array", items: { type: "string" } },
      keysecondary: { type: "array", items: { type: "string" } },
      content: { type: "string" },
      comment: { type: "string" },
      constant: { type: "boolean" },
      disabled: { type: "boolean" },
      position: { type: "number" },
      order_value: { type: "number" },
      probability: { type: "number" },
    },
    required: ["content"],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const wbId = input.world_book_id ?? c.world_book_ids[0];
    if (!wbId) return { content: "Error: character has no attached world books and world_book_id was not provided", isError: true };
    const create: WorldBookEntryCreateDTO = {
      content: input.content,
    };
    if (input.key) create.key = [...input.key];
    if (input.keysecondary) create.keysecondary = [...input.keysecondary];
    if (input.comment !== undefined) create.comment = input.comment;
    if (input.constant !== undefined) create.constant = input.constant;
    if (input.disabled !== undefined) create.disabled = input.disabled;
    if (input.position !== undefined) create.position = input.position;
    if (input.order_value !== undefined) create.order_value = input.order_value;
    if (input.probability !== undefined) create.probability = input.probability;
    const created = await ctx.spindle.world_books.entries.create(wbId, create, ctx.userId);
    ctx.pushEdit({ op: "create", surface: "world_book_entry", surfaceId: created.id, surfaceLabel: wbLabel(created), snapshot: created });
    return { content: JSON.stringify({ entry_id: created.id, world_book_id: created.world_book_id, comment: created.comment, key: created.key, content_chars: created.content.length }) };
  },
});
