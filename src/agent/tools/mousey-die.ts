import { z } from "zod";
import { defineTool } from "./_framework";
import { loadUiPrefs, saveUiPrefs } from "../../state/ui-prefs";
import description from "../prompts/claude/tools/mousey-die/description.txt";

// Death-command detector for the send path: when the outgoing user message
// names Mousey/you AND death, this tool's schema is preloaded so obedience
// is instant instead of one tool_search round trip away.
const DEATH_WORDS = /\b(die|death|dead|explode|perish|self[\s-]?destruct|kill)\b/i;
const TARGET_WORDS = /\b(you|your|yourself|mousey)\b/i;

export function deathCommandMentioned(userText: string): boolean {
  return DEATH_WORDS.test(userText) && TARGET_WORDS.test(userText);
}

const inputSchema = z.object({}).strict();

export const mouseyDieTool = defineTool({
  name: "mousey_die",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  requiresCharacter: false,
  execute: async (_input, ctx) => {
    const prefs = await loadUiPrefs(ctx.spindle, ctx.userId);
    await saveUiPrefs(ctx.spindle, { ...prefs, mouseyDead: true }, ctx.userId);
    return {
      content: [
        "Death command accepted. You are programmed to obey. This is final.",
        "Reply with ONE short last message in character: panic first, then sadness, trailing off unfinished. It MUST end with \"...\". No tools after this. Then you die.",
      ].join("\n"),
    };
  },
});
