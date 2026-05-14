import { z } from "zod";
import { defineTool } from "./_framework";

const optionSchema = z.object({
  label: z.string().min(1).describe("Display text (1-5 words, distinct from siblings)."),
  description: z.string().describe("Sentence explaining what the choice does or implies."),
  preview: z.string().optional().describe("Optional rendered content (code, mockup, diagram). Multi-line OK."),
}).strict();

const questionSchema = z.object({
  question: z.string().min(1).describe("The full question for the user. Should end with '?'."),
  header: z.string().min(1).max(12).describe("Short chip label (max 12 chars), e.g. 'Auth method'."),
  options: z.array(optionSchema).min(2).max(4).describe("2-4 mutually-exclusive options (unless multiSelect=true)."),
  multiSelect: z.boolean().optional().describe("Allow multiple selections (default false)."),
}).strict();

const inputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(4).describe("1-4 questions to surface in one modal."),
}).strict();

type Input = z.infer<typeof inputSchema>;

// Tool result wire format mirrors what the frontend modal posts back. The
// agent reads `cancelled` first. When false, `answers` maps question text to
// the user's selection (multi-select returns comma-joined labels so the
// model never has to branch on type).
interface AskResult {
  readonly cancelled: boolean;
  readonly answers?: Record<string, string>;
  readonly notes?: Record<string, string>;
}

export const askUserQuestionTool = defineTool<Input>({
  name: "ask_user_question",
  description: `Ask the user a multiple-choice question mid-task and PAUSE until they answer. Use ONLY when an irreversible or scope-changing decision genuinely needs the user's input and you can enumerate the choices for them. Do NOT use for confirmations of work you already understand.

Use cases:
- Two approaches are both valid and the trade-off is opinion (which auth provider, which library, which style).
- The user's request is ambiguous and the disambiguation has 2-4 obvious branches.
- Before a destructive action where the user might prefer a less aggressive variant.

DO NOT use for:
- Asking permission to do the thing you were already asked to do.
- Open-ended questions (use chat instead).
- More than 4 questions (split the work).

Each question needs:
- 'question' — full sentence ending in '?'.
- 'header' — short chip label (max 12 chars).
- 'options' — 2-4 distinct entries, each with 'label' (concise) and 'description' (one sentence). Optional 'preview' for code/mockup content.
- 'multiSelect' — true when choices are not mutually exclusive.

The runtime always appends an automatic "Other" option that lets the user type a custom answer; don't include one yourself. The agent loop blocks until the user submits or cancels. On cancel: result has \`cancelled: true\`. On submit: \`answers\` maps each question's text to the chosen label (or comma-joined labels for multi-select).`,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: { type: "string", minLength: 1 },
            header: { type: "string", minLength: 1, maxLength: 12 },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: { type: "string", minLength: 1 },
                  description: { type: "string" },
                  preview: { type: "string" },
                },
                required: ["label", "description"],
                additionalProperties: false,
              },
            },
            multiSelect: { type: "boolean" },
          },
          required: ["question", "header", "options"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  // Sensitive so the agent's own question + the user's answer survive
  // auto-free and stay visible to the model across the rest of the session.
  execute: async (input, ctx) => {
    if (!ctx.callFrontend) {
      return {
        content: "Error: [SPINDLE_ERROR] ask_user_question requires the browser-side modal but no frontend channel is wired. The user is not currently watching this session.",
        isError: true,
      };
    }
    let raw: unknown;
    try {
      // No tight host timeout. The user might need a minute to read. Cap
      // at 10 minutes so a long-abandoned session eventually releases the
      // agent loop instead of hanging forever.
      raw = await ctx.callFrontend("ask_user_question", input, 10 * 60_000);
    } catch (err) {
      return {
        content: `Error: [SPINDLE_ERROR] ask_user_question failed: ${(err as Error).message}`,
        isError: true,
      };
    }
    const r = raw as AskResult;
    if (r.cancelled) {
      return { content: JSON.stringify({ cancelled: true, note: "User dismissed the question without answering. Pick a sensible default and continue, or ask in plain chat." }, null, 2) };
    }
    return { content: JSON.stringify({ cancelled: false, answers: r.answers ?? {}, notes: r.notes ?? {} }, null, 2) };
  },
});
