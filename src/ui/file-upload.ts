// Shared file-upload helpers: chunked ws_upload_part streaming (used by both the
// workspace panel and composer attachments) plus attachment classification.

import type { FrontendToBackend } from "../types";

export const MAX_FILES = 5;
// Text files at or under this size get their content inlined into the message so
// the agent sees them without a tool call (CC-style). Larger ones are path refs.
export const INLINE_TEXT_BYTES = 16 * 1024;
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "xml", "yaml", "yml",
  "html", "htm", "css", "js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java",
  "c", "h", "cpp", "lua", "sh", "ini", "toml", "log", "srt", "vtt", "sql", "svg",
]);

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/xml") return true;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return TEXT_EXTS.has(ext);
}

// Workspace path validation rejects backslashes, control chars, and `..`. Keep a
// conservative charset and prefix with the attachment id to avoid collisions.
export function safeAttachmentName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Stream bytes to a workspace path via chunked ws_upload_part. The backend
// assembles by index and writes once all parts arrive (and acks with
// ws_upload_complete). Single source for both the workspace panel and composer.
// `onProgress` reports the fraction of chunks sent (0..1). Yields between chunks
// so a big file doesn't freeze the main thread on base64 and the WS can drain.
export async function streamUpload(
  send: (m: FrontendToBackend) => void,
  path: string,
  bytes: Uint8Array,
  transferId: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const total = Math.max(1, Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES));
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(i * UPLOAD_CHUNK_BYTES, Math.min(bytes.length, (i + 1) * UPLOAD_CHUNK_BYTES));
    send({ type: "ws_upload_part", transferId, path, dataBase64: bytesToBase64(slice), index: i, total });
    onProgress?.((i + 1) / total);
    if (i < total - 1) await new Promise((r) => setTimeout(r, 0));
  }
}
