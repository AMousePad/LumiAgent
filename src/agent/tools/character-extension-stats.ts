import { z } from "zod";
import { defineTool } from "./_framework";
import { parseExtensionPath, getAtPath } from "./_paths";

const inputSchema = z.object({
  path: z.string(),
});

export const characterExtensionStatsTool = defineTool({
  name: "character_extension_stats",
  description: "[LEGACY — superseded by the inspect tool with path char/extensions/<dotted>. Kept for back-compat; prefer the named successor.] Cheap orientation for a path under character.extensions. For strings: char/line counts + peek. For arrays: length + per-item type/size summary. For objects: top-level key list with per-key type/size summary. Call this before read_character_extension on anything you don't already know is small (e.g. lumirealm.payload).",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Path relative to character.extensions, e.g. 'lumirealm.payload' or 'lumirealm.payload.background_html'." } },
    required: ["path"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    let segs;
    try { segs = parseExtensionPath(input.path); } catch (e) { return { content: `Error: ${(e as Error).message}`, isError: true }; }
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    const val = getAtPath(c.extensions ?? {}, segs);
    if (val === undefined) return { content: `Error: extensions.${input.path} does not exist`, isError: true };
    const summarize = (v: unknown): { type: string; chars?: number; lines?: number; length?: number; keys?: number; peek?: string } => {
      if (v === null) return { type: "null" };
      if (typeof v === "string") return { type: "string", chars: v.length, lines: v === "" ? 0 : v.split("\n").length, peek: v.slice(0, 80) };
      if (typeof v === "number" || typeof v === "boolean") return { type: typeof v };
      if (Array.isArray(v)) {
        const s = JSON.stringify(v);
        return { type: "array", length: v.length, chars: s.length };
      }
      if (typeof v === "object") {
        const keys = Object.keys(v as Record<string, unknown>);
        const s = JSON.stringify(v);
        return { type: "object", keys: keys.length, chars: s.length };
      }
      return { type: typeof v };
    };
    if (typeof val === "string") {
      return {
        content: JSON.stringify({
          path: input.path, type: "string",
          chars: val.length,
          lines: val === "" ? 0 : val.split("\n").length,
          peek: val.slice(0, 200),
        }, null, 2),
      };
    }
    if (Array.isArray(val)) {
      const items = val.map((item, i) => ({ index: i, ...summarize(item) }));
      return { content: JSON.stringify({ path: input.path, type: "array", length: val.length, items: items.slice(0, 60), truncated: items.length > 60 }, null, 2) };
    }
    if (val !== null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      const keys = Object.keys(obj);
      const perKey = keys.map((k) => ({ key: k, ...summarize(obj[k]) }));
      const totalChars = JSON.stringify(obj).length;
      return { content: JSON.stringify({ path: input.path, type: "object", key_count: keys.length, total_chars: totalChars, keys: perKey }, null, 2) };
    }
    return { content: JSON.stringify({ path: input.path, type: typeof val, value: val }, null, 2) };
  },
});
