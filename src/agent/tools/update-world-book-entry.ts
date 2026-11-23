import { z } from "zod";
import { defineTool } from "./_framework";
import { updateWorldBookEntries, WB_LOGIC_ENUM, WB_POSITION_ENUM } from "./_worldbook";
import description from "../prompts/claude/tools/update-world-book-entry/description.txt";

const inputSchema = z.object({
  entry_id: z.string().optional(),
  entry_ids: z.array(z.string()).optional(),
  book_id: z.string().optional(),
  query: z.string().optional(),
  where: z.record(z.string(), z.unknown()).optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
  clear: z.array(z.string()).optional(),
});

const bool = { type: "boolean" };
const int = { type: "integer" };

export const updateWorldBookEntryTool = defineTool({
  name: "update_world_book_entry",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string", description: "One entry to patch." },
      entry_ids: { type: "array", items: { type: "string" }, description: "Several entries to patch with the same patch." },
      book_id: { type: "string", description: "Book id or name. Patches every entry in it, or only those selected by query and where." },
      query: { type: "string", description: "With book_id: keep entries whose comment, keys, secondary keys or content contain this text, case-insensitive." },
      where: {
        type: "object",
        description: "With book_id: keep entries whose flags equal these values.",
        properties: { constant: bool, disabled: bool, selective: bool, vectorized: bool },
      },
      patch: {
        type: "object",
        description: "Only the fields to change. key and keysecondary replace the whole list, so include the keys to keep.",
        properties: {
          key: { type: "array", items: { type: "string" } },
          keysecondary: { type: "array", items: { type: "string" } },
          content: { type: "string" },
          comment: { type: "string", description: "The entry title." },
          constant: bool,
          disabled: bool,
          selective: bool,
          selective_logic: { type: "integer", description: WB_LOGIC_ENUM },
          position: { type: "integer", description: WB_POSITION_ENUM },
          depth: int,
          role: { type: "string", enum: ["system", "user", "assistant"] },
          order_value: int,
          priority: int,
          probability: int,
          use_probability: bool,
          scan_depth: int,
          case_sensitive: bool,
          match_whole_words: bool,
          use_regex: bool,
          group_name: { type: "string" },
          group_override: bool,
          group_weight: int,
          sticky: int,
          cooldown: int,
          delay: int,
          prevent_recursion: bool,
          exclude_recursion: bool,
          delay_until_recursion: bool,
          vectorized: bool,
          automation_id: { type: "string" },
        },
      },
      clear: {
        type: "array",
        items: { type: "string" },
        description: "Fields to empty: keysecondary, comment, group_name (leaves its group), role, scan_depth (back to the global scan depth), automation_id. An empty value in patch never clears.",
      },
    },
    required: ["patch"],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    try { return await updateWorldBookEntries(ctx, input); }
    catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
  },
});
