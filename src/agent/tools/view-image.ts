import { z } from "zod";
import { defineTool } from "./_framework";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
// Fallback base64 ceiling when the browser resize RPC is unavailable. Keeps the
// inline image under the Anthropic 5 MB limit and the prompt sane.
const MAX_B64 = 3_600_000;

function makeAttachmentId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

const inputSchema = z.object({ path: z.string().min(1) }).strict();

export const viewImageTool = defineTool({
  name: "view_image",
  description: "Load an image file from the workspace so you can actually see it (needs a vision-capable connection). Pass a workspace path like 'screenshots/rule.png'. The image becomes visible to you on the next step. Supported: png, jpg, gif, webp.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative image path." } },
    required: ["path"],
  },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    if (!ctx.queueImage) return { content: "Error: image viewing isn't available in this context.", isError: true };
    const ext = input.path.toLowerCase().split(".").pop() ?? "";
    if (!IMAGE_EXTS.has(ext)) return { content: `Error: '${input.path}' is not a supported image (png/jpg/gif/webp).`, isError: true };
    const ws = await import("../../state/workspace");
    const node = await ws.stat(ctx.spindle, ctx.userId, input.path);
    if (!node) return { content: `Error: workspace path '${input.path}' not found`, isError: true };
    if (node.isDirectory) return { content: `Error: '${input.path}' is a directory, not an image`, isError: true };
    let bytes: Uint8Array;
    try { bytes = await ws.readBinary(ctx.spindle, ctx.userId, input.path); }
    catch (err) { return { content: `Error reading '${input.path}': ${(err as Error).message}`, isError: true }; }

    let data = Buffer.from(bytes).toString("base64");
    let mime = mimeForExt(ext);
    let outExt = ext;
    // Resize in the browser: the worker sandbox can't run image libraries. Falls
    // back to the original bytes (with a size guard) when the RPC is unavailable.
    if (ctx.callFrontend) {
      try {
        const r = await ctx.callFrontend("image_resize", { data, mime_type: mime }, 30_000) as { data?: string; mime_type?: string } | null;
        if (r && typeof r.data === "string" && r.data.length > 0) {
          data = r.data;
          if (typeof r.mime_type === "string" && r.mime_type.length > 0) {
            mime = r.mime_type;
            outExt = mime.split("/")[1] ?? outExt;
          }
        }
      } catch { /* fall through to raw bytes with the size guard below */ }
    }
    if (data.length > MAX_B64) {
      return { content: `Error: '${input.path}' is too large to view (${Math.round(data.length / 1024)} KB base64) and could not be downscaled. Resize it under ~2.7 MB and retry.`, isError: true };
    }
    // Persist the (resized) bytes so the injected image is a path ref like a
    // composer attachment, not base64 in session history.
    const outPath = `attachments/${ctx.sessionId}/viewed-${makeAttachmentId()}.${outExt}`;
    const bin = new Uint8Array(Buffer.from(data, "base64"));
    try { await ws.writeBinary(ctx.spindle, ctx.userId, outPath, bin); }
    catch (err) { return { content: `Error caching image for view: ${(err as Error).message}`, isError: true }; }
    ctx.queueImage({ path: outPath, mime_type: mime, label: input.path });
    return { content: `Loaded '${input.path}' (${node.sizeBytes} bytes, ${mime}). It is visible to you starting on the next step. If you cannot see it, the active connection's model may not support vision.` };
  },
});
