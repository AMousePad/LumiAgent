import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/todo-write/description.txt";

const todoSchema = z.object({
  content: z.string().min(1).describe("Imperative form of the task ('Run tests', 'Fix the bug')."),
  activeForm: z.string().min(1).describe("Present-continuous form ('Running tests', 'Fixing the bug')."),
  status: z.enum(["pending", "in_progress", "completed"]).describe("Current state of the task."),
}).strict();

const inputSchema = z.object({
  todos: z.array(todoSchema).min(1).describe(
    "The full updated todo list. Replaces the previous list wholesale, not a partial patch. At most one item should be 'in_progress' at a time.",
  ),
}).strict();

type Input = z.infer<typeof inputSchema>;

export const todoWriteTool = defineTool<Input>({
  name: "todo_write",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            content: { type: "string", minLength: 1 },
            activeForm: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "activeForm", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  execute: async (input) => {
    const inProgressCount = input.todos.filter((t) => t.status === "in_progress").length;
    const pending = input.todos.filter((t) => t.status === "pending").length;
    const completed = input.todos.filter((t) => t.status === "completed").length;
    const warnings: string[] = [];
    if (inProgressCount > 1) {
      warnings.push(`Warning: ${inProgressCount} items are 'in_progress'. Keep at most one active at a time.`);
    }
    const summary = `Todo list updated: ${input.todos.length} item${input.todos.length === 1 ? "" : "s"} (${pending} pending, ${inProgressCount} in_progress, ${completed} completed).`;
    const prefix = warnings.length > 0 ? `${warnings.join("\n")}\n\n` : "";
    return { content: `${prefix}${summary}` };
  },
});
