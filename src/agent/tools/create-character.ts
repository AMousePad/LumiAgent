import { z } from "zod";
import type { CharacterCreateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/create-character/description.txt";

const strField = z.string().max(100_000).optional();

const inputSchema = z.object({
  name: z.string().min(1).max(200),
  description: strField,
  personality: strField,
  scenario: strField,
  first_mes: strField,
  mes_example: strField,
  creator_notes: strField,
  system_prompt: strField,
  post_history_instructions: strField,
  creator: z.string().max(200).optional(),
  tags: z.array(z.string().min(1)).max(50).optional(),
  alternate_greetings: z.array(z.string()).max(20).optional(),
  world_book_ids: z.array(z.string()).max(20).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const createCharacterTool = defineTool({
  name: "create_character",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string" },
      personality: { type: "string" },
      scenario: { type: "string" },
      first_mes: { type: "string" },
      mes_example: { type: "string" },
      creator_notes: { type: "string" },
      system_prompt: { type: "string" },
      post_history_instructions: { type: "string" },
      creator: { type: "string", maxLength: 200 },
      tags: { type: "array", items: { type: "string" }, maxItems: 50 },
      alternate_greetings: { type: "array", items: { type: "string" }, maxItems: 20 },
      world_book_ids: { type: "array", items: { type: "string" }, maxItems: 20, description: "Existing world book ids to attach at creation." },
      extensions: { type: "object", description: "Initial extension data. Provider-owned subtrees (lumirealm.*) should be left to their extensions." },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const dto: CharacterCreateDTO = { name: input.name };
    for (const k of ["description", "personality", "scenario", "first_mes", "mes_example", "creator_notes", "system_prompt", "post_history_instructions", "creator"] as const) {
      const v = input[k];
      if (v !== undefined) (dto as unknown as Record<string, unknown>)[k] = v;
    }
    if (input.tags !== undefined) dto.tags = input.tags;
    if (input.alternate_greetings !== undefined) dto.alternate_greetings = input.alternate_greetings;
    if (input.world_book_ids !== undefined) dto.world_book_ids = input.world_book_ids;
    if (input.extensions !== undefined) dto.extensions = input.extensions;
    try {
      const c = await ctx.spindle.characters.create(dto, ctx.userId);
      return {
        content: JSON.stringify({
          created: { id: c.id, name: c.name },
          address_as: `char/${c.id}/<field>`,
          note: "Not in the edit ledger; delete_character is the undo.",
        }, null, 2),
      };
    } catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
  },
});
