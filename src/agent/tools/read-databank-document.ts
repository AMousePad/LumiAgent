import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import description from "../prompts/claude/tools/read-databank-document/description.txt";
import argDocumentId from "../prompts/claude/tools/read-databank-document/arg_document_id.txt";
import argMetaOnly from "../prompts/claude/tools/read-databank-document/arg_meta_only.txt";

const inputSchema = z.object({
  document_id: z.string().min(1),
  meta_only: z.boolean().optional(),
}).strict();

export const readDatabankDocumentTool = defineTool({
  name: "read_databank_document",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      document_id: { type: "string", description: argDocumentId },
      meta_only: { type: "boolean", description: argMetaOnly },
    },
    required: ["document_id"],
  },
  execute: async (input, ctx) => {
    try {
      const meta = await ctx.spindle.databanks.documents.get(input.document_id, ctx.userId);
      if (!meta) return { content: JSON.stringify({ found: false, document_id: input.document_id }) };
      if (input.meta_only) return { content: JSON.stringify(meta, null, 2) };
      const body = await ctx.spindle.databanks.documents.getContent(input.document_id, ctx.userId);
      const out = JSON.stringify({ ...meta, content: body?.content ?? null }, null, 2);
      return { content: await spillOrReturn(ctx, out, `read_databank_document(${input.document_id})`) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
