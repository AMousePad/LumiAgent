import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
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
    let chatId = input.chat_id || ctx.pinnedChatId || null;
    let chatSource = input.chat_id ? "argument" : "pinned";
    if (!chatId) {
      const active = await ctx.spindle.chats.getActive(ctx.userId).catch(() => null);
      chatId = active?.id ?? null;
      chatSource = "host_active";
    }
    if (!chatId) {
      return { content: JSON.stringify({ error: 'No chat_id supplied, no chat pinned and no active chat in Lumiverse. Use chats(action=list) and pass a chat_id.' }), isError: true };
    }
    try {
      // Fall back to the agent's own connection so dry-run doesn't depend on the
      // user having a default connection flagged. The host's resolveConnection
      // throws "No connection profile found" when no id is passed and no default
      // exists; the chat path always passes its connection, so chat works while
      // this tool didn't for users without a default.
      const connectionId = input.connection_id || ctx.connectionId;
      const result = await ctx.spindle.generate.dryRun({
        chatId,
        ...(connectionId ? { connectionId } : {}),
        ...(input.persona_id ? { personaId: input.persona_id } : {}),
        ...(input.preset_id ? { presetId: input.preset_id } : {}),
      }, ctx.userId);
      // Full message bodies run to hundreds of KB and buried the token table, so they are opt-in.
      const sections = [...(result.tokenCount?.breakdown ?? [])].sort((a, b) => b.tokens - a.tokens);
      const summary = {
        chat_id: chatId,
        chat_source: chatSource,
        model: result.model,
        provider: result.provider,
        total_tokens: result.tokenCount?.total_tokens ?? null,
        tokenizer: result.tokenCount?.tokenizer_name ?? null,
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
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
