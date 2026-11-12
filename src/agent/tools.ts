import type { ToolSchema } from "../types";
import { isDeferredTool, isReadOnlyTool, listDeferredToolNames, maxResultSizeCharsFor, registry } from "./tools/_registry";
import { formatZodError, prepareToolArgs } from "./tools/_framework";
import type { ToolCtx as SharedToolCtx, QueuedImage as SharedQueuedImage } from "./tools/_context";
import { changeApprovalPolicyFor, type ChangeImpact } from "./change-approval";
import { canonicalToolReferences, isPublicTool, isToolGroup } from './tools/_tool-groups';
import { describeHook, hookMatches, type HookRule } from "./hooks";

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
  readonly hooks?: readonly HookRule[];
  // Plan mode: any call that is not read-only is refused before it runs.
  readonly readOnlyMode?: boolean;
}

// Group calls carry the action in args, so the read-only answer depends on
// the parsed input, not just the name.
export function isReadOnlyCall(toolName: string, parsedArgs: Record<string, unknown>): boolean {
  const tool = registry.get(toolName);
  if (isToolGroup(toolName)) return Boolean(tool?.isConcurrencySafe?.(parsedArgs));
  if (tool?.isReadOnly) return Boolean(tool.isReadOnly(parsedArgs));
  return isReadOnlyTool(toolName);
}

const PLAN_MODE_ALWAYS_ALLOWED: ReadonlySet<string> = new Set(["delegate", "tool_search", "todo_write", "ask_user_question", "finish", "remember_note"]);

export function allowedInPlanMode(toolName: string): boolean {
  return PLAN_MODE_ALWAYS_ALLOWED.has(toolName) || isToolGroup(toolName) || isReadOnlyTool(toolName);
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
  return registry.schemas().filter((s) => isPublicTool(s.name) && passesCharacterGate(s.name, hasCharacter)).map(publicSchema);
}

function publicSchema(schema: ToolSchema): ToolSchema {
  return { ...schema, description: canonicalToolReferences(schema.description) };
}

// Schemas shipped in the initial tools list passed to the LLM. Excludes
// deferred tools (model fetches their schemas via tool_search on demand).
export function makeInitialToolSchemas(hasCharacter = true): ToolSchema[] {
  return makeToolSchemas(hasCharacter).filter((s) => !isDeferredTool(s.name));
}

// Lookup table of full schemas for deferred tools. runAgent uses this to
// re-issue the schemas list once tool_search announces a discovery.
export function makeDeferredToolSchemaMap(hasCharacter = true): Record<string, ToolSchema> {
  const out: Record<string, ToolSchema> = {};
  for (const name of listDeferredToolNames()) {
    if (!passesCharacterGate(name, hasCharacter)) continue;
    const s = registry.schemaFor(name);
    if (s) out[name] = publicSchema(s);
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
      const parsed = tool.inputSchema.safeParse(prepareToolArgs(tool, args));
      if (!parsed.success) {
        return { content: `Error: [INVALID_INPUT] invalid input for tool '${tool.name}':\n${formatZodError(parsed.error, tool.jsonSchema)}`, isError: true };
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
      const parsedArgs = parsed.data as Record<string, unknown>;
      if ((options.readOnlyMode === true || ctx.readOnlyMode === true) && !PLAN_MODE_ALWAYS_ALLOWED.has(tool.name) && !isReadOnlyCall(tool.name, parsedArgs)) {
        return { content: `Error: [PLAN_MODE] '${tool.name}' would change state and plan mode is on. Describe the change you would make instead, the user will switch modes to apply it.`, isError: true };
      }
      const hooks = options.hooks ?? [];
      let hookApproval: HookRule | null = null;
      for (const rule of hooks) {
        if (rule.when !== "before" || !hookMatches(rule, tool.name, parsedArgs)) continue;
        if (rule.effect === "deny") return { content: `Error: [HOOK_DENIED] ${describeHook(rule)}`, isError: true };
        if (rule.effect === "approve" && hookApproval === null) hookApproval = rule;
      }
      if (options.requireChangeApproval === true || hookApproval !== null) {
        let policy = changeApprovalPolicyFor(tool.name, parsedArgs, {
          characterId: ctx.characterId,
          pinnedChatId: ctx.pinnedChatId,
        });
        if (hookApproval !== null && policy.kind !== "required") {
          policy = { kind: "required", impact: { action: "update", severity: "change", target: JSON.stringify(parsedArgs).slice(0, 500), summary: `Hook: ${describeHook(hookApproval)}` } };
        }
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
      let content = r.content;
      if (r.isError !== true && hooks.length > 0 && tool.name !== "custom_tool_run") {
        for (const rule of hooks) {
          if (rule.when !== "after" || rule.effect !== "run" || !rule.custom_tool || !hookMatches(rule, tool.name, parsedArgs)) continue;
          const runner = dispatch["custom_tool_run"];
          if (!runner) continue;
          try {
            const hr = await runner({ name: rule.custom_tool, args: { tool: tool.name, args: parsedArgs, result: content.slice(0, 20_000) } }, ctxWithDispatch as ToolCtx);
            content = `${content}\n\n[hook ${rule.custom_tool}${hr.isError ? " FAILED" : ""}: ${hr.content.slice(0, 4000)}]`;
          } catch (err) {
            content = `${content}\n\n[hook ${rule.custom_tool} FAILED: ${(err as Error).message}]`;
          }
        }
      }
      return r.isError === true ? { content, isError: true } : { content };
    };
  }
  return dispatch;
}
