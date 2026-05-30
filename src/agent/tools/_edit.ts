// Byte-exact find with one specific recovery: curly-quote normalization.
// The agent is expected to copy bytes verbatim from a recent `read`. The
// one exception is curly quotes, because LLMs cannot reliably emit
// U+2018/2019/201C/201D and would otherwise need a re-read every time a
// file uses smart quotes.
//
// The older NFC / NFD / strip-invisible / whitespace-flex cascade was
// dropped on purpose. Those fallbacks fired silently and a few (notably
// whitespace-flex) could match wildly different content than the agent
// intended. Loud failures teach the agent "this source has NBSPs / mixed
// line endings / NFD Hangul" better than silent recoveries do.
//
// For NFD-encoded leaves, run `inspect` first to see the encoding diagnostics.

export interface EditOutcome {
  result: string;
  count: number;
  firstSnippet: string;
  recoveredVia?: string;
}

export function applyEdit(text: string, find: string, replace: string, replaceAll: boolean): EditOutcome {
  if (find === "") throw new Error("'find' must be non-empty");

  const located = locateMatch(text, find);
  if (!located) throw diagnoseFindFailure(text, find);

  const { actual, label } = located;
  let count = 0;
  let scan = 0;
  while ((scan = text.indexOf(actual, scan)) >= 0) { count++; scan += actual.length; }
  if (!replaceAll && count > 1) {
    throw new Error(`[FIND_NOT_UNIQUE] 'find' appears ${count} times; either expand it for uniqueness or pass replace_all=true.`);
  }

  const idx = text.indexOf(actual);
  const adaptedReplace = label === "byte-exact" ? replace : preserveTypography(find, actual, replace);
  const result = replaceAll
    ? text.split(actual).join(adaptedReplace)
    : `${text.slice(0, idx)}${adaptedReplace}${text.slice(idx + actual.length)}`;

  const out: EditOutcome = {
    result,
    count: replaceAll ? count : 1,
    firstSnippet: editSnippetContext(text, actual, adaptedReplace, idx),
  };
  if (label !== "byte-exact") out.recoveredVia = label;
  return out;
}

function editSnippetContext(before: string, find: string, replace: string, idx: number): string {
  const ctxBefore = before.slice(Math.max(0, idx - 60), idx);
  const ctxAfter = before.slice(idx + find.length, idx + find.length + 60);
  return `${ctxBefore}>>>>${replace}<<<<${ctxAfter}`;
}

// byte-exact, then one length-preserving quote-normalization pass. Anything
// else (NFC/NFD, invisibles, whitespace runs) is the agent's responsibility
// to handle by re-reading and copying bytes verbatim. `inspect` surfaces the
// encoding state so the agent can detect weird source before editing.
function locateMatch(text: string, find: string): { actual: string; label: string } | null {
  if (text.includes(find)) return { actual: find, label: "byte-exact" };

  // Quote normalize: replace curly / corner / fullwidth quotes with ASCII on
  // BOTH sides, find by index in the normalized doc, then slice the ORIGINAL
  // doc at the same index since asciifyQuotes is length-preserving.
  const nf = asciifyQuotes(find);
  if (nf.length === find.length && nf !== find) {
    const nt = asciifyQuotes(text);
    if (nt.length === text.length) {
      const i = nt.indexOf(nf);
      if (i >= 0) return { actual: text.substring(i, i + find.length), label: "quote-normalized" };
    }
  }

  return null;
}

// When the match only succeeded via quote-asciify, re-apply the document's
// curly / corner-bracket style to the replacement so document typography
// survives the edit. Adapted from claude-code FileEditTool preserveQuoteStyle.
function preserveTypography(find: string, actual: string, replace: string): string {
  if (find === actual) return replace;
  let out = replace;
  if (actual.includes("“") || actual.includes("”")) {
    out = applyPaired(out, '"', "“", "”");
  }
  if (actual.includes("‘") || actual.includes("’")) {
    out = applyPaired(out, "'", "‘", "’");
  }
  // Pivot characters must mirror QUOTE_LIKE_MAP: 「」 → ', 『』 → ". Sharing the
  // double-quote pivot for both bracket pairs would let the 『』 branch overwrite
  // the 「」 branch's restorations whenever a document mixed them, and a 「」-only
  // document where the agent's replace contains ASCII ' (the asciified form)
  // would never have those single quotes re-promoted to corner brackets at all.
  if (actual.includes("「") || actual.includes("」")) {
    out = applyPaired(out, "'", "「", "」");
  }
  if (actual.includes("『") || actual.includes("』")) {
    out = applyPaired(out, '"', "『", "』");
  }
  return out;
}

function applyPaired(s: string, ascii: string, open: string, close: string): string {
  const chars = [...s];
  const isOpening = (i: number): boolean => {
    if (i === 0) return true;
    const p = chars[i - 1];
    return p === " " || p === "\t" || p === "\n" || p === "\r" || p === "(" || p === "[" || p === "{" || p === "—" || p === "–";
  };
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ascii) {
      const prev = i > 0 ? chars[i - 1] : undefined;
      const next = i < chars.length - 1 ? chars[i + 1] : undefined;
      const prevLetter = prev !== undefined && /\p{L}/u.test(prev);
      const nextLetter = next !== undefined && /\p{L}/u.test(next);
      if (ascii === "'" && prevLetter && nextLetter) {
        // A letter-flanked apostrophe (don't, rock'n'roll) is never a paired
        // delimiter. Promoting it would inject a closing quote or, for a corner-
        // bracket doc, a 」 into the middle of a word. Keep it ASCII.
        out.push(chars[i]!);
      } else {
        out.push(isOpening(i) ? open : close);
      }
    } else {
      out.push(chars[i]!);
    }
  }
  return out.join("");
}

const QUOTE_LIKE_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "«": '"', "»": '"', "‹": "'", "›": "'",
  "ʼ": "'", "ʹ": "'", "ʺ": '"', "ˮ": '"',
  "＇": "'", "＂": '"',
  "「": "'", "」": "'", "『": '"', "』": '"',
  "〈": "<", "〉": ">", "《": "<", "》": ">",
};
function asciifyQuotes(s: string): string {
  let out = "";
  for (const ch of s) out += QUOTE_LIKE_MAP[ch] ?? ch;
  return out;
}

function diagnoseFindFailure(text: string, find: string): Error {
  const previewBytes = (s: string) => {
    const head = s.slice(0, 60);
    const codes = Array.from(head).slice(0, 20).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
    return `${JSON.stringify(head)}${head.length < s.length ? "…" : ""} [${codes}]`;
  };
  // Hint at likely NFD vs NFC mismatch, the most common silent cause of
  // byte-mismatch on Korean cards.
  const nfcFind = find.normalize("NFC");
  const nfdFind = find.normalize("NFD");
  const nfcHit = nfcFind !== find && text.includes(nfcFind);
  const nfdHit = nfdFind !== find && text.includes(nfdFind);
  let normHint = "";
  if (nfcHit) normHint = "\n\nDIAGNOSIS: your `find` would match if NFC-normalized. The doc is NFC and your find is NFD. Run `inspect` on this path to see the encoding state. Copy bytes verbatim from a fresh `read` to fix.";
  else if (nfdHit) normHint = "\n\nDIAGNOSIS: your `find` would match if NFD-normalized. The doc is NFD (rare, suggests macOS-filesystem-authored content). Copy bytes verbatim from a fresh `read` to fix.";

  const findPreview = previewBytes(find);
  return new Error(
    `[FIND_NOT_FOUND] 'find' string not found in document. Tried byte-exact and quote-normalized, neither hit. Likely causes: (1) the field changed since your last read, re-read and copy bytes verbatim; (2) you retyped instead of copying from the read output; (3) the source has encoding drift (NFD, NBSPs, BOMs), run \`inspect\` on this path to see the diagnostics.${normHint} find=${findPreview}.`,
  );
}
