import { z } from "zod";
import { defineTool } from "./_framework";
import { parseExtensionPath, getAtPath } from "./_paths";

const inputSchema = z.object({
  path: z.string().optional(),
  max_depth: z.number().optional(),
  max_entries: z.number().optional(),
});

function classifyNode(v: unknown): { type: string; size?: number } {
  if (v === null) return { type: "null" };
  if (Array.isArray(v)) return { type: "array", size: v.length };
  if (typeof v === "object") return { type: "object", size: Object.keys(v).length };
  if (typeof v === "string") return { type: "string", size: v.length };
  if (typeof v === "number") return { type: "number" };
  if (typeof v === "boolean") return { type: "boolean" };
  return { type: typeof v };
}

export const listExtensionKeysTool = defineTool({
  name: "list_extension_keys",
  description: "[LEGACY — superseded by the list tool with path char/extensions or char/extensions/<dotted>. Kept for back-compat; prefer the named successor.] Enumerate keys and types under character.extensions (or a subpath). Returns each path with type/size. Use before grep_card or read_character_extension to learn the shape of a card's extensions blob.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      max_depth: { type: "number" },
      max_entries: { type: "number" },
    },
    required: [],
  },
  defaultSensitivity: "insensitive",
  execute: async (input, ctx) => {
    const path = input.path ?? "";
    const maxDepth = Math.max(1, Math.floor(input.max_depth ?? 4));
    const maxEntries = Math.max(1, Math.floor(input.max_entries ?? 200));
    const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
    if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
    let segs;
    try { segs = path === "" ? [] : parseExtensionPath(path); }
    catch (e) { return { content: `Error: ${(e as Error).message}`, isError: true }; }
    const root = getAtPath(c.extensions ?? {}, segs);
    if (root === undefined) {
      return { content: `Error: extensions${path === "" ? "" : "." + path} does not exist`, isError: true };
    }
    const entries: Array<{ path: string; type: string; size?: number }> = [];
    let truncated = false;
    const visit = (node: unknown, prefix: string, depth: number): void => {
      if (entries.length >= maxEntries) { truncated = true; return; }
      const info = classifyNode(node);
      if (prefix !== "") {
        const out: { path: string; type: string; size?: number } = { path: prefix, type: info.type };
        if (info.size !== undefined) out.size = info.size;
        entries.push(out);
      }
      if (depth >= maxDepth) return;
      if (node === null || node === undefined || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          if (entries.length >= maxEntries) { truncated = true; return; }
          visit(node[i], `${prefix}[${i}]`, depth + 1);
        }
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        if (entries.length >= maxEntries) { truncated = true; return; }
        const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
        const isIdent = safeKey === k;
        const seg = isIdent ? (prefix === "" ? k : `.${k}`) : `[${safeKey}]`;
        visit(v, prefix + seg, depth + 1);
      }
    };
    visit(root, "", 0);
    return { content: JSON.stringify({ base: path === "" ? "extensions" : `extensions.${path}`, count: entries.length, truncated, entries }, null, 2) };
  },
});
