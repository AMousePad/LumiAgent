// Surface-provider protocol. Opt-in extensions expose two rpcPool endpoints
// under their own prefix: `<extId>.lumiagent.describe` (sync, static manifest)
// and `<extId>.lumiagent.execute` (handle, dispatches list/read/write).

export interface SurfaceField {
  readonly path: string;
  readonly label: string;
  readonly description?: string;
  readonly type: "string" | "array" | "object" | "any";
  readonly editable: boolean;
  readonly large?: boolean;
}

export interface SurfaceDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly item_kind: string;
  readonly scope: { kind: "global" | "per_character" };
  readonly fields: readonly SurfaceField[];
}

export interface SurfaceManifest {
  readonly extension: { id: string; name: string; version?: string };
  readonly surfaces: readonly SurfaceDescriptor[];
}

export interface SurfaceItem {
  readonly id: string;
  readonly label: string;
  readonly brief?: Record<string, unknown>;
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

// Endpoint name helpers — keep these in one place so any rename is one-line.
export const ENDPOINTS = {
  describe: (extId: string): string => `${extId}.lumiagent.describe`,
  list: (extId: string): string => `${extId}.lumiagent.list_items`,
  read: (extId: string): string => `${extId}.lumiagent.read_item`,
  write: (extId: string): string => `${extId}.lumiagent.write_field`,
} as const;
