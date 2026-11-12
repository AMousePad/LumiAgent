import type { SpindleAPI } from "lumiverse-spindle-types";
import { listDir, readText } from "./workspace";

// Subagent profiles. Two builtins plus user-authored `agents/<name>.md` files
// in the workspace (frontmatter + prompt body), the same pattern as skills.
export const AGENTS_DIR = "agents";
export const DEFAULT_SUBAGENT_MAX_TURNS = 25;
export const MAX_SUBAGENT_MAX_TURNS = 80;
export const DEFAULT_SUBAGENT_MAX_MINUTES = 15;

export interface AgentProfile {
  readonly name: string;
  readonly description: string;
  readonly tools: "all" | "read_only" | readonly string[];
  readonly maxTurns: number;
  readonly connection?: string | undefined;
  readonly prompt: string;
  readonly builtin: boolean;
}

export const BUILTIN_PROFILES: readonly AgentProfile[] = [
  {
    name: "explore",
    description: "read-only investigator: finds, reads, greps, audits, and reports",
    tools: "read_only",
    maxTurns: DEFAULT_SUBAGENT_MAX_TURNS,
    prompt: "You are read-only. Every write tool is refused. Report findings with exact ids, paths and quoted lines so the main assistant can act without re-reading.",
    builtin: true,
  },
  {
    name: "worker",
    description: "general worker: reads and edits like the main assistant",
    tools: "all",
    maxTurns: DEFAULT_SUBAGENT_MAX_TURNS,
    prompt: "Read before you edit. Make only the changes the brief asks for and list every edit in the report with its path.",
    builtin: true,
  },
];

export function isValidProfileName(name: string): boolean {
  return /^[a-z][a-z0-9_-]{0,39}$/i.test(name);
}

function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fields: {}, body: text.trim() };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!.toLowerCase()] = kv[2]!.trim();
  }
  return { fields, body: m[2]!.trim() };
}

function parseTools(raw: string | undefined): AgentProfile["tools"] {
  const v = (raw ?? "all").trim();
  if (v === "" || v === "all" || v === "*") return "all";
  if (v === "read_only" || v === "read-only" || v === "readonly") return "read_only";
  return v.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
}

export function parseProfileMarkdown(name: string, text: string): AgentProfile {
  const { fields, body } = parseFrontmatter(text);
  const turns = Number.parseInt(fields["max_turns"] ?? "", 10);
  const maxTurns = Number.isFinite(turns) && turns > 0 ? Math.min(turns, MAX_SUBAGENT_MAX_TURNS) : DEFAULT_SUBAGENT_MAX_TURNS;
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return {
    name,
    description: fields["description"] ?? firstLine.slice(0, 160),
    tools: parseTools(fields["tools"]),
    maxTurns,
    ...(fields["connection"] ? { connection: fields["connection"] } : {}),
    prompt: body,
    builtin: false,
  };
}

export async function loadUserProfiles(spindle: SpindleAPI, userId: string): Promise<AgentProfile[]> {
  let nodes: Awaited<ReturnType<typeof listDir>>;
  try { nodes = await listDir(spindle, userId, AGENTS_DIR); }
  catch { return []; }
  const out: AgentProfile[] = [];
  for (const n of nodes) {
    if (n.isDirectory || !n.name.toLowerCase().endsWith(".md")) continue;
    const name = n.name.slice(0, -3);
    if (!isValidProfileName(name) || name.toLowerCase() === "readme") continue;
    try {
      const text = await readText(spindle, userId, `${AGENTS_DIR}/${n.name}`);
      out.push(parseProfileMarkdown(name, text));
    } catch { /* unreadable profile, skip */ }
  }
  return out;
}

export async function loadAllProfiles(spindle: SpindleAPI, userId: string): Promise<AgentProfile[]> {
  const user = await loadUserProfiles(spindle, userId);
  const builtinNames = new Set(BUILTIN_PROFILES.map((p) => p.name));
  return [...BUILTIN_PROFILES, ...user.filter((p) => !builtinNames.has(p.name))];
}

export function describeProfiles(profiles: readonly AgentProfile[]): string {
  return profiles.map((p) => `- ${p.name}: ${p.description}`).join("\n");
}

export const AGENTS_README = `# Subagent profiles

Each \`agents/<name>.md\` file here becomes a profile the assistant can pass as \`agent\` to the delegate tool. Builtins: \`explore\` (read-only) and \`worker\` (can edit).

\`\`\`
---
description: one line the assistant sees when choosing a profile
tools: read_only            # or: all, or a comma list of tool names (read, grep, list, workspace, chats)
max_turns: 25               # 1-80
connection: GPT-6 Astra     # optional: connection name or id to run this profile on
---
Instructions for the subagent. Written as its system prompt addendum.
\`\`\`
`;
