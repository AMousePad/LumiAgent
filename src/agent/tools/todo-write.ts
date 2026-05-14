import { z } from "zod";
import { defineTool } from "./_framework";

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
  description: `Create or update the structured task list for the current session.

Use this proactively when:
- The user's request requires 3+ distinct steps.
- The user provides a numbered or comma-separated task list.
- Complex multi-step work where you want to externalize the plan so the user can see progress.

Do NOT use this for:
- Single trivial tasks.
- Conversational or purely informational requests.
- Tasks that take fewer than 3 meaningful steps.

Rules:
- Each item carries 'content' (imperative: "Fix bug"), 'activeForm' (present continuous: "Fixing bug"), and 'status' (pending | in_progress | completed).
- Replaces the whole list on each call. Send the full state, not a delta.
- At most ONE item should be 'in_progress' at a time.
- Mark items 'completed' as soon as they're done. Don't batch completions.
- Drop items that are no longer relevant by omitting them from the new list.`,
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
      warnings.push(`WARNING: ${inProgressCount} items are 'in_progress'. Keep at most one active at a time.`);
    }
    const summary = `Todo list updated: ${input.todos.length} item${input.todos.length === 1 ? "" : "s"} (${pending} pending, ${inProgressCount} in_progress, ${completed} completed).`;
    const prefix = warnings.length > 0 ? `${warnings.join("\n")}\n\n` : "";
    return { content: `${prefix}${summary}` };
  },
});
