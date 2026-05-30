import { z } from "zod";
import { defineTool } from "./_framework";
import { isDeferredTool, listDeferredToolNames, registry } from "./_registry";

const inputSchema = z.object({
  query: z.string().min(1).describe(
    "Either 'select:Name1,Name2' to fetch named tools directly, or a free-text keyword search (matches against tool name + description).",
  ),
  max_results: z.number().int().positive().max(20).optional().describe(
    "Max keyword-search results (default 5). Ignored for select: queries.",
  ),
}).strict();

type Input = z.infer<typeof inputSchema>;

function parseToolName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[._]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreKeyword(toolName: string, description: string, terms: string[]): number {
  const nameParts = parseToolName(toolName);
  const desc = description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const exact = nameParts.includes(term);
    const partial = !exact && nameParts.some((p) => p.includes(term));
    if (exact) score += 10;
    else if (partial) score += 5;
    if (desc.includes(term)) score += 2;
  }
  return score;
}

function formatFunctions(schemas: Array<{ name: string; description: string; parameters: Record<string, unknown> }>): string {
  const lines = schemas.map((s) => {
    const entry = { description: s.description, name: s.name, parameters: s.parameters };
    return `<function>${JSON.stringify(entry)}</function>`;
  });
  return `<functions>\n${lines.join("\n")}\n</functions>`;
}

export const toolSearchTool = defineTool<Input>({
  name: "tool_search",
  description: `Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name only in the system prompt under "Deferred tools available via tool_search". Their input schemas are not loaded, so calling them directly will fail. Use this tool with query "select:<name>[,<name>...]" to load the full schema, then invoke the tool normally on the next turn.

Result format: each matched tool appears as one <function>{"description":"...","name":"...","parameters":{...}}</function> line inside a <functions> block. Once a tool's schema appears in that result, it becomes callable like any tool defined at the top of the prompt.

Query forms:
- "select:read_persona,list_personas" - fetch these exact tools by name
- "regex" - keyword search, returns up to max_results best matches
- "lorebook entry" - multi-word keyword search`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "select:Name1,Name2 OR keyword search" },
      max_results: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  // Discovered schemas persist across normal turns via the loop's
  // seed-from-history scan (it reads the <functions> block back), so the agent
  // need not re-issue tool_search every message. Compaction collapses history
  // and resets discovery, the agent re-runs tool_search after a compaction.
  execute: async (input, ctx) => {
    const maxResults = input.max_results ?? 5;
    const deferredNames = listDeferredToolNames();
    // Char-required tools are filtered out of the deferred schema map in a
    // no-character session, so tool_search must match. Otherwise it reports them
    // "loaded" while the loop drops them and the call fails with [NO_TARGET].
    const hasChar = !!ctx.characterId;

    let pickedNames: string[] = [];
    const missingSelect: string[] = [];
    const unavailableNoChar: string[] = [];
    const selectMatch = input.query.match(/^select:(.+)$/i);
    if (selectMatch) {
      const requested = selectMatch[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      const found: string[] = [];
      for (const n of requested) {
        const tool = registry.get(n);
        if (!tool) {
          missingSelect.push(n);
          continue;
        }
        if (tool.requiresCharacter && !hasChar) {
          unavailableNoChar.push(tool.name);
          continue;
        }
        if (!found.includes(tool.name)) found.push(tool.name);
      }
      if (found.length === 0) {
        return {
          content: `No tools loaded from 'select:${requested.join(",")}'. ${missingSelect.length > 0 ? `Unknown names: ${missingSelect.join(", ")}. ` : ""}${unavailableNoChar.length > 0 ? `Unavailable without a focused character (this is an All-Characters session): ${unavailableNoChar.join(", ")}. ` : ""}Use the deferred-tools list from the system prompt to pick valid names, or run a keyword search instead.`,
          isError: true,
        };
      }
      pickedNames = found;
    } else {
      const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored: Array<{ name: string; score: number }> = [];
      for (const name of deferredNames) {
        const t = registry.get(name);
        if (!t) continue;
        if (t.requiresCharacter && !hasChar) continue;
        const s = scoreKeyword(t.name, t.description, terms);
        if (s > 0) scored.push({ name: t.name, score: s });
      }
      scored.sort((a, b) => b.score - a.score);
      pickedNames = scored.slice(0, maxResults).map((s) => s.name);
      if (pickedNames.length === 0) {
        return {
          content: JSON.stringify({
            matches: [],
            query: input.query,
            total_deferred_tools: deferredNames.length,
            note: "No matches. Try shorter terms or 'select:<exact_name>'.",
          }, null, 2),
        };
      }
    }

    const schemas = pickedNames
      .map((n) => registry.schemaFor(n))
      .filter((s): s is { name: string; description: string; parameters: Record<string, unknown> } => s !== undefined);

    ctx.discoverTools?.(pickedNames);

    const stillDeferred = pickedNames.filter((n) => isDeferredTool(n));
    const alreadyLoaded = pickedNames.filter((n) => !isDeferredTool(n));

    const header = `Loaded ${schemas.length} tool schema${schemas.length === 1 ? "" : "s"}. They are now callable on the next turn.`;
    const noteLines: string[] = [];
    if (alreadyLoaded.length > 0) {
      noteLines.push(`Note: ${alreadyLoaded.join(", ")} ${alreadyLoaded.length === 1 ? "was" : "were"} already loaded. Selecting an already-loaded tool is a harmless no-op.`);
    }
    if (missingSelect.length > 0) {
      noteLines.push(`Warning: unknown names not loaded: ${missingSelect.join(", ")}. Check the deferred-tools list in the system prompt. Do NOT call these names — they won't dispatch.`);
    }
    if (unavailableNoChar.length > 0) {
      noteLines.push(`Not loaded (need a focused character, this is an All-Characters session): ${unavailableNoChar.join(", ")}. Focus a character first, then re-run tool_search.`);
    }
    void stillDeferred;
    return {
      content: `${header}\n${noteLines.join("\n")}\n\n${formatFunctions(schemas)}`,
    };
  },
});
