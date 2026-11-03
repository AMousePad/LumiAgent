import { nameQuery, nameQueryProperty, searchPage } from "./_name-search";
import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/list-databank-documents/description.txt";
import argDatabankId from "../prompts/claude/tools/list-databank-documents/arg_databank_id.txt";
import argLimit from "../prompts/claude/tools/list-databank-documents/arg_limit.txt";
import argOffset from "../prompts/claude/tools/list-databank-documents/arg_offset.txt";

const inputSchema = z.object({
  query: nameQuery,
  databank_id: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const listDatabankDocumentsTool = defineTool({
  name: "list_databank_documents",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      query: nameQueryProperty,
      databank_id: { type: "string", description: argDatabankId },
      limit: { type: "number", description: argLimit },
      offset: { type: "number", description: argOffset },
    },
    required: ["databank_id"],
  },
  execute: async (input, ctx) => {
    try {
      const res = await searchPage((limit, offset) => ctx.spindle.databanks.documents.list(input.databank_id, {
        limit,
        offset,
        userId: ctx.userId,
      }), item => item.name, input, ctx.signal);
      const rows = res.data.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        mime_type: d.mime_type,
        file_size: d.file_size,
        total_chunks: d.total_chunks,
        status: d.status,
        error_message: d.error_message,
        updated_at: d.updated_at,
      }));
      return { content: JSON.stringify({ databank_id: input.databank_id, total: res.total, offset: res.offset, has_more: res.has_more, next_offset: res.next_offset, returned: rows.length, documents: rows }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
