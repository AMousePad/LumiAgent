import type { ToolSchema } from "../types";
import { isDeferredTool, isReadOnlyTool, listDeferredToolNames, maxResultSizeCharsFor, registry } from "./tools/_registry";
import { formatZodError } from "./tools/_framework";
import type { ToolCtx as SharedToolCtx, QueuedImage as SharedQueuedImage } from "./tools/_context";
import { changeApprovalPolicyFor, type ChangeImpact } from "./change-approval";

export type ToolCtx = SharedToolCtx;
export type QueuedImage = SharedQueuedImage;
export { RecentReadsCache } from "./tools/_context";
export { isDeferredTool, isReadOnlyTool, listDeferredToolNames, maxResultSizeCharsFor } from "./tools/_registry";

export interface ToolDispatchResult {
  readonly content: string;
  readonly isError?: boolean;
}
export type ToolFn = (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolDispatchResult>;

export interface ToolApprovalRequest {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly impact: ChangeImpact;
  readonly sessionId: string;
  readonly assistantMessageId: string;
  readonly rootCallId: string | null;
  readonly invocationPath: readonly string[];
}

export type ToolApprovalDecision =
  | { readonly kind: "approved" }
  | { readonly kind: "rejected" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ToolDispatchOptions {
  readonly requireChangeApproval?: boolean;
  readonly requestApproval?: (request: ToolApprovalRequest, signal: AbortSignal) => Promise<ToolApprovalDecision>;
}

// In no-character sessions, drop tools whose execution is character-bound so
// the LLM physically cannot call them. Keeps the system-prompt one-liner the
// sole place the agent needs to learn what to say to the user about it.
function passesCharacterGate(name: string, hasCharacter: boolean): boolean {
  return hasCharacter || !registry.requiresCharacter(name);
}

// True when the tool requires an active character to function. Exposed so
// callers (notably system-prompt assembly) can filter deferred-tool listings
// in no-character sessions.
export function toolRequiresCharacter(name: string): boolean {
  return registry.requiresCharacter(name);
}

export function makeToolSchemas(hasCharacter = true): ToolSchema[] {
  return registry.schemas().filter((s) => passesCharacterGate(s.name, hasCharacter));
}

// Schemas shipped in the initial tools list passed to the LLM. Excludes
// deferred tools (model fetches their schemas via tool_search on demand).
export function makeInitialToolSchemas(hasCharacter = true): ToolSchema[] {
  return registry.schemas().filter((s) => !isDeferredTool(s.name) && passesCharacterGate(s.name, hasCharacter));
}

// Lookup table of full schemas for deferred tools. runAgent uses this to
// re-issue the schemas list once tool_search announces a discovery.
export function makeDeferredToolSchemaMap(hasCharacter = true): Record<string, ToolSchema> {
  const out: Record<string, ToolSchema> = {};
  for (const name of listDeferredToolNames()) {
    if (!passesCharacterGate(name, hasCharacter)) continue;
    const s = registry.schemaFor(name);
    if (s) out[name] = s;
  }
  return out;
}

function cloneApprovalArgs(args: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return structuredClone(args);
}

function deniedResult(decision: Exclude<ToolApprovalDecision, { readonly kind: "approved" }>): ToolDispatchResult {
  if (decision.kind === "rejected") {
    return { content: "Error: [APPROVAL_REJECTED] The user rejected this change. No change was made. Do not retry unless the user asks.", isError: true };
  }
  if (decision.kind === "cancelled") {
    return { content: "Error: [APPROVAL_CANCELLED] Approval was cancelled. No change was made.", isError: true };
  }
  return { content: `Error: [APPROVAL_UNAVAILABLE] ${decision.reason}. No change was made.`, isError: true };
}

export function makeToolDispatch(options: ToolDispatchOptions = {}): Record<string, ToolFn> {
  const dispatch: Record<string, ToolFn> = {};
  for (const tool of registry.list()) {
    dispatch[tool.name] = async (args, ctx) => {
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        return { content: `Error: [INVALID_INPUT] invalid input for tool '${tool.name}':\n${formatZodError(parsed.error)}`, isError: true };
      }
      const invocationPath = [...(ctx.invocationPath ?? []), tool.name];
      const ctxWithDispatch = {
        ...ctx,
        __dispatch: dispatch,
        invocationPath,
      };
      if (tool.validateInput) {
        const v = await tool.validateInput(parsed.data, ctxWithDispatch as ToolCtx);
        if (!v.result) return { content: `Error: [${v.errorCode}] ${v.message}`, isError: true };
      }
      if (options.requireChangeApproval === true) {
        const policy = changeApprovalPolicyFor(tool.name, parsed.data as Record<string, unknown>, {
          characterId: ctx.characterId,
          pinnedChatId: ctx.pinnedChatId,
        });
        if (policy.kind === "required") {
          if (ctx.signal.aborted) return deniedResult({ kind: "cancelled" });
          if (!options.requestApproval) {
            return deniedResult({ kind: "unavailable", reason: "No approval handler is available" });
          }
          let decision: ToolApprovalDecision;
          try {
            decision = await options.requestApproval({
              toolName: tool.name,
              args: cloneApprovalArgs(parsed.data as Record<string, unknown>),
              impact: policy.impact,
              sessionId: ctx.sessionId,
              assistantMessageId: ctx.assistantMessageId,
              rootCallId: ctx.rootCallId ?? null,
              invocationPath,
            }, ctx.signal);
          } catch (err) {
            decision = ctx.signal.aborted
              ? { kind: "cancelled" }
              : { kind: "unavailable", reason: (err as Error).message || "Approval failed" };
          }
          if (!decision || !["approved", "rejected", "cancelled", "unavailable"].includes(decision.kind)) {
            decision = { kind: "unavailable", reason: "The approval handler returned an invalid decision" };
          }
          if (decision.kind !== "approved") return deniedResult(decision);
          if (ctx.signal.aborted) return deniedResult({ kind: "cancelled" });
          // State may have changed while the modal was open. Re-run the
          // side-effect-free preflight immediately before execution.
          if (tool.validateInput) {
            const v = await tool.validateInput(parsed.data, ctxWithDispatch as ToolCtx);
            if (!v.result) return { content: `Error: [${v.errorCode}] ${v.message}`, isError: true };
          }
        }
      }
      // Surface the tool's isError flag to the caller so the loop can stamp
      // is_error: true on the wire tool_result. Anthropic uses that signal to
      // decide whether to retry / recover; without it, coded errors look like
      // successful results and the model silently moves on.
      const r = await tool.execute(parsed.data, ctxWithDispatch as ToolCtx);
      return r.isError === true ? { content: r.content, isError: true } : { content: r.content };
    };
  }
  return dispatch;
}
