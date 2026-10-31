import type { Context } from "modern-screenshot";

const normalizeFamily = (family: string) =>
  family.trim().replace(/["']/g, "").toLowerCase();

export async function waitForCaptureFonts(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (document.fonts.status !== "loading") return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Fonts are still loading. Retry the capture when they finish.",
          ),
        ),
      5000,
    );
    signal.addEventListener("abort", abort, { once: true });
    document.fonts.ready.then(() => finish(), finish);
  });
}

export async function embedCaptureFonts(
  context: Context,
  signal: AbortSignal,
  warnings: Set<string>,
): Promise<string> {
  // Pseudo-elements can use a different font from the element that owns them.
  const style = document.createElement("span").style;
  for (const declarations of context.svgStyles.keys()) {
    style.cssText = declarations;
    for (const family of style.fontFamily
      .split(",")
      .map(normalizeFamily)
      .filter(Boolean)) {
      if (!context.fontFamilies.has(family))
        context.fontFamilies.set(family, new Set());
    }
  }

  const faces: CSSFontFaceRule[] = [];
  const visited = new Set<CSSStyleSheet>();
  const collectRules = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) faces.push(rule);
      else if (rule instanceof CSSImportRule && rule.styleSheet)
        collectSheet(rule.styleSheet);
      else if (
        rule instanceof CSSMediaRule &&
        !matchMedia(rule.conditionText).matches
      )
        continue;
      else if (
        rule instanceof CSSSupportsRule &&
        !CSS.supports(rule.conditionText)
      )
        continue;
      else if ("cssRules" in rule)
        collectRules((rule as CSSGroupingRule).cssRules);
    }
  };
  const collectSheet = (sheet: CSSStyleSheet) => {
    if (visited.has(sheet) || sheet.disabled) return;
    visited.add(sheet);
    if (sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches)
      return;
    try {
      collectRules(sheet.cssRules);
    } catch {
      warnings.add(
        "Some stylesheet rules were inaccessible; their fonts may be missing from the capture.",
      );
    }
  };
  for (const root of [document, ...context.shadowRoots]) {
    for (const sheet of [
      ...Array.from(root.styleSheets),
      ...root.adoptedStyleSheets,
    ])
      collectSheet(sheet);
  }

  const downloads = new Map<string, Promise<string>>();
  const download = (url: URL): Promise<string> => {
    let pending = downloads.get(url.href);
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        signal.throwIfAborted();
        const response = await fetch(url.href, {
          credentials: "same-origin",
          cache: "no-cache",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Font download failed.");
        const blob = await response.blob();
        signal.throwIfAborted();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    })();
    downloads.set(url.href, pending);
    return pending;
  };

  const embeddedFamilies = new Set<string>();
  const rules: string[] = [];
  for (const face of faces) {
    const family = normalizeFamily(face.style.getPropertyValue("font-family"));
    if (!context.fontFamilies.has(family)) continue;
    const source = face.style.getPropertyValue("src");
    const urls = [
      ...source.matchAll(
        /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/g,
      ),
    ];
    let embedded = source;
    let usable = urls.length === 0;
    for (const match of urls) {
      try {
        const raw = (match[1] ?? match[2] ?? match[3] ?? "")
          .trim()
          .replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, character) => {
            const code = hex ? parseInt(hex, 16) : 0;
            return hex
              ? String.fromCodePoint(
                  code > 0 && code <= 0x10ffff ? code : 0xfffd,
                )
              : character;
          });
        const url = new URL(
          raw,
          face.parentStyleSheet?.href ?? document.baseURI,
        );
        if (url.protocol !== "data:" && url.origin !== location.origin) {
          warnings.add("Cross-origin fonts were omitted from the capture.");
          embedded = embedded.replace(
            match[0],
            'url("data:font/woff2;base64,")',
          );
          continue;
        }
        const data = url.protocol === "data:" ? url.href : await download(url);
        embedded = embedded.replace(match[0], `url(${JSON.stringify(data)})`);
        usable = true;
      } catch {
        signal.throwIfAborted();
        warnings.add(
          "A font could not be embedded; its text or icons may differ from the live page.",
        );
        embedded = embedded.replace(match[0], 'url("data:font/woff2;base64,")');
      }
    }
    if (!usable) continue;
    const descriptors = Array.from(face.style)
      .filter((name) => name !== "src")
      .map((name) => `${name}:${face.style.getPropertyValue(name)};`)
      .join("");
    rules.push(`@font-face{${descriptors}src:${embedded};}`);
    embeddedFamilies.add(family);
  }
  for (const font of document.fonts) {
    const family = normalizeFamily(font.family);
    if (
      font.status === "loaded" &&
      context.fontFamilies.has(family) &&
      !embeddedFamilies.has(family)
    ) {
      warnings.add(
        "A loaded font could not be embedded; missing glyphs in this capture may not reflect the live page.",
      );
    }
  }
  return rules.join("\n") || " ";
}
