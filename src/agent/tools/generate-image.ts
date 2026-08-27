import { z } from "zod";
import type { ImageGenRequestDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import { resolveCharacterTargetOptional } from "./_context";
import description from "../prompts/claude/tools/generate-image/description.txt";
import argPrompt from "../prompts/claude/tools/generate-image/arg_prompt.txt";
import argNegativePrompt from "../prompts/claude/tools/generate-image/arg_negative_prompt.txt";
import argModel from "../prompts/claude/tools/generate-image/arg_model.txt";
import argConnectionId from "../prompts/claude/tools/generate-image/arg_connection_id.txt";
import argParameters from "../prompts/claude/tools/generate-image/arg_parameters.txt";
import argCharacterId from "../prompts/claude/tools/generate-image/arg_character_id.txt";
import argChatId from "../prompts/claude/tools/generate-image/arg_chat_id.txt";
import argSaveTo from "../prompts/claude/tools/generate-image/arg_save_to.txt";
import argSetAsAvatar from "../prompts/claude/tools/generate-image/arg_set_as_avatar.txt";

const inputSchema = z.object({
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  model: z.string().optional(),
  connection_id: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  character_id: z.string().optional(),
  chat_id: z.string().optional(),
  save_to: z.string().optional(),
  set_as_avatar: z.boolean().optional(),
}).strict();

// data:image/png;base64,AAAA -> { mime, bytes }
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "image/png";
  const body = m[3] ?? "";
  if (!m[2]) return { mime, bytes: new Uint8Array(Buffer.from(decodeURIComponent(body), "utf-8")) };
  return { mime, bytes: new Uint8Array(Buffer.from(body, "base64")) };
}

function extensionFor(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

export const generateImageTool = defineTool({
  name: "generate_image",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: argPrompt },
      negative_prompt: { type: "string", description: argNegativePrompt },
      model: { type: "string", description: argModel },
      connection_id: { type: "string", description: argConnectionId },
      parameters: { type: "object", description: argParameters },
      character_id: { type: "string", description: argCharacterId },
      chat_id: { type: "string", description: argChatId },
      save_to: { type: "string", description: argSaveTo },
      set_as_avatar: { type: "boolean", description: argSetAsAvatar },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const wantsBytes = input.save_to !== undefined || input.set_as_avatar === true;
    // "none" is the explicit opt-out; anything else falls back to the focus so
    // a generated image lands in the right card's gallery by default.
    const owner = input.character_id === "none"
      ? null
      : (input.character_id ?? resolveCharacterTargetOptional(ctx) ?? null);

    if (input.set_as_avatar === true && owner === null) {
      return { content: "Error: [NO_TARGET] set_as_avatar needs a character. Pass character_id or focus a character.", isError: true };
    }

    const req: ImageGenRequestDTO = {
      prompt: input.prompt,
      ...(input.negative_prompt !== undefined ? { negativePrompt: input.negative_prompt } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.connection_id !== undefined ? { connection_id: input.connection_id } : {}),
      ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
      ...(owner !== null ? { owner_character_id: owner } : {}),
      ...(input.chat_id !== undefined ? { owner_chat_id: input.chat_id } : {}),
      // The base64 payload is the largest possible tool result. Only ask for it
      // when we actually have to write bytes somewhere.
      ...(wantsBytes ? {} : { includeDataUrl: false }),
      userId: ctx.userId,
    };

    let result;
    try { result = await ctx.spindle.imageGen.generate(req); }
    catch (err) {
      const msg = (err as Error).message;
      return {
        content: `Error: [SPINDLE_ERROR] image generation failed: ${msg}\nRun \`list_image_models\` to check the user has an image-gen connection and that the model / parameters are valid for its provider.`,
        isError: true,
      };
    }

    const out: Record<string, unknown> = {
      image_id: result.imageId ?? null,
      image_url: result.imageUrl ?? null,
      model: result.model,
      provider: result.provider,
      owner_character_id: owner,
    };

    if (wantsBytes) {
      const decoded = result.imageDataUrl ? decodeDataUrl(result.imageDataUrl) : null;
      if (!decoded) {
        out["warning"] = "Provider returned no image bytes, so save_to / set_as_avatar were skipped.";
        return { content: JSON.stringify(out, null, 2) };
      }
      if (input.save_to !== undefined) {
        try {
          const ws = await import("../../state/workspace");
          const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
          await ws.writeBinary(ctx.spindle, ctx.userId, input.save_to, decoded.bytes, caps);
          out["saved_to"] = input.save_to;
          out["bytes"] = decoded.bytes.length;
        } catch (err) { out["save_error"] = (err as Error).message; }
      }
      if (input.set_as_avatar === true && owner !== null) {
        try {
          await ctx.spindle.characters.setAvatar(owner, {
            data: decoded.bytes,
            filename: `avatar.${extensionFor(decoded.mime)}`,
            mime_type: decoded.mime,
          }, ctx.userId);
          out["avatar_set"] = true;
        } catch (err) { out["avatar_error"] = (err as Error).message; }
      }
    }

    return { content: JSON.stringify(out, null, 2) };
  },
});
