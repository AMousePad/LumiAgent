// The phone-line protocol. Any extension that wants the agent to see its data
// implements ONE rpcPool handler at `<extId>.phoneline`. The caller publishes
// its request envelope at `<callerExtId>.phoneline_request` before reading the
// extension's `phoneline` endpoint; the handler reads the envelope by the
// requester id. rpcPool is pull-only, so this stays serial within a turn.
//
// Required op: `describe`. Optional ops: `system_prompt`, `check_write`,
// `list_items`, `read_item`, `write_field`. Optional means the extension can
// throw "unknown op" and the caller falls back to "no contribution / allow".

export interface SurfaceDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope: "global" | "per_character";
}

export interface SurfaceManifest {
  // `id` is overridden by the registry with the host-attested channel
  // namespace before consent. Other fields are self-declared by extension
  // code and CANNOT be trusted as identity claims. They exist for agent
  // consumption (e.g. version-conditioning prompt logic), not for trust UX.
  readonly extension: { id: string; name: string; version?: string };
  readonly surfaces: readonly SurfaceDescriptor[];
  // Path prefixes under `character.extensions.*` that LumiAgent's find tools
  // (grep, survey_cjk, apply_glossary, audit_card_coverage) should skip.
  // Useful for derived projections / frozen snapshots whose canonical source
  // lives elsewhere: surfacing them in find results is wasteful since edits
  // get refused anyway. A prefix matches itself, `prefix.`, and `prefix[`.
  readonly excludeFromSearch?: readonly string[];
}

export interface SurfaceItem {
  readonly id: string;
  readonly label: string;
  readonly brief?: Record<string, unknown>;
}

interface BaseRequest {
  readonly userId: string;
  readonly callId?: string;
}

export interface DescribeRequest {
  readonly op: "describe";
}

export interface SystemPromptRequest extends BaseRequest {
  readonly op: "system_prompt";
  readonly characterId: string;
}

export interface CheckWriteRequest extends BaseRequest {
  readonly op: "check_write";
  readonly characterId: string;
  readonly extPath: string;
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

export interface GrepItemsRequest extends BaseRequest {
  readonly op: "grep_items";
  readonly surfaceId: string;
  readonly characterId?: string;
  readonly pattern: string;
  readonly ignoreCase?: boolean;
  // Optional path-prefix filter (path-segment aware). Only leaves whose path
  // equals the prefix, or starts with `prefix.`, or starts with `prefix[`,
  // are considered. Use to scope a search to e.g. "module.regex".
  readonly fieldPrefix?: string;
  readonly head?: number;
}

export type PhoneLineRequest =
  | DescribeRequest
  | SystemPromptRequest
  | CheckWriteRequest
  | ListItemsRequest
  | ReadItemRequest
  | WriteFieldRequest
  | GrepItemsRequest;

export interface SystemPromptResponse {
  readonly text: string | null;
}

export interface CheckWriteResponse {
  readonly ok: boolean;
  readonly message?: string;
}

export interface ListItemsResponse {
  readonly items: readonly SurfaceItem[];
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

export interface GrepItemHit {
  readonly itemId: string;
  readonly itemLabel?: string;
  readonly fieldPath: string;
  readonly line: number;
  readonly match: string;
  readonly preview: string;
}

export interface GrepItemsResponse {
  readonly hits: readonly GrepItemHit[];
  readonly truncated: boolean;
}

export const PHONELINE_ENDPOINT = (extId: string): string => `${extId}.phoneline`;
export const PHONELINE_REQUEST_CHANNEL = "phoneline_request";
