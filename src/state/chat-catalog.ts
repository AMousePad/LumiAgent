import type { ChatDTO, SpindleAPI } from "lumiverse-spindle-types";

const CHAT_PAGE_SIZE = 200;

export type GroupLorebookMode = "active_character" | "all_unmuted" | "all";

function chatMetadata(chat: ChatDTO): Readonly<Record<string, unknown>> {
  const metadata = (chat as unknown as { metadata?: unknown }).metadata;
  return metadata && typeof metadata === "object"
    ? metadata as Readonly<Record<string, unknown>>
    : {};
}

export function isGroupChat(chat: ChatDTO): boolean {
  const group = chatMetadata(chat)["group"];
  return group === true || group === 1;
}

export function groupCharacterIds(chat: ChatDTO): string[] {
  const raw = chatMetadata(chat)["character_ids"];
  const ids = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0 && typeof chat.character_id === "string" && chat.character_id.length > 0) {
    ids.push(chat.character_id);
  }
  return [...new Set(ids)];
}

export function groupLorebookMode(chat: ChatDTO): GroupLorebookMode {
  const metadata = chatMetadata(chat);
  const explicit = metadata["group_lorebook_mode"];
  if (explicit === "active_character" || explicit === "all_unmuted" || explicit === "all") {
    return explicit;
  }
  if (metadata["group_card_mode"] === "merge") return "all";
  if (metadata["group_card_mode"] === "merge_ignore_muted") return "all_unmuted";
  return "active_character";
}

export function lorebookCharacterIds(chat: ChatDTO, focusedCharacterId: string | null): string[] {
  if (!isGroupChat(chat)) return chat.character_id ? [chat.character_id] : [];
  const members = groupCharacterIds(chat);
  const mode = groupLorebookMode(chat);
  if (mode === "all") return members;
  const active = focusedCharacterId && members.includes(focusedCharacterId)
    ? focusedCharacterId
    : members.includes(chat.character_id)
      ? chat.character_id
      : members[0];
  if (mode === "all_unmuted") {
    const metadata = chatMetadata(chat);
    const muted = new Set(
      Array.isArray(metadata["muted_character_ids"])
        ? metadata["muted_character_ids"].filter((id): id is string => typeof id === "string")
        : [],
    );
    const unmuted = members.filter((id) => !muted.has(id));
    return unmuted.length > 0 ? unmuted : active ? [active] : [];
  }
  return active ? [active] : [];
}

export function chatIncludesCharacter(chat: ChatDTO, characterId: string): boolean {
  return isGroupChat(chat)
    ? groupCharacterIds(chat).includes(characterId)
    : chat.character_id === characterId;
}

export function countChatsByCharacter(chats: readonly ChatDTO[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chat of chats) {
    const characterIds = isGroupChat(chat) ? groupCharacterIds(chat) : [chat.character_id];
    for (const characterId of new Set(characterIds)) {
      if (!characterId) continue;
      counts.set(characterId, (counts.get(characterId) ?? 0) + 1);
    }
  }
  return counts;
}

export async function listAllChats(spindle: SpindleAPI, userId: string): Promise<ChatDTO[]> {
  const chats: ChatDTO[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await spindle.chats.list({ userId, limit: CHAT_PAGE_SIZE, offset });
    total = Math.max(0, page.total);
    for (const chat of page.data) {
      if (seen.has(chat.id)) continue;
      seen.add(chat.id);
      chats.push(chat);
    }
    if (page.data.length === 0) break;
    offset += page.data.length;
  }
  return chats;
}

export async function listChatsForCharacter(
  spindle: SpindleAPI,
  userId: string,
  characterId: string,
): Promise<ChatDTO[]> {
  const chats = await listAllChats(spindle, userId);
  return chats
    .filter((chat) => chatIncludesCharacter(chat, characterId))
    .sort((a, b) => b.updated_at - a.updated_at);
}
