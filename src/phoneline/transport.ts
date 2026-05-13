import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  PHONELINE_ENDPOINT,
  PHONELINE_REQUEST_CHANNEL,
  type PhoneLineRequest,
  type SurfaceManifest,
  type SystemPromptResponse,
  type CheckWriteResponse,
  type ListItemsResponse,
  type ReadItemResponse,
  type WriteFieldResponse,
} from "./protocol";

let callIdCounter = 0;
function makeCallId(): string {
  callIdCounter++;
  return `pl_${Date.now().toString(36)}_${callIdCounter}`;
}

async function dial<T>(spindle: SpindleAPI, extId: string, request: PhoneLineRequest): Promise<T> {
  const existing = (request as { callId?: string }).callId;
  const enriched = { ...request, callId: existing ?? makeCallId() } as PhoneLineRequest;
  spindle.rpcPool.sync(PHONELINE_REQUEST_CHANNEL, enriched);
  return await spindle.rpcPool.read<T>(PHONELINE_ENDPOINT(extId));
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
