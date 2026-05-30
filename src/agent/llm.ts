import type { SpindleAPI, StreamChunkDTO } from "lumiverse-spindle-types";
import type { LlmMessage, ToolCall, ToolSchema } from "../types";
import { dlog } from "../log";

export interface LlmCallInput {
  readonly messages: readonly LlmMessage[];
  readonly tools?: readonly ToolSchema[] | undefined;
  readonly connectionId?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly userId: string;
  readonly signal?: AbortSignal | undefined;
}

export interface LlmFinalResponse {
  readonly content: string;
  readonly reasoning?: string | undefined;
  readonly finish_reason: string;
  readonly tool_calls: readonly ToolCall[];
  readonly usage?: { prompt: number; completion: number; total: number; estimated?: boolean } | undefined;
}

export type LlmStreamEvent =
  | { type: "token"; token: string }
  | { type: "reasoning"; token: string }
  | { type: "done"; response: LlmFinalResponse };

export async function* runLlmStream(
  spindle: SpindleAPI,
  input: LlmCallInput,
): AsyncGenerator<LlmStreamEvent, void, void> {
  const req = {
    type: "quiet" as const,
    messages: [...input.messages],
    userId: input.userId,
  } as Parameters<SpindleAPI["generate"]["quietStream"]>[0];
  if (input.tools !== undefined) req.tools = [...input.tools];
  if (input.connectionId !== undefined) req.connection_id = input.connectionId;
  if (input.parameters !== undefined) req.parameters = input.parameters;
  if (input.signal !== undefined) req.signal = input.signal;
  const stream = spindle.generate.quietStream(req);

  // Stream-shape diagnostics. The reasoning-only-no-action failure can't be
  // told apart from a clean empty turn without knowing whether a terminal
  // `done` chunk ever arrived and what it carried. Counters here + the
  // summary log on stream end give us that.
  let tokenChunks = 0;
  let tokenChars = 0;
  let reasoningChunks = 0;
  let reasoningChars = 0;
  let sawDone = false;
  let lastChunkType = "<none>";

  for await (const raw of stream) {
    const chunk = raw as StreamChunkDTO;
    lastChunkType = chunk.type;
    if (chunk.type === "token") {
      tokenChunks++;
      tokenChars += chunk.token.length;
      if (chunk.token.length > 0) yield { type: "token", token: chunk.token };
    } else if (chunk.type === "reasoning") {
      reasoningChunks++;
      reasoningChars += chunk.token.length;
      if (chunk.token.length > 0) yield { type: "reasoning", token: chunk.token };
    } else if (chunk.type === "done") {
      sawDone = true;
      const toolNames = (chunk.tool_calls ?? []).map((t) => t.name).join(",") || "<none>";
      dlog(spindle,
        `llm.stream done: finish_reason=${chunk.finish_reason} content_chars=${chunk.content.length} ` +
        `tool_calls=${chunk.tool_calls?.length ?? 0}[${toolNames}] ` +
        `reasoning_chars_terminal=${chunk.reasoning?.length ?? 0} ` +
        `reasoning_chars_streamed=${reasoningChars}(${reasoningChunks} chunks) ` +
        `token_chars_streamed=${tokenChars}(${tokenChunks} chunks) ` +
        `usage=${chunk.usage ? `p${chunk.usage.prompt_tokens}/c${chunk.usage.completion_tokens}/t${chunk.usage.total_tokens}` : "<none>"}`,
      );
      const response: LlmFinalResponse = {
        content: chunk.content,
        finish_reason: chunk.finish_reason,
        tool_calls: chunk.tool_calls ?? [],
      };
      if (chunk.reasoning !== undefined) (response as { reasoning?: string }).reasoning = chunk.reasoning;
      // Some providers (GLM-5.1:thinking via NanoGPT, certain OpenAI-compat
      // gateways) omit usage on streaming or report zeros. Treat all-zero as
      // missing so the loop's fallback path runs.
      if (chunk.usage && (chunk.usage.prompt_tokens > 0 || chunk.usage.completion_tokens > 0)) {
        // Derive total rather than trusting total_tokens: a gateway that fills
        // only the component fields (the quirk this branch guards) reports
        // total_tokens:0, which would zero the displayed total and under-count
        // the TPM window.
        const total = chunk.usage.total_tokens > 0
          ? chunk.usage.total_tokens
          : chunk.usage.prompt_tokens + chunk.usage.completion_tokens;
        (response as { usage?: { prompt: number; completion: number; total: number; estimated?: boolean } }).usage = {
          prompt: chunk.usage.prompt_tokens,
          completion: chunk.usage.completion_tokens,
          total,
        };
      }
      yield { type: "done", response };
    }
  }

  // Stream ended without a terminal `done`. This is the prime suspect for the
  // reasoning-only-no-action failure: provider streamed reasoning (or nothing)
  // then closed the connection with no completion chunk and no thrown error.
  if (!sawDone) {
    spindle.log.warn(
      `llm.stream ENDED WITHOUT done chunk: last_chunk_type=${lastChunkType} ` +
      `reasoning_chars_streamed=${reasoningChars}(${reasoningChunks} chunks) ` +
      `token_chars_streamed=${tokenChars}(${tokenChunks} chunks). ` +
      `The loop will see empty content + no tool_calls + finish_reason="" and fail the turn.`,
    );
  }
}
