import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/remember-note/description.txt";

const MAX_NOTE_CHARS = 300;
const MAX_NOTES_FILE_CHARS = 60_000;

const inputSchema = z.object({
  text: z.string().min(1).max(MAX_NOTE_CHARS),
  heading: z.string().min(1).max(60).optional(),
}).strict();

export const rememberNoteTool = defineTool({
  name: "remember_note",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: MAX_NOTE_CHARS, description: "One fact, present tense." },
      heading: { type: "string", maxLength: 60, description: "Optional '## heading' to file the note under. Created at the end of the file when missing." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    const { AGENT_NOTES_PATH } = await import("../../state/system-files");
    const ws = await import("../../state/workspace");
    const note = `- ${input.text.replace(/\s+/g, " ").trim()}`;
    let current = "";
    try { current = await ws.readText(ctx.spindle, ctx.userId, AGENT_NOTES_PATH); } catch { current = ""; }
    if (current.length + note.length + 2 > MAX_NOTES_FILE_CHARS) {
      return { content: `Error: [NOTES_FULL] agent/agent.md is over ${MAX_NOTES_FILE_CHARS} chars. Ask the user to prune it before adding more.`, isError: true };
    }
    if (current.includes(note)) return { content: "Already noted. No change." };
    let next: string;
    if (input.heading) {
      const headingLine = `## ${input.heading.trim()}`;
      const lines = current.split(/\r?\n/);
      const idx = lines.findIndex((l) => l.trim().toLowerCase() === headingLine.toLowerCase());
      if (idx === -1) {
        next = `${current.replace(/\s+$/, "")}\n\n${headingLine}\n${note}\n`;
      } else {
        let end = idx + 1;
        while (end < lines.length && !/^#{1,6}\s/.test(lines[end]!)) end++;
        while (end > idx + 1 && lines[end - 1]!.trim().length === 0) end--;
        lines.splice(end, 0, note);
        next = lines.join("\n");
        if (!next.endsWith("\n")) next += "\n";
      }
    } else {
      next = `${current.replace(/\s+$/, "")}\n${note}\n`;
    }
    await ws.writeText(ctx.spindle, ctx.userId, AGENT_NOTES_PATH, next, await ws.resolveUserCaps(ctx.spindle, ctx.userId));
    return { content: `Noted in agent/agent.md${input.heading ? ` under "${input.heading}"` : ""}. Loads from the next session on.` };
  },
});
