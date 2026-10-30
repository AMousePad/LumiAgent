import { z } from "zod";
import { defineTool } from "./_framework";
import * as workspace from "../../state/workspace";

const inputSchema = z
  .object({
    selector: z.string().min(1).max(1000).optional(),
    max_edge: z.number().int().min(512).max(2048).optional(),
  })
  .strict();

export const captureUiTool = defineTool({
  name: "capture_ui",
  description:
    "Render the visible Lumiverse tab to an image and view it on your next step. Works through the connected browser, without a desktop installation. Optional selector crops to one visible element, max_edge defaults to 1600. Saves a JPEG in workspace captures/. This is a DOM rendering: blur, embedded frames, video and remote assets can differ or be absent. Requires a vision-capable model and the originating tab to stay visible. Password fields and LumiAgent itself are excluded.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "Optional CSS selector matching exactly one visible element.",
      },
      max_edge: { type: "integer", minimum: 512, maximum: 2048 },
    },
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    let createdPath: string | undefined;
    try {
      if (!ctx.callFrontend || !ctx.queueImage)
        throw new Error(
          "UI capture requires a connected Lumiverse tab and image viewing.",
        );
      ctx.signal.throwIfAborted();
      const result = (await ctx.callFrontend("ui_capture", input, 60_000)) as {
        base64: string;
        mime_type: string;
        width: number;
        height: number;
        method: string;
        warnings: string[];
      };
      ctx.signal.throwIfAborted();
      if (
        result.mime_type !== "image/jpeg" ||
        !result.base64 ||
        result.base64.length > 2_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64)
      )
        throw new Error("Invalid UI capture response.");
      const bytes = new Uint8Array(Buffer.from(result.base64, "base64"));
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
        throw new Error("UI capture did not return a JPEG.");
      const path = `captures/${ctx.sessionId}/${Date.now()}-${crypto.randomUUID()}.jpg`;
      await workspace.writeBinary(
        ctx.spindle,
        ctx.userId,
        path,
        bytes,
        await workspace.resolveUserCaps(ctx.spindle, ctx.userId),
      );
      createdPath = path;
      ctx.signal.throwIfAborted();
      ctx.queueImage({
        path,
        mime_type: result.mime_type,
        label: "Lumiverse rendered UI snapshot",
      });
      return {
        content: JSON.stringify({
          path,
          width: result.width,
          height: result.height,
          method: result.method,
          warnings: result.warnings,
          viewing:
            "The image is attached to your next step. Evaluate only what is visible.",
        }),
      };
    } catch (error) {
      let cleanup = "";
      if (createdPath) {
        try {
          await workspace.remove(ctx.spindle, ctx.userId, createdPath);
        } catch {
          cleanup = ` The unviewed capture remains at ${createdPath}.`;
        }
      }
      return {
        content: `Error: ${(error as Error).message}${cleanup}`,
        isError: true,
      };
    }
  },
});
