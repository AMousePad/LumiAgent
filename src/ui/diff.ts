import { diffLines, diffWordsWithSpace } from "diff";

const MAX_LINE_CHARS = 4000;
const DEFAULT_CONTEXT_LINES = 3;
const EXPAND_CHUNK_LINES = 20;

function trunc(s: string): string {
  if (s.length <= MAX_LINE_CHARS) return s;
  return `${s.slice(0, MAX_LINE_CHARS)} … (truncated, ${s.length} chars total)`;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export function computeDiffStats(before: string, after: string): DiffStats {
  if (before === after) return { added: 0, removed: 0, unchanged: before.split("\n").length };
  const parts = diffLines(before, after);
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const p of parts) {
    const lineCount = p.value.endsWith("\n") ? p.count ?? p.value.split("\n").length - 1 : p.count ?? p.value.split("\n").length;
    if (p.added) added += lineCount;
    else if (p.removed) removed += lineCount;
    else unchanged += lineCount;
  }
  return { added, removed, unchanged };
}

export function renderInlineFieldDiff(before: string, after: string): HTMLElement {
  const wrap = el("div", "la-diff-inline");
  const parts = diffWordsWithSpace(before, after);
  for (const p of parts) {
    if (p.added) {
      const s = el("span", "la-diff-add");
      s.textContent = trunc(p.value);
      wrap.appendChild(s);
    } else if (p.removed) {
      const s = el("span", "la-diff-del");
      s.textContent = trunc(p.value);
      wrap.appendChild(s);
    } else {
      const s = el("span", "la-diff-ctx");
      s.textContent = trunc(p.value);
      wrap.appendChild(s);
    }
  }
  return wrap;
}

type DiffKind = "add" | "del" | "ctx";

interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
  readonly oldLineNum: number | null;
  readonly newLineNum: number | null;
}

function buildDiffLines(before: string, after: string): readonly DiffLine[] {
  const parts = diffLines(before, after);
  const out: DiffLine[] = [];
  let oldN = 1;
  let newN = 1;
  for (const p of parts) {
    const lines = p.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      if (p.added) {
        out.push({ kind: "add", text: line, oldLineNum: null, newLineNum: newN++ });
      } else if (p.removed) {
        out.push({ kind: "del", text: line, oldLineNum: oldN++, newLineNum: null });
      } else {
        out.push({ kind: "ctx", text: line, oldLineNum: oldN++, newLineNum: newN++ });
      }
    }
  }
  return out;
}

// Mark every line within `context` of a change. Adjacent visible regions merge
// so we render hunks the way GitHub does, with collapsible gaps between them.
function findVisibleRanges(lines: readonly DiffLine[], context: number): ReadonlyArray<readonly [number, number]> {
  if (lines.length === 0) return [];
  const visible = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.kind === "ctx") continue;
    const lo = Math.max(0, i - context);
    const hi = Math.min(lines.length - 1, i + context);
    for (let j = lo; j <= hi; j++) visible[j] = true;
  }
  const ranges: Array<readonly [number, number]> = [];
  let i = 0;
  while (i < lines.length) {
    if (!visible[i]) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && visible[j + 1]) j++;
    ranges.push([i, j] as const);
    i = j + 1;
  }
  return ranges;
}

function renderDiffLine(line: DiffLine, showNumbers: boolean): HTMLElement {
  const cls = line.kind === "add"
    ? "la-diff-add-row"
    : line.kind === "del"
      ? "la-diff-del-row"
      : "la-diff-ctx";
  const sigil = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const row = el("div", `la-diff-row ${cls}`);
  if (showNumbers) {
    const oldCol = el("span", "la-diff-lineno la-diff-lineno-old", line.oldLineNum === null ? "" : String(line.oldLineNum));
    const newCol = el("span", "la-diff-lineno la-diff-lineno-new", line.newLineNum === null ? "" : String(line.newLineNum));
    row.append(oldCol, newCol);
  }
  const sigilEl = el("span", "la-diff-sigil", sigil);
  const textEl = el("span", "la-diff-text", trunc(line.text));
  row.append(sigilEl, textEl);
  return row;
}

// Expandable gap. Click reveals the hidden lines; for large gaps the button
// only expands one chunk at a time (top-down) so the user can drill in without
// dumping a 5000-line tail into the DOM.
function renderGap(
  lines: readonly DiffLine[],
  from: number,
  to: number,
  showNumbers: boolean,
): HTMLElement {
  const remaining = to - from + 1;
  const btn = el("button", "la-diff-gap-expander") as HTMLButtonElement;
  btn.type = "button";
  const setLabel = (n: number, leftover: number): void => {
    const more = leftover > 0 ? ` (${leftover} more hidden)` : "";
    btn.textContent = `…  expand ${n} unchanged line${n === 1 ? "" : "s"}${more}  …`;
  };
  setLabel(Math.min(EXPAND_CHUNK_LINES, remaining), Math.max(0, remaining - EXPAND_CHUNK_LINES));
  // Track cursor in mutable closure so successive clicks chip away from the
  // top of the gap. The remaining tail is re-rendered as a fresh expander
  // until exhausted.
  let cursor = from;
  btn.addEventListener("click", () => {
    const chunkEnd = Math.min(cursor + EXPAND_CHUNK_LINES - 1, to);
    const frag = document.createDocumentFragment();
    for (let i = cursor; i <= chunkEnd; i++) {
      frag.appendChild(renderDiffLine(lines[i]!, showNumbers));
    }
    cursor = chunkEnd + 1;
    if (cursor > to) {
      btn.replaceWith(frag);
    } else {
      const leftover = to - cursor + 1;
      const nextChunk = Math.min(EXPAND_CHUNK_LINES, leftover);
      setLabel(nextChunk, leftover - nextChunk);
      btn.before(frag);
    }
  });
  return btn;
}

export function renderUnifiedDiff(before: string, after: string, contextLines = DEFAULT_CONTEXT_LINES): HTMLElement {
  const wrap = el("div", "la-diff-unified");
  if (before === after) {
    wrap.appendChild(el("div", "la-diff-empty", "(no changes)"));
    return wrap;
  }
  const lines = buildDiffLines(before, after);
  const ranges = findVisibleRanges(lines, contextLines);
  const showNumbers = lines.length >= 8;

  if (ranges.length === 0) {
    // The diff yielded only context lines (rare: identical content reached
    // here via floating-point drift in computeDiffStats). Fall back to
    // rendering everything.
    for (const line of lines) wrap.appendChild(renderDiffLine(line, showNumbers));
    return wrap;
  }
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (cursor < start) wrap.appendChild(renderGap(lines, cursor, start - 1, showNumbers));
    for (let i = start; i <= end; i++) wrap.appendChild(renderDiffLine(lines[i]!, showNumbers));
    cursor = end + 1;
  }
  if (cursor < lines.length) wrap.appendChild(renderGap(lines, cursor, lines.length - 1, showNumbers));
  return wrap;
}

interface SxsPair {
  readonly left: string | null;
  readonly right: string | null;
  readonly kind: "add" | "del" | "ctx" | "change";
  readonly oldLineNum: number | null;
  readonly newLineNum: number | null;
}

function buildSxsPairs(before: string, after: string): readonly SxsPair[] {
  const parts = diffLines(before, after);
  const pairs: SxsPair[] = [];
  let oldN = 1;
  let newN = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const next = parts[i + 1];
    if (p.removed && next && next.added) {
      const oldLines = p.value.split("\n");
      const newLines = next.value.split("\n");
      if (oldLines[oldLines.length - 1] === "") oldLines.pop();
      if (newLines[newLines.length - 1] === "") newLines.pop();
      const m = Math.max(oldLines.length, newLines.length);
      for (let k = 0; k < m; k++) {
        const hasOld = k < oldLines.length;
        const hasNew = k < newLines.length;
        pairs.push({
          left: hasOld ? (oldLines[k] ?? "") : null,
          right: hasNew ? (newLines[k] ?? "") : null,
          kind: "change",
          oldLineNum: hasOld ? oldN++ : null,
          newLineNum: hasNew ? newN++ : null,
        });
      }
      i++;
      continue;
    }
    const lines = p.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (p.added) {
      for (const l of lines) pairs.push({ left: null, right: l, kind: "add", oldLineNum: null, newLineNum: newN++ });
    } else if (p.removed) {
      for (const l of lines) pairs.push({ left: l, right: null, kind: "del", oldLineNum: oldN++, newLineNum: null });
    } else {
      for (const l of lines) pairs.push({ left: l, right: l, kind: "ctx", oldLineNum: oldN++, newLineNum: newN++ });
    }
  }
  return pairs;
}

function findSxsVisibleRanges(pairs: readonly SxsPair[], context: number): ReadonlyArray<readonly [number, number]> {
  if (pairs.length === 0) return [];
  const visible = new Array<boolean>(pairs.length).fill(false);
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i]!.kind === "ctx") continue;
    const lo = Math.max(0, i - context);
    const hi = Math.min(pairs.length - 1, i + context);
    for (let j = lo; j <= hi; j++) visible[j] = true;
  }
  const ranges: Array<readonly [number, number]> = [];
  let i = 0;
  while (i < pairs.length) {
    if (!visible[i]) { i++; continue; }
    let j = i;
    while (j + 1 < pairs.length && visible[j + 1]) j++;
    ranges.push([i, j] as const);
    i = j + 1;
  }
  return ranges;
}

function renderSxsRow(pair: SxsPair): HTMLElement {
  const r = el("div", `la-diff-sxs-row la-diff-sxs-${pair.kind}`);
  const l = el("div", "la-diff-sxs-cell la-diff-sxs-old");
  const rt = el("div", "la-diff-sxs-cell la-diff-sxs-new");
  l.textContent = pair.left === null ? "" : trunc(pair.left);
  rt.textContent = pair.right === null ? "" : trunc(pair.right);
  if (pair.left === null) l.classList.add("la-diff-sxs-empty");
  if (pair.right === null) rt.classList.add("la-diff-sxs-empty");
  r.appendChild(l);
  r.appendChild(rt);
  return r;
}

function renderSxsGap(pairs: readonly SxsPair[], from: number, to: number): HTMLElement {
  const remaining = to - from + 1;
  const btn = el("button", "la-diff-sxs-gap-expander") as HTMLButtonElement;
  btn.type = "button";
  const setLabel = (n: number, leftover: number): void => {
    const more = leftover > 0 ? ` (${leftover} more hidden)` : "";
    btn.textContent = `…  expand ${n} unchanged line${n === 1 ? "" : "s"}${more}  …`;
  };
  setLabel(Math.min(EXPAND_CHUNK_LINES, remaining), Math.max(0, remaining - EXPAND_CHUNK_LINES));
  let cursor = from;
  btn.addEventListener("click", () => {
    const chunkEnd = Math.min(cursor + EXPAND_CHUNK_LINES - 1, to);
    const frag = document.createDocumentFragment();
    for (let i = cursor; i <= chunkEnd; i++) frag.appendChild(renderSxsRow(pairs[i]!));
    cursor = chunkEnd + 1;
    if (cursor > to) {
      btn.replaceWith(frag);
    } else {
      const leftover = to - cursor + 1;
      const nextChunk = Math.min(EXPAND_CHUNK_LINES, leftover);
      setLabel(nextChunk, leftover - nextChunk);
      btn.before(frag);
    }
  });
  return btn;
}

export function renderSideBySideDiff(before: string, after: string, contextLines = DEFAULT_CONTEXT_LINES): HTMLElement {
  const root = el("div", "la-diff-sxs");
  const head = el("div", "la-diff-sxs-head");
  head.appendChild(el("div", "la-diff-sxs-headcell la-diff-sxs-headcell-old", "Before"));
  head.appendChild(el("div", "la-diff-sxs-headcell la-diff-sxs-headcell-new", "After"));
  root.appendChild(head);

  const body = el("div", "la-diff-sxs-body");
  if (before === after) {
    body.appendChild(el("div", "la-diff-empty", "(no changes)"));
    root.appendChild(body);
    return root;
  }
  const pairs = buildSxsPairs(before, after);
  const ranges = findSxsVisibleRanges(pairs, contextLines);
  if (ranges.length === 0) {
    for (const pair of pairs) body.appendChild(renderSxsRow(pair));
    root.appendChild(body);
    return root;
  }
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (cursor < start) body.appendChild(renderSxsGap(pairs, cursor, start - 1));
    for (let i = start; i <= end; i++) body.appendChild(renderSxsRow(pairs[i]!));
    cursor = end + 1;
  }
  if (cursor < pairs.length) body.appendChild(renderSxsGap(pairs, cursor, pairs.length - 1));
  root.appendChild(body);
  return root;
}

export function isShortField(before: string, after: string): boolean {
  const longest = Math.max(before.length, after.length);
  const newlines = (before + "\n" + after).split("\n").length - 1;
  return longest < 120 && newlines <= 2;
}
