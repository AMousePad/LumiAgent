import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/roll-dice/description.txt";
import argSpec from "../prompts/claude/tools/roll-dice/arg_spec.txt";

const inputSchema = z.object({
  spec: z.string().min(1),
});

export const rollDiceTool = defineTool({
  name: "roll_dice",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { spec: { type: "string", description: argSpec } },
    required: ["spec"],
  },
  execute: async (input) => {
    const spec = input.spec.trim().toLowerCase();
    const m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(spec);
    if (!m) return { content: `Error: bad spec '${spec}'. Format: NdM or NdM+K / NdM-K (e.g. 3d6, 1d20+4).`, isError: true };
    const n = parseInt(m[1]!, 10);
    const sides = parseInt(m[2]!, 10);
    const mod = m[3] ? parseInt(m[3]!.replace(/\s+/g, ""), 10) : 0;
    if (n <= 0 || n > 1000) return { content: "Error: dice count must be 1..1000", isError: true };
    if (sides <= 0 || sides > 10000) return { content: "Error: die sides must be 1..10000", isError: true };
    const rolls: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const r = 1 + Math.floor(Math.random() * sides);
      rolls.push(r);
      sum += r;
    }
    return { content: JSON.stringify({ spec, rolls, modifier: mod, total: sum + mod }, null, 2) };
  },
});
