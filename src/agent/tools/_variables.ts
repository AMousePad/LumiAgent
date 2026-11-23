import type { ChatDTO } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";
import { chatGlobalVars, varText } from "../../state/chat-global-vars";

export type VarStore = "chat" | "global" | "local" | "user_level";

export const VAR_STORES: Readonly<Record<VarStore, { store: string; read_by: string; reaches_prompts: boolean }>> = {
  chat: { store: "chat.metadata.chat_variables", read_by: "{{getchatvar}}, and Risu / LumiRealm getvar", reaches_prompts: true },
  global: { store: "chat.metadata.macro_variables.global", read_by: "{{getgvar}} / {{getglobalvar}} in this chat", reaches_prompts: true },
  local: { store: "chat.metadata.macro_variables.local", read_by: "no Lumiverse macro. {{getvar}} is rebuilt for every prompt from preset variables", reaches_prompts: false },
  user_level: { store: "user setting macro_variables_global", read_by: "no Lumiverse macro. Extensions may read it", reaches_prompts: false },
};

function strings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, varText(v)]));
}

export async function readAllStores(ctx: ToolCtx, chat: ChatDTO): Promise<Record<VarStore, Record<string, string>>> {
  const meta = (chat.metadata ?? {}) as Record<string, unknown>;
  const macro = (meta["macro_variables"] && typeof meta["macro_variables"] === "object" ? meta["macro_variables"] : {}) as Record<string, unknown>;
  let userLevel: Record<string, string> = {};
  try { userLevel = strings(await ctx.spindle.variables.global.list(ctx.userId)); } catch { /* reported as empty */ }
  return {
    chat: strings(meta["chat_variables"]),
    global: strings(chatGlobalVars(meta)),
    local: strings(macro["local"]),
    user_level: userLevel,
  };
}
