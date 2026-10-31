import type { WorkspaceEntry } from "./types";

export type WorkspaceAction =
  | { action: "list"; path: string }
  | { action: "preview"; path: string }
  | { action: "download"; path: string; archive: boolean }
  | { action: "write"; path: string; content: string; expectedContent?: string; create?: boolean }
  | { action: "mkdir" | "delete"; path: string }
  | { action: "copy" | "move"; from: string; to: string };

export type WorkspaceResult =
  | { kind: "entries"; entries: readonly WorkspaceEntry[] }
  | { kind: "text"; content: string }
  | { kind: "media"; dataBase64: string }
  | { kind: "file"; fileId: string }
  | { kind: "changed" };
