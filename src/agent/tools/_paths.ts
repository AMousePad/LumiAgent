export type PathSegment = { kind: "key"; value: string } | { kind: "index"; value: number };

export function parseExtensionPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === ".") { i++; continue; }
    if (ch === "[") {
      const end = path.indexOf("]", i);
      if (end < 0) throw new Error(`unclosed bracket in path at index ${i}`);
      const inner = path.slice(i + 1, end);
      if (/^\d+$/.test(inner)) {
        segments.push({ kind: "index", value: parseInt(inner, 10) });
      } else if ((inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) || (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)) {
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
