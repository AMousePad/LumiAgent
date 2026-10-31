import type { SpindleAPI, SpindleFileRef } from "lumiverse-spindle-types";
import type { WorkspaceAction, WorkspaceResult } from "../workspace-contract";
import * as workspace from "./workspace";

const mutationTails = new Map<string, Promise<unknown>>();

export async function workspaceAction(spindle: SpindleAPI, userId: string, input: WorkspaceAction): Promise<WorkspaceResult> {
  if (["list", "preview", "download"].includes(input.action)) return execute(spindle, userId, input);
  const previous = mutationTails.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => execute(spindle, userId, input));
  mutationTails.set(userId, next);
  try { return await next; }
  finally { if (mutationTails.get(userId) === next) mutationTails.delete(userId); }
}

async function stageFile(spindle: SpindleAPI, userId: string, path: string): Promise<SpindleFileRef> {
  const bytes = await workspace.readBinary(spindle, userId, path);
  const file = await spindle.files.create({ fileName: path.split("/").at(-1)!, size: bytes.length, userId });
  try {
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
      await spindle.files.writeChunk(file.fileId, offset, bytes.subarray(offset, offset + 256 * 1024), userId);
    }
    return await spindle.files.finish(file.fileId, userId);
  } catch (error) { await spindle.files.delete(file.fileId, userId).catch(() => {}); throw error; }
}

async function execute(spindle: SpindleAPI, userId: string, input: WorkspaceAction): Promise<WorkspaceResult> {
  switch (input.action) {
    case "list": {
      const { ensureSystemFiles } = await import("./system-files");
      if (input.path === "") await ensureSystemFiles(spindle, userId);
      return { kind: "entries", entries: await workspace.listDir(spindle, userId, input.path, true) };
    }
    case "preview": {
      const node = await workspace.stat(spindle, userId, input.path, true);
      if (!node || node.isDirectory) throw new Error("File no longer exists");
      if (node.sizeBytes > 2 * 1024 * 1024) throw new Error("Preview is limited to 2 MB. Download to open this file.");
      const bytes = await workspace.readBinary(spindle, userId, input.path);
      if (bytes.length > 2 * 1024 * 1024) throw new Error("Preview is limited to 2 MB. Download to open this file.");
      if (/\.(png|jpe?g|gif|webp|bmp|ico|avif|mp3|wav|ogg|m4a|flac|opus|mp4|webm|mov)$/i.test(input.path)) {
        return { kind: "media", dataBase64: Buffer.from(bytes).toString("base64") };
      }
      if (bytes.includes(0)) throw new Error("This file has no text preview. Download to open it.");
      try { return { kind: "text", content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
      catch { throw new Error("This file has no UTF-8 text preview. Download to open it."); }
    }
    case "download": {
      if (!input.archive) return { kind: "file", fileId: (await stageFile(spindle, userId, input.path)).fileId };
      const files = await workspace.walk(spindle, userId, input.path, true);
      if (!files.length) throw new Error("Folder has no files to download");
      const staged: SpindleFileRef[] = [];
      try {
        const entries = [];
        for (const file of files) {
          const ref = await stageFile(spindle, userId, file.path);
          staged.push(ref);
          entries.push({ name: input.path ? file.path.slice(input.path.length + 1) : file.path, source: { fileId: ref.fileId } });
        }
        const maxBytes = Math.min(100 * 1024 ** 3, Math.ceil(staged.reduce((sum, file) => sum + file.size, 0) * 1.01) + entries.length * 512 + 65536);
        const archive = await spindle.archives.create(entries, { fileName: `${input.path.split("/").at(-1) || "workspace"}.zip`, userId, maxBytes });
        return { kind: "file", fileId: archive.fileId };
      } finally { await Promise.allSettled(staged.map(file => spindle.files.delete(file.fileId, userId))); }
    }
    case "copy":
      await workspace.copyPath(spindle, userId, input.from, input.to, { recursive: true, caps: await workspace.resolveUserCaps(spindle, userId) });
      break;
    case "move":
      await workspace.movePath(spindle, userId, input.from, input.to);
      break;
    case "mkdir":
      if (await workspace.stat(spindle, userId, input.path, true)) throw new Error("A file or folder with that name already exists");
      await workspace.makeDir(spindle, userId, input.path);
      break;
    case "delete": await workspace.remove(spindle, userId, input.path); break;
    case "write": {
      if (input.create && await workspace.stat(spindle, userId, input.path, true)) throw new Error("A file with that name already exists");
      if (input.expectedContent !== undefined && await workspace.readText(spindle, userId, input.path) !== input.expectedContent) {
        throw new Error("This file changed since you opened it. Your draft is preserved.");
      }
      await workspace.writeText(spindle, userId, input.path, input.content, await workspace.resolveUserCaps(spindle, userId), { ...(input.expectedContent === undefined ? {} : { expectedContent: input.expectedContent }), ...(input.create === undefined ? {} : { create: input.create }) });
      break;
    }
    default: throw new Error("Unsupported file action");
  }
  return { kind: "changed" };
}
