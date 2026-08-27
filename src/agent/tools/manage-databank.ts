import { z } from "zod";
import type { DatabankCreateDTO, DatabankUpdateDTO } from "lumiverse-spindle-types";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/manage-databank/description.txt";

const inputSchema = z.object({
  action: z.enum(["create_bank", "update_bank", "delete_bank", "add_document", "rename_document", "delete_document", "reprocess_document"]),
  databank_id: z.string().optional(),
  document_id: z.string().optional(),
  value: z.record(z.string(), z.unknown()).optional(),
}).strict();

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const manageDatabankTool = defineTool({
  name: "manage_databank",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create_bank", "update_bank", "delete_bank", "add_document", "rename_document", "delete_document", "reprocess_document"] },
      databank_id: { type: "string", description: "Required for update_bank / delete_bank / add_document." },
      document_id: { type: "string", description: "Required for rename_document / delete_document / reprocess_document." },
      value: { type: "object", description: "Action-specific fields; see description." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const v = input.value ?? {};
    try {
      switch (input.action) {
        case "create_bank": {
          const name = str(v["name"]);
          const scope = v["scope"];
          if (!name) return { content: "Error: [INVALID_INPUT] create_bank needs value.name", isError: true };
          if (scope !== "global" && scope !== "character" && scope !== "chat") {
            return { content: "Error: [INVALID_INPUT] value.scope must be global | character | chat", isError: true };
          }
          const dto: DatabankCreateDTO = {
            name,
            scope,
            ...(str(v["description"]) !== undefined ? { description: str(v["description"])! } : {}),
            ...(str(v["scope_id"]) !== undefined ? { scope_id: str(v["scope_id"])! } : {}),
          };
          const bank = await ctx.spindle.databanks.create(dto, ctx.userId);
          return { content: JSON.stringify({ created: { id: bank.id, name: bank.name, scope: bank.scope } }) };
        }
        case "update_bank": {
          if (!input.databank_id) return { content: "Error: [INVALID_INPUT] update_bank needs databank_id", isError: true };
          const patch: DatabankUpdateDTO = {
            ...(str(v["name"]) !== undefined ? { name: str(v["name"])! } : {}),
            ...(typeof v["description"] === "string" ? { description: v["description"] } : {}),
            ...(typeof v["enabled"] === "boolean" ? { enabled: v["enabled"] } : {}),
          };
          if (Object.keys(patch).length === 0) return { content: "Error: [INVALID_INPUT] nothing to update; value takes name / description / enabled", isError: true };
          const bank = await ctx.spindle.databanks.update(input.databank_id, patch, ctx.userId);
          return { content: JSON.stringify({ updated: { id: bank.id, name: bank.name, enabled: bank.enabled } }) };
        }
        case "delete_bank": {
          if (!input.databank_id) return { content: "Error: [INVALID_INPUT] delete_bank needs databank_id", isError: true };
          const ok = await ctx.spindle.databanks.delete(input.databank_id, ctx.userId);
          return { content: JSON.stringify({ deleted: ok }) };
        }
        case "add_document": {
          if (!input.databank_id) return { content: "Error: [INVALID_INPUT] add_document needs databank_id", isError: true };
          const name = str(v["name"]);
          const text = v["content"];
          if (!name || typeof text !== "string" || text.length === 0) {
            return { content: "Error: [INVALID_INPUT] add_document needs value.name and non-empty value.content", isError: true };
          }
          const doc = await ctx.spindle.databanks.documents.create(input.databank_id, {
            data: new TextEncoder().encode(text),
            filename: `${name.replace(/[^\w.-]+/g, "_")}.txt`,
            mime_type: "text/plain",
            name,
          }, ctx.userId);
          return { content: JSON.stringify({ added: { id: doc.id, name: doc.name, status: doc.status }, note: "Chunking and embedding are asynchronous; list_databank_documents shows when it is processed." }) };
        }
        case "rename_document": {
          if (!input.document_id) return { content: "Error: [INVALID_INPUT] rename_document needs document_id", isError: true };
          const name = str(v["name"]);
          if (!name) return { content: "Error: [INVALID_INPUT] rename_document needs value.name", isError: true };
          const doc = await ctx.spindle.databanks.documents.update(input.document_id, { name }, ctx.userId);
          return { content: JSON.stringify({ renamed: { id: doc.id, name: doc.name } }) };
        }
        case "delete_document": {
          if (!input.document_id) return { content: "Error: [INVALID_INPUT] delete_document needs document_id", isError: true };
          const ok = await ctx.spindle.databanks.documents.delete(input.document_id, ctx.userId);
          return { content: JSON.stringify({ deleted: ok }) };
        }
        case "reprocess_document": {
          if (!input.document_id) return { content: "Error: [INVALID_INPUT] reprocess_document needs document_id", isError: true };
          const res = await ctx.spindle.databanks.documents.reprocess(input.document_id, ctx.userId);
          return { content: JSON.stringify(res) };
        }
      }
    } catch (err) { return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true }; }
  },
});
