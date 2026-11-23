import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { resolveChat } from "./_chat";
import description from "../prompts/claude/tools/dry-run-prompt/description.txt";
import argChatId from "../prompts/claude/tools/dry-run-prompt/arg_chat_id.txt";
import argConnectionId from "../prompts/claude/tools/dry-run-prompt/arg_connection_id.txt";
import argPersonaId from "../prompts/claude/tools/dry-run-prompt/arg_persona_id.txt";
import argPresetId from "../prompts/claude/tools/dry-run-prompt/arg_preset_id.txt";

const inputSchema = z.object({
  chat_id: z.string().optional(),
  connection_id: z.string().optional(),
  persona_id: z.string().optional(),
  preset_id: z.string().optional(),
  include_messages: z.boolean().optional(),
}).strict();

interface PresetUsed {
  preset_id: string | null;
  preset_name?: string;
  preset_source: string;
  preset_note?: string;
}

export const dryRunPromptTool = defineTool({
  name: "dry_run_prompt",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: argChatId },
      connection_id: { type: "string", description: argConnectionId },
      persona_id: { type: "string", description: argPersonaId },
      preset_id: { type: "string", description: argPresetId },
      include_messages: { type: "boolean", description: "Also return the assembled message bodies. Off by default: the token table answers size questions without them." },
    },
    required: [],
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    const meta = (chat.metadata ?? {}) as Record<string, unknown>;
    const noPresetChat = meta["temporary"] === true && meta["no_preset"] === true;
    try {
      let preset: PresetUsed;
      if (input.preset_id && !noPresetChat) {
        const row = await ctx.spindle.presets.get(input.preset_id, ctx.userId);
        if (!row) return { content: `Error: [PATH_NOT_FOUND] preset '${input.preset_id}' not found, nothing was assembled. Call list({path:"preset"}) for preset ids, or omit preset_id to use the chat's own preset.`, isError: true };
        preset = { preset_id: row.id, preset_name: row.name, preset_source: "argument" };
      } else {
        // Reporting only. Older hosts lack getActive, and a failed lookup must not fail the dry run.
        const active = await (async () => ctx.spindle.presets.getActive(chatId, ctx.userId))().catch(() => null);
        const activeId = active?.preset_id;
        const row = activeId ? await (async () => ctx.spindle.presets.get(activeId, ctx.userId))().catch(() => null) : null;
        preset = active
          ? { preset_id: active.preset_id, ...(row ? { preset_name: row.name } : {}), preset_source: active.source === "none" ? "selected" : `${active.source} binding` }
          : { preset_id: null, preset_source: "unknown", preset_note: "The host did not report which preset this chat uses." };
        if (input.preset_id) preset.preset_note = "preset_id was ignored: this is a temporary chat that runs without a preset.";
      }
      const forced = preset.preset_source === "argument";
      // The host errors without a default connection when none is passed, so pass the agent's own.
      const connectionId = input.connection_id || ctx.connectionId;
      const result = await ctx.spindle.generate.dryRun({
        chatId,
        ...(connectionId ? { connectionId } : {}),
        ...(input.persona_id ? { personaId: input.persona_id } : {}),
        // Without the force flag a chat, persona or character preset binding silently replaces presetId.
        ...(forced ? { presetId: preset.preset_id!, forcePresetId: true } : {}),
      }, ctx.userId);
      const sections = [...(result.tokenCount?.breakdown ?? [])].sort((a, b) => b.tokens - a.tokens);
      const clip = result.contextClipStats;
      const summary = {
        chat_id: chatId,
        chat_name: chat.name,
        chat_source: source,
        ...preset,
        model: result.model,
        provider: result.provider,
        total_tokens: result.tokenCount?.total_tokens ?? null,
        chat_history_tokens: result.chatHistoryTokens ?? null,
        tokenizer: result.tokenCount?.tokenizer_name ?? null,
        context_clip: clip ?? null,
        ...(clip && clip.messagesDropped > 0 ? { context_clip_note: `${clip.messagesDropped} oldest chat messages (${clip.tokensDropped} tokens) did not fit the ${clip.maxContext}-token context and are not in this prompt.` } : {}),
        ...(clip?.fixedOverBudget || clip?.budgetInvalid ? { context_clip_warning: "The fixed prompt alone exceeds the input budget. Raise the preset context size or trim prompt blocks and lorebook entries." } : {}),
        sections_by_tokens: sections.map((s) => ({ name: s.name, type: s.type, tokens: s.tokens, ...(s.role ? { role: s.role } : {}) })),
        message_count: result.messages.length,
        world_info_stats: result.worldInfoStats ?? null,
        memory_stats: result.memoryStats ?? null,
        parameters: result.parameters,
        breakdown: result.breakdown.map((b) => ({
          type: b.type, name: b.name,
          ...(b.role ? { role: b.role } : {}),
          ...(typeof b.content === "string" ? { chars: b.content.length } : {}),
          ...(b.messageCount !== undefined ? { message_count: b.messageCount } : {}),
          ...(b.blockId ? { block_id: b.blockId } : {}),
        })),
        ...(input.include_messages ? { messages: result.messages } : { messages_omitted: "Pass include_messages:true for the assembled message bodies (large, spills to tmp)." }),
      };
      const text = JSON.stringify(summary, null, 2);
      const out = await spillOrReturn(ctx, text, `dry_run_prompt(${chatId})`,
        "Use tmp_grep to find specific strings (e.g. unfamiliar tokens like '<payload>') across the assembled prompt; tmp_read to inspect specific message bodies.");
      return { content: out };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] dry run for chat ${chatId} failed: ${(err as Error).message}`, isError: true };
    }
  },
});
