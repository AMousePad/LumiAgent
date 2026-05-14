import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  chat_id: z.string().optional(),
  connection_id: z.string().optional(),
  persona_id: z.string().optional(),
  preset_id: z.string().optional(),
}).strict();

export const dryRunPromptTool = defineTool({
  name: "dry_run_prompt",
  description: "Run Lumiverse's prompt-assembly pipeline WITHOUT calling the LLM. Returns the exact messages that would be sent, plus a per-block breakdown (system / persona / world info entries / character fields / chat memory / chat history / etc.), token count, model, provider, world-info activation stats, and memory stats. THE definitive way to answer 'why is the AI saying X' or 'what's actually in the prompt'. Defaults to the pinned chat. The full messages array often spills to a tmp handle.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat to assemble for. Defaults to the pinned chat." },
      connection_id: { type: "string", description: "Override the connection used (defaults to the chat's active connection)." },
      persona_id: { type: "string", description: "Override the persona." },
      preset_id: { type: "string", description: "Override the preset." },
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
      const result = await ctx.spindle.generate.dryRun({
        chatId,
        ...(input.connection_id ? { connectionId: input.connection_id } : {}),
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
