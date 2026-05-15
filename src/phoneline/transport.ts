import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  PHONELINE_ENDPOINT,
  PHONELINE_REQUEST_CHANNEL,
  type PhoneLineRequest,
  type SurfaceManifest,
  type SystemPromptResponse,
  type CheckWriteResponse,
  type CheckReadResponse,
  type ListItemsResponse,
  type ReadItemResponse,
  type WriteFieldResponse,
  type GrepItemsResponse,
  type MutationResponse,
} from "./protocol";

let callIdCounter = 0;
function makeCallId(): string {
  callIdCounter++;
  return `pl_${Date.now().toString(36)}_${callIdCounter}`;
}

let dialChain: Promise<unknown> = Promise.resolve();

// Per-dial hard timeout. The chain is global, so a hung responder would
// otherwise stall every user's chat.
const DIAL_TIMEOUT_MS = 15_000;

async function dial<T>(spindle: SpindleAPI, extId: string, request: PhoneLineRequest): Promise<T> {
  const existing = (request as { callId?: string }).callId;
  const enriched = { ...request, callId: existing ?? makeCallId() } as PhoneLineRequest;
  const run = async (): Promise<T> => {
    spindle.rpcPool.sync(PHONELINE_REQUEST_CHANNEL, enriched);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`phoneline dial to '${extId}' timed out after ${DIAL_TIMEOUT_MS}ms`)), DIAL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        spindle.rpcPool.read<T>(PHONELINE_ENDPOINT(extId)),
        timeout,
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };
  const next = dialChain.then(run, run);
  // Keep the chain alive even if this dial rejected, so a failure on one
  // caller doesn't poison every later dial.
  dialChain = next.catch(() => undefined);
  return next;
}

export function dialDescribe(spindle: SpindleAPI, extId: string): Promise<SurfaceManifest> {
  return dial<SurfaceManifest>(spindle, extId, { op: "describe" });
}

export function dialSystemPrompt(
  spindle: SpindleAPI,
  extId: string,
  userId: string,
  characterId: string,
): Promise<SystemPromptResponse> {
  return dial<SystemPromptResponse>(spindle, extId, { op: "system_prompt", userId, characterId });
}

export function dialCheckWrite(
  spindle: SpindleAPI,
  extId: string,
  userId: string,
  characterId: string,
  extPath: string,
): Promise<CheckWriteResponse> {
  return dial<CheckWriteResponse>(spindle, extId, { op: "check_write", userId, characterId, extPath });
}

export function dialCheckRead(
  spindle: SpindleAPI,
  extId: string,
  userId: string,
  characterId: string,
  extPath: string,
): Promise<CheckReadResponse> {
  return dial<CheckReadResponse>(spindle, extId, { op: "check_read", userId, characterId, extPath });
}

export function dialListItems(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "list_items" }>, "op">,
): Promise<ListItemsResponse> {
  return dial<ListItemsResponse>(spindle, extId, { op: "list_items", ...req });
}

export function dialReadItem(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "read_item" }>, "op">,
): Promise<ReadItemResponse> {
  return dial<ReadItemResponse>(spindle, extId, { op: "read_item", ...req });
}

export function dialWriteField(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "write_field" }>, "op">,
): Promise<WriteFieldResponse> {
  return dial<WriteFieldResponse>(spindle, extId, { op: "write_field", ...req });
}

export function dialGrepItems(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "grep_items" }>, "op">,
): Promise<GrepItemsResponse> {
  return dial<GrepItemsResponse>(spindle, extId, { op: "grep_items", ...req });
}

export function dialAssetMutate(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "asset_mutate" }>, "op">,
): Promise<MutationResponse> {
  return dial<MutationResponse>(spindle, extId, { op: "asset_mutate", ...req });
}

export function dialAttachModule(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "attach_module" }>, "op">,
): Promise<MutationResponse> {
  return dial<MutationResponse>(spindle, extId, { op: "attach_module", ...req });
}

export function dialDetachModule(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "detach_module" }>, "op">,
): Promise<MutationResponse> {
  return dial<MutationResponse>(spindle, extId, { op: "detach_module", ...req });
}

export function dialSetToggle(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "set_toggle" }>, "op">,
): Promise<MutationResponse> {
  return dial<MutationResponse>(spindle, extId, { op: "set_toggle", ...req });
}

export function dialSetChatVariable(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "set_chat_variable" }>, "op">,
): Promise<MutationResponse> {
  return dial<MutationResponse>(spindle, extId, { op: "set_chat_variable", ...req });
}

export function dialSetDefaultVariablesText(
  spindle: SpindleAPI,
  extId: string,
  req: Omit<Extract<PhoneLineRequest, { op: "set_default_variables_text" }>, "op">,
): Promise<MutationResponse> {
  return dial<MutationResponse>(spindle, extId, { op: "set_default_variables_text", ...req });
}
