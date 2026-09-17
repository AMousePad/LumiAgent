# Comment guidelines

These rules apply to every comment (`//`, `/* */`, `/** */`) added or edited in
this repo. Apply on every commit, including refactors and one-line fixes.

## Comments must NOT contain:

1. **References to files on the user's local machine.** No absolute paths
   (e.g. `g:/mousepad_git/...`, `C:/...`). No relative paths to anything
   under `local/` (gitignored).
2. **References to file paths, character names, or code positions.** Source
   files get renamed and moved (`process/modules.ts`, `src/parser/foo.ts`).
   Line numbers (`foo.ts:1234`, `bar.svelte.ts:299-513`) drift on every edit.
   Card and character names change. Reference the *concept* or *function name*
   alone, never a file path or position. "Risu's `readModule`" is fine,
   "Risu's `readModule` in `process/modules.ts`" is not.
3. **Explanations of what the code below does** when the code is
   self-documenting. Identifiers already say *what*. Comments only earn their
   space when they say *why*: hidden constraint, subtle invariant, workaround
   for a specific bug, surprising behavior.
4. **Em dashes (`—`), semicolons in comment text, or AI fingerprint phrasing.**
   Use `,` or `.` or `:` instead of `—`. Avoid "comprehensive", "robust",
   "leverages", "Note that...", "It's worth noting...", rule-of-three
   parallelism, hedging boilerplate, marketing-style adjectives.
5. **References to documentation.** Internal docs live under `local/` and are
   gitignored. Don't write "see local/docs/foo.md" or "see proposal-X.md".
6. **References to tests.** No tests are committed to this repo (tests live
   in `local/tests/` only). Don't write "see foo.test.ts" or "covered by
   `tests/...`".
7. **Large comment blocks.** Any block longer than 2 sentences must be
   removed or condensed to 1-2 sentences. No exceptions.

## Comments SHOULD:

8. **Be facts, not prose.** No preamble ("This function does..."), no
   postamble ("That's why we...", "In conclusion..."). High information
   density per line.
9. **Use minimal production-level structures.** Default to no comment. Add
   one only when the *why* is non-obvious. Don't add JSDoc to every export
   for the sake of completeness, only where it genuinely aids the reader.
10. **Preserve important information.** When condensing a large block, keep
    the load-bearing facts: the *why*, the invariant, the gotcha, the
    constraint. Drop the explanation of the mechanism (the code shows that),
    drop the rationale narrative, drop the citation. If a block contains
    real engineering knowledge that future-you needs to avoid breaking the
    code, that knowledge MUST survive the condense.

## Log messages and error strings

Log/error message *text* (inside `log.info`, `flog.warn`, `console.error`,
`new Error('...')`, etc.) follows the same rules: no em dashes, no AI
phrasing. The structural log call itself is code, untouched.
