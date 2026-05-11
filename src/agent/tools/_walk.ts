export interface StringLeaf { path: string; text: string; }

export function* walkStringLeaves(obj: unknown, prefix: string = ""): Generator<StringLeaf, void, void> {
  if (typeof obj === "string") {
    if (obj.length > 0) yield { path: prefix || "(root)", text: obj };
    return;
  }
  if (obj === null || obj === undefined || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      yield* walkStringLeaves(obj[i], `${prefix}[${i}]`);
    }
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    const isIdent = safeKey === k;
    const seg = isIdent ? (prefix === "" ? k : `.${k}`) : `[${safeKey}]`;
    yield* walkStringLeaves(v, prefix + seg);
  }
}
