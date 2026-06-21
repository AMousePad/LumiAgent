import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/random-pick/description.txt";
import argItems from "../prompts/claude/tools/random-pick/arg_items.txt";
import argCount from "../prompts/claude/tools/random-pick/arg_count.txt";
import argReplacement from "../prompts/claude/tools/random-pick/arg_replacement.txt";

const inputSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number().optional(),
  replacement: z.boolean().optional(),
});

export const randomPickTool = defineTool({
  name: "random_pick",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      items: { type: "array", items: {}, description: argItems },
      count: { type: "number", description: argCount },
      replacement: { type: "boolean", description: argReplacement },
    },
    required: ["items"],
  },
  execute: async (input) => {
    const items = input.items;
    if (items.length === 0) return { content: "Error: 'items' is empty", isError: true };
    const count = Math.max(1, Math.floor(input.count ?? 1));
    const withReplacement = input.replacement ?? false;
    if (!withReplacement && count > items.length) {
      return { content: `Error: count ${count} exceeds items length ${items.length} (set replacement=true to allow duplicates)`, isError: true };
    }
    const picks: unknown[] = [];
    if (withReplacement) {
      for (let i = 0; i < count; i++) picks.push(items[Math.floor(Math.random() * items.length)]);
    } else {
      const pool = [...items];
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        picks.push(pool[idx]);
        pool.splice(idx, 1);
      }
    }
    return { content: JSON.stringify({ count, replacement: withReplacement, picks }, null, 2) };
  },
});
