import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { CustomToolManifest } from "../../state/custom-tools";

// Two modes:
// - Named: `name` references a saved recipe under workspace/custom_tools/.
// - Inline: `steps` (and optional `return`) execute a one-off pipe without
//   touching disk. Output of step N becomes input to step N+1 via
//   `save_as` + `{{$var}}` substitution, the same interpreter the saved
//   path uses. Lets the model chain calls instead of round-tripping each
//   tool result through the LLM only to re-emit the same bytes.
const inputSchema = z.object({
  name: z.string().min(1).optional(),
  steps: z.array(z.object({
    call: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
    save_as: z.string().min(1).optional(),
  })).optional(),
  return: z.unknown().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
}).refine((d) => (d.name !== undefined) !== (d.steps !== undefined), {
  message: "provide exactly one of `name` (saved recipe) or `steps` (inline pipe)",
});

// Recipes call back into other tools, so the orchestrator must attach the
// full dispatch map onto ctx as `__dispatch` before invoking this tool.
// runCustomTool stamps the active depth/deadline/budget onto the step ctx so
// a nested custom_tool_run invocation inherits them; without that thread the
// CUSTOM_TOOLS_MAX_DEPTH check is dead code (each re-entry resets depth to 1
// and rearms a fresh 60s deadline + step budget) and a recipe that calls
// itself recurses until JS stack exhaustion.
type CtxWithDispatch = ToolCtx & {
  readonly __dispatch?: Record<string, (args: Record<string, unknown>, ctx: ToolCtx) => Promise<{ content: string; isError?: boolean }>>;
  readonly __customToolDepth?: number;
  readonly __customToolDeadline?: number;
  readonly __customToolStepBudget?: { remaining: number };
};

export const customToolRunTool = defineTool({
  name: "custom_tool_run",
  description: `Run multiple built-in tool calls in one turn (worked examples in the system prompt's "Piping tool calls" section).
- Chain: step N saves with \`save_as\`, step N+1 references via \`{{$var}}\`.
- Fan-out: each step \`save_as\`s; the runtime returns all bindings as one object.
Use whenever you'd call tool A then feed its value into tool B, or call several tools whose results you all want — the intermediates stay in the interpreter, never round-trip through your tool_result stream.

Ref syntax in step args / optional \`return\`: \`{{$body}}\` (raw value), \`prefix {{$body}} end\` (coerced string), \`{{$pick.picks[0].id}}\` (dotted path + index).
Returns: explicit \`return\` → that; else any \`save_as\` → object of all bindings; else the final step's result.
Budget: 400 steps / depth 4 / 60s. The \`name\` form runs a saved recipe; default to inline \`steps\`.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Saved recipe name (named mode)." },
      steps: {
        type: "array",
        description: "Inline pipe (inline mode). Each step calls one built-in tool; `save_as` binds the parsed result to a name later steps can reference via {{$name}}.",
        items: {
          type: "object",
          properties: {
            call: { type: "string", description: "Built-in tool name to invoke." },
            args: { type: "object", description: "Args for that tool; values may contain {{$var}} refs." },
            save_as: { type: "string", description: "Variable name for downstream steps." },
          },
          required: ["call"],
        },
      },
      return: { description: "Optional return template. Same {{$var}} syntax. Omit to return the last step's result." },
      args: { type: "object", description: "Named-mode only: args matching the saved recipe's `params` schema." },
    },
  },
  execute: async (input, ctx) => {
    const ct = await import("../../state/custom-tools");
    const dispatch = (ctx as CtxWithDispatch).__dispatch;
    if (!dispatch) {
      return {
        content: "Error: custom_tool_run is not wired. The orchestrator must attach the full dispatch map onto ctx as '__dispatch' before invoking this tool.",
        isError: true,
      };
    }

    let manifest: CustomToolManifest;
    let mode: "named" | "inline";
    if (input.name !== undefined) {
      mode = "named";
      const loaded = await ct.loadCustomTool(ctx.spindle, ctx.userId, input.name);
      if (!loaded) return { content: `Error: custom tool '${input.name}' not found`, isError: true };
      manifest = loaded;
    } else {
      mode = "inline";
      // Synthesize a manifest. `name`/`description`/`params` are required by
      // validateManifest; populate sane defaults since none of them affect
      // the interpreter beyond identity reporting and param coercion.
      const synthetic = {
        name: "inline_pipe",
        description: "inline pipe (one-off chain)",
        params: {},
        steps: input.steps,
        ...(input.return !== undefined ? { return: input.return } : {}),
      };
      try { manifest = ct.validateManifest(synthetic); }
      catch (e) { return { content: `Error: inline manifest invalid: ${(e as Error).message}`, isError: true }; }
    }

    const passed = input.args ?? {};
    // Inherit depth/deadline/budget from an outer custom_tool_run frame so
    // CUSTOM_TOOLS_MAX_DEPTH actually fires and nested calls share the parent's
    // 60s budget instead of rearming it.
    const parentDepth = (ctx as CtxWithDispatch).__customToolDepth ?? 0;
    const parentDeadline = (ctx as CtxWithDispatch).__customToolDeadline;
    const parentBudget = (ctx as CtxWithDispatch).__customToolStepBudget;
    try {
      const result = await ct.runCustomTool(ctx, manifest, passed, {
        dispatch,
        depth: parentDepth + 1,
        deadline: parentDeadline ?? Date.now() + ct.CUSTOM_TOOLS_TIMEOUT_MS,
        stepBudget: parentBudget ?? { remaining: ct.CUSTOM_TOOLS_MAX_STEPS },
      });
      return { content: JSON.stringify({ mode, name: manifest.name, result }, null, 2) };
    } catch (e) {
      return { content: `Error: ${(e as Error).message}`, isError: true };
    }
  },
});
