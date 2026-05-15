import { z } from "zod";
import { defineTool } from "./_framework";
import type { PersonaCreateDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  folder: z.string().optional(),
  is_default: z.boolean().optional(),
  attached_world_book_id: z.string().optional(),
});

export const createPersonaTool = defineTool({
  name: "create_persona",
  description: "Create a new user persona. Returns the new persona's id. Revertible (revert deletes it).",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      folder: { type: "string" },
      is_default: { type: "boolean" },
      attached_world_book_id: { type: "string" },
    },
    required: ["name"],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const create: PersonaCreateDTO = { name: input.name };
    if (input.title !== undefined) create.title = input.title;
    if (input.description !== undefined) create.description = input.description;
    if (input.folder !== undefined) create.folder = input.folder;
    if (input.is_default !== undefined) create.is_default = input.is_default;
    if (input.attached_world_book_id !== undefined) create.attached_world_book_id = input.attached_world_book_id;
    const created = await ctx.spindle.personas.create(create, ctx.userId);
    ctx.pushEdit({
      op: "create",
      surface: "persona",
      surfaceId: created.id,
      surfaceLabel: created.name,
      snapshot: created,
      scope: { kind: "persona", id: created.id },
    });
    return { content: JSON.stringify({ persona_id: created.id, name: created.name }) };
  },
});
