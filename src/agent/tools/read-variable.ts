import { z } from "zod";
import { defineTool } from "./_framework";
import { resolveChat } from "./_chat";
import { readAllStores, VAR_STORES, type VarStore } from "./_variables";
import description from "../prompts/claude/tools/read-variable/description.txt";
import argScope from "../prompts/claude/tools/read-variable/arg_scope.txt";
import argKey from "../prompts/claude/tools/read-variable/arg_key.txt";
import argChatId from "../prompts/claude/tools/read-variable/arg_chat_id.txt";

const inputSchema = z.object({
  scope: z.enum(["chat", "local", "global", "macro", "any"]).optional(),
  key: z.string().min(1),
  chat_id: z.string().optional(),
}).strict();

const ORDER: readonly VarStore[] = ["chat", "global", "local", "user_level"];

export const readVariableTool = defineTool({
  name: "read_variable",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["any", "chat", "global", "local"], description: argScope },
      key: { type: "string", description: argKey },
      chat_id: { type: "string", description: argChatId },
    },
    required: ["key"],
  },
  execute: async (input, ctx) => {
    const resolved = await resolveChat(ctx, input.chat_id);
    if ("error" in resolved) return resolved.error;
    const { chat, chatId, source } = resolved;
    try {
      // The old macro scope addressed its two sub-stores as local.<key> and global.<key>.
      const dotted = input.scope === "macro" ? /^(local|global)\.(.+)$/.exec(input.key) : null;
      const key = dotted ? dotted[2]! : input.key;
      const wanted: VarStore | null = dotted ? dotted[1] as VarStore
        : input.scope === "chat" || input.scope === "global" || input.scope === "local" ? input.scope : null;
      const stores = await readAllStores(ctx, chat);
      const found = ORDER.filter((s) => Object.hasOwn(stores[s], key)).map((s) => ({ scope: s, value: stores[s][key]!, store: VAR_STORES[s].store, read_by: VAR_STORES[s].read_by }));
      const primary = (wanted ? found.find((f) => f.scope === wanted) : found[0]) ?? null;
      const elsewhere = found.filter((f) => f !== primary);
      const base = { key, chat_id: chatId, chat_name: chat.name, chat_source: source, ...(wanted ? { scope_asked: wanted } : {}) };
      if (!primary) {
        return {
          content: JSON.stringify({
            ...base,
            exists: false,
            ...(elsewhere.length > 0
              ? { found_in_other_scopes: elsewhere, note: `'${key}' is not in scope ${wanted}, but exists in ${elsewhere.map((f) => f.scope).join(", ")}.` }
              : { note: `'${key}' is not set in any variable store of this chat. A macro reading it gets an empty string. variables(action=list) shows the keys that exist.` }),
          }, null, 2),
        };
      }
      return {
        content: JSON.stringify({
          ...base,
          exists: true,
          scope: primary.scope,
          value: primary.value,
          store: primary.store,
          read_by: primary.read_by,
          ...(elsewhere.length > 0 ? { also_in: elsewhere } : {}),
        }, null, 2),
      };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] reading variable '${input.key}' in chat ${chatId} failed: ${(err as Error).message}`, isError: true };
    }
  },
});
