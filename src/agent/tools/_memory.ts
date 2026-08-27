import type { MemoryEntityDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { ToolCtx } from "./_context";

export function resolveMemoryChat(ctx: ToolCtx, explicit?: string): string | null {
  return explicit ?? ctx.pinnedChatId ?? null;
}

export const NO_CHAT_ERROR = "Error: [NO_TARGET] no chat. Pass chat_id, or have the user pin a chat. Memory is per-chat.";

// The memories permission was added late; installs that predate it run
// ungrated until the user re-approves, so surface that instead of a raw throw.
export function memoryError(err: unknown): string {
  const msg = (err as Error).message;
  if (/permission/i.test(msg)) {
    return `Error: [SPINDLE_ERROR] ${msg}. The 'memories' permission may not be granted yet; the user can grant it from the Lumiverse extension manager.`;
  }
  return `Error: [SPINDLE_ERROR] ${msg}`;
}

export async function findEntity(spindle: SpindleAPI, chatId: string, ref: { name?: string; entityId?: string }, userId: string): Promise<MemoryEntityDTO | null> {
  if (ref.entityId) return spindle.memories.entities.get(ref.entityId, userId);
  if (ref.name) return spindle.memories.entities.findByName(chatId, ref.name, userId);
  return null;
}

export function entityRow(e: MemoryEntityDTO): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    type: e.entityType,
    aliases: e.aliases,
    status: e.status,
    mentions: e.mentionCount,
    description: e.description,
  };
}
