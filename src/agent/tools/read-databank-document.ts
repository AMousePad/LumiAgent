import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";

const inputSchema = z.object({
  document_id: z.string().min(1),
  meta_only: z.boolean().optional(),
}).strict();

export const readDatabankDocumentTool = defineTool({
  name: "read_databank_document",
  description: "Read a databank document. Returns metadata always; with meta_only=false (default), also returns the full extracted text content (spills to a tmp handle if large).",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      document_id: { type: "string", description: "Document id." },
      meta_only: { type: "boolean", description: "If true, skip the content fetch. Default false." },
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
