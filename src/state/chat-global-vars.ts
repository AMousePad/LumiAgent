import type { SpindleAPI } from "lumiverse-spindle-types";

const MAX_ATTEMPTS = 8;

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Bag : {};
}

export function chatGlobalVars(metadata: unknown): Bag {
  return bag(bag(bag(metadata)["macro_variables"])["global"]);
}

export function varText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export async function readChatGlobalVar(spindle: SpindleAPI, chatId: string, key: string, userId: string): Promise<string | null> {
  const chat = await spindle.chats.get(chatId, userId);
  if (!chat) throw new Error(`Chat ${chatId} not found`);
  const vars = chatGlobalVars(chat.metadata);
  return Object.hasOwn(vars, key) ? varText(vars[key]) : null;
}

// Changes one metadata key against a fresh read. A plain chats.update would overwrite variables a running generation just saved.
export async function updateChatMetadataKey<T>(
  spindle: SpindleAPI,
  chatId: string,
  key: string,
  next: (current: unknown) => T | undefined,
  userId: string,
): Promise<{ changed: boolean; value: unknown }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const chat = await spindle.chats.get(chatId, userId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    const metadata = bag(chat.metadata);
    const value = next(metadata[key]);
    if (value === undefined) return { changed: false, value: metadata[key] };
    const merged = { ...metadata, [key]: value };
    if (typeof spindle.chats.compareAndSetMetadata !== "function") {
      await spindle.chats.update(chatId, { metadata: merged }, userId);
      return { changed: true, value };
    }
    if (await spindle.chats.compareAndSetMetadata(chatId, { expected_metadata: metadata, metadata: merged }, userId)) return { changed: true, value };
  }
  throw new Error(`chat ${chatId} kept changing while it was being saved. Nothing was written, retry the call`);
}

// The {{getgvar}} family reads chat.metadata.macro_variables.global, not the user-level setting behind variables.global.
// chats.update replaces the whole metadata object, so the write is a compare-and-set on a fresh read.
export async function writeChatGlobalVar(
  spindle: SpindleAPI,
  chatId: string,
  key: string,
  value: string | null,
  userId: string,
): Promise<{ before: string | null; after: string | null }> {
  if (typeof spindle.chats.compareAndSetMetadata !== "function") {
    throw new Error("this Lumiverse version cannot update chat metadata safely. Update Lumiverse, then retry");
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const chat = await spindle.chats.get(chatId, userId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    const metadata = bag(chat.metadata);
    const vars = { ...chatGlobalVars(metadata) };
    const before = Object.hasOwn(vars, key) ? varText(vars[key]) : null;
    if (before === value) return { before, after: value };
    if (value === null) delete vars[key];
    else vars[key] = value;
    const updated = await spindle.chats.compareAndSetMetadata(chatId, {
      expected_metadata: metadata,
      metadata: { ...metadata, macro_variables: { ...bag(metadata["macro_variables"]), global: vars } },
    }, userId);
    if (updated) return { before, after: value };
  }
  throw new Error(`chat ${chatId} kept changing while the variable was being saved. Nothing was written, retry the call`);
}
