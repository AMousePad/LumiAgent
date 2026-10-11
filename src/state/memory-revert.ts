import type { ChatLinkDTO, SpindleAPI, VaultDTO } from "lumiverse-spindle-types";
import type { MemoryVaultSnapshot } from "../types";
import { sha256 } from "./patch-stack";

export async function readVaultMetadata(spindle: SpindleAPI, userId: string, id: string) {
  return (await spindle.memories.vaults.list(userId)).find((vault) => vault.id === id) ?? null;
}

export async function readOwnedVault(spindle: SpindleAPI, userId: string, id: string) {
  try { return await spindle.memories.vaults.get(id, userId); }
  catch (error) {
    if (!(await spindle.memories.vaults.list(userId)).some((vault) => vault.id === id)) return null;
    throw error;
  }
}

export async function readOwnedMemoryLinks(spindle: SpindleAPI, userId: string, chatId: string) {
  try { return await spindle.memories.links.list(chatId, userId); }
  catch (error) {
    if (!await spindle.chats.get(chatId, userId)) return [];
    throw error;
  }
}

export function memoryLinkState(link: ChatLinkDTO): string {
  return JSON.stringify([link.id, link.userId, link.chatId, link.linkType, link.vaultId,
    link.targetChatId, link.label, link.enabled, link.priority, link.createdAt]);
}

function vaultState(vault: VaultDTO): string {
  const { sourceChatName: _displayName, ...state } = vault;
  return JSON.stringify(state);
}

export async function vaultContentsHash(spindle: SpindleAPI, userId: string, id: string): Promise<string> {
  const contents = await spindle.memories.vaults.get(id, userId);
  if (!contents) throw new Error("memory vault not found");
  const chunks = await spindle.memories.vaults.getChunks(id, userId);
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return sha256(JSON.stringify([byId(contents.entities), byId(contents.relations), byId(chunks)]));
}

export async function revertMemoryCreation(
  spindle: SpindleAPI, userId: string, surface: "memory_vault" | "memory_link", snapshot: MemoryVaultSnapshot | ChatLinkDTO,
): Promise<string | null> {
  if (surface === "memory_link") {
    const original = snapshot as ChatLinkDTO;
    const live = (await readOwnedMemoryLinks(spindle, userId, original.chatId)).find((link) => link.id === original.id);
    if (!live) return null;
    if (memoryLinkState(live) !== memoryLinkState(original)) return "The link changed after creation. Its current state was kept.";
    if (!await spindle.memories.links.remove(original.chatId, original.id, userId)) throw new Error("memory link removal failed");
    return null;
  }
  const original = snapshot as MemoryVaultSnapshot;
  const live = await readOwnedVault(spindle, userId, original.vault.id);
  if (!live) return null;
  if (!original.contentsHash || vaultState(live.vault) !== vaultState(original.vault)
    || await vaultContentsHash(spindle, userId, live.vault.id) !== original.contentsHash) {
    return "The vault changed after creation or its original snapshot is incomplete. It was kept.";
  }
  // Vault deletion cascades into every attachment, including links added by the user.
  let offset = 0;
  for (;;) {
    const page = await spindle.chats.list({ userId, offset, limit: 200 });
    if (!page.data.length && offset < page.total) throw new Error("chat listing incomplete, vault was kept");
    for (const chat of page.data) {
      const links = await spindle.memories.links.list(chat.id, userId);
      if (links.some((link) => link.vaultId === original.vault.id)) return "The vault has chat links. Revert or remove those links first. The vault was kept.";
    }
    offset += page.data.length;
    if (offset >= page.total) break;
  }
  const latest = await readOwnedVault(spindle, userId, original.vault.id);
  if (!latest) return null;
  if (vaultState(latest.vault) !== vaultState(original.vault)
    || await vaultContentsHash(spindle, userId, latest.vault.id) !== original.contentsHash) return "The vault changed during undo. It was kept.";
  if (!await spindle.memories.vaults.delete(original.vault.id, userId)) throw new Error("memory vault removal failed");
  return null;
}
