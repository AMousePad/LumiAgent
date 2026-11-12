import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { isDeferredTool, isReadOnlyTool, registry } from "./_registry";
import { isToolGroup } from "./_tool-groups";
import { prepareToolArgs } from "./_framework";
import { fillPrompt } from "../prompts/_fill";
import description from "../prompts/claude/tools/delegate/description.txt";
import preamble from "../prompts/claude/agent/subagent/preamble.txt";
import type { ToolSchema } from "../../types";
import type { ToolCtx, ToolFn } from "../tools";
import {
  BUILTIN_PROFILES, DEFAULT_SUBAGENT_MAX_MINUTES, MAX_SUBAGENT_MAX_TURNS, loadAllProfiles, type AgentProfile,
} from "../../state/agent-profiles";

const MAX_TASK_CHARS = 20_000;

// Tools that only make sense for the top-level assistant talking to a user.
const EXCLUDED_FOR_SUBAGENTS: ReadonlySet<string> = new Set([
  "delegate", "ask_user_question", "todo_write", "notify_user", "navigate_ui", "mousey_die",
]);

const inputSchema = z.object({
  task: z.string().min(1).max(MAX_TASK_CHARS),
  agent: z.string().min(1).max(40).optional(),
  connection: z.string().min(1).max(200).optional(),
  max_turns: z.number().int().min(1).max(MAX_SUBAGENT_MAX_TURNS).optional(),
}).strict();

type Input = z.infer<typeof inputSchema>;

function profileAllows(profile: AgentProfile, name: string): boolean {
  if (EXCLUDED_FOR_SUBAGENTS.has(name)) return false;
  // finish is intercepted by the child loop, so every profile may call it.
  if (name === "finish") return true;
  if (profile.tools === "all") return true;
  if (profile.tools === "read_only") return isReadOnlyTool(name) || isToolGroup(name);
  return profile.tools.includes(name);
}

// Group calls carry their action in args, so read-only enforcement for a group
// happens here per call rather than at schema time.
function callIsReadOnly(name: string, args: Record<string, unknown>): boolean {
  const tool = registry.get(name);
  if (isToolGroup(name)) {
    const prepared = tool ? prepareToolArgs(tool, args) as Record<string, unknown> : args;
    return Boolean(tool?.isConcurrencySafe?.(prepared));
  }
  if (tool?.isReadOnly) return Boolean(tool.isReadOnly(prepareToolArgs(tool, args)));
  return isReadOnlyTool(name);
}

export const delegateTool = defineTool<Input>({
  name: "delegate",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      task: { type: "string", minLength: 1, maxLength: MAX_TASK_CHARS, description: "Complete, self-contained brief: goal, exact ids/paths, constraints, and the report shape you want back." },
      agent: { type: "string", description: "Profile: explore (read-only, parallel-safe), worker (can edit), or a name from the workspace agents/ folder. Default worker." },
      connection: { type: "string", description: "Run on another model connection (id or display name). Default: this session's connection." },
      max_turns: { type: "integer", minimum: 1, maximum: MAX_SUBAGENT_MAX_TURNS, description: "Model turns before the subagent must report. Default from the profile (25)." },
    },
    required: ["task"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isConcurrencySafe: (input) => (input.agent ?? "worker") === "explore",
  execute: async (input, ctx) => {
    const d = ctx.delegation;
    if (!d) {
      return { content: "Error: [SPINDLE_ERROR] delegate is not available here (no delegation context). Subagents cannot delegate further.", isError: true };
    }
    const dispatch = (ctx as ToolCtx & { __dispatch?: Record<string, ToolFn> }).__dispatch;
    if (!dispatch) return { content: "Error: delegate is not wired (no dispatch map).", isError: true };

    const requested = (input.agent ?? "worker").trim();
    const profiles = await loadAllProfiles(ctx.spindle, ctx.userId);
    let profile = profiles.find((p) => p.name.toLowerCase() === requested.toLowerCase());
    if (!profile) {
      return {
        content: `Error: [INVALID_INPUT] unknown agent profile '${requested}'. Available: ${profiles.map((p) => `${p.name} (${p.description})`).join("; ")}. Add more as workspace agents/<name>.md.`,
        isError: true,
      };
    }
    if (ctx.readOnlyMode && profile.tools !== "read_only") {
      profile = { ...profile, tools: "read_only", prompt: `${profile.prompt}\n\nPlan mode is on: every write tool is refused this run.` };
    }

    const connRef = input.connection ?? profile.connection;
    let connectionId = d.connectionId;
    let parameters = d.parameters;
    let connectionLabel = "session connection";
    if (connRef) {
      const resolved = await d.resolveConnection(connRef);
      if (!resolved) return { content: `Error: [INVALID_INPUT] no model connection matches '${connRef}'. Use connections(action=list) to see ids and names.`, isError: true };
      connectionId = resolved.connectionId;
      parameters = resolved.parameters;
      connectionLabel = resolved.name;
    }

    const allowedNames = new Set(d.toolSchemas.map((s) => s.name).filter((n) => profileAllows(profile!, n)));
    const initial = d.toolSchemas.filter((s) => allowedNames.has(s.name) && !isDeferredTool(s.name));
    const discoverable: Record<string, ToolSchema> = {};
    for (const s of d.toolSchemas) if (allowedNames.has(s.name) && isDeferredTool(s.name)) discoverable[s.name] = s;
    const readOnlyProfile = profile.tools === "read_only";
    const allowCall = (name: string, args: Record<string, unknown>): string | null => {
      if (!allowedNames.has(name)) return `'${name}' is not available to the '${profile!.name}' subagent.`;
      if (readOnlyProfile && !callIsReadOnly(name, args)) return `'${profile!.name}' is read-only, '${name}' with these arguments would write. Report what should change instead.`;
      return null;
    };

    const rules = [profile.prompt.trim(), readOnlyProfile ? "" : "Edits you make are recorded in the Workshop ledger under the main assistant's call and can be reverted by the user."].filter(Boolean).join("\n\n");
    const systemPrompt = `${fillPrompt(preamble, { AGENT: profile.name, DESCRIPTION: profile.description, PROFILE_RULES: rules })}\n\n---\n\n${d.systemPrompt}`;
    const maxTurns = Math.min(input.max_turns ?? profile.maxTurns, MAX_SUBAGENT_MAX_TURNS);
    const callId = ctx.rootCallId ?? "";
    const onProgress = d.onProgress && callId ? (ev: Parameters<NonNullable<typeof d.onProgress>>[1]) => d.onProgress!(callId, ev) : undefined;

    const { runSubagent } = await import("../subagent");
    const outcome = await runSubagent({
      ctx, dispatch, systemPrompt, contextNote: d.contextNote, task: input.task,
      tools: initial, discoverable, allowCall, maxTurns, maxTimeMs: DEFAULT_SUBAGENT_MAX_MINUTES * 60_000,
      connectionId, parameters, reasoning: d.reasoning, cacheMode: d.cacheMode, onProgress,
    });

    const payload = {
      agent: profile.name,
      connection: connectionLabel,
      status: outcome.status,
      turns: outcome.turns,
      tool_calls: outcome.toolCalls,
      tokens: outcome.usage,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      report: outcome.result.length > 0 ? outcome.result : "(the subagent produced no report)",
      ...(outcome.status !== "completed" ? { note: "The subagent did not finish cleanly. Treat the report as partial and verify before relying on it." } : {}),
    };
    const content = await spillOrReturn(ctx, JSON.stringify(payload, null, 2), `delegate:${profile.name}`);
    return outcome.status === "error" ? { content, isError: true } : { content };
  },
});

export const SUBAGENT_BUILTIN_NAMES = BUILTIN_PROFILES.map((p) => p.name);
