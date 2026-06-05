import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import type { ToolCtx } from "./_context";

type SearchResponse = Awaited<ReturnType<ToolCtx["spindle"]["webSearch"]["query"]>>;

function buildMarkdown(res: SearchResponse): string {
  const lines: string[] = [`# Web search: "${res.query}" (${res.results.length} result${res.results.length === 1 ? "" : "s"})`, ""];
  res.results.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${r.title}`);
    lines.push(r.url);
    if (r.snippet) lines.push("", r.snippet);
    const doc = res.documents?.find((d) => d.url === r.url);
    if (doc?.content) lines.push("", "### Page content", doc.content);
    else if (doc?.error) lines.push("", `_(could not fetch page content: ${doc.error})_`);
    lines.push("", "---", "");
  });
  return lines.join("\n").trim();
}

const inputSchema = z.object({
  query: z.string().min(2),
  count: z.number().int().positive().optional(),
  scrape: z.boolean().optional(),
  save_to: z.string().optional(),
}).strict();

export const webSearchTool = defineTool({
  name: "web_search",
  description: "Search the public web via the user's configured Lumiverse web search provider. Returns ranked results (title, URL, snippet); with scrape on (default) it also fetches and returns the top pages' extracted text. The `query` must be a short keyword-heavy search phrase a human would type ('latest OpenRouter pricing', 'Claude Sonnet release notes'), NOT a sentence, answer, or roleplay narration. Pass `save_to` (a workspace path like 'research/topic.md') to also write the results + page text to a file. Requires the user to have web search enabled in Lumiverse Settings.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 2, description: "Keyword-heavy search phrase, not a sentence." },
      count: { type: "integer", minimum: 1, description: "Desired result count (clamped to the user's max)." },
      scrape: { type: "boolean", description: "Fetch top pages' text (default true). Set false for titles/URLs/snippets only." },
      save_to: { type: "string", description: "Optional workspace path to also save the results markdown to." },
    },
    required: ["query"],
  },
  // A pure search is read-only; saving to a file makes it a write.
  isReadOnly: (input) => (input as { save_to?: unknown }).save_to === undefined,
  execute: async (input, ctx) => {
    try {
      const settings = await ctx.spindle.webSearch.getSettings(ctx.userId).catch(() => null);
      if (settings && !settings.enabled) {
        return { content: "Error: web search is not enabled. Ask the user to configure a web search provider in Lumiverse Settings -> Web Search.", isError: true };
      }
      const res = await ctx.spindle.webSearch.query({
        query: input.query,
        userId: ctx.userId,
        ...(input.count !== undefined ? { count: input.count } : {}),
        ...(input.scrape !== undefined ? { scrape: input.scrape } : {}),
      });
      if (res.results.length === 0) {
        return { content: JSON.stringify({ query: res.query, results: [], note: "No results returned." }) };
      }
      const markdown = buildMarkdown(res);
      let savedNote = "";
      if (input.save_to) {
        const ws = await import("../../state/workspace");
        try {
          const caps = await ws.resolveUserCaps(ctx.spindle, ctx.userId);
          await ws.writeText(ctx.spindle, ctx.userId, input.save_to, markdown, caps);
          savedNote = `Saved ${markdown.length} chars to workspace '${input.save_to}'.\n\n`;
        } catch (err) {
          savedNote = `(Could not save to '${input.save_to}': ${(err as Error).message})\n\n`;
        }
      }
      const out = await spillOrReturn(ctx, markdown, `web_search:${input.query}`, "Use web_fetch to pull a specific result URL in full, or save_to to persist results.");
      return { content: savedNote + out };
    } catch (err) {
      return { content: `Error: web search failed: ${(err as Error).message}`, isError: true };
    }
  },
});
