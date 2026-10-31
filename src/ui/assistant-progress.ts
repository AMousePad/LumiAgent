import type { AssistantActivity } from "../types";
import type { createActivitySummary } from "./activity-summary";
import { onDispose } from "./dom-lifecycle";

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function mountAssistantProgress(reasoning: ReturnType<typeof createActivitySummary>, showWaiting?: (label: string | null) => void) {
  const summary = reasoning.root.querySelector("summary")!;
  let activity: AssistantActivity | undefined;
  let receivedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
  const render = () => {
    if (!activity) return;
    const active = ["waiting", "thinking", "responding", "tools"].includes(activity.phase);
    const now = (activity.observedAt ?? activity.updatedAt) + (active ? performance.now() - receivedAt : 0);
    const silence = Math.max(0, now - activity.updatedAt);
    const thinking = activity.phase === "thinking";
    const elapsed = activity.reasoningMs + (activity.thinkingSince === undefined ? 0 : Math.max(0, now - activity.thinkingSince));
    const waiting = active && activity.phase !== "tools" && silence >= 30000;
    reasoning.root.classList.toggle("is-thinking", thinking && !waiting);
    reasoning.setLabel(waiting && thinking ? `Waiting for model · ${duration(silence)}` : thinking ? `Thinking for ${duration(elapsed)}` : elapsed > 0 ? `Thought for ${duration(elapsed)}` : "Reasoning");
    summary.title = active ? `Last update ${duration(silence)} ago` : "Reasoning and tool history";
    showWaiting?.(activity.phase === "waiting" ? `Waiting for model${silence >= 1000 ? ` · ${duration(silence)}` : "…"}` : waiting && !thinking ? `Waiting for model · ${duration(silence)}` : null);
  };
  onDispose(summary, stop);
  return {
    update(value: AssistantActivity | undefined) {
      activity = value ? { ...value } : undefined;
      receivedAt = performance.now();
      stop(); render();
      if (activity && ["waiting", "thinking", "responding", "tools"].includes(activity.phase)) timer = setInterval(render, 1000);
    },
    destroy: stop,
  };
}
