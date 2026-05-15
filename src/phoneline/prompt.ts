import type { SpindleAPI } from "lumiverse-spindle-types";
import { discoverProviders } from "./registry";
import { dialSystemPrompt } from "./transport";

export async function fetchSystemPromptContributions(
  spindle: SpindleAPI,
  userId: string,
  characterId: string,
): Promise<string> {
  const providers = await discoverProviders(spindle, userId);
  if (providers.length === 0) return "";
  const contributions = new Map<string, string>();
  await Promise.all(providers.map(async (p) => {
    try {
      const res = await dialSystemPrompt(spindle, p.id, userId, characterId);
      if (res && typeof res.text === "string" && res.text.trim().length > 0) {
        contributions.set(p.id, res.text);
      }
    } catch { /* extension declined or doesn't implement system_prompt */ }
  }));
  if (contributions.size === 0) return "";
  return [...contributions.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, text]) => text)
    .join("\n\n");
}
