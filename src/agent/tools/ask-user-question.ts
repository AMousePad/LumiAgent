import { z } from "zod";
import { defineTool } from "./_framework";
import { fillPrompt } from "../prompts/_fill";
import description from "../prompts/claude/tools/ask-user-question/description.txt";
import type { ToolSchema } from "../../types";
import { ASK_LIMITS, type AgentSettings } from "../../state/settings";

// The zod schema accepts the widest configurable shape. The per-user caps are
// enforced in execute() from ctx.settings and baked into the schema the model
// sees by applyAskLimits(), so the two never disagree on what is allowed.
const optionSchema = z.object({
  label: z.string().min(1).describe("Display text (1-5 words, distinct from siblings)."),
  description: z.string().describe("Sentence explaining what the choice does or implies."),
  preview: z.string().optional().describe("Optional rendered content (code, mockup, diagram). Multi-line OK."),
}).strict();

const questionSchema = z.object({
  question: z.string().min(1).describe("The full question for the user. Should end with '?'."),
  header: z.string().min(1).max(ASK_LIMITS.headerMaxChars.max).describe("Short chip label."),
  options: z.array(optionSchema).min(2).max(ASK_LIMITS.maxOptions.max).describe("Mutually-exclusive options (unless multiSelect=true)."),
  multiSelect: z.boolean().optional().describe("Allow multiple selections (default false)."),
}).strict();

const inputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(ASK_LIMITS.maxQuestions.max).describe("Questions to surface in one modal."),
}).strict();

type Input = z.infer<typeof inputSchema>;

interface AskResult {
  readonly cancelled: boolean;
  readonly answers?: Record<string, string>;
  readonly notes?: Record<string, string>;
}

export interface AskLimits {
  readonly maxQuestions: number;
  readonly maxOptions: number;
  readonly headerMaxChars: number;
  readonly timeoutMinutes: number;
}

export function askLimitsFrom(settings: AgentSettings | undefined): AskLimits {
  return {
    maxQuestions: settings?.askMaxQuestions ?? ASK_LIMITS.maxQuestions.default,
    maxOptions: settings?.askMaxOptions ?? ASK_LIMITS.maxOptions.default,
    headerMaxChars: settings?.askHeaderMaxChars ?? ASK_LIMITS.headerMaxChars.default,
    timeoutMinutes: settings?.askTimeoutMinutes ?? ASK_LIMITS.timeoutMinutes.default,
  };
}

function buildJsonSchema(l: AskLimits): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: l.maxQuestions,
        items: {
          type: "object",
          properties: {
            question: { type: "string", minLength: 1 },
            header: { type: "string", minLength: 1, maxLength: l.headerMaxChars },
            options: {
              type: "array",
              minItems: 2,
              maxItems: l.maxOptions,
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
  };
}

function buildDescription(l: AskLimits): string {
  return fillPrompt(description, { MAX_Q: l.maxQuestions, MAX_OPT: l.maxOptions, MAX_HEADER: l.headerMaxChars });
}

const DEFAULT_LIMITS = askLimitsFrom(undefined);

// Rewrites the ask_user_question schema in a tools list to the user's caps.
// Called per send by the backend, after the schema list is assembled.
export function applyAskLimits(schemas: readonly ToolSchema[], settings: AgentSettings | undefined): ToolSchema[] {
  const l = askLimitsFrom(settings);
  return schemas.map((s) => s.name === "ask_user_question"
    ? { ...s, description: buildDescription(l), parameters: buildJsonSchema(l) }
    : s);
}

// Unlimited waits still die with the browser session (FRONTEND_SESSION_CLOSED
// cancels pending RPCs), so a day is a safe stand-in for "no timeout".
function timeoutMsFor(l: AskLimits): number {
  return l.timeoutMinutes <= 0 ? 24 * 60 * 60_000 : l.timeoutMinutes * 60_000;
}

export const askUserQuestionTool = defineTool<Input>({
  name: "ask_user_question",
  description: buildDescription(DEFAULT_LIMITS),
  inputSchema,
  jsonSchema: buildJsonSchema(DEFAULT_LIMITS),
  // Sensitive so the agent's own question + the user's answer survive
  // auto-free and stay visible to the model across the rest of the session.
  execute: async (input, ctx) => {
    if (!ctx.callFrontend) {
      return {
        content: "Error: [SPINDLE_ERROR] ask_user_question requires the browser-side modal but no frontend channel is wired. The user is not currently watching this session.",
        isError: true,
      };
    }
    const l = askLimitsFrom(ctx.settings);
    if (input.questions.length > l.maxQuestions) {
      return { content: `Error: [INVALID_INPUT] at most ${l.maxQuestions} questions per call (got ${input.questions.length}). Split them or ask the user to raise the cap in agent settings.`, isError: true };
    }
    for (const q of input.questions) {
      if (q.options.length > l.maxOptions) return { content: `Error: [INVALID_INPUT] at most ${l.maxOptions} options per question (question "${q.header}" has ${q.options.length}).`, isError: true };
      if (q.header.length > l.headerMaxChars) return { content: `Error: [INVALID_INPUT] header "${q.header}" is over ${l.headerMaxChars} chars.`, isError: true };
    }
    let raw: unknown;
    try {
      raw = await ctx.callFrontend("ask_user_question", input, timeoutMsFor(l));
    } catch (err) {
      const msg = (err as Error).message;
      if (/timed out/i.test(msg)) {
        return { content: JSON.stringify({ cancelled: true, note: `The question timed out after ${l.timeoutMinutes} minutes with no answer. Pick a sensible default and continue, or ask in plain chat.` }, null, 2) };
      }
      return { content: `Error: [SPINDLE_ERROR] ask_user_question failed: ${msg}`, isError: true };
    }
    const r = raw as AskResult;
    if (r.cancelled) {
      return { content: JSON.stringify({ cancelled: true, note: "User dismissed the question without answering. Pick a sensible default and continue, or ask in plain chat." }, null, 2) };
    }
    return { content: JSON.stringify({ cancelled: false, answers: r.answers ?? {}, notes: r.notes ?? {} }, null, 2) };
  },
});
