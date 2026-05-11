// Browser-side bridge for the backend's `translate_card_strings` tool.
// Uses Chrome's built-in on-device Translator API (window.Translator /
// window.ai?.translator). The backend RPCs in with a batch of items keyed
// by id + kind; we resolve a Translator per language pair, dispatch
// per-kind parsing, and return the translated strings.
//
// Kind semantics:
//   plain — translate the whole string in one shot.
//   html  — DOMParser → text-node walk → translate each → reassemble.
//   lua   — extract "..." and '...' string literals → translate each → splice back.
//
// If the Translator API is missing or the language pair has no on-device
// model, we surface `capabilityError` so the tool can fail cleanly with a
// useful message instead of returning a half-translated card.

type Kind = "plain" | "html" | "lua";

interface IncomingItem { readonly id: string; readonly text: string; readonly kind: Kind }
interface OutgoingItem { readonly id: string; readonly text?: string; readonly error?: string }

interface TranslatorInstance {
  translate(text: string): Promise<string>;
}

interface TranslatorFactory {
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
  availability?: (opts: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
}

function pickTranslatorFactory(): TranslatorFactory | null {
  const w = globalThis as unknown as {
    Translator?: TranslatorFactory;
    ai?: { translator?: TranslatorFactory };
    translation?: { createTranslator?: (opts: { sourceLanguage: string; targetLanguage: string }) => Promise<TranslatorInstance> };
  };
  if (w.Translator?.create) return w.Translator;
  if (w.ai?.translator?.create) return w.ai.translator;
  if (w.translation?.createTranslator) {
    return {
      create: async (opts) => {
        const t = await w.translation!.createTranslator!(opts);
        return t;
      },
    };
  }
  return null;
}

const translatorCache = new Map<string, Promise<TranslatorInstance>>();

function getTranslator(factory: TranslatorFactory, source: string, target: string): Promise<TranslatorInstance> {
  const key = `${source}->${target}`;
  let p = translatorCache.get(key);
  if (!p) {
    p = factory.create({ sourceLanguage: source, targetLanguage: target });
    translatorCache.set(key, p);
  }
  return p;
}

async function translateHtml(html: string, t: TranslatorInstance): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let cur: Node | null = walker.nextNode();
  while (cur) { nodes.push(cur as Text); cur = walker.nextNode(); }
  for (const n of nodes) {
    const raw = n.nodeValue ?? "";
    if (raw.trim().length === 0) continue;
    try {
      const tr = await t.translate(raw);
      n.nodeValue = tr;
    } catch {
      // Leave the node untouched on per-string failure; partial translation
      // is preferable to throwing the whole document out.
    }
  }
  return doc.body.innerHTML;
}

// Lua string literal matcher. Supports double-quoted and single-quoted
// strings with escape sequences. Does NOT yet handle [[ long brackets ]] —
// those are rare in Risu-style snippets; can extend if needed.
const LUA_STRING_RX = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;

async function translateLua(code: string, t: TranslatorInstance): Promise<string> {
  const matches: Array<{ start: number; end: number; raw: string; quote: '"' | "'"; inner: string }> = [];
  for (const m of code.matchAll(LUA_STRING_RX)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const inner = m[1] ?? m[2] ?? "";
    matches.push({ start, end: start + raw.length, raw, quote: raw.charAt(0) as '"' | "'", inner });
  }
  if (matches.length === 0) return code;
  const translatedInners = new Map<string, string>();
  for (const m of matches) {
    if (translatedInners.has(m.inner)) continue;
    if (m.inner.trim().length === 0) { translatedInners.set(m.inner, m.inner); continue; }
    try { translatedInners.set(m.inner, await t.translate(m.inner)); }
    catch { translatedInners.set(m.inner, m.inner); }
  }
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += code.slice(cursor, m.start);
    const translated = translatedInners.get(m.inner) ?? m.inner;
    out += `${m.quote}${translated.replace(/\\/g, "\\\\").replace(m.quote === '"' ? /"/g : /'/g, "\\" + m.quote)}${m.quote}`;
    cursor = m.end;
  }
  out += code.slice(cursor);
  return out;
}

export async function handleTranslateBatch(args: unknown): Promise<{ translated: OutgoingItem[]; capabilityError?: string }> {
  const { items, source_lang, target_lang } = args as { items: IncomingItem[]; source_lang: string; target_lang: string };
  const factory = pickTranslatorFactory();
  if (!factory) return { translated: [], capabilityError: "Translator API not exposed by this browser (needs Chrome desktop with on-device translator)." };
  let translator: TranslatorInstance;
  try { translator = await getTranslator(factory, source_lang, target_lang); }
  catch (err) { return { translated: [], capabilityError: `Translator init failed (${source_lang}→${target_lang}): ${(err as Error).message}` }; }

  const out: OutgoingItem[] = [];
  for (const it of items) {
    try {
      if (it.kind === "plain") {
        out.push({ id: it.id, text: await translator.translate(it.text) });
      } else if (it.kind === "html") {
        out.push({ id: it.id, text: await translateHtml(it.text, translator) });
      } else if (it.kind === "lua") {
        out.push({ id: it.id, text: await translateLua(it.text, translator) });
      } else {
        out.push({ id: it.id, error: `unknown kind '${it.kind as string}'` });
      }
    } catch (err) {
      out.push({ id: it.id, error: (err as Error).message });
    }
  }
  return { translated: out };
}
