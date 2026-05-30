// Markdown -> DocumentFragment with DOMParser + tag-allowlist sanitisation.

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "del", "code", "pre",
  "blockquote", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img", "span", "div",
  "table", "thead", "tbody", "tr", "th", "td",
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
  th: new Set(["align"]),
  td: new Set(["align"]),
  // Limited `class` allowlist for elements we emit ourselves (task list mark).
  span: new Set(["class"]),
};

// When `class` is permitted on a tag, only allow the prefixes we render.
const ALLOWED_CLASS_PREFIXES = new Set(["la-task-mark", "language-"]);

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
    const key = `${PLACEHOLDER_PREFIX}c${codeSpans.size}${PLACEHOLDER_SUFFIX}`;
    codeSpans.set(key, `<code>${escapeHtml(code)}</code>`);
    return key;
  });

  // Bare-URL autolinks. Run BEFORE escapeHtml so the inserted `<a>` survives
  // (the placeholder slot is content-opaque to escapeHtml). The lead-char
  // exclusion blocks URLs that are already the `(...)` of a markdown link —
  // `[text](https://x)` keeps the `(` as preceding char of the URL.
  out = out.replace(/(^|[^\](\w])(https?:\/\/[^\s<>() ]+[^\s<>().,:;!?\]\) ])/g, (_m, lead: string, url: string) => {
    const key = `${PLACEHOLDER_PREFIX}u${codeSpans.size}${PLACEHOLDER_SUFFIX}`;
    codeSpans.set(key, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    return `${lead}${key}`;
  });

  out = escapeHtml(out);

  // src / alt / href are captured from the already-escaped string (escapeHtml ran
  // above), so they must NOT be escaped again: a URL like `?a=1&b=2` is already
  // `&amp;` here, and re-escaping bakes a literal `&amp;` into the href. The
  // single prior escape still neutralizes quote-breakout, and the sanitizer
  // (isAllowedUrl + attribute allowlist) gates the scheme.
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => `<img src="${src}" alt="${alt}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => `<a href="${href}">${text}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // Hard break: two-or-more trailing spaces before \n become <br>. Run before
  // joining splits the string up; the marker survives escapeHtml because we
  // already escaped before this point.
  out = out.replace(/ {2,}\n/g, "<br>\n");

  for (const [key, html] of codeSpans) out = out.split(key).join(html);
  codeSpans.clear();
  return out;
}

// GFM pipe table parsing.
// A pipe row is any line containing `|` outside code spans. Leading/trailing
// pipes are stripped. The separator row's cells determine column count and
// per-column alignment (`---`, `:---`, `---:`, `:---:`).
function parsePipeRow(line: string): string[] | null {
  let trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  // Honor escaped pipes inside cells (`\|` is a literal pipe). Split on
  // unescaped `|` and unescape afterwards.
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") { buf += "|"; i++; continue; }
    if (ch === "|") { cells.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

type Align = "" | "left" | "right" | "center";
function parseSeparatorRow(line: string): Align[] | null {
  const cells = parsePipeRow(line);
  if (!cells || cells.length === 0) return null;
  const aligns: Align[] = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell) && !/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) aligns.push("center");
    else if (right) aligns.push("right");
    else if (left) aligns.push("left");
    else aligns.push("");
  }
  return aligns;
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

    // GFM pipe table: header row + separator row + zero-or-more body rows.
    // Detected only when the next line is a valid separator with the same
    // column count as the header. Anything else with `|` falls through to the
    // paragraph path so prose like "x | y" is left alone.
    if (trimmed.includes("|") && i + 1 < lines.length) {
      const headerCells = parsePipeRow(line);
      const aligns = parseSeparatorRow(lines[i + 1] ?? "");
      if (headerCells && aligns && headerCells.length > 0 && headerCells.length === aligns.length) {
        flushPara();
        const cols = headerCells.length;
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length) {
          const t = (lines[i] ?? "").trim();
          if (t.length === 0) break;
          const row = parsePipeRow(lines[i] ?? "");
          if (!row) break;
          while (row.length < cols) row.push("");
          rows.push(row.slice(0, cols));
          i++;
        }
        const headHtml = headerCells
          .map((c, idx) => {
            const a = aligns[idx];
            const attr = a ? ` align="${a}"` : "";
            return `<th${attr}>${inlineMarkdown(c, codeSpans)}</th>`;
          }).join("");
        const bodyHtml = rows
          .map((row) => "<tr>" + row.map((c, idx) => {
            const a = aligns[idx];
            const attr = a ? ` align="${a}"` : "";
            return `<td${attr}>${inlineMarkdown(c, codeSpans)}</td>`;
          }).join("") + "</tr>").join("");
        out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
        continue;
      }
    }
    // List detection: walk lines tracking indent depth. A line with a bullet
    // (or `N.`) at the same indent as the current list is a sibling item;
    // deeper indent + bullet starts a nested sub-list inside the previous
    // item; shallower indent or non-list ends the block. Task-list prefixes
    // (`[ ]` / `[x]`) on item content render as ☐ / ☑ glyphs.
    const indentOf = (s: string): number => s.length - s.trimStart().length;
    const matchListItem = (s: string): { ordered: boolean; content: string } | null => {
      const m1 = /^(?:[-*+])\s+(.*)$/.exec(s);
      if (m1) return { ordered: false, content: m1[1] ?? "" };
      const m2 = /^\d+\.\s+(.*)$/.exec(s);
      if (m2) return { ordered: true, content: m2[1] ?? "" };
      return null;
    };
    const renderItemContent = (raw: string): string => {
      // Task-list marker at the very start of the item content.
      const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(raw);
      if (taskMatch) {
        const checked = taskMatch[1] !== " ";
        return `<span class="la-task-mark">${checked ? "☑" : "☐"}</span> ${inlineMarkdown(taskMatch[2] ?? "", codeSpans)}`;
      }
      return inlineMarkdown(raw, codeSpans);
    };
    const isListLine = (s: string): boolean => matchListItem(s.trimStart()) !== null;
    if (isListLine(trimmed)) {
      flushPara();
      // Recursive list parser. baseIndent fixes the column at which sibling
      // items live; lines indented deeper recurse, lines indented shallower
      // end the block.
      const parseList = (baseIndent: number): { html: string; nextIdx: number } => {
        let j = i;
        // First line determines list type (ordered vs unordered).
        const firstStripped = (lines[j] ?? "").trimStart();
        const firstMatch = matchListItem(firstStripped);
        if (!firstMatch) return { html: "", nextIdx: j };
        const ordered = firstMatch.ordered;
        const items: string[] = [];
        let currentContent: string | null = null;
        while (j < lines.length) {
          const ln = lines[j] ?? "";
          const lnTrim = ln.trim();
          if (lnTrim.length === 0) {
            // A blank line between items is allowed. If the very next line is
            // STILL a list line at >= baseIndent, continue; else end.
            const next = lines[j + 1] ?? "";
            const nextStripped = next.trimStart();
            const nextIndent = indentOf(next);
            if (nextStripped.length > 0 && matchListItem(nextStripped) && nextIndent >= baseIndent) {
              j++;
              continue;
            }
            break;
          }
          const ind = indentOf(ln);
          const stripped = ln.trimStart();
          const im = matchListItem(stripped);
          if (im && ind === baseIndent) {
            if (currentContent !== null) items.push(currentContent);
            currentContent = renderItemContent(im.content);
            j++;
          } else if (im && ind > baseIndent && currentContent !== null) {
            // Nested list. Recurse with the deeper indent as base.
            const saveI = i;
            i = j;
            const sub = parseList(ind);
            j = sub.nextIdx;
            i = saveI;
            currentContent += sub.html;
          } else if (ind > baseIndent && currentContent !== null && !im) {
            // Lazy continuation of the current item (an indented prose line
            // belonging to the same `<li>`).
            currentContent += " " + inlineMarkdown(lnTrim, codeSpans);
            j++;
          } else {
            break;
          }
        }
        if (currentContent !== null) items.push(currentContent);
        const tag = ordered ? "ol" : "ul";
        return { html: `<${tag}>${items.map((c) => `<li>${c}</li>`).join("")}</${tag}>`, nextIdx: j };
      };
      const startIndent = indentOf(line);
      const result = parseList(startIndent);
      out.push(result.html);
      i = result.nextIdx;
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
      if (name === "class") {
        const ok = attr.value.split(/\s+/).every((c) => ALLOWED_CLASS_PREFIXES.has(c) || [...ALLOWED_CLASS_PREFIXES].some((p) => p.endsWith("-") && c.startsWith(p)));
        if (!ok) continue;
      }
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
