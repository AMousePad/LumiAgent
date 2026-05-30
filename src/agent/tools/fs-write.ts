import { z } from "zod";
import { defineTool } from "./_framework";
import { stashDraft, loadDraft, draftReuseNote } from "./_drafts";

const inputSchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
  content_handle: z.string().optional(),
}).refine((d) => d.content !== undefined || d.content_handle !== undefined, {
  message: "either content or content_handle is required",
});

export const fsWriteTool = defineTool({
  name: "fs_write",
  description: "Create or overwrite a text file in the workspace. Use fs_edit for find/replace on existing files. Pass `content` for a literal payload or `content_handle` to reuse a stashed draft. Subject to per-file size cap and per-user storage cap.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      content_handle: { type: "string", description: "Handle of a previously-stashed draft. Use instead of content to avoid re-emitting." },
    },
    required: ["path"],
  },
  execute: async (input, ctx) => {
    let content = input.content;
    if (content === undefined && input.content_handle) {
      const loaded = await loadDraft(ctx, input.content_handle);
      if (loaded === null) return { content: `Error: draft handle '${input.content_handle}' not found or expired. Re-send content literally.`, isError: true };
      content = loaded;
    }
    if (content === undefined) return { content: "Error: provide either content or content_handle.", isError: true };

    const ws = await import("../../state/workspace");
    try {
      const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
      await ws.writeText(ctx.spindle, ctx.userId, input.path, content, caps);
    } catch (err) {
      const h = await stashDraft(ctx, `fs_write:${input.path}`, content);
      return { content: `Error: ${(err as Error).message}\n\n${draftReuseNote(h, content.length, "content")}`, isError: true };
    }
    const node = await ws.stat(ctx.spindle, ctx.userId, input.path);
    return { content: JSON.stringify({ path: input.path, bytes_written: content.length, ...node }) };
  },
});
