// rpcPool is pull-only. We sync the payload to our own prefix, the handler reads it back via the requester id. Serial within a turn so no race.
// Channel name avoids the `lumiagent.` prefix because spindle's normalize would dedupe `lumiagent.lumiagent.x` to `lumiagent.x` and the handler would miss.

import type { SpindleAPI } from "lumiverse-spindle-types";

interface BaseRequest {
  readonly userId: string;
  readonly callId?: string;
}

export interface ListItemsRequest extends BaseRequest {
  readonly op: "list_items";
  readonly surfaceId: string;
  readonly characterId?: string;
}

export interface ReadItemRequest extends BaseRequest {
  readonly op: "read_item";
  readonly surfaceId: string;
  readonly itemId: string;
  readonly field?: string;
}

export interface WriteFieldRequest extends BaseRequest {
  readonly op: "write_field";
  readonly surfaceId: string;
  readonly itemId: string;
  readonly field: string;
  readonly value: unknown;
}

export type ExternalRequest = ListItemsRequest | ReadItemRequest | WriteFieldRequest;

export interface ListItemsResponse {
  readonly items: ReadonlyArray<{ id: string; label: string; brief?: Record<string, unknown> }>;
  readonly total: number;
}

export interface ReadItemResponse {
  readonly value: unknown;
  readonly meta?: Record<string, unknown>;
}

export interface WriteFieldResponse {
  readonly ok: boolean;
  readonly error?: string;
}

let callIdCounter = 0;
function makeCallId(): string {
  callIdCounter++;
  return `ext_${Date.now().toString(36)}_${callIdCounter}`;
}

async function call<T>(spindle: SpindleAPI, providerId: string, request: ExternalRequest): Promise<T> {
  const enriched: ExternalRequest = { ...request, callId: request.callId ?? makeCallId() };
  spindle.rpcPool.sync("agent_request_envelope", enriched);
  return await spindle.rpcPool.read<T>(`${providerId}.lumiagent.execute`);
}

export function callExternalList(spindle: SpindleAPI, providerId: string, req: Omit<ListItemsRequest, "op">): Promise<ListItemsResponse> {
  return call<ListItemsResponse>(spindle, providerId, { ...req, op: "list_items" });
}

export function callExternalRead(spindle: SpindleAPI, providerId: string, req: Omit<ReadItemRequest, "op">): Promise<ReadItemResponse> {
  return call<ReadItemResponse>(spindle, providerId, { ...req, op: "read_item" });
}

export function callExternalWrite(spindle: SpindleAPI, providerId: string, req: Omit<WriteFieldRequest, "op">): Promise<WriteFieldResponse> {
  return call<WriteFieldResponse>(spindle, providerId, { ...req, op: "write_field" });
}
