import { z } from "zod";
import type { WorldBookEntryDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import type { ToolCtx } from "./_context";
import type { EditRecord, ScopeRef } from "../../types";
import { wbLabel } from "./_surfaces";

const inputSchema = z.object({
  path: z.string().min(3).describe("Entity to delete. Same path grammar as `read` / `edit`."),
}).strict();

async function listAllEntries(ctx: ToolCtx, bookId: string): Promise<WorldBookEntryDTO[]> {
  const out: WorldBookEntryDTO[] = [];
  let offset = 0;
  for (;;) {
    const page = await ctx.spindle.world_books.entries.list(bookId, { limit: 200, offset, userId: ctx.userId });
    out.push(...page.data);
    offset += page.data.length;
    if (page.data.length === 0 || out.length >= page.total) break;
  }
  return out;
}

export const deleteTool = defineTool({
  name: "delete",
  description: `Delete an entity addressed by the same path grammar as \`read\` / \`edit\`. The full prior state is snapshotted into the edit log so the delete is revertible (revert recreates it; container deletes restore their children too). Deleting a world book or preset cascades to its entries / blocks.

Deletable paths:
- \`wb/<id>\` -> a world book (id is a book) OR a single entry (id is an entry). Resolved by lookup.
- \`rx/<scriptId>\` -> a regex script.
- \`persona/<personaId>\` -> a user persona.
- \`preset/<presetId>\` -> a prompt preset (and its blocks).
- \`preset/<presetId>/block/<blockId>\` -> one prompt block.
- \`char/alternate_greetings/<idx>\` -> a greeting by 0-based index.

Caveat: a recreated book / preset / persona gets a fresh id on revert; external references to the old id (e.g. a character's world_book_ids) are not rewired.`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Entity path. See description." } },
    required: ["path"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx: ToolCtx) => {
    const path = input.path.trim().replace(/^character\//, "char/");
    const parts = path.split("/").filter((p) => p.length > 0);

    // preset/<presetId>/block/<blockId>
    if (parts[0] === "preset" && parts[2] === "block" && parts.length === 4) {
      const presetId = parts[1]!;
      const blockId = parts[3]!;
      const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx < 0) return { content: `Error: [PATH_NOT_FOUND] block ${blockId} not in preset ${presetId}`, isError: true };
      const before = blocks[idx]!;
      await ctx.spindle.presets.blocks.delete(presetId, blockId, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "preset_block", surfaceId: `${presetId}:${blockId}`,
        surfaceLabel: `${before.name || "block"}`,
        snapshot: { ...before, __presetId: presetId, __index: idx } as never,
        scope: { kind: "preset", id: presetId },
      } satisfies EditRecord);
      return { content: JSON.stringify({ preset_id: presetId, block_id: blockId, deleted: true, can_revert: true }) };
    }

    // preset/<presetId>
    if (parts[0] === "preset" && parts.length === 2) {
      const presetId = parts[1]!;
      const preset = await ctx.spindle.presets.get(presetId, ctx.userId);
      if (!preset) return { content: `Error: [PATH_NOT_FOUND] preset ${presetId} not found`, isError: true };
      const blocks = await ctx.spindle.presets.blocks.list(presetId, ctx.userId);
      await ctx.spindle.presets.delete(presetId, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "preset", surfaceId: presetId, surfaceLabel: preset.name,
        snapshot: { preset, blocks }, scope: { kind: "preset", id: presetId },
      } satisfies EditRecord);
      return { content: JSON.stringify({ preset_id: presetId, deleted: true, blocks_removed: blocks.length, can_revert: true }) };
    }

    // persona/<personaId>
    if (parts[0] === "persona" && parts.length === 2) {
      const personaId = parts[1]!;
      const p = await ctx.spindle.personas.get(personaId, ctx.userId);
      if (!p) return { content: `Error: [PATH_NOT_FOUND] persona ${personaId} not found`, isError: true };
      await ctx.spindle.personas.delete(personaId, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "persona", surfaceId: personaId, surfaceLabel: p.name,
        snapshot: p, scope: { kind: "persona", id: personaId },
      } satisfies EditRecord);
      return { content: JSON.stringify({ persona_id: personaId, deleted: true, can_revert: true }) };
    }

    // rx/<scriptId>
    if ((parts[0] === "rx" || parts[0] === "regex_script") && parts.length === 2) {
      const id = parts[1]!;
      const before = await ctx.spindle.regex_scripts.get(id, ctx.userId);
      if (!before) return { content: `Error: [PATH_NOT_FOUND] regex script ${id} not found`, isError: true };
      await ctx.spindle.regex_scripts.delete(id, ctx.userId);
      const scope: ScopeRef | undefined = ctx.characterId ? undefined : { kind: "regex_script", id };
      ctx.pushEdit({
        op: "delete", surface: "regex_script", surfaceId: id, surfaceLabel: before.name, snapshot: before,
        ...(scope ? { scope } : {}),
      } satisfies EditRecord);
      return { content: JSON.stringify({ script_id: id, deleted: true, can_revert: true }) };
    }

    // char/alternate_greetings/<idx>
    if ((path.startsWith("char/alternate_greetings/")) && parts.length === 3) {
      if (!ctx.characterId) return { content: "Error: [INVALID_INPUT] no active character", isError: true };
      const idx = parseInt(parts[2]!, 10);
      if (!Number.isFinite(idx)) return { content: `Error: [INVALID_INPUT] '${parts[2]}' is not an index`, isError: true };
      const c = await ctx.spindle.characters.get(ctx.characterId, ctx.userId);
      if (!c) return { content: `Error: character ${ctx.characterId} not found`, isError: true };
      const arr = [...(c.alternate_greetings ?? [])];
      if (idx < 0 || idx >= arr.length) return { content: `Error: [OUT_OF_RANGE] index ${idx} (length ${arr.length})`, isError: true };
      const removed = arr[idx] ?? "";
      arr.splice(idx, 1);
      await ctx.spindle.characters.update(ctx.characterId, { alternate_greetings: arr }, ctx.userId);
      ctx.pushEdit({
        op: "delete", surface: "alternate_greeting", surfaceId: String(idx),
        surfaceLabel: `alternate_greetings[${idx}]`, snapshot: { greeting: removed, index: idx },
      } satisfies EditRecord);
      return { content: JSON.stringify({ index: idx, deleted: true, chars_removed: removed.length }) };
    }

    // wb/<id> -> book or entry (resolved by lookup)
    if ((parts[0] === "wb" || parts[0] === "world_book") && parts.length === 2) {
      const id = parts[1]!;
      const book = await ctx.spindle.world_books.get(id, ctx.userId).catch(() => null);
      if (book) {
        const entries = await listAllEntries(ctx, id);
        await ctx.spindle.world_books.delete(id, ctx.userId);
        ctx.pushEdit({
          op: "delete", surface: "world_book", surfaceId: id, surfaceLabel: book.name,
          snapshot: { book, entries }, scope: { kind: "world_book", id },
        } satisfies EditRecord);
        return { content: JSON.stringify({ world_book_id: id, deleted: true, entries_removed: entries.length, can_revert: true }) };
      }
      const entry = await ctx.spindle.world_books.entries.get(id, ctx.userId).catch(() => null);
      if (!entry) return { content: `Error: [PATH_NOT_FOUND] no world book or entry with id ${id}`, isError: true };
      await ctx.spindle.world_books.entries.delete(id, ctx.userId);
      const scope: ScopeRef | undefined = ctx.characterId ? undefined : { kind: "world_book", id: entry.world_book_id };
      ctx.pushEdit({
        op: "delete", surface: "world_book_entry", surfaceId: id, surfaceLabel: wbLabel(entry), snapshot: entry,
        ...(scope ? { scope } : {}),
      } satisfies EditRecord);
      return { content: JSON.stringify({ entry_id: id, world_book_id: entry.world_book_id, deleted: true, can_revert: true }) };
    }

    return { content: `Error: [PATH_NOT_FOUND] cannot delete '${path}'. Valid: wb/<id>, rx/<id>, persona/<id>, preset/<id>, preset/<id>/block/<id>, char/alternate_greetings/<idx>`, isError: true };
  },
});
