import { z } from "zod";
import { defineTool } from "./_framework";
import { attachWorldBook } from "./_worldbook";
import description from "../prompts/claude/tools/attach-world-book/description.txt";
import argWorldBookId from "../prompts/claude/tools/attach-world-book/arg_world_book_id.txt";
import argScope from "../prompts/claude/tools/attach-world-book/arg_scope.txt";
import argAction from "../prompts/claude/tools/attach-world-book/arg_action.txt";
import argTargetId from "../prompts/claude/tools/attach-world-book/arg_target_id.txt";

const SCOPES = ["character", "chat", "global", "persona"] as const;

const inputSchema = z.object({
  world_book_id: z.string().min(1),
  scope: z.enum(SCOPES),
  action: z.enum(["attach", "detach"]).optional(),
  target_id: z.string().optional(),
}).strict();

export const attachWorldBookTool = defineTool({
  name: "attach_world_book",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      world_book_id: { type: "string", description: argWorldBookId },
      scope: { type: "string", enum: [...SCOPES], description: argScope },
      action: { type: "string", enum: ["attach", "detach"], description: argAction },
      target_id: { type: "string", description: argTargetId },
    },
    required: ["world_book_id", "scope"],
  },
  requiresCharacter: false,
  execute: (input, ctx) => attachWorldBook(ctx, input),
});
