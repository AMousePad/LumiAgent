import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";

const inputSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

// Recipes call back into other tools, so the orchestrator must attach the
// full dispatch map onto ctx as `__dispatch` before invoking this tool.
type CtxWithDispatch = ToolCtx & {
  readonly __dispatch?: Record<string, (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>>;
};

export const customToolRunTool = defineTool({
  name: "custom_tool_run",
  description: "Execute a saved custom tool. The runtime substitutes params/vars into each step's args and dispatches the chain of built-in tools. Step budget is 50 calls per run; recursive custom tools are allowed up to depth 4. Returns whatever the manifest's `return` template yields, or the final step's parsed result if no `return` is set.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The custom tool's name." },
      args: { type: "object", description: "Arguments matching the tool's `params` schema." },
    },
    required: ["name"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const ct = await import("../../state/custom-tools");
    const manifest = await ct.loadCustomTool(ctx.spindle, ctx.userId, input.name);
    if (!manifest) return { content: `Error: custom tool '${input.name}' not found`, isError: true };
    const dispatch = (ctx as CtxWithDispatch).__dispatch;
    if (!dispatch) {
      return {
        content: "Error: custom_tool_run is not wired. The orchestrator must attach the full dispatch map onto ctx as '__dispatch' before invoking this tool.",
        isError: true,
      };
    }
    const passed = input.args ?? {};
    try {
      const result = await ct.runCustomTool(ctx, manifest, passed, {
        dispatch,
        depth: 1,
        deadline: Date.now() + ct.CUSTOM_TOOLS_TIMEOUT_MS,
        stepBudget: { remaining: ct.CUSTOM_TOOLS_MAX_STEPS },
      });
      return { content: JSON.stringify({ name: input.name, result }, null, 2) };
    } catch (e) {
      return { content: `Error: ${(e as Error).message}`, isError: true };
    }
  },
});
