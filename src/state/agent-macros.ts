import type { SpindleAPI } from "lumiverse-spindle-types";

// One fixed macro, `{{lumiagent::<name>}}`, instead of one registration per
// stored name. Registration is global while values are per-user, so per-name
// registration would either leak values across users (updateMacroValue keys a
// single global cache) or require enumerating every user's store at boot to
// survive a worker restart. A single arg-taking macro resolved through the
// handler needs neither: env.extra.userId picks the store at invoke time.

export const MACROS_PATH = "agent/macros.json";
export const MACRO_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const MACRO_VALUE_MAX_CHARS = 8_000;
export const MACROS_MAX_PER_USER = 100;

type MacroMap = Record<string, string>;

const cache = new Map<string, MacroMap>();

async function load(spindle: SpindleAPI, userId: string): Promise<MacroMap> {
  const hit = cache.get(userId);
  if (hit) return hit;
  let map: MacroMap = {};
  try {
    const raw = await spindle.userStorage.read(`workspace/${MACROS_PATH}`, userId);
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && MACRO_NAME_RE.test(k)) map[k] = v;
      }
    }
  } catch { map = {}; }
  cache.set(userId, map);
  return map;
}

async function persist(spindle: SpindleAPI, userId: string, map: MacroMap): Promise<void> {
  await spindle.userStorage.write(`workspace/${MACROS_PATH}`, JSON.stringify(map), userId);
  cache.set(userId, map);
}

export async function listMacros(spindle: SpindleAPI, userId: string): Promise<MacroMap> {
  return { ...(await load(spindle, userId)) };
}

export async function setMacro(spindle: SpindleAPI, userId: string, name: string, value: string): Promise<{ created: boolean; count: number }> {
  const map = { ...(await load(spindle, userId)) };
  const created = !(name in map);
  if (created && Object.keys(map).length >= MACROS_MAX_PER_USER) {
    throw new Error(`macro store is full (${MACROS_MAX_PER_USER}); clear one first`);
  }
  map[name] = value;
  await persist(spindle, userId, map);
  return { created, count: Object.keys(map).length };
}

export async function clearMacro(spindle: SpindleAPI, userId: string, name: string): Promise<boolean> {
  const map = { ...(await load(spindle, userId)) };
  if (!(name in map)) return false;
  delete map[name];
  await persist(spindle, userId, map);
  return true;
}

interface MacroInvokeCtx {
  readonly args?: readonly string[];
  readonly env?: { readonly extra?: { readonly userId?: string } };
}

// Called once at backend startup. The handler is invoked by the host for every
// `{{lumiagent::...}}` occurrence in any user's prompts, so it must stay cheap
// and must never throw (an unresolvable ref renders empty, matching host macro
// error behavior).
export function registerAgentMacro(spindle: SpindleAPI): void {
  spindle.registerMacro({
    name: "lumiagent",
    category: "extension",
    description: "A value stored by the LumiAgent agent. Usage: {{lumiagent::name}}. Bare {{lumiagent}} lists stored names.",
    args: [{ name: "name", description: "Stored value name", required: false }],
    handler: (async (ctx: MacroInvokeCtx) => {
      try {
        const userId = ctx.env?.extra?.userId;
        if (!userId) return "";
        const map = await load(spindle, userId);
        const name = (ctx.args?.[0] ?? "").trim().toLowerCase();
        if (name === "") return Object.keys(map).sort().join(", ");
        return map[name] ?? "";
      } catch { return ""; }
    }) as unknown as string,
  });
}
