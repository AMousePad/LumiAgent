import { z } from "zod";
import type { EditEdit, EditRecord, MemoryVaultSnapshot } from "../../types";
import { vaultContentsHash, readVaultMetadata } from "../../state/memory-revert";
import { defineTool } from "./_framework";
import { resolveChatTarget, type ToolCtx } from "./_context";
import { spillOrReturn } from "./_io";

const id = z.string().min(1);
const pageFields = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
function page<T>(rows: T[], input: { offset?: number | undefined; limit?: number | undefined }) {
  const offset = input.offset ?? 0;
  const items = rows.slice(offset, offset + (input.limit ?? 50));
  return { total: rows.length, items, next_offset: offset + items.length < rows.length ? offset + items.length : null };
}
async function result(ctx: ToolCtx, origin: string, value: unknown) {
  return { content: await spillOrReturn(ctx, JSON.stringify(value, null, 2), origin) };
}

async function trackedUpdate(ctx: ToolCtx, record: EditEdit, read: () => Promise<string | null>, write: () => Promise<boolean>) {
  if (!ctx.stageEdit) throw new Error("durable edit tracking is unavailable");
  const staged = await ctx.stageEdit(record);
  let attempted = false;
  try {
    ctx.signal.throwIfAborted();
    if (await read() !== record.before) throw new Error("value changed before update, read it again");
    attempted = true;
    if (!await write()) throw new Error("memory object no longer exists");
    staged.commit();
  } catch (error) {
    let unchanged = false;
    try { unchanged = await read() === record.before; } catch { }
    if (!attempted || unchanged) await staged.discard();
    else staged.commit();
    throw error;
  }
}

async function recordCreations(ctx: ToolCtx, records: EditRecord[]) {
  for (let i = 0; i < records.length; i++) {
    try {
      const staged = await ctx.stageEdit!(records[i]!);
      staged.commit();
    } catch (error) {
      for (const record of records.slice(i)) ctx.pushEdit(record);
      throw new Error(`Created memory objects, but durable history could not be confirmed. Do not repeat creation. IDs: ${records.map((record) => record.surfaceId).join(", ")}. ${(error as Error).message}`);
    }
  }
}

const listVaultsInput = z.object({ query: z.string().optional(), ...pageFields }).strict();
export const listMemoryVaultsTool = defineTool({
  name: "list_memory_vaults",
  description: "List the user's memory vault snapshots. Optional name/ID substring and pagination, default 50. Read-only and live.",
  inputSchema: listVaultsInput, jsonSchema: z.toJSONSchema(listVaultsInput), isReadOnly: () => true,
  execute: async (input, ctx) => {
    const query = input.query?.toLowerCase() ?? "";
    const rows = (await ctx.spindle.memories.vaults.list(ctx.userId))
      .filter((vault) => `${vault.id} ${vault.name}`.toLowerCase().includes(query)).sort((a, b) => a.id.localeCompare(b.id));
    return result(ctx, "list_memory_vaults", page(rows, input));
  },
});

const readVaultInput = z.object({ vault_id: id, section: z.enum(["summary", "entities", "relations", "chunks"]), ...pageFields }).strict();
export const readMemoryVaultTool = defineTool({
  name: "read_memory_vault",
  description: "Read a vault's metadata or page through its snapshot entities, relations, or memory chunks. Default page size 50. Large results spill to workspace tmp handles. Does not reindex or change the vault.",
  inputSchema: readVaultInput, jsonSchema: z.toJSONSchema(readVaultInput), isReadOnly: () => true,
  execute: async (input, ctx) => {
    const contents = await ctx.spindle.memories.vaults.get(input.vault_id, ctx.userId);
    if (!contents) throw new Error("memory vault not found");
    if (input.section === "summary") return result(ctx, "read_memory_vault", contents.vault);
    const rows = input.section === "chunks" ? await ctx.spindle.memories.vaults.getChunks(input.vault_id, ctx.userId) : contents[input.section];
    return result(ctx, "read_memory_vault", { vault: contents.vault, section: input.section, ...page<unknown>(rows, input) });
  },
});

const createVaultInput = z.object({ chat_id: id.optional(), name: z.string().trim().min(1).max(200), description: z.string().max(4000).optional() }).strict();
export const createMemoryVaultTool = defineTool({
  name: "create_memory_vault",
  description: "Snapshot a chat's memory into a new vault. Defaults to the pinned chat. Tracked in Workshop. Undo removes only this unchanged vault and refuses while any chat links reference it. No permanent-delete or reindex tool is provided.",
  inputSchema: createVaultInput, jsonSchema: z.toJSONSchema(createVaultInput),
  execute: async (input, ctx) => {
    if (!ctx.stageEdit) throw new Error("durable edit tracking is unavailable");
    ctx.signal.throwIfAborted();
    const vault = await ctx.spindle.memories.vaults.create({ chatId: resolveChatTarget(ctx, input.chat_id), name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}) }, ctx.userId);
    const snapshot: MemoryVaultSnapshot = { vault, contentsHash: null };
    let warning: string | undefined;
    try { snapshot.contentsHash = await vaultContentsHash(ctx.spindle, ctx.userId, vault.id); }
    catch { warning = "Created, but snapshot verification failed. Undo will keep this vault. Do not repeat creation."; }
    await recordCreations(ctx, [{ op: "create", surface: "memory_vault", surfaceId: vault.id, surfaceLabel: vault.name,
      snapshot, scope: { kind: "memory_vault", id: vault.id } }]);
    return { content: JSON.stringify({ vault, ...(warning ? { warning } : {}) }) };
  },
});

const renameVaultInput = z.object({ vault_id: id, expected_name: z.string(), name: z.string().trim().min(1).max(200) }).strict();
export const renameMemoryVaultTool = defineTool({
  name: "rename_memory_vault",
  description: "Rename a memory vault. Supply expected_name from a fresh read to protect manual changes. Workshop tracks the name field. Undo stops on later manual edits, including when force is requested.",
  inputSchema: renameVaultInput, jsonSchema: z.toJSONSchema(renameVaultInput),
  execute: async (input, ctx) => {
    const read = async () => (await readVaultMetadata(ctx.spindle, ctx.userId, input.vault_id))?.name ?? null;
    if (await read() !== input.expected_name) throw new Error("vault name changed or vault not found, read it again");
    if (input.name === input.expected_name) return { content: JSON.stringify({ changed: false }) };
    await trackedUpdate(ctx, { op: "edit", surface: "memory_vault", surfaceId: input.vault_id, surfaceLabel: input.name,
      field: "name", before: input.expected_name, after: input.name, scope: { kind: "memory_vault", id: input.vault_id } }, read,
      () => ctx.spindle.memories.vaults.rename(input.vault_id, input.name, ctx.userId));
    return { content: JSON.stringify({ vault_id: input.vault_id, name: input.name, changed: true }) };
  },
});

const listLinksInput = z.object({ chat_id: id.optional(), ...pageFields }).strict();
export const listMemoryLinksTool = defineTool({
  name: "list_memory_links",
  description: "Read a chat's live vault attachments and cross-chat memory links, including disabled links. Defaults to the pinned chat, 50 items per page.",
  inputSchema: listLinksInput, jsonSchema: z.toJSONSchema(listLinksInput), isReadOnly: () => true,
  execute: async (input, ctx) => {
    const chatId = resolveChatTarget(ctx, input.chat_id);
    const rows = await ctx.spindle.memories.links.list(chatId, ctx.userId);
    return result(ctx, "list_memory_links", { chat_id: chatId, ...page(rows, input) });
  },
});

const attachLinkInput = z.object({ chat_id: id.optional(), vault_id: id.optional(), target_chat_id: id.optional(),
  label: z.string().max(200).optional(), bidirectional: z.boolean().optional() }).strict();
export const attachMemoryLinkTool = defineTool({
  name: "attach_memory_link",
  description: "Attach a vault OR another chat's memories to a chat. Specify exactly one of vault_id and target_chat_id. Chat defaults to pinned. Bidirectional is for chat links only. Workshop tracks each newly created link, preserving existing reverse links. Undo refuses if the link was manually changed. Disable existing links with set_memory_link_enabled.",
  inputSchema: attachLinkInput, jsonSchema: z.toJSONSchema(attachLinkInput),
  execute: async (input, ctx) => {
    if (!!input.vault_id === !!input.target_chat_id || (input.vault_id && input.bidirectional)) throw new Error("specify one vault_id or target_chat_id, bidirectional is for chat links only");
    if (!ctx.stageEdit) throw new Error("durable edit tracking is unavailable");
    ctx.signal.throwIfAborted();
    const created = await ctx.spindle.memories.links.attach({ chatId: resolveChatTarget(ctx, input.chat_id),
      linkType: input.vault_id ? "vault" : "interlink",
      ...(input.vault_id ? { vaultId: input.vault_id } : { targetChatId: input.target_chat_id! }),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.bidirectional !== undefined ? { bidirectional: input.bidirectional } : {}),
    }, ctx.userId);
    await recordCreations(ctx, created.map((link) => ({ op: "create", surface: "memory_link", surfaceId: `${link.chatId}:${link.id}`,
      surfaceLabel: link.label || link.vaultName || link.targetChatName || "Memory link", snapshot: link, scope: { kind: "chat", id: link.chatId } })));
    return { content: JSON.stringify({ created }) };
  },
});

const toggleLinkInput = z.object({ chat_id: id.optional(), link_id: id, expected_enabled: z.boolean(), enabled: z.boolean() }).strict();
export const setMemoryLinkEnabledTool = defineTool({
  name: "set_memory_link_enabled",
  description: "Enable or disable a memory link without deleting it. Supply expected_enabled from list_memory_links. Workshop tracks only the enabled field, preserves other fields, and stops undo on later manual changes to enabled.",
  inputSchema: toggleLinkInput, jsonSchema: z.toJSONSchema(toggleLinkInput),
  execute: async (input, ctx) => {
    const chatId = resolveChatTarget(ctx, input.chat_id);
    const read = async () => {
      const link = (await ctx.spindle.memories.links.list(chatId, ctx.userId)).find((item) => item.id === input.link_id);
      return link ? JSON.stringify(link.enabled) : null;
    };
    if (await read() !== JSON.stringify(input.expected_enabled)) throw new Error("link changed or not found, read it again");
    if (input.enabled === input.expected_enabled) return { content: JSON.stringify({ changed: false }) };
    await trackedUpdate(ctx, { op: "edit", surface: "memory_link", surfaceId: `${chatId}:${input.link_id}`, surfaceLabel: "Memory link",
      field: "enabled", before: JSON.stringify(input.expected_enabled), after: JSON.stringify(input.enabled), valueEncoding: "json",
      scope: { kind: "chat", id: chatId } }, read,
      () => ctx.spindle.memories.links.toggle(chatId, input.link_id, input.enabled, ctx.userId));
    return { content: JSON.stringify({ chat_id: chatId, link_id: input.link_id, enabled: input.enabled, changed: true }) };
  },
});

export const memoryVaultLinkTools = [listMemoryVaultsTool, readMemoryVaultTool, createMemoryVaultTool, renameMemoryVaultTool,
  listMemoryLinksTool, attachMemoryLinkTool, setMemoryLinkEnabledTool] as const;
