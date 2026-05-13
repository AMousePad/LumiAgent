import type { SpindleAPI, StreamChunkDTO } from "lumiverse-spindle-types";
import type { LlmMessage, ToolCall, ToolSchema } from "../types";

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

  for await (const raw of stream) {
    const chunk = raw as StreamChunkDTO;
    if (chunk.type === "token") {
      if (chunk.token.length > 0) yield { type: "token", token: chunk.token };
    } else if (chunk.type === "reasoning") {
      if (chunk.token.length > 0) yield { type: "reasoning", token: chunk.token };
    } else if (chunk.type === "done") {
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
        (response as { usage?: { prompt: number; completion: number; total: number; estimated?: boolean } }).usage = {
          prompt: chunk.usage.prompt_tokens,
          completion: chunk.usage.completion_tokens,
          total: chunk.usage.total_tokens,
        };
      }
      yield { type: "done", response };
    }
  }
}
