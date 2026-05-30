import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number().optional(),
  replacement: z.boolean().optional(),
});

export const randomPickTool = defineTool({
  name: "random_pick",
  description: `Pick one or more items from a list at random. Use this whenever the user asks you to choose, pick, or randomize, models are bad at random selection on their own.

The items you pass must come from a real tool result (\`list\`, \`grep\`, \`inspect\`, \`tmp_grep\`). Don't synthesize ids or paths from memory and feed them in, you'll pick from things that don't exist. If you don't have the candidate set yet, call \`list\` first.

Returns:
- \`count\`       — how many were picked.
- \`replacement\` — whether duplicates were allowed.
- \`picks\`       — array of the chosen items, same element type you passed in. If \`items\` was \`[{path, label}, ...]\` then \`picks[0].path\` is the pick's path.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      items: { type: "array", items: {}, description: "The list to pick from. Items can be any JSON value (strings, objects, etc.); picks come back as the same element type." },
      count: { type: "number", description: "How many to pick. Default 1." },
      replacement: { type: "boolean", description: "If true, the same item can be picked more than once. Default false." },
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
