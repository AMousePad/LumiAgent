import type { SpindleAPI } from "lumiverse-spindle-types";
import { listDir, readText } from "./workspace";

// Skills are reusable instruction files at `skills/<name>.md`. The system
// prompt lists name + description, the agent reads the body on demand, and a
// user message starting with `/<name>` inlines the body ahead of the request.
export const SKILLS_DIR = "skills";

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

export function isValidSkillName(name: string): boolean {
  return /^[a-z][a-z0-9_-]{0,39}$/i.test(name);
}

function parseSkill(name: string, text: string): Skill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  let description = "";
  let body = text.trim();
  if (m) {
    for (const line of m[1]!.split(/\r?\n/)) {
      const kv = /^description\s*:\s*(.*)$/i.exec(line);
      if (kv) description = kv[1]!.trim();
    }
    body = m[2]!.trim();
  }
  if (!description) description = (body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").replace(/^#+\s*/, "").slice(0, 160);
  return { name, description, body };
}

export async function loadSkills(spindle: SpindleAPI, userId: string): Promise<Skill[]> {
  let nodes: Awaited<ReturnType<typeof listDir>>;
  try { nodes = await listDir(spindle, userId, SKILLS_DIR); }
  catch { return []; }
  const out: Skill[] = [];
  for (const n of nodes) {
    if (n.isDirectory || !n.name.toLowerCase().endsWith(".md")) continue;
    const name = n.name.slice(0, -3);
    if (!isValidSkillName(name) || name.toLowerCase() === "readme") continue;
    try { out.push(parseSkill(name, await readText(spindle, userId, `${SKILLS_DIR}/${n.name}`))); }
    catch { /* unreadable skill, skip */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function describeSkills(skills: readonly Skill[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

// `/name rest` -> the skill plus the rest of the message. Null when the text
// is not a slash command or names no known skill.
export function expandSlashCommand(content: string, skills: readonly Skill[]): { skill: Skill; rest: string } | null {
  const m = /^\/([A-Za-z][\w-]*)\b[ \t]*([\s\S]*)$/.exec(content.trim());
  if (!m) return null;
  const skill = skills.find((s) => s.name.toLowerCase() === m[1]!.toLowerCase());
  return skill ? { skill, rest: m[2]!.trim() } : null;
}

export function renderSkillInvocation(skill: Skill, rest: string): string {
  const request = rest.length > 0 ? rest : "(no further instructions: apply the skill to the current context)";
  return `[Skill "${skill.name}" invoked by the user. Follow these instructions for this request.]\n${skill.body}\n\n[User request]\n${request}`;
}

export const SKILLS_README = `# Skills

Each \`skills/<name>.md\` file is a reusable instruction set. The assistant sees the name and description in its system prompt and reads the file when a task matches. Typing \`/<name> your request\` in the chat inlines the skill ahead of your request.

\`\`\`
---
description: one line shown to the assistant
---
Step-by-step instructions, checklists, conventions, example wording.
\`\`\`
`;
