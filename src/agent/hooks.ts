// Declarative tool hooks from settings. No code runs: a rule matches a tool
// call by name / action / path glob and either refuses it, forces an approval
// prompt, or runs a saved custom tool after it with the call's result.
export interface HookRule {
  readonly tool: string;
  readonly action?: string | undefined;
  readonly path?: string | undefined;
  readonly when: "before" | "after";
  readonly effect: "deny" | "approve" | "run";
  readonly custom_tool?: string | undefined;
  readonly message?: string | undefined;
}

export const MAX_HOOK_RULES = 64;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export function coerceHooks(raw: unknown): HookRule[] {
  if (!Array.isArray(raw)) return [];
  const out: HookRule[] = [];
  for (const item of raw.slice(0, MAX_HOOK_RULES)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const tool = str(r["tool"]);
    const when = r["when"] === "after" ? "after" : "before";
    const effect = r["effect"] === "approve" || r["effect"] === "run" ? r["effect"] : r["effect"] === "deny" ? "deny" : null;
    if (!tool || !effect) continue;
    if (effect === "run" && !str(r["custom_tool"])) continue;
    if (when === "after" && effect !== "run") continue;
    if (when === "before" && effect === "run") continue;
    out.push({
      tool,
      action: str(r["action"]),
      path: str(r["path"]),
      when,
      effect,
      custom_tool: str(r["custom_tool"]),
      message: str(r["message"]),
    });
  }
  return out;
}

// Parse the settings textarea. Throws with a human message on bad JSON or
// rules that would be silently dropped, so the UI can refuse the save.
export function parseHooksText(text: string): HookRule[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch (e) { throw new Error(`Hooks are not valid JSON: ${(e as Error).message}`); }
  if (!Array.isArray(parsed)) throw new Error("Hooks must be a JSON array of rules.");
  const rules = coerceHooks(parsed);
  if (rules.length !== parsed.length) throw new Error(`${parsed.length - rules.length} rule(s) are invalid. Each needs tool, when (before|after), effect (deny|approve|run), and custom_tool for run.`);
  return rules;
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

const globCache = new Map<string, RegExp>();
function globMatch(glob: string, value: string): boolean {
  let re = globCache.get(glob);
  if (!re) { re = globToRegExp(glob); globCache.set(glob, re); }
  return re.test(value);
}

export function hookMatches(rule: HookRule, toolName: string, args: Readonly<Record<string, unknown>>): boolean {
  if (!globMatch(rule.tool, toolName)) return false;
  if (rule.action !== undefined) {
    const action = typeof args["action"] === "string" ? args["action"] : "";
    if (!globMatch(rule.action, action)) return false;
  }
  if (rule.path !== undefined) {
    const p = typeof args["path"] === "string" ? args["path"] : typeof args["from"] === "string" ? args["from"] : "";
    if (!globMatch(rule.path, p)) return false;
  }
  return true;
}

export function describeHook(rule: HookRule): string {
  const where = [rule.tool, rule.action ? `action=${rule.action}` : "", rule.path ? `path=${rule.path}` : ""].filter(Boolean).join(" ");
  return rule.message ?? `${rule.when} ${where}: ${rule.effect}${rule.custom_tool ? ` ${rule.custom_tool}` : ""}`;
}
