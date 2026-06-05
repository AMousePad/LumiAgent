import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

// Shape the host's cors_proxy returns. `body` is text, or base64 when the
// request asked for arraybuffer (image/audio/font only, magic-byte validated).
interface CorsResponse {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body: string;
  encoding?: string;
}

const inputSchema = z.object({
  url: z.string().url(),
  save_to: z.string().optional(),
  as: z.enum(["text", "image"]).optional(),
}).strict();

export const webFetchTool = defineTool({
  name: "web_fetch",
  description: "Fetch a single URL through the Lumiverse CORS proxy and optionally save it to the workspace. Default `as: 'text'` returns the raw body (HTML/JSON/text) and, with `save_to`, writes it to a workspace file. Use `as: 'image'` with a required `save_to` to download an image (png/jpg/gif/webp) straight to the workspace as bytes (the image data is not dumped into the reply). Pair with web_search: search first, then web_fetch the URLs worth keeping.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Fully-formed http(s) URL." },
      save_to: { type: "string", description: "Optional workspace path to save to. Required when as='image'." },
      as: { type: "string", enum: ["text", "image"], description: "text (default) returns/saves the body; image downloads bytes to save_to." },
    },
    required: ["url"],
  },
  isReadOnly: (input) => (input as { save_to?: unknown }).save_to === undefined,
  execute: async (input, ctx) => {
    const url = input.url.trim();
    if (!/^https?:\/\//i.test(url)) return { content: "Error: url must start with http:// or https://", isError: true };
    const ws = await import("../../state/workspace");

    if ((input.as ?? "text") === "image") {
      if (!input.save_to) return { content: "Error: as='image' requires save_to (a workspace path like 'images/foo.png').", isError: true };
      let resp: CorsResponse;
      try { resp = await ctx.spindle.cors(url, { responseType: "arraybuffer", mediaType: "image" }) as CorsResponse; }
      catch (err) { return { content: `Error fetching image: ${(err as Error).message}`, isError: true }; }
      if (resp.status >= 400) return { content: `Error: HTTP ${resp.status} ${resp.statusText || ""} fetching ${url}`, isError: true };
      const bytes = new Uint8Array(Buffer.from(resp.body, "base64"));
      try {
        const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
        await ws.writeBinary(ctx.spindle, ctx.userId, input.save_to, bytes, caps);
      } catch (err) { return { content: `Error saving image: ${(err as Error).message}`, isError: true }; }
      return { content: JSON.stringify({ url, saved_to: input.save_to, bytes: bytes.length, content_type: resp.headers?.["content-type"] ?? null }) };
    }

    let resp: CorsResponse;
    try { resp = await ctx.spindle.cors(url, { responseType: "text" }) as CorsResponse; }
    catch (err) { return { content: `Error fetching url: ${(err as Error).message}`, isError: true }; }
    if (resp.status >= 400) return { content: `Error: HTTP ${resp.status} ${resp.statusText || ""} fetching ${url}`, isError: true };
    const body = typeof resp.body === "string" ? resp.body : String(resp.body);

    let savedNote = "";
    if (input.save_to) {
      try {
        const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
        await ws.writeText(ctx.spindle, ctx.userId, input.save_to, body, caps);
        savedNote = `Saved ${body.length} chars to workspace '${input.save_to}'.\n\n`;
      } catch (err) { savedNote = `(Could not save to '${input.save_to}': ${(err as Error).message})\n\n`; }
    }
    const header = `# Fetched ${url} (HTTP ${resp.status}, ${body.length} chars)\n\n`;
    const out = await spillOrReturn(ctx, header + body, `web_fetch:${url}`, "Raw response body. Pass save_to to persist it, or fs_write the parts you need.");
    return { content: savedNote + out };
  },
});
