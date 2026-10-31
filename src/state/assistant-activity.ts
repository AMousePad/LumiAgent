import type { AgentEvent, AssistantActivity, ChatAssistantMessage } from "../types";

export function activitySnapshot(activity: AssistantActivity | undefined, now = Date.now()): AssistantActivity | undefined {
  return activity ? { ...activity, observedAt: now } : undefined;
}

export function advanceActivity(message: ChatAssistantMessage, event: AgentEvent, now = Date.now()): void {
  const previous = message.activity;
  let phase: AssistantActivity["phase"] | undefined;
  switch (event.type) {
    case "turn_retry":
    case "turn_started": phase = "waiting"; break;
    case "llm_reasoning": if (event.token) phase = "thinking"; break;
    case "llm_token": if (event.token) phase = "responding"; break;
    case "tool_started": phase = "tools"; break;
    case "tool_finished": phase = "tools"; break;
    case "turn_completed": phase = "waiting"; break;
    case "paused_for_input": phase = "complete"; break;
  }
  if (!phase) return;
  const activity: AssistantActivity = previous ?? { phase: "waiting", reasoningMs: 0, turnStartedAt: now, updatedAt: now };
  if (activity.thinkingSince !== undefined && phase !== "thinking") {
    activity.reasoningMs += Math.max(0, now - activity.thinkingSince);
    delete activity.thinkingSince;
  }
  if (phase === "thinking" && activity.thinkingSince === undefined) {
    activity.thinkingSince = activity.phase === "waiting" ? activity.turnStartedAt : now;
  }
  if (event.type === "turn_started") activity.turnStartedAt = now;
  activity.phase = phase;
  activity.updatedAt = now;
  delete activity.observedAt;
  message.activity = activity;
}

export function finishActivity(message: ChatAssistantMessage, now = Date.now()): void {
  const activity = message.activity;
  if (!activity || message.status === "streaming") return;
  if (activity.thinkingSince !== undefined) {
    activity.reasoningMs += Math.max(0, now - activity.thinkingSince);
    delete activity.thinkingSince;
  }
  activity.phase = message.status;
  activity.updatedAt = now;
  delete activity.observedAt;
}
