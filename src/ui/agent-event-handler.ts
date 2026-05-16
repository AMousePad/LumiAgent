import type { AgentEvent, AssistantBlock, ChatAssistantMessage, ChatMessage, EditLogEntry, ScopeRef } from "../types";
import { characterScope, scopeKeyString } from "../types";
import type { AssistantHandle } from "./chat-thread";
import type { DiffModalHandle } from "./diff-modal";

// Narrow view onto drawer state mutated by the agent-event stream. Structural
// typing lets the caller pass its full UiState in.
export interface AgentEventState {
  streamingAssistant: AssistantHandle | null;
  currentAssistantMessage: ChatAssistantMessage | null;
  messages: ChatMessage[];
  edits: EditLogEntry[];
  scopeLedgers: Map<string, readonly EditLogEntry[]>;
  workshopFocusScope: ScopeRef | null;
  characterId: string | null;
  diffModal: DiffModalHandle | null;
}

export interface AgentEventCtx {
  readonly state: AgentEventState;
  adoptStreamingTurn(assistantMessageId: string): AssistantHandle;
  ensureStreamingTurn(): AssistantHandle;
  // Re-point state.currentAssistantMessage at the streaming message in state.messages
  // when the handle is live but the pointer was lost. Called by handlers that
  // mutate block state without going through ensureStreamingTurn.
  rebindCurrentAssistantMessage(): void;
  finalizeAssistantTurn(status: ChatAssistantMessage["status"]): void;
  rerenderThread(): void;
  updateSessionBar(): void;
  clearErrorBanners(): void;
}

// One handler per AgentEvent variant. Streaming events mutate the live bubble
// and currentAssistantMessage directly. Terminal events (paused_for_input)
// flush back to a static-rendered bubble so action buttons appear.
export function handleAgentEvent(ev: AgentEvent, ctx: AgentEventCtx): void {
  switch (ev.type) {
    case "warning":
      // Routed to toast / system prompt; never render inline yellow boxes.
      return;
    case "turn_started":
      ctx.clearErrorBanners();
      ctx.adoptStreamingTurn(ev.assistantMessageId);
      if (ctx.state.currentAssistantMessage) ctx.state.currentAssistantMessage.turn = ev.turn;
      return;
    case "llm_token": {
      ctx.ensureStreamingTurn().appendToken(ev.token);
      const a = ctx.state.currentAssistantMessage;
      if (!a) return;
      const last = a.blocks[a.blocks.length - 1];
      if (last && last.type === "text") last.content += ev.token;
      else a.blocks.push({ type: "text", content: ev.token });
      return;
    }
    case "llm_reasoning": {
      ctx.ensureStreamingTurn().appendReasoning(ev.token);
      const a = ctx.state.currentAssistantMessage;
      if (!a) return;
      const last = a.blocks[a.blocks.length - 1];
      if (last && last.type === "reasoning") last.content += ev.token;
      else a.blocks.push({ type: "reasoning", content: ev.token });
      return;
    }
    case "tool_started":
      ctx.ensureStreamingTurn().startTool(ev.call_id, ev.name, ev.args);
      ctx.state.currentAssistantMessage?.blocks.push({
        type: "tool", call_id: ev.call_id, name: ev.name, args: ev.args, edit_ids: [],
      });
      return;
    case "tool_finished": {
      ctx.state.streamingAssistant?.finishTool(ev.call_id, ev.result, ev.is_error, ev.edit_ids);
      ctx.rebindCurrentAssistantMessage();
      const a = ctx.state.currentAssistantMessage;
      if (!a) return;
      for (const b of a.blocks) {
        if (b.type === "tool" && b.call_id === ev.call_id) {
          const tb = b as AssistantBlock & { type: "tool" };
          tb.result = ev.result;
          tb.is_error = ev.is_error;
          tb.edit_ids = [...ev.edit_ids];
        }
      }
      return;
    }
    case "edit_logged": {
      ctx.state.edits.push(ev.entry);
      // File into the entry's own scope slot so the badge (active scope) and
      // the modal (focused scope) both pick it up with no extra round-trip.
      const key = scopeKeyString(ev.entry.scope);
      ctx.state.scopeLedgers.set(key, [...(ctx.state.scopeLedgers.get(key) ?? []), ev.entry]);
      ctx.state.streamingAssistant?.attachEdits([ev.entry]);
      const shown = ctx.state.workshopFocusScope
        ?? (ctx.state.characterId !== null ? characterScope(ctx.state.characterId) : null);
      if (shown && scopeKeyString(shown) === key) {
        ctx.state.diffModal?.setEdits(ctx.state.scopeLedgers.get(key) ?? []);
      }
      ctx.updateSessionBar();
      return;
    }
    case "turn_completed": {
      ctx.rebindCurrentAssistantMessage();
      const a = ctx.state.currentAssistantMessage;
      if (!a) return;
      a.finish_reason = ev.finish_reason;
      if (ev.usage) {
        a.usage = ev.usage;
        ctx.state.streamingAssistant?.setUsage(ev.usage);
      }
      if (ev.cleanedContent !== undefined) {
        // Drop every streaming text block and re-add a single one at the
        // tail. The post-stream rerender redraws from this state.
        a.blocks = a.blocks.filter((b) => b.type !== "text");
        if (ev.cleanedContent.trim().length > 0) {
          a.blocks.push({ type: "text", content: ev.cleanedContent });
        }
      }
      return;
    }
    case "paused_for_input":
      if (ev.detail) {
        ctx.state.streamingAssistant?.addWarning(ev.detail);
        ctx.rebindCurrentAssistantMessage();
        ctx.state.currentAssistantMessage?.blocks.push({ type: "warning", message: ev.detail });
      }
      ctx.finalizeAssistantTurn("complete");
      // Swap the streaming bubble for the rendered one so Regenerate appears
      // without waiting for the next user send.
      ctx.rerenderThread();
      return;
    case "revert_logged":
    case "edits_resynced":
      // Server-driven path: the matching top-level BackendToFrontend events
      // (edit_reverted, scope_edits_pushed) handle the UI side. Nothing
      // to do here.
      return;
  }
}
