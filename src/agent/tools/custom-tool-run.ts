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
type CtxWithDispatch = ToolCtx & {
  readonly __dispatch?: Record<string, (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>>;
};

export const customToolRunTool = defineTool({
  name: "custom_tool_run",
  description: `Run multiple built-in tool calls in one turn. Two patterns:

CHAIN (pipe outputs forward): step N saves its result with \`save_as\`, step N+1 references it via \`{{$var}}\`.
FAN-OUT (gather independent calls): each step \`save_as\`s its result; the runtime returns ALL saved bindings as one object.

Use this whenever you'd otherwise call tool A, copy a value into tool B (chain) OR call several tools whose results you all want (fan-out). The intermediate results live in the interpreter, never round-trip through your tool_result stream, never get re-typed.

Reference syntax inside step args (and inside an optional \`return\`):
  "{{$body}}"             — whole-string ref returns the raw value (array/object/etc.)
  "prefix {{$body}} end"  — embedded ref coerces to string
  "{{$pick.picks[0].id}}" — dotted path + bracket index

Chain example: pick a random world-book entry and read it.
  custom_tool_run({
    steps: [
      { call: "list",        args: { path: "wb/<bookId>" }, save_as: "entries" },
      { call: "random_pick", args: { items: "{{$entries.entries}}" }, save_as: "pick" },
      { call: "read",        args: { path: "{{$pick.picks[0].path}}/content" } }
    ]
  })
Returns the final \`read\` result (only the last step's value, since only the final step has nothing depending on it — but you can still \`save_as\` it if you want it explicitly named).

Fan-out example: gather every editable surface inventory at once.
  custom_tool_run({
    steps: [
      { call: "list",          args: { path: "wb" },              save_as: "world_books" },
      { call: "inspect",       args: { path: "rx" },              save_as: "regex_scripts" },
      { call: "list",          args: { path: "char/extensions" }, save_as: "extensions" },
      { call: "list_external", args: { surface_id: "module_envelope" }, save_as: "modules" }
    ]
  })
Returns \`{world_books, regex_scripts, extensions, modules}\` because every step has a \`save_as\` and no \`return\` is specified.

Return rules:
- \`return\` is explicit  → that's the result (templates allowed).
- No \`return\`, any \`save_as\`s → object of all saved bindings.
- No \`return\`, no \`save_as\` → just the final step's parsed result.

Budget: 50 steps / depth 4 / 60s wall-clock.

(The \`name\` form runs a saved recipe; default to inline \`steps\` for any one-off chain or fan-out.)`,
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
    try {
      const result = await ct.runCustomTool(ctx, manifest, passed, {
        dispatch,
        depth: 1,
        deadline: Date.now() + ct.CUSTOM_TOOLS_TIMEOUT_MS,
        stepBudget: { remaining: ct.CUSTOM_TOOLS_MAX_STEPS },
      });
      return { content: JSON.stringify({ mode, name: manifest.name, result }, null, 2) };
    } catch (e) {
      return { content: `Error: ${(e as Error).message}`, isError: true };
    }
  },
});
