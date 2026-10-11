import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const councilInput = z.object({
  section: z.enum(["settings", "members", "available_lumia"]).describe("Which live Council view to read."),
}).strict();

export const inspectCouncilTool = defineTool({
  name: "inspect_council",
  description: "Read live Council settings, resolved members, or available Lumia definitions for the current user. Inspection only. Use inspect_dlc to browse pack content. Large results spill to workspace tmp handles.",
  inputSchema: councilInput,
  jsonSchema: z.toJSONSchema(councilInput),
  isReadOnly: () => true,
  execute: async ({ section }, ctx) => {
    const options = { userId: ctx.userId };
    const result = section === "settings" ? await ctx.spindle.council.getSettings(options)
      : section === "members" ? await ctx.spindle.council.getMembers(options)
      : await ctx.spindle.council.getAvailableLumiaItems(options);
    return { content: await spillOrReturn(ctx, JSON.stringify(result, null, 2), "inspect_council") };
  },
});

const dlcInput = z.object({
  category: z.enum(["packs", "lumiaItems", "narrativeStyles", "utilities", "retrofits", "tools"]).describe("Catalog category to inspect."),
  id: z.string().min(1).optional().describe("Return the full definition for this exact item ID."),
  pack_id: z.string().min(1).optional(),
  query: z.string().optional().describe("Substring filter on names and IDs."),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export const inspectDlcTool = defineTool({
  name: "inspect_dlc",
  description: "Browse the current user's live DLC packs, Lumia, narrative styles, utilities, retrofits, and Loom tools. Lists return metadata, supply an id for full content. Read-only. Pagination defaults to 50 items. Large definitions spill to workspace tmp handles.",
  inputSchema: dlcInput,
  jsonSchema: z.toJSONSchema(dlcInput),
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const catalog = await ctx.spindle.dlc.getCatalog({ userId: ctx.userId });
    const query = input.query?.toLowerCase() ?? "";
    const rows = catalog[input.category].filter((row) => {
      const name = "name" in row ? row.name : row.display_name;
      return (!input.id || row.id === input.id)
        && (!input.pack_id || ("pack_id" in row ? row.pack_id : row.id) === input.pack_id)
        && `${row.id} ${name}`.toLowerCase().includes(query);
    }).sort((a, b) => a.id.localeCompare(b.id));
    const offset = input.offset ?? 0;
    const items = rows.slice(offset, offset + (input.limit ?? 50)).map((row) => input.id ? row : ({
      id: row.id, name: "name" in row ? row.name : row.display_name,
      pack_id: "pack_id" in row ? row.pack_id : row.id, version: row.version,
    }));
    return { content: await spillOrReturn(ctx, JSON.stringify({ category: input.category, total: rows.length, items,
      next_offset: offset + items.length < rows.length ? offset + items.length : null }, null, 2), "inspect_dlc") };
  },
});
