export interface StringLeaf { path: string; text: string; }

export type PathSkipFn = (path: string) => boolean;

// `skip(path)` short-circuits a subtree: if it returns true for a child
// path, that subtree is not descended and no leaves under it are yielded.
// Used by find tools to honour phone-line manifests' excludeFromSearch lists
// (derived projections, frozen snapshots, anything the agent can't edit).
export function* walkStringLeaves(
  obj: unknown,
  prefix: string = "",
  skip?: PathSkipFn,
): Generator<StringLeaf, void, void> {
  if (typeof obj === "string") {
    if (obj.length > 0) yield { path: prefix || "(root)", text: obj };
    return;
  }
  if (obj === null || obj === undefined || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childPath = `${prefix}[${i}]`;
      if (skip && skip(childPath)) continue;
      yield* walkStringLeaves(obj[i], childPath, skip);
    }
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    const isIdent = safeKey === k;
    const seg = isIdent ? (prefix === "" ? k : `.${k}`) : `[${safeKey}]`;
    const childPath = prefix + seg;
    if (skip && skip(childPath)) continue;
    yield* walkStringLeaves(v, childPath, skip);
  }
}
