export const MAX_FILES = 5;
// Text files at or under this size get their content inlined into the message so
// the agent sees them without a tool call (CC-style). Larger ones are path refs.
export const INLINE_TEXT_BYTES = 16 * 1024;

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
