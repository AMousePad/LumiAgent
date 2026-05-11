// Markdown -> DocumentFragment with DOMParser + tag-allowlist sanitisation.

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "del", "code", "pre",
  "blockquote", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img", "span", "div",
]);

const DROP_TAGS = new Set([
  "style", "script", "noscript", "template",
  "iframe", "object", "embed",
  "head", "title", "meta", "link", "base",
]);

const ALLOWED_ATTRS_PER_TAG: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
};

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Code spans get extracted into placeholders before inline rules run.
const PLACEHOLDER_PREFIX = " LA_PH_";
const PLACEHOLDER_SUFFIX = " ";

function inlineMarkdown(input: string, codeSpans: Map<string, string>): string {
  let out = input;

  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    const key = `${PLACEHOLDER_PREFIX}${codeSpans.size}${PLACEHOLDER_SUFFIX}`;
    codeSpans.set(key, `<code>${escapeHtml(code)}</code>`);
    return key;
  });

  out = escapeHtml(out);

  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => `<a href="${escapeHtml(href)}">${text}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  for (const [key, html] of codeSpans) out = out.split(key).join(html);
  codeSpans.clear();
  return out;
}

function blockMarkdownToHtml(input: string): string {
  if (!input) return "";
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const codeSpans = new Map<string, string>();
  let i = 0;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    const joined = para.join("\n");
    if (joined.trim()) {
      out.push(`<p>${inlineMarkdown(joined, codeSpans)}</p>`);
    }
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Fenced code block: ``` or ~~~ optionally followed by language id.
    const fenceMatch = /^(```+|~~~+)([A-Za-z0-9_+-]*)\s*$/.exec(trimmed);
    if (fenceMatch && fenceMatch[1]) {
      flushPara();
      const fence = fenceMatch[1];
      const fenceChar = fence[0]!;
      const lang = fenceMatch[2] ?? "";
      i++;
      const buf: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const closer = new RegExp(`^${fenceChar}{${fence.length},}\\s*$`).exec(cur.trim());
        if (closer) { i++; break; }
        buf.push(cur);
        i++;
      }
      const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${classAttr}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    if (trimmed.length === 0) { flushPara(); i++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading && heading[1] && heading[2] !== undefined) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2], codeSpans)}</h${level}>`);
      i++; continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara(); out.push("<hr>"); i++; continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? "").trim())) {
        buf.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inlineMarkdown(buf.join("\n"), codeSpans)}</blockquote>`);
      continue;
    }
    const ulMatch = /^(?:[-*+])\s+(.*)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      flushPara();
      const isOrdered = !!olMatch;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trim();
        const m = isOrdered ? /^\d+\.\s+(.*)$/.exec(cur) : /^(?:[-*+])\s+(.*)$/.exec(cur);
        if (!m) break;
        items.push(`<li>${inlineMarkdown(m[1] ?? "", codeSpans)}</li>`);
        i++;
      }
      out.push(`<${isOrdered ? "ol" : "ul"}>${items.join("")}</${isOrdered ? "ol" : "ul"}>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

function isAllowedUrl(url: string): boolean {
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
    const parsed = new URL(trimmed, "https://example.invalid/");
    return ALLOWED_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeNode(input: Node, target: Node, doc: Document): void {
  const node = input as ChildNode;
  if (node.nodeType === Node.TEXT_NODE) {
    target.appendChild(doc.createTextNode((node as Text).data));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tagName = el.tagName.toLowerCase();
  if (DROP_TAGS.has(tagName)) return;
  if (!ALLOWED_TAGS.has(tagName)) {
    for (const child of Array.from(el.childNodes)) sanitizeNode(child, target, doc);
    return;
  }
  const cleanEl = doc.createElement(tagName);
  const allowedAttrs = ALLOWED_ATTRS_PER_TAG[tagName];
  if (allowedAttrs) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name)) continue;
      if ((name === "href" || name === "src") && !isAllowedUrl(attr.value)) continue;
      cleanEl.setAttribute(name, attr.value);
    }
  }
  if (tagName === "a") {
    cleanEl.setAttribute("rel", "noopener noreferrer nofollow");
    cleanEl.setAttribute("target", "_blank");
  }
  if (tagName === "img") {
    cleanEl.setAttribute("loading", "lazy");
    cleanEl.setAttribute("referrerpolicy", "no-referrer");
  }
  for (const child of Array.from(el.childNodes)) sanitizeNode(child, cleanEl, doc);
  target.appendChild(cleanEl);
}

export function renderMarkdown(raw: string): DocumentFragment {
  const doc = document;
  const frag = doc.createDocumentFragment();
  if (!raw) return frag;
  const html = blockMarkdownToHtml(raw);
  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const sourceRoot = parsed.getElementById("root");
  if (!sourceRoot) {
    frag.appendChild(doc.createTextNode(raw));
    return frag;
  }
  const wrapper = doc.createElement("div");
  for (const child of Array.from(sourceRoot.childNodes)) sanitizeNode(child, wrapper, doc);
  for (const child of Array.from(wrapper.childNodes)) frag.appendChild(child);
  return frag;
}
