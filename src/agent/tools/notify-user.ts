import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/notify-user/description.txt";
import argTitle from "../prompts/claude/tools/notify-user/arg_title.txt";
import argBody from "../prompts/claude/tools/notify-user/arg_body.txt";

const inputSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1),
}).strict();

export const notifyUserTool = defineTool({
  name: "notify_user",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 100, description: argTitle },
      body: { type: "string", minLength: 1, description: argBody },
    },
    required: ["title", "body"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    // userId is mandatory here: the host throws for operator-scoped extensions
    // without it rather than defaulting, which would broadcast to every user.
    let status;
    try { status = await ctx.spindle.push.getStatus(ctx.userId); }
    catch { status = { available: false, subscriptionCount: 0 }; }

    if (!status.available || status.subscriptionCount === 0) {
      return { content: JSON.stringify({ sent: 0, reason: "The user has no push subscription. Say it in the chat instead." }) };
    }

    try {
      const res = await ctx.spindle.push.send({ title: input.title, body: input.body }, ctx.userId);
      return { content: JSON.stringify({ sent: res.sent }) };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true };
    }
  },
});
