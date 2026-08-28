import { z } from "zod";
import { defineTool } from "./_framework";
import { TUTORIAL_STEPS, VERDICT_RIGHT, VERDICT_WRONG, tutorialFinale, tutorialQuizCount, type VnLine } from "../../ui/tutorial-content";
import description from "../prompts/claude/tools/read-tutorial-script/description.txt";

function lineText(ln: VnLine): string {
  const tag = ln.kind === "speech" ? "Mousey" : ln.kind === "thought" ? "(thought)" : ln.kind === "sfx" ? "[sfx]" : "[narration]";
  return `  ${tag}: ${ln.text}`;
}

// The script is static; render it once at module load.
function renderScript(): string {
  const out: string[] = [
    "# Onboarding tour script (the VN tutorial the user plays in the drawer)",
    "",
    "You are the character in this tour: it dramatizes your first shift. Quiz answers marked with (correct).",
    "",
  ];
  let quiz = 0;
  TUTORIAL_STEPS.forEach((step, i) => {
    if (step.kind === "say") {
      out.push(`## Step ${i + 1}${step.anchor ? ` (spotlights: ${step.anchor})` : ""}`);
      for (const ln of step.lines) out.push(lineText(ln));
    } else {
      quiz++;
      out.push(`## Step ${i + 1}, Quiz ${quiz} of ${tutorialQuizCount()}${step.anchor ? ` (spotlights: ${step.anchor})` : ""}`);
      for (const ln of step.lines) out.push(lineText(ln));
      for (const o of step.options) out.push(`  - ${o.text}${o.correct ? " (correct)" : ""}`);
      out.push(`  Why: ${step.why}`);
    }
    out.push("");
  });
  out.push("## Quiz reactions");
  out.push("Right answer:");
  for (const ln of VERDICT_RIGHT) out.push(lineText(ln));
  out.push("Wrong answer:");
  for (const ln of VERDICT_WRONG) out.push(lineText(ln));
  out.push("");
  out.push("## Finale (by score out of 5)");
  for (const [label, score] of [["Perfect (5)", 5], ["Middling (3-4)", 3], ["Low (0-2)", 0]] as const) {
    out.push(`${label}:`);
    for (const ln of tutorialFinale(score, 5)) out.push(lineText(ln));
  }
  return out.join("\n");
}

const SCRIPT = renderScript();

const inputSchema = z.object({}).strict();

export const readTutorialScriptTool = defineTool({
  name: "read_tutorial_script",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  requiresCharacter: false,
  execute: async () => ({ content: SCRIPT }),
});
