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
    },
    required: [],
  },
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const chatId = input.chat_id ?? ctx.pinnedChatId;
    if (!chatId) {
      return { content: JSON.stringify({ error: "no chat_id given and no pinned chat. Pass chat_id, or pin a chat first." }), isError: true };
    }
    try {
      // Fall back to the agent's own connection so dry-run doesn't depend on the
      // user having a default connection flagged. The host's resolveConnection
      // throws "No connection profile found" when no id is passed and no default
      // exists; the chat path always passes its connection, so chat works while
      // this tool didn't for users without a default.
      const connectionId = input.connection_id ?? ctx.connectionId;
      const result = await ctx.spindle.generate.dryRun({
        chatId,
        ...(connectionId ? { connectionId } : {}),
        ...(input.persona_id ? { personaId: input.persona_id } : {}),
        ...(input.preset_id ? { presetId: input.preset_id } : {}),
      }, ctx.userId);
      const summary = {
        chat_id: chatId,
        model: result.model,
        provider: result.provider,
        token_count: result.tokenCount ?? null,
        message_count: result.messages.length,
        breakdown_entry_count: result.breakdown.length,
        world_info_stats: result.worldInfoStats ?? null,
        memory_stats: result.memoryStats ?? null,
        parameters: result.parameters,
        breakdown: result.breakdown,
        messages: result.messages,
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
