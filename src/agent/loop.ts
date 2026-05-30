import type { SpindleAPI } from "lumiverse-spindle-types";
import type {
  AgentEvent,
  EditLogEntry,
  EditRecord,
  LlmMessage,
  LlmMessagePart,
  RevertOutcomeWire,
  ToolCall,
  ToolResult,
  ToolSchema,
} from "../types";
import { encodeAssistantTurn, encodeToolResults, coalesceConsecutiveTurns } from "./protocol";
import { runLlmStream } from "./llm";
import { withRollingCacheBreakpoint } from "./cache-control";
import { LoopDetector } from "./loop-detector";
import { newEditEntry } from "../state/edit-log";
import { dlog } from "../log";
import { characterScope } from "../types";
import { writeTmp } from "../state/tmp-store";
import { isReadOnlyTool, maxResultSizeCharsFor, RecentReadsCache, type ToolCtx, type ToolFn } from "./tools";

const PARALLEL_TOOL_CONCURRENCY = 5;
const SPILL_ENVELOPE_SENTINEL = "{\n  \"spilled\": true";

interface SpillCapInfo {
  readonly unit: "chars" | "tokens";
  readonly limit: number;
  // total volume in the chosen unit. Tokens path passes the counted result;
  // chars path passes the stored info.totalChars.
  readonly observed: number;
}

async function spillToolResult(
  spindle: SpindleAPI,
  sessionId: string,
  userId: string,
  toolName: string,
  resultText: string,
  cap: SpillCapInfo,
): Promise<string> {
  const info = await writeTmp(spindle, sessionId, userId, resultText, `tool:${toolName}`);
  // Peek budget tracks the cap so spills from tiny tools stay tiny too.
  const peekTarget = cap.unit === "tokens"
    ? Math.floor(cap.limit * 3 * 0.1)
    : Math.floor(cap.limit * 0.1);
  const peek = resultText.slice(0, Math.min(800, peekTarget));
  const envelope: Record<string, unknown> = {
    spilled: true,
    tmp_handle: info.handle,
    origin: `tool:${toolName}`,
    total_chars: info.totalChars,
    total_lines: info.totalLines,
    peek_chars: peek.length,
    peek,
    note: `Output was ${cap.observed} ${cap.unit}, over the ${cap.limit}-${cap.unit} cap. Saved to tmp handle '${info.handle}'. Use tmp_grep / tmp_read / tmp_stat to inspect specific parts without dumping it all into context.`,
  };
  if (cap.unit === "tokens") {
    envelope["total_tokens"] = cap.observed;
    envelope["cap_tokens"] = cap.limit;
  } else {
    envelope["cap_chars"] = cap.limit;
  }
  return JSON.stringify(envelope, null, 2);
}

export interface RunAgentInput {
  readonly spindle: SpindleAPI;
  readonly userId: string;
  readonly sessionId: string;
  readonly characterId: string | null;
  readonly assistantMessageId: string;
  readonly pinnedChatId: string | null;
  readonly conversation: LlmMessage[];
  readonly tools: readonly ToolSchema[];
  // Schemas for tools omitted from `tools` because they are deferred. Provided
  // separately so the loop can splice them back in when tool_search discovers
  // a tool mid-run.
  readonly deferredToolSchemas?: Readonly<Record<string, ToolSchema>>;
  readonly dispatch: Record<string, ToolFn>;
  readonly connectionId?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly maxTurns?: number | undefined;
  readonly startingTurn?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly contextTokens?: number | undefined;
  // Hard ceiling on a single tool-call result in tokens. Anything bigger gets
  // redirected to a session-scoped tmp file with a small envelope returned to
  // the model. Resolved by the backend from AgentSettings.toolOutputCapTokens.
  readonly toolOutputCapTokens?: number | null | undefined;
  readonly tokenizerModelId?: string | undefined;
  readonly cacheMode?: "off" | "system_only" | "full" | undefined;
  // Max tokens (prompt + completion) per rolling 60s before the loop pauses
  // requests. null/0 = no throttle. Resolved from AgentSettings.tpmLimit.
  readonly tpmLimit?: number | null | undefined;
  // Optional backend->frontend RPC. Backend wires this so tools running in
  // the sandbox can request browser-only work (e.g. Chrome Translator API).
  readonly callFrontend?: (op: string, args: unknown, timeoutMs?: number) => Promise<unknown>;
}

// userId is load-bearing: scopes the host tokenizer lookup so a user's
// connection profile cannot leak across users. Char/3 fallback on host error.
async function countResultTokens(spindle: SpindleAPI, userId: string, text: string, modelId?: string): Promise<number> {
  if (text.length === 0) return 0;
  try {
    const opts: { userId: string; model?: string } = { userId };
    if (modelId) opts.model = modelId;
    const r = await spindle.tokens.countText(text, opts);
    return r.total_tokens;
  } catch {
    return Math.ceil(text.length / 3);
  }
}

// Reconstruct usage locally when the provider omitted it (or reported zeros).
// Prompt = the conv we just sent; completion = generated content + reasoning.
// Approximate but directionally accurate; UI prefixes with "~".
async function estimateUsage(
  spindle: SpindleAPI,
  userId: string,
  conv: readonly LlmMessage[],
  content: string,
  reasoning: string | undefined,
  modelId?: string,
): Promise<{ prompt: number; completion: number; total: number; estimated: true }> {
  const promptText = JSON.stringify(conv);
  const completionText = (content ?? "") + (reasoning ?? "");
  const [prompt, completion] = await Promise.all([
    countResultTokens(spindle, userId, promptText, modelId),
    countResultTokens(spindle, userId, completionText, modelId),
  ]);
  return { prompt, completion, total: prompt + completion, estimated: true };
}

const DEFAULT_CONTEXT_TOKENS = 400_000;

const DEFAULT_MAX_TURNS = 40;

const TPM_WINDOW_MS = 60_000;

// Per-user rolling token window. Module scope so it spans every request a user
// makes within the worker's lifetime (the tool loop, regenerate, compaction,
// back-to-back messages), not just one runAgent call. A worker restart resets
// it, which only over-permits for one window.
const tpmWindows = new Map<string, { ts: number; tokens: number }[]>();

function pruneTpm(userId: string): { ts: number; tokens: number }[] {
  const arr = tpmWindows.get(userId) ?? [];
  const cutoff = Date.now() - TPM_WINDOW_MS;
  while (arr.length > 0 && arr[0]!.ts < cutoff) arr.shift();
  tpmWindows.set(userId, arr);
  return arr;
}

function recordTpm(userId: string, tokens: number): void {
  if (tokens <= 0) return;
  pruneTpm(userId).push({ ts: Date.now(), tokens });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const onAbort = (): void => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Remove text-form tool-call markup (e.g. <tool_use>, <invoke>, <function_call>,
// <tool_call>, <function_calls>, <parameter>) that the model sometimes
// interleaves with prose when it shouldn't. Paired tags get nuked along with
// their bodies; orphan tags get removed cleanly.
const TEXT_TOOL_TAG_NAMES = "(?:invoke|tool_use|tool_call|function_call|function_calls|parameter)";
const PAIRED_TAG_RX = new RegExp(`<\\s*${TEXT_TOOL_TAG_NAMES}\\b[\\s\\S]*?<\\/\\s*${TEXT_TOOL_TAG_NAMES}\\s*>`, "gi");
const ORPHAN_OPEN_RX = new RegExp(`<\\s*${TEXT_TOOL_TAG_NAMES}\\b[^>]*>`, "gi");
const ORPHAN_CLOSE_RX = new RegExp(`<\\/\\s*${TEXT_TOOL_TAG_NAMES}\\s*>`, "gi");

// Scan prior tool_search results in the conversation for the deferred tools
// already discovered in earlier sends. Lets the model resume mid-task without
// re-calling tool_search every fresh message.
function seedDiscoveredFromHistory(
  conv: readonly LlmMessage[],
  deferredSchemas: Readonly<Record<string, ToolSchema>>,
): Set<string> {
  const out = new Set<string>();
  const toolSearchCallIds = new Set<string>();
  for (const msg of conv) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as readonly LlmMessagePart[]) {
      if (part.type === "tool_use" && part.name === "tool_search") {
        toolSearchCallIds.add(part.id);
      } else if (part.type === "tool_result" && toolSearchCallIds.has(part.tool_use_id) && !part.is_error) {
        const blockRx = /<function>(\{[\s\S]*?\})<\/function>/g;
        let m: RegExpExecArray | null;
        while ((m = blockRx.exec(part.content)) !== null) {
          try {
            const parsed = JSON.parse(m[1]!) as { name?: unknown };
            if (typeof parsed.name === "string" && deferredSchemas[parsed.name]) {
              out.add(parsed.name);
            }
          } catch { /* malformed entry, skip */ }
        }
      }
    }
  }
  return out;
}

function stripTextToolCallSyntax(content: string): string {
  let out = content;
  for (let i = 0; i < 4 && PAIRED_TAG_RX.test(out); i++) {
    out = out.replace(PAIRED_TAG_RX, "");
  }
  out = out.replace(ORPHAN_OPEN_RX, "").replace(ORPHAN_CLOSE_RX, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// Recognise pseudo-XML tool-call syntax the model sometimes emits as text
// when it doesn't (or can't) use the provider's native tool-use channel.
// Covers Anthropic's <invoke>/<function_calls>, our own <tool_use>,
// OpenAI-ish <function_call>, and the generic <tool_call>. Case-insensitive.
const TEXT_TOOL_CALL_RX = /<\s*(?:invoke|tool_use|tool_call|function_call|function_calls)\b/i;

function hasTextToolCallSyntax(content: string): boolean {
  return TEXT_TOOL_CALL_RX.test(content);
}

// Extract pseudo-XML tool calls from prose so we can dispatch them as a
// fallback when the model has regressed to text-form (typically after several
// failed native calls primed it from its own history). Returns the recovered
// calls plus the content with those blocks removed.
function parseTextFormToolCalls(content: string): { recovered: ToolCall[]; cleaned: string } {
  const recovered: ToolCall[] = [];
  // Match either <tool_use name="X" id="Y">...</tool_use>
  // or         <invoke name="X" id="Y">...</invoke>
  // The body is treated as JSON args. The id is optional, synthesize if missing.
  const blockRx = /<\s*(?:tool_use|invoke)\s+([^>]*)>([\s\S]*?)<\/\s*(?:tool_use|invoke)\s*>/gi;
  const attrRx = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  let synthCounter = 0;
  const matches: { start: number; end: number }[] = [];
  while ((m = blockRx.exec(content)) !== null) {
    const attrStr = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    while ((am = attrRx.exec(attrStr)) !== null) attrs[am[1]!] = am[2]!;
    const name = attrs.name;
    if (!name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    } catch {
      // Body wasn't valid JSON. Fall back to <parameter name="x">value</parameter> shape.
      const paramRx = /<\s*parameter\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/\s*parameter\s*>/gi;
      let pm: RegExpExecArray | null;
      while ((pm = paramRx.exec(body)) !== null) args[pm[1]!] = pm[2]!;
      // If still empty, skip this block, the model's output is too malformed to dispatch safely.
      if (Object.keys(args).length === 0) continue;
    }
    const call_id = attrs.id ?? `synth_${Date.now().toString(36)}_${synthCounter++}`;
    recovered.push({ name, args, call_id });
    matches.push({ start: m.index, end: m.index + m[0].length });
  }
  // Remove matched blocks from content, leaving the prose between them.
  if (matches.length === 0) return { recovered: [], cleaned: content };
  let cleaned = "";
  let cursor = 0;
  for (const mm of matches) {
    cleaned += content.slice(cursor, mm.start);
    cursor = mm.end;
  }
  cleaned += content.slice(cursor);
  return { recovered, cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim() };
}

export async function* runAgent(input: RunAgentInput): AsyncGenerator<AgentEvent, void, void> {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const signal = input.signal ?? new AbortController().signal;
  const conv = input.conversation;
  const detector = new LoopDetector({ maxRepetitions: 3, loopDetectionWindow: 4 });

  let finishedSummary: string | undefined;

  const deferredSchemas = input.deferredToolSchemas ?? {};
  const discoveredToolNames = seedDiscoveredFromHistory(input.conversation, deferredSchemas);
  const recentReads = new RecentReadsCache();

  interface CallBuffer {
    readonly edits: EditRecord[];
    readonly reverts: Array<{ editId: string; outcome: RevertOutcomeWire }>;
    resync: boolean;
    // squash_session_edits passes the absorbed → merged id map so the backend
    // can rewrite tool-block edit_ids on the in-flight assistant message,
    // matching what autosquashAndNotify does at end-of-message. Without this
    // the per-block "Revert all" affordance points at IDs the ledger no
    // longer has.
    resyncRemap?: Record<string, string>;
  }

  function makeCallCtx(buffer: CallBuffer): ToolCtx {
    return {
      spindle: input.spindle,
      userId: input.userId,
      sessionId: input.sessionId,
      // Empty string is the no-focus sentinel (All Characters mode).
      // resolveCharacterTarget treats "" and null alike, throwing [NO_TARGET]
      // when a tool needs a character but got neither an explicit id nor focus.
      characterId: input.characterId ?? "",
      assistantMessageId: input.assistantMessageId,
      pinnedChatId: input.pinnedChatId,
      signal,
      contextTokens: input.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      recentReads,
      setFinished: (s) => { finishedSummary = s; },
      pushEdit: (rec) => { buffer.edits.push(rec); },
      pushRevert: (editId, outcome) => { buffer.reverts.push({ editId, outcome }); },
      pushLedgerResync: (remap) => {
        buffer.resync = true;
        if (remap && Object.keys(remap).length > 0) {
          buffer.resyncRemap = { ...(buffer.resyncRemap ?? {}), ...remap };
        }
      },
      discoverTools: (names) => {
        for (const n of names) {
          if (deferredSchemas[n]) discoveredToolNames.add(n);
        }
      },
      ...(input.callFrontend !== undefined ? { callFrontend: input.callFrontend } : {}),
    };
  }

  const startingTurn = input.startingTurn ?? 0;
  let anyToolCallThisRun = false;
  let textToolCallRetries = 0;
  for (let i = 1; i <= maxTurns; i++) {
    const turnNum = startingTurn + i;
    if (signal.aborted) return;

    const tpmLimit = input.tpmLimit ?? null;
    if (tpmLimit !== null && tpmLimit > 0) {
      while (!signal.aborted) {
        const win = pruneTpm(input.userId);
        const used = win.reduce((a, e) => a + e.tokens, 0);
        if (used < tpmLimit) break;
        const oldest = win[0];
        const waitMs = oldest === undefined
          ? TPM_WINDOW_MS
          : Math.min(TPM_WINDOW_MS, Math.max(1_000, oldest.ts + TPM_WINDOW_MS - Date.now()));
        yield {
          type: "warning",
          message: `TPM limit reached: ~${used} tokens used in the last minute (limit ${tpmLimit}). Pausing ${Math.ceil(waitMs / 1000)}s to stay under the rate limit.`,
        };
        await sleep(waitMs, signal);
      }
      if (signal.aborted) return;
    }

    yield { type: "turn_started", turn: turnNum, assistantMessageId: input.assistantMessageId };

    let content = "";
    let toolCalls: readonly ToolCall[] = [];
    let finishReason = "";
    let usage: { prompt: number; completion: number; total: number; estimated?: boolean } | undefined;
    let reasoning: string | undefined;

    // Splice discovered deferred tools into the tools list for this turn.
    // The dispatch map already covers every registered tool. This only
    // affects which schemas the provider sees.
    let effectiveTools: readonly ToolSchema[] = input.tools;
    if (discoveredToolNames.size > 0) {
      const extras: ToolSchema[] = [];
      for (const n of discoveredToolNames) {
        const s = deferredSchemas[n];
        if (s) extras.push(s);
      }
      effectiveTools = [...input.tools, ...extras];
    }

    // Streamed-reasoning counters. `reasoning` (the variable) is only set from
    // the terminal `done` chunk, so a stream that ends mid-reasoning leaves it
    // undefined even though the model produced a lot of thinking. These track
    // what actually came down the wire so the failure dump is accurate.
    let streamedReasoningChars = 0;
    let streamedTokenChars = 0;
    let sawDoneEvent = false;
    try {
      for await (const ev of runLlmStream(input.spindle, {
        messages: withRollingCacheBreakpoint(coalesceConsecutiveTurns(conv), input.cacheMode ?? "full"),
        tools: effectiveTools,
        ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
        ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
        userId: input.userId,
        signal,
      })) {
        if (ev.type === "token") {
          streamedTokenChars += ev.token.length;
          yield { type: "llm_token", token: ev.token };
        } else if (ev.type === "reasoning") {
          streamedReasoningChars += ev.token.length;
          yield { type: "llm_reasoning", token: ev.token };
        } else {
          sawDoneEvent = true;
          content = ev.response.content;
          toolCalls = ev.response.tool_calls;
          finishReason = ev.response.finish_reason;
          usage = ev.response.usage;
          reasoning = ev.response.reasoning;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      input.spindle.log.error(
        `loop.turn ${turnNum} LLM stream threw: ${(err as Error).message} ` +
        `(streamed reasoning_chars=${streamedReasoningChars} token_chars=${streamedTokenChars} saw_done=${sawDoneEvent})`,
      );
      throw new Error(`LLM call failed: ${(err as Error).message}`);
    }

    dlog(input.spindle,
      `loop.turn ${turnNum} response: finish_reason=${finishReason || "<empty>"} ` +
      `content_chars=${content.length} tool_calls=${toolCalls.length}` +
      `[${toolCalls.map((t) => t.name).join(",") || "<none>"}] ` +
      `reasoning_terminal_chars=${reasoning?.length ?? 0} reasoning_streamed_chars=${streamedReasoningChars} ` +
      `token_streamed_chars=${streamedTokenChars} saw_done=${sawDoneEvent} ` +
      `usage=${usage ? `p${usage.prompt}/c${usage.completion}/t${usage.total}${usage.estimated ? "(est)" : ""}` : "<none>"} ` +
      `conv_msgs=${conv.length}`,
    );

    if (usage === undefined) {
      try {
        usage = await estimateUsage(input.spindle, input.userId, withRollingCacheBreakpoint(coalesceConsecutiveTurns(conv), input.cacheMode ?? "full"), content, reasoning, input.tokenizerModelId);
      } catch { /* keep undefined: UI just hides the strip */ }
    }

    if (usage !== undefined) recordTpm(input.userId, usage.total);

    if (turnNum === startingTurn + 1 && content.trim().length === 0 && toolCalls.length === 0) {
      const lastUser = [...conv].reverse().find((m) => m.role === "user");
      const lastUserPreview = typeof lastUser?.content === "string"
        ? lastUser.content.slice(0, 200)
        : JSON.stringify(lastUser?.content ?? null).slice(0, 200);

      // Request-shape census. The NanoGPT-vs-OpenRouter split for DeepSeek-v4
      // points at the gateway choking on tool-history continuations, so the
      // load-bearing signal is how much tool_use / tool_result history the
      // failing request carried vs a request that succeeded earlier.
      let toolUseParts = 0;
      let toolResultParts = 0;
      let largestToolResultChars = 0;
      let totalContentChars = 0;
      for (const m of conv) {
        if (typeof m.content === "string") { totalContentChars += m.content.length; continue; }
        for (const p of m.content) {
          if (p.type === "tool_use") toolUseParts++;
          else if (p.type === "tool_result") {
            toolResultParts++;
            const c = typeof p.content === "string" ? p.content : JSON.stringify(p.content);
            largestToolResultChars = Math.max(largestToolResultChars, c.length);
            totalContentChars += c.length;
          } else if (p.type === "text") {
            totalContentChars += p.text.length;
          }
        }
      }
      const priorToolCalled = toolUseParts > 0;

      input.spindle.log.error(
        `loop.turn ${turnNum} EMPTY-TURN FAILURE: ` +
        `saw_done=${sawDoneEvent} finish_reason=${finishReason || "<empty>"} ` +
        `content_chars=${content.length} tool_calls=${toolCalls.length} ` +
        `reasoning_terminal_chars=${reasoning?.length ?? 0} reasoning_streamed_chars=${streamedReasoningChars} ` +
        `token_streamed_chars=${streamedTokenChars} ` +
        `usage=${usage ? `p${usage.prompt}/c${usage.completion}/t${usage.total}${usage.estimated ? "(est)" : ""}` : "<none>"} ` +
        `conv_msgs=${conv.length} req_tool_use=${toolUseParts} req_tool_result=${toolResultParts} ` +
        `largest_tool_result_chars=${largestToolResultChars} total_content_chars=${totalContentChars} ` +
        `tools_offered=${effectiveTools.length} connection=${input.connectionId ?? "<default>"} ` +
        `last_user="${lastUserPreview.replace(/\n/g, " ")}"`,
      );
      const toolsOffered = effectiveTools.length;
      let diag: string;
      let advice: string;
      if (!sawDoneEvent && streamedReasoningChars > 0) {
        diag = `the provider streamed ${streamedReasoningChars} chars of reasoning then closed the connection without a completion chunk. The model thought but never emitted an answer or tool call.`;
        advice = "Re-send. A stream that drops mid-reasoning is often transient.";
      } else if (!sawDoneEvent) {
        diag = "the provider closed the stream without emitting anything (no reasoning, no content, no completion chunk).";
        advice = "Check the Lumiverse server log for a `[lumiverse.*.sse]` line. An error frame means the gateway returned an upstream error.";
      } else if (priorToolCalled) {
        diag = `the provider returned a complete but empty response (finish_reason=${finishReason || "unknown"}) on a continuation whose history already contains ${toolUseParts} tool call(s) and ${toolResultParts} tool result(s) (largest ${largestToolResultChars} chars).`;
        advice = "The model DID emit tool calls earlier in this conversation, so it is tool-call capable. An empty completion specifically on a tool-history continuation is a gateway defect, not a model or LumiAgent issue. NanoGPT exhibits this serving DeepSeek-v4 (both thinking and non-thinking) while the same model works through OpenRouter. Run this model via a different gateway (OpenRouter is confirmed working) for tool-driven sessions.";
      } else {
        diag = `the provider returned a complete response (finish_reason=${finishReason || "unknown"}) with no content, no tool calls, and no reasoning, while ${toolsOffered} tools were offered and no tool call has succeeded yet in this conversation.`;
        advice = "Re-send once. If it stays empty, this connection likely is not emitting native tool calls at all, try a function-calling-capable connection (Claude, GPT-4-class, Gemini, DeepSeek-v4 via OpenRouter).";
      }
      throw new Error(
        "The model produced no answer and no tool call: " + diag + "\n\n" +
        "Diagnostics (also in the Lumiverse server logs):\n" +
        `  • terminal chunk received: ${sawDoneEvent ? "yes" : "no"}\n` +
        `  • finish_reason: ${finishReason || "(stream ended before one was sent)"}\n` +
        `  • reasoning streamed: ${streamedReasoningChars} chars\n` +
        `  • content: ${content.length} chars, tool calls: ${toolCalls.length}\n` +
        `  • prior tool calls in this conversation: ${toolUseParts} (tool results: ${toolResultParts})\n` +
        `  • tools offered this turn: ${toolsOffered}\n\n` +
        advice,
      );
    }

    // Strip text-form tool-call markup that the model interleaves with
    // prose. Two branches:
    //   - native calls landed too: clean content for save+display, warn
    //     once, continue normally so the native calls execute.
    //   - no native calls: this is the retry-or-bail path below.
    let cleanedFromMixed: string | undefined;
    if (toolCalls.length > 0 && hasTextToolCallSyntax(content)) {
      const cleaned = stripTextToolCallSyntax(content);
      yield { type: "warning", message: "The model mixed text-form tool-call syntax in with the response. Cleaned it from the saved conversation; native tool calls were executed normally." };
      content = cleaned;
      cleanedFromMixed = cleaned;
    }

    if (toolCalls.length === 0 && hasTextToolCallSyntax(content)) {
      if (textToolCallRetries < 1) {
        textToolCallRetries++;
        conv.push({ role: "assistant", content });
        conv.push({
          role: "user",
          content: "[SYSTEM: Your previous reply contained tool-call syntax as text (e.g. <invoke>, <tool_use>, <function_call>, <tool_call> tags). Text-encoded tool calls are NOT executed in their text form, they only run through the provider's native tool-use channel. Re-issue the same call(s) properly now.]",
        });
        yield { type: "warning", message: "The model wrote tool syntax as text instead of calling through the native channel. Nudged once. If it happens again I'll parse and dispatch as a fallback." };
        // Carry the cleaned text so the turn-scoped block fold strips the raw
        // <invoke>/<tool_call> markup from THIS retried turn's display block.
        // Without it the raw pseudo-XML persists in the bubble (the turn-scoped
        // clean can't reach back from a later turn).
        yield { type: "turn_completed", turn: turnNum, finish_reason: finishReason, cleanedContent: stripTextToolCallSyntax(content), ...(usage !== undefined ? { usage } : {}) };
        continue;
      }
      const { recovered, cleaned } = parseTextFormToolCalls(content);
      if (recovered.length > 0) {
        yield { type: "warning", message: `Model regressed to text-form tool calls. Parsed ${recovered.length} block${recovered.length === 1 ? "" : "s"} and dispatching as a fallback.` };
        toolCalls = recovered;
        content = cleaned;
        // Fall through to the normal toolCalls.length > 0 branch below.
      } else {
        throw new Error(
          "The model wrote tool syntax as text, but the markup couldn't be parsed into a usable call. " +
          "This connection may not actually support native tool calling, or the model's pseudo-XML is too malformed to recover. " +
          "Try a different connection (Anthropic / OpenAI / Google / Bedrock and most OpenRouter routes for those same models support native tool calls).",
        );
      }
    }

    // Tool-call loop detection runs POST-dispatch (below) so it can see
    // whether this turn made progress. Text-repetition has no dispatch, so
    // it's evaluated here.
    if (toolCalls.length === 0 && content.trim().length > 0) {
      const loop = detector.recordText(content);
      if (loop) {
        conv.push(encodeAssistantTurn(content, toolCalls, reasoning));
        yield { type: "warning", message: loop.detail };
        yield { type: "paused_for_input", reason: "loop_detected", detail: loop.detail };
        return;
      }
    }

    if (toolCalls.length > 0) anyToolCallThisRun = true;
    const results: ToolResult[] = [];
    const newEdits: EditLogEntry[] = [];
    let revertedThisTurn = false;

    interface CallOutcome {
      readonly tc: ToolCall;
      readonly buffer: CallBuffer;
      resultText: string;
      isError: boolean;
      // Set only for unknown-tool errors, so the loop can skip the post-dispatch
      // bookkeeping that doesn't apply (no edits, no resync, no reverts).
      unknownTool?: boolean;
    }

    const executeOne = async (tc: ToolCall): Promise<CallOutcome> => {
      const buffer: CallBuffer = { edits: [], reverts: [], resync: false };
      const fn = input.dispatch[tc.name];
      if (!fn) {
        const msg = `Unknown tool '${tc.name}'. Available: ${Object.keys(input.dispatch).join(", ")}`;
        return { tc, buffer, resultText: msg, isError: true, unknownTool: true };
      }
      let resultText: string;
      let isError = false;
      const incompleteArgs = tc.args && typeof tc.args === "object" && (tc.args as { _incomplete?: unknown })._incomplete === true;
      if (incompleteArgs) {
        const partial = (tc.args as { _raw_partial_json?: string })._raw_partial_json ?? "";
        const parseErr = (tc.args as { _parse_error?: string })._parse_error ?? "<unknown>";
        resultText = `Error: tool call '${tc.name}' was emitted with truncated arguments (the model hit max_tokens mid-call). Partial JSON received: ${JSON.stringify(partial.slice(0, 400))}. Parse error: ${parseErr}. Raise Max Response in agent settings or split the call into smaller pieces, then retry.`;
        isError = true;
      } else {
        try {
          const r = await fn(tc.args, makeCallCtx(buffer));
          resultText = r.content;
          if (r.isError === true) isError = true;
        } catch (err) {
          resultText = `Error: ${(err as Error).message}`;
          isError = true;
        }
      }
      // Per-tool char cap fires first: cheaper than token counting, more
      // granular than the global tokens cap. Tools mapped to Infinity
      // self-spill, so they short-circuit here without any cost.
      const perToolCap = maxResultSizeCharsFor(tc.name);
      if (
        perToolCap !== null && Number.isFinite(perToolCap)
        && !isError
        && !resultText.startsWith(SPILL_ENVELOPE_SENTINEL)
        && resultText.length > perToolCap
      ) {
        try {
          resultText = await spillToolResult(input.spindle, input.sessionId, input.userId, tc.name, resultText, {
            unit: "chars", limit: perToolCap, observed: resultText.length,
          });
        } catch { /* fall through to the token cap or final clip() */ }
      }

      const cap = input.toolOutputCapTokens;
      if (
        cap !== undefined && cap !== null && cap > 0
        && !isError
        && !resultText.startsWith(SPILL_ENVELOPE_SENTINEL)
      ) {
        const tokens = await countResultTokens(input.spindle, input.userId, resultText, input.tokenizerModelId);
        if (tokens > cap) {
          try {
            resultText = await spillToolResult(input.spindle, input.sessionId, input.userId, tc.name, resultText, {
              unit: "tokens", limit: cap, observed: tokens,
            });
          } catch { /* fall through to protocol.clip() */ }
        }
      }
      return { tc, buffer, resultText, isError };
    };

    // Partition into batches: consecutive read-only calls run in parallel,
    // anything else runs alone. Conservative on input shape: a tool that
    // isn't explicitly read-only falls in its own serial batch.
    const reg = await import("./tools/_registry");
    interface Batch { readonly concurrent: boolean; readonly calls: ToolCall[]; }
    const batches: Batch[] = [];
    for (const tc of toolCalls) {
      const tool = reg.registry.get(tc.name);
      const safeByFlag = tool?.isConcurrencySafe?.(tc.args) ?? tool?.isReadOnly?.(tc.args);
      const safeByName = isReadOnlyTool(tc.name);
      const concurrent = Boolean(safeByFlag ?? safeByName);
      const last = batches[batches.length - 1];
      if (concurrent && last?.concurrent) last.calls.push(tc);
      else batches.push({ concurrent, calls: [tc] });
    }

    const drainOutcome = function* (oc: CallOutcome): Generator<AgentEvent, void, void> {
      // characterId is sentinel-coerced to "" in no-character sessions; defensive
      // since char-required tools (the only edit producers) are filtered out of
      // the schema in that mode and can't reach this branch.
      const editsForCall: EditLogEntry[] = oc.buffer.edits.map((rec) =>
        newEditEntry(input.sessionId, rec.scope ?? characterScope(input.characterId ?? ""), oc.tc.call_id, oc.tc.name, turnNum, rec, input.assistantMessageId),
      );
      newEdits.push(...editsForCall);
      results.push({ call_id: oc.tc.call_id, name: oc.tc.name, content: oc.resultText, ...(oc.isError ? { is_error: true } : {}) });
      for (const e of editsForCall) yield { type: "edit_logged", entry: e };
      for (const r of oc.buffer.reverts) { revertedThisTurn = true; yield { type: "revert_logged", editId: r.editId, outcome: r.outcome }; }
      if (oc.buffer.resync) yield oc.buffer.resyncRemap
        ? { type: "edits_resynced", absorbedToMerged: oc.buffer.resyncRemap }
        : { type: "edits_resynced" };
      yield {
        type: "tool_finished",
        call_id: oc.tc.call_id,
        result: oc.resultText,
        is_error: oc.isError,
        edit_ids: editsForCall.map((e) => e.id),
      };
    };

    for (const batch of batches) {
      if (signal.aborted) return;
      // Emit tool_started for every call in this batch BEFORE dispatching, so
      // the UI sees all in-flight blocks at once when the batch goes parallel.
      for (const tc of batch.calls) {
        yield { type: "tool_started", call_id: tc.call_id, name: tc.name, args: tc.args };
      }
      let outcomes: CallOutcome[];
      if (batch.concurrent && batch.calls.length > 1) {
        // Worker-pool fan-out: PARALLEL_TOOL_CONCURRENCY workers race to claim
        // the next index off a shared counter. Single-threaded JS makes the
        // counter safe. Spindle requests are the only shared dependency;
        // 5-wide keeps us well under any host-side rate limits.
        outcomes = new Array<CallOutcome>(batch.calls.length);
        let next = 0;
        const worker = async (): Promise<void> => {
          while (true) {
            const idx = next++;
            if (idx >= batch.calls.length) return;
            outcomes[idx] = await executeOne(batch.calls[idx]!);
          }
        };
        const workerCount = Math.min(PARALLEL_TOOL_CONCURRENCY, batch.calls.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
      } else {
        // Serial single call (or an unsafe batch of 1).
        outcomes = [];
        for (const tc of batch.calls) {
          if (signal.aborted) return;
          outcomes.push(await executeOne(tc));
        }
      }
      // Emit results in original tool_calls order so the conversation we push
      // back to the provider matches the order it sent us.
      for (const oc of outcomes) {
        if (oc.unknownTool) {
          results.push({ call_id: oc.tc.call_id, name: oc.tc.name, content: oc.resultText, is_error: true });
          yield { type: "tool_finished", call_id: oc.tc.call_id, result: oc.resultText, is_error: true, edit_ids: [] };
          continue;
        }
        yield* drainOutcome(oc);
      }
    }

    conv.push(encodeAssistantTurn(content, toolCalls, reasoning));
    if (results.length > 0) conv.push(encodeToolResults(results));

    // Loop detection with progress known. Any forward motion this turn clears
    // the detector, so repetition that coexists with progress never fires.
    // Only a run of strictly unproductive turns can accumulate to a flag.
    if (newEdits.length > 0 || revertedThisTurn || finishedSummary !== undefined) {
      detector.noteProgress();
    } else if (toolCalls.length > 0) {
      const loop = detector.recordToolCalls(toolCalls.map((tc) => ({ name: tc.name, input: tc.args })));
      if (loop) {
        yield { type: "warning", message: loop.detail };
        yield { type: "paused_for_input", reason: "loop_detected", detail: loop.detail };
        return;
      }
    }

    const completedEvent: AgentEvent = {
      type: "turn_completed",
      turn: turnNum,
      finish_reason: finishReason,
      ...(usage !== undefined ? { usage } : {}),
      ...(cleanedFromMixed !== undefined ? { cleanedContent: cleanedFromMixed } : {}),
    };
    yield completedEvent;

    if (finishReason === "max_tokens") {
      yield {
        type: "warning",
        message: `Response was cut off at the Max Response cap${usage ? ` (${usage.completion} tokens)` : ""}. The model didn't finish its turn. Raise "Max Response" in agent settings, or break the task into smaller steps.`,
      };
      yield { type: "paused_for_input", reason: "max_tokens", detail: "Response truncated at max_tokens. Raise the cap in settings or split the task." };
      return;
    }

    if (finishedSummary !== undefined) {
      yield { type: "paused_for_input", reason: "no_tool_calls", detail: `Task complete: ${finishedSummary}` };
      return;
    }

    if (toolCalls.length === 0) {
      if (!anyToolCallThisRun && content.trim().length > 0) {
        yield {
          type: "warning",
          message:
            "I responded without calling any tools. If you asked for an edit and nothing changed, the selected connection might not support native tool calling. Try a different connection: Anthropic, OpenAI, Google Gemini, Claude-via-Vertex/Bedrock, and most OpenRouter routes for those same models support it. Proxies and older open-weight models often do not.",
        };
      }
      yield { type: "paused_for_input", reason: "no_tool_calls" };
      return;
    }
  }

  yield {
    type: "paused_for_input",
    reason: "max_turns",
    detail: `Reached max turns (${maxTurns}) without natural stop. Send another message to continue or revert session to start over.`,
  };
}
