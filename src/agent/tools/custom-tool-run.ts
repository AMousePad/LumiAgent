import { z } from "zod";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { CustomToolManifest } from "../../state/custom-tools";
import description from "../prompts/claude/tools/custom-tool-run/description.txt";
import argName from "../prompts/claude/tools/custom-tool-run/arg_name.txt";
import argSteps from "../prompts/claude/tools/custom-tool-run/arg_steps.txt";
import argStepsCall from "../prompts/claude/tools/custom-tool-run/arg_steps__call.txt";
import argStepsArgs from "../prompts/claude/tools/custom-tool-run/arg_steps__args.txt";
import argStepsSaveAs from "../prompts/claude/tools/custom-tool-run/arg_steps__save_as.txt";
import argReturn from "../prompts/claude/tools/custom-tool-run/arg_return.txt";
import argArgs from "../prompts/claude/tools/custom-tool-run/arg_args.txt";

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
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: argName },
      steps: {
        type: "array",
        description: argSteps,
        items: {
          type: "object",
          properties: {
            call: { type: "string", description: argStepsCall },
            args: { type: "object", description: argStepsArgs },
            save_as: { type: "string", description: argStepsSaveAs },
          },
          required: ["call"],
        },
      },
      return: { description: argReturn },
      args: { type: "object", description: argArgs },
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
