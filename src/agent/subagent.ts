import type { GenerationReasoningOverrideDTO } from "lumiverse-spindle-types";
import type { LlmMessage, SubagentProgressEvent, ToolCall, ToolResult, ToolSchema } from "../types";
import { encodeAssistantTurn, encodeToolResults, coalesceConsecutiveTurns } from "./protocol";
import { runLlmStream } from "./llm";
import { canRetryModelError } from "./retry";
import { systemMessageWithCache, withRollingCacheBreakpoint, type CacheMode } from "./cache-control";
import { LoopDetector } from "./loop-detector";
import { prepareToolArgs } from "./tools/_framework";
import { spillOrReturn } from "./tools/_io";
import type { ToolCtx, ToolFn } from "./tools";
import { isReadOnlyTool, registry } from "./tools/_registry";

// Child loop for delegated work. Runs on the PARENT's ToolCtx so every edit,
// revert and recent read is attributed to the delegate call (same contract as
// custom_tool_run). No compaction, no text-form fallback: a subagent that
// drifts just ends with a status the parent can act on.
export interface SubagentRunOptions {
  readonly ctx: ToolCtx;
  readonly dispatch: Record<string, ToolFn>;
  readonly systemPrompt: string;
  readonly contextNote: string;
  readonly task: string;
  readonly tools: readonly ToolSchema[];
  // Deferred schemas tool_search may discover mid-run, already profile-filtered.
  readonly discoverable: Readonly<Record<string, ToolSchema>>;
  // Null when the call may run, otherwise the reason it is refused.
  readonly allowCall: (name: string, args: Record<string, unknown>) => string | null;
  readonly maxTurns: number;
  readonly maxTimeMs: number;
  readonly connectionId?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly reasoning?: GenerationReasoningOverrideDTO | undefined;
  readonly cacheMode: CacheMode;
  readonly onProgress?: ((ev: SubagentProgressEvent) => void) | undefined;
}

export type SubagentStatus = "completed" | "max_turns" | "timeout" | "cancelled" | "loop_detected" | "error";

export interface SubagentOutcome {
  readonly status: SubagentStatus;
  readonly result: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly usage: { prompt: number; completion: number; total: number };
  readonly error?: string | undefined;
}

const PARALLEL = 4;
const LLM_RETRIES = 2;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(t); resolve(); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = ["path", "pattern", "query", "action", "chat_id", "name", "handle", "task"];
  const parts: string[] = [];
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) parts.push(`${k}=${v.length > 60 ? `${v.slice(0, 57)}...` : v}`);
  }
  if (parts.length === 0) {
    let s: string;
    try { s = JSON.stringify(args); } catch { s = "{}"; }
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  }
  return parts.join(" ");
}

// tool_search answers from the full registry. Strip schemas the profile cannot
// call and say so, or the model re-searches for a tool it will never get.
function filterToolSearchResult(content: string, allowCall: SubagentRunOptions["allowCall"]): string {
  const blocked: string[] = [];
  const filtered = content.replace(/<function>(\{[\s\S]*?\})<\/function>\n?/g, (whole, json: string) => {
    try {
      const name = (JSON.parse(json) as { name?: unknown }).name;
      if (typeof name === "string" && allowCall(name, {}) !== null) { blocked.push(name); return ""; }
    } catch { /* keep unparseable blocks */ }
    return whole;
  });
  if (blocked.length === 0) return content;
  return `${filtered.trim()}\n\nNot available to this subagent (do not search for them again): ${blocked.join(", ")}. Finish with what you can do, or report that the main assistant must run them.`;
}

function isConcurrencySafeCall(name: string, args: Record<string, unknown>): boolean {
  const tool = registry.get(name.trim());
  if (tool) {
    const prepared = prepareToolArgs(tool, args) as Record<string, unknown>;
    const flag = tool.isConcurrencySafe?.(prepared) ?? tool.isReadOnly?.(prepared);
    if (flag !== undefined) return Boolean(flag);
  }
  return isReadOnlyTool(name);
}

export async function runSubagent(opts: SubagentRunOptions): Promise<SubagentOutcome> {
  const { ctx, dispatch } = opts;
  const signal = ctx.signal;
  const deadline = Date.now() + opts.maxTimeMs;
  const usage = { prompt: 0, completion: 0, total: 0 };
  let toolCallCount = 0;
  let finishedSummary: string | undefined;
  const discovered = new Set<string>();
  const detector = new LoopDetector({ maxRepetitions: 3, loopDetectionWindow: 4 });

  // Strip delegation so a child cannot delegate, and keep finish local.
  const { delegation: _delegation, ...parentRest } = ctx as ToolCtx & { delegation?: unknown };
  const childCtx: ToolCtx = {
    ...(parentRest as ToolCtx),
    setFinished: (s) => { finishedSummary = s; },
    invocationPath: [...(ctx.invocationPath ?? []), "delegate"],
    discoverTools: (names) => { for (const n of names) if (opts.discoverable[n]) discovered.add(n); },
  };

  const conv: LlmMessage[] = [systemMessageWithCache(opts.systemPrompt, opts.cacheMode)];
  if (opts.contextNote.trim().length > 0) conv.push({ role: "user", content: opts.contextNote });
  conv.push({ role: "user", content: opts.task });

  const callModel = async (tools: readonly ToolSchema[]): Promise<{ content: string; toolCalls: readonly ToolCall[]; finish: string; reasoning?: string | undefined }> => {
    let attempt = 0;
    for (;;) {
      try {
        let content = "";
        let toolCalls: readonly ToolCall[] = [];
        let finish = "";
        let reasoning: string | undefined;
        let sawDone = false;
        for await (const ev of runLlmStream(ctx.spindle, {
          messages: withRollingCacheBreakpoint(coalesceConsecutiveTurns(conv), opts.cacheMode),
          tools,
          ...(opts.connectionId !== undefined ? { connectionId: opts.connectionId } : {}),
          ...(opts.parameters !== undefined ? { parameters: opts.parameters } : {}),
          ...(opts.reasoning !== undefined ? { reasoning: opts.reasoning } : {}),
          userId: ctx.userId,
          signal,
        })) {
          if (ev.type !== "done") continue;
          sawDone = true;
          content = ev.response.content;
          toolCalls = ev.response.tool_calls;
          finish = ev.response.finish_reason;
          reasoning = ev.response.reasoning;
          if (ev.response.usage) {
            usage.prompt += ev.response.usage.prompt;
            usage.completion += ev.response.usage.completion;
            usage.total += ev.response.usage.total;
          }
        }
        if (!sawDone) throw new Error("The model connection closed before the response finished.");
        if (!content.trim() && toolCalls.length === 0 && !["max_tokens", "content_filter", "safety"].includes(finish)) {
          throw new Error("The model returned an empty response.");
        }
        return { content, toolCalls, finish, reasoning };
      } catch (err) {
        if (signal.aborted || attempt >= LLM_RETRIES || !canRetryModelError(err)) throw err;
        attempt++;
        await sleep(1000 * attempt, signal);
      }
    }
  };

  const toolsForTurn = (): ToolSchema[] => {
    if (discovered.size === 0) return [...opts.tools];
    const extra: ToolSchema[] = [];
    for (const n of discovered) { const s = opts.discoverable[n]; if (s && !opts.tools.some((t) => t.name === n)) extra.push(s); }
    return [...opts.tools, ...extra];
  };

  const executeOne = async (tc: ToolCall): Promise<ToolResult> => {
    toolCallCount++;
    const args = (tc.args && typeof tc.args === "object" ? tc.args : {}) as Record<string, unknown>;
    const name = tc.name.trim();
    if ((args as { _incomplete?: unknown })._incomplete === true) {
      return { call_id: tc.call_id, name: tc.name, content: `Error: tool call '${name}' arrived with truncated arguments. Split the call into smaller pieces and retry.`, is_error: true };
    }
    if (name === "finish") {
      const summary = typeof args["summary"] === "string" ? args["summary"] : "";
      finishedSummary = summary;
      return { call_id: tc.call_id, name: tc.name, content: "OK. Task marked complete." };
    }
    const refused = opts.allowCall(name, args);
    if (refused !== null) return { call_id: tc.call_id, name: tc.name, content: `Error: [SUBAGENT_TOOL_REFUSED] ${refused}`, is_error: true };
    const fn = dispatch[name];
    if (!fn) return { call_id: tc.call_id, name: tc.name, content: `Error: unknown tool '${name}'.`, is_error: true };
    opts.onProgress?.({ type: "tool_started", id: tc.call_id, name, summary: summarizeArgs(args) });
    let content: string;
    let isError = false;
    try {
      const r = await fn(args, childCtx);
      content = r.content;
      isError = r.isError === true;
    } catch (err) {
      content = `Error: ${(err as Error).message}`;
      isError = true;
    }
    if (!isError && name === "tool_search") content = filterToolSearchResult(content, opts.allowCall);
    if (!isError) {
      try { content = await spillOrReturn(ctx, content, `subagent:${name}`); }
      catch { /* keep the full text */ }
    }
    opts.onProgress?.({ type: "tool_finished", id: tc.call_id, ok: !isError });
    return { call_id: tc.call_id, name: tc.name, content, ...(isError ? { is_error: true } : {}) };
  };

  let turns = 0;
  let lastContent = "";
  const done = (status: SubagentStatus, result: string, error?: string): SubagentOutcome => {
    opts.onProgress?.({ type: "done", status, turns });
    return { status, result, turns, toolCalls: toolCallCount, usage, ...(error !== undefined ? { error } : {}) };
  };

  try {
    while (turns < opts.maxTurns) {
      if (signal.aborted) return done("cancelled", lastContent);
      if (Date.now() > deadline) return done("timeout", lastContent, `time limit of ${Math.round(opts.maxTimeMs / 60_000)} minutes reached`);
      turns++;
      opts.onProgress?.({ type: "turn", turn: turns });
      const r = await callModel(toolsForTurn());
      if (r.content.trim().length > 0) lastContent = r.content;
      conv.push(encodeAssistantTurn(r.content, r.toolCalls, r.reasoning));
      if (r.toolCalls.length === 0) {
        if (r.finish === "max_tokens") return done("error", lastContent, "response truncated at max_tokens");
        const loop = detector.recordText(r.content);
        if (loop) return done("loop_detected", lastContent, loop.detail);
        return done("completed", r.content);
      }
      // Batches mirror the parent loop: consecutive concurrency-safe calls run together.
      const results: ToolResult[] = [];
      let i = 0;
      while (i < r.toolCalls.length) {
        const first = r.toolCalls[i]!;
        const batch: ToolCall[] = [first];
        i++;
        if (isConcurrencySafeCall(first.name, first.args as Record<string, unknown>)) {
          while (i < r.toolCalls.length && isConcurrencySafeCall(r.toolCalls[i]!.name, r.toolCalls[i]!.args as Record<string, unknown>)) { batch.push(r.toolCalls[i]!); i++; }
        }
        if (batch.length === 1) { results.push(await executeOne(batch[0]!)); continue; }
        const out = new Array<ToolResult>(batch.length);
        let next = 0;
        const worker = async (): Promise<void> => {
          for (;;) { const idx = next++; if (idx >= batch.length) return; out[idx] = await executeOne(batch[idx]!); }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, worker));
        results.push(...out);
      }
      conv.push(encodeToolResults(results));
      if (finishedSummary !== undefined) return done("completed", finishedSummary);
      if (signal.aborted) return done("cancelled", lastContent);
      const loop = detector.recordToolCalls(r.toolCalls.map((tc) => ({ name: tc.name, input: tc.args })));
      if (loop) return done("loop_detected", lastContent, loop.detail);
      if (results.some((x) => !x.is_error)) detector.noteProgress();
    }
    // Grace turn, no tools: the model must report with what it has.
    conv.push({ role: "user", content: `[Turn limit of ${opts.maxTurns} reached. No more tool calls are possible. Reply now with your final report: what you verified, what you changed, and what remains unfinished.]` });
    const final = await callModel([]);
    return done("max_turns", final.content.trim().length > 0 ? final.content : lastContent);
  } catch (err) {
    if (signal.aborted) return done("cancelled", lastContent);
    return done("error", lastContent, (err as Error).message);
  }
}
