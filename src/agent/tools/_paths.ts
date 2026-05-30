export type PathSegment = { kind: "key"; value: string } | { kind: "index"; value: number };

// Real extension objects nest a handful deep and arrays hold a few entries. A
// hostile path (e.g. via `set`) with a huge index would make setAtPath allocate
// a giant sparse array (multi-hundred-MB JSON.stringify or RangeError), and a
// thousands-deep path would blow setAtPath's recursion stack. Cap both.
const MAX_EXTENSION_INDEX = 100_000;
const MAX_EXTENSION_DEPTH = 256;

export function parseExtensionPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    if (segments.length > MAX_EXTENSION_DEPTH) throw new Error(`extension path too deeply nested (max ${MAX_EXTENSION_DEPTH} segments)`);
    const ch = path[i]!;
    if (ch === ".") { i++; continue; }
    if (ch === "[") {
      const end = path.indexOf("]", i);
      if (end < 0) throw new Error(`unclosed bracket in path at index ${i}`);
      const inner = path.slice(i + 1, end);
      if (/^\d+$/.test(inner)) {
        const idx = parseInt(inner, 10);
        if (idx > MAX_EXTENSION_INDEX) throw new Error(`extension array index ${idx} exceeds max ${MAX_EXTENSION_INDEX}`);
        segments.push({ kind: "index", value: idx });
      } else if (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) {
        // The encoder (walkStringLeaves / list) brackets non-identifier keys as
        // JSON.stringify(key), so JSON.parse to undo escaping (\" \\ etc.).
        // Without this, a key containing " round-trips with a stray backslash
        // and the bulk writers corrupt the extension object.
        let key: string;
        try { key = JSON.parse(inner) as string; } catch { key = inner.slice(1, -1); }
        segments.push({ kind: "key", value: key });
      } else if (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) {
        segments.push({ kind: "key", value: inner.slice(1, -1) });
      } else {
        throw new Error(`bracket contents must be a number or quoted string: [${inner}]`);
      }
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    const key = path.slice(i, j);
    if (key.length === 0) throw new Error(`empty key at index ${i}`);
    segments.push({ kind: "key", value: key });
    i = j;
  }
  return segments;
}

export function getAtPath(obj: unknown, segments: readonly PathSegment[]): unknown {
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (seg.kind === "key") {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg.value];
    } else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.value];
    }
  }
  return cur;
}

export function setAtPath(root: unknown, segments: readonly PathSegment[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  if (head!.kind === "index") {
    const arr = Array.isArray(root) ? [...root] : [];
    arr[head!.value] = setAtPath(arr[head!.value], rest, value);
    return arr;
  }
  const obj = (root && typeof root === "object" && !Array.isArray(root)) ? { ...(root as Record<string, unknown>) } : {};
  obj[head!.value] = setAtPath(obj[head!.value], rest, value);
  return obj;
}
