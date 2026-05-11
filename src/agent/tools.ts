import type { ToolSchema } from "../types";
import { isDeferredTool, isReadOnlyTool, listDeferredToolNames, maxResultSizeCharsFor, registry } from "./tools/_registry";
import { formatZodError } from "./tools/_framework";
import type { ToolCtx as SharedToolCtx } from "./tools/_context";

export type ToolCtx = SharedToolCtx;
export { RecentReadsCache } from "./tools/_context";
export { isDeferredTool, isReadOnlyTool, listDeferredToolNames, maxResultSizeCharsFor } from "./tools/_registry";

export type ToolFn = (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;

export function makeToolSchemas(): ToolSchema[] {
  return registry.schemas();
}

// Schemas shipped in the initial tools list passed to the LLM. Excludes
// deferred tools (model fetches their schemas via tool_search on demand).
export function makeInitialToolSchemas(): ToolSchema[] {
  return registry.schemas().filter((s) => !isDeferredTool(s.name));
}

// Lookup table of full schemas for deferred tools. runAgent uses this to
// re-issue the schemas list once tool_search announces a discovery.
export function makeDeferredToolSchemaMap(): Record<string, ToolSchema> {
  const out: Record<string, ToolSchema> = {};
  for (const name of listDeferredToolNames()) {
    const s = registry.schemaFor(name);
    if (s) out[name] = s;
  }
  return out;
}

export function makeToolDispatch(): Record<string, ToolFn> {
  const dispatch: Record<string, ToolFn> = {};
  for (const tool of registry.list()) {
    dispatch[tool.name] = async (args, ctx) => {
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: [INVALID_INPUT] invalid input for tool '${tool.name}':\n${formatZodError(parsed.error)}`;
      }
      const ctxWithDispatch = { ...ctx, __dispatch: dispatch };
      if (tool.validateInput) {
        const v = await tool.validateInput(parsed.data, ctxWithDispatch as ToolCtx);
        if (!v.result) return `Error: [${v.errorCode}] ${v.message}`;
      }
      const r = await tool.execute(parsed.data, ctxWithDispatch as ToolCtx);
      return r.content;
    };
  }
  return dispatch;
}
