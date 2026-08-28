import {
  TUTORIAL_STEPS,
  VERDICT_RIGHT,
  VERDICT_WRONG,
  tutorialFinale,
  tutorialQuizCount,
  type MouseyExpression,
  type TutQuizStep,
  type TutStep,
  type VnLine,
} from "./tutorial-content";
import { MOUSEY_EXPRESSIONS } from "../generated/expressions";
import { POOF_GIF_DATA_URL } from "../generated/poof";

// Visual-novel overlay tour over the real drawer. Dim everything, cut a
// spotlight hole around the step's anchor control, and play the script in a
// VN dialogue box: name tag, full-height sprite standing behind the box,
// quizzes as choice menus. Steps are paginated into BEATS, each holding at
// most one expression change, so every sprite swap takes a user click.
// No live progress persistence: the whole tour is a few minutes long.

export interface TutorialDeps {
  // Drawer root the overlay mounts into. Anchors are data-tut ids inside it.
  readonly root: HTMLElement;
  // Fired once per open(), the drawer persists the seen flag.
  readonly onOpened: () => void;
  // Fired once per run when the finale (score screen) is reached; the drawer
  // persists the done flag and drops the meet-Mousey banner.
  readonly onCompleted: () => void;
  // Fired when the user clicks Finish on the finale (after the tour closes);
  // the drawer shows the congrats modal.
  readonly onFinished: () => void;
  // Opens the capabilities modal (host modals stack above the overlay).
  readonly onShowCapabilities: () => void;
}

export interface TutorialHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

interface AnswerRecord {
  readonly pickedText: string;
  readonly correct: boolean;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Avalanche mixing: the plain LCG shuffle degenerated on the similar q_*
// ids and parked every correct answer in the same slot.
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Deterministic per-question order so Back never reshuffles.
export function shuffledOrder(id: string, count: number): number[] {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (Math.imul(seed, 31) + id.charCodeAt(i)) >>> 0;
  seed = mix(seed);
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    seed = mix(seed + i);
    const j = seed % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function shuffled(q: TutQuizStep): { text: string; correct: boolean }[] {
  return shuffledOrder(q.id, q.options.length).map((i) => {
    const o = q.options[i]!;
    return { text: o.text, correct: !!o.correct };
  });
}

// Beat boundaries: a new beat starts at the line whose expression differs
// from the running one when the current beat already swapped once. One click
// per swap keeps the sprite readable.
function splitBeats(lines: readonly VnLine[], entryExpr: MouseyExpression): number[] {
  const starts: number[] = [0];
  let running = entryExpr;
  let swapped = false;
  lines.forEach((ln, i) => {
    if (!ln.expr || ln.expr === running) return;
    if (swapped && i > (starts[starts.length - 1] ?? 0)) {
      starts.push(i);
    }
    running = ln.expr;
    swapped = true;
  });
  return starts;
}

function beatEnd(starts: readonly number[], beat: number, total: number): number {
  return beat + 1 < starts.length ? starts[beat + 1]! : total;
}

// Expression the script has settled on before lines[start], within one step.
function lastExprBefore(lines: readonly VnLine[], start: number): MouseyExpression | null {
  for (let i = start - 1; i >= 0; i--) {
    const e = lines[i]?.expr;
    if (e) return e;
  }
  return null;
}

export function createTutorial(deps: TutorialDeps): TutorialHandle {
  let overlay: HTMLElement | null = null;
  let spot: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let idx = 0;
  // Pagination inside a step: which beat of the current step is revealed.
  let beatIdx = 0;
  // idx === TUTORIAL_STEPS.length renders the finale card.
  const answers = new Map<string, AnswerRecord>();
  let resizeObs: ResizeObserver | null = null;
  // Sprite expression state. Expression carries across steps until a line
  // changes it; swap timers are cancelled on every re-render.
  let spriteEl: HTMLImageElement | null = null;
  let currentExpr: MouseyExpression = "neutral";
  let exprTimers: ReturnType<typeof setTimeout>[] = [];
  // Dialogue-box lift above a low anchor (px from the overlay bottom); 0 =
  // resting position. Feeds the sprite-bottom computation.
  let cardLift = 0;
  let cardObs: ResizeObserver | null = null;

  // Once a quiz's answer boxes render the card is tall enough to bury the
  // sprite, so she rises to stand on top of the box (clamped to stay on
  // screen). Question-typing beats and say steps keep the classic
  // legs-behind-the-box stance. The card is observed because the options and
  // the verdict grow it; the CSS bottom transition makes every move a glide.
  function syncSpriteBottom(): void {
    if (!spriteEl || !card || !overlay) return;
    // Baseline nudge: she floats 10% of her own height above wherever she
    // would otherwise stand.
    const nudge = Math.round(spriteEl.offsetHeight * 0.1);
    if (currentStep()?.kind === "quiz" && card.querySelector(".la-tut-options") !== null) {
      const inset = cardLift > 0 ? cardLift : 16;
      const raise = inset + card.offsetHeight + nudge;
      const cap = Math.max(0, overlay.clientHeight - spriteEl.offsetHeight);
      spriteEl.style.bottom = `${Math.min(raise, cap)}px`;
    } else {
      spriteEl.style.bottom = `${(cardLift > 0 ? Math.max(0, cardLift - 14) : 0) + nudge}px`;
    }
  }
  // Finale lines are score-dependent; computed once on first finale render.
  let finaleLines: readonly VnLine[] | null = null;
  let completedFired = false;

  function clearExprTimers(): void {
    for (const t of exprTimers) clearTimeout(t);
    exprTimers = [];
    typingFinish = null;
  }

  // One-shot stunt: wobble, timber sideways, and stay down. The class (and
  // the pose, via fill-mode) holds until the next step render clears it.
  // Mid-timber she fades to dizzy: an opacity dip rather than the usual
  // slide-swap, whose animation classes would override the fall keyframes.
  function playFall(): void {
    const sprite = spriteEl;
    if (!sprite) return;
    sprite.classList.remove("is-falling");
    void sprite.offsetWidth;
    sprite.classList.add("is-falling");
    exprTimers.push(setTimeout(() => {
      const spr = spriteEl;
      if (!spr || !spr.classList.contains("is-falling")) return;
      spr.style.transition = "opacity 0.16s ease";
      spr.style.opacity = "0";
      exprTimers.push(setTimeout(() => {
        setExpression("dizzy", false);
        spr.style.opacity = "1";
        exprTimers.push(setTimeout(() => {
          spr.style.opacity = "";
          spr.style.transition = "";
        }, 200));
      }, 170));
    }, 880));
  }

  // Intro reveal: a poof cloud covers the sprite while the source swaps
  // underneath. The gif loops forever, so it is removed just before its
  // 900ms cycle would restart.
  function playPoof(): void {
    if (!overlay || !spriteEl) return;
    const o = overlay.getBoundingClientRect();
    const sr = spriteEl.getBoundingClientRect();
    const img = document.createElement("img");
    img.className = "la-vn-poof";
    img.src = POOF_GIF_DATA_URL;
    img.alt = "";
    // Sprite-width cloud, dead-centered on the sprite.
    const size = sr.width;
    img.style.width = `${size}px`;
    img.style.left = `${sr.left - o.left}px`;
    img.style.top = `${sr.top - o.top + (sr.height - size) / 2}px`;
    overlay.appendChild(img);
    exprTimers.push(setTimeout(() => img.remove(), 880));
  }

  // The VN still-image trick (Ren'Py's ~0.2s attribute dissolve, plus a small
  // horizontal move-fade): slide-fade the old sprite out, swap the source,
  // slide-fade the new one in with a slight settle overshoot. Leaving the
  // intro cardboard box swaps under a poof cloud instead.
  function setExpression(next: MouseyExpression, animate = true): void {
    if (next === currentExpr) return;
    const prev = currentExpr;
    currentExpr = next;
    const sprite = spriteEl;
    if (!sprite) return;
    sprite.classList.toggle("is-shaking", next === "cardboard");
    if (!animate) {
      sprite.classList.remove("la-vn-swap-out", "la-vn-swap-in");
      sprite.src = MOUSEY_EXPRESSIONS[currentExpr] ?? sprite.src;
      return;
    }
    if (prev === "cardboard") {
      playPoof();
      exprTimers.push(setTimeout(() => {
        sprite.src = MOUSEY_EXPRESSIONS[currentExpr] ?? sprite.src;
      }, 250));
      return;
    }
    sprite.classList.remove("la-vn-swap-in");
    sprite.classList.add("la-vn-swap-out");
    exprTimers.push(setTimeout(() => {
      sprite.src = MOUSEY_EXPRESSIONS[currentExpr] ?? sprite.src;
      sprite.classList.remove("la-vn-swap-out");
      sprite.classList.add("la-vn-swap-in");
      exprTimers.push(setTimeout(() => sprite.classList.remove("la-vn-swap-in"), 240));
    }, 150));
  }

  function currentStep(): TutStep | null {
    return TUTORIAL_STEPS[idx] ?? null;
  }

  function currentLines(): readonly VnLine[] {
    const step = currentStep();
    if (step) return step.lines;
    if (!finaleLines) finaleLines = tutorialFinale(score(), tutorialQuizCount());
    return finaleLines;
  }

  // Static fold of every prior step's expressions. Beat boundaries must not
  // depend on the runtime expression (it mutates mid-beat, and advance() and
  // renderStep() would then disagree about where beats fall).
  function entryExprFor(stepIdx: number): MouseyExpression {
    let e: MouseyExpression = "neutral";
    for (let i = 0; i < stepIdx && i < TUTORIAL_STEPS.length; i++) {
      for (const ln of TUTORIAL_STEPS[i]!.lines) if (ln.expr) e = ln.expr;
    }
    return e;
  }

  function currentBeats(): number[] {
    return splitBeats(currentLines(), entryExprFor(idx));
  }

  function quizNumber(step: TutQuizStep): number {
    let n = 0;
    for (const st of TUTORIAL_STEPS) {
      if (st.kind === "quiz") n++;
      if (st === step) break;
    }
    return n;
  }

  function score(): number {
    let n = 0;
    for (const a of answers.values()) if (a.correct) n++;
    return n;
  }

  /* ---------------------------------------------------------- spotlight */

  function placeSpot(): void {
    if (!overlay || !spot) return;
    const step = currentStep();
    const anchor = step?.anchor;
    let target = anchor ? deps.root.querySelector<HTMLElement>(`[data-tut="${anchor}"]`) : null;
    // A display:none anchor reports a zero rect; dim without a hole instead
    // of ringing the top-left corner.
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) target = null;
    }
    if (!target) {
      // Zero-size hole in the center: the shadow still dims everything.
      spot.classList.add("is-hidden");
      const r = deps.root.getBoundingClientRect();
      Object.assign(spot.style, { top: `${r.height / 2}px`, left: `${r.width / 2}px`, width: "0px", height: "0px" });
      cardLift = 0;
      if (card) card.style.bottom = "";
      syncSpriteBottom();
      return;
    }
    spot.classList.remove("is-hidden");
    const c = deps.root.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const pad = 5;
    const top = Math.max(0, t.top - c.top - pad);
    const left = Math.max(0, t.left - c.left - pad);
    const right = Math.min(c.width, t.right - c.left + pad);
    const bottom = Math.min(c.height, t.bottom - c.top + pad);
    Object.assign(spot.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${Math.max(0, right - left)}px`,
      height: `${Math.max(0, bottom - top)}px`,
    });
    // Low anchors (the composer, the compaction ring): the box stays at the
    // bottom but soft-lifts above the hole, and the sprite rides up with it.
    // CSS transitions on `bottom` make both glide instead of jump.
    const anchorMidY = (top + bottom) / 2;
    cardLift = anchorMidY > c.height * 0.55 ? Math.max(0, c.height - top + 12) : 0;
    if (card) card.style.bottom = cardLift > 0 ? `${cardLift}px` : "";
    syncSpriteBottom();
  }

  /* -------------------------------------------------------- VN dialogue */

  // A click mid-type completes the current beat's text instantly instead of
  // advancing; null when nothing is typing.
  let typingFinish: (() => void) | null = null;

  function decorated(ln: VnLine): string {
    return ln.kind === "speech" ? `“${ln.text}”`
      : ln.kind === "thought" ? `*${ln.text}*`
      : ln.text;
  }

  // sfx characters wriggle independently, the VN shaky-text staple. Negative
  // phase-offset delays start each glyph mid-wave instead of in lockstep.
  function wiggleChar(ch: string, i: number): HTMLElement {
    const span = el("span", "la-vn-wiggle", ch);
    span.style.animationDelay = `-${(i % 7) * 90}ms`;
    return span;
  }

  function fillLine(div: HTMLElement, ln: VnLine): void {
    if (ln.kind === "sfx") {
      div.replaceChildren();
      Array.from(decorated(ln)).forEach((ch, i) => div.appendChild(wiggleChar(ch, i)));
      return;
    }
    div.textContent = decorated(ln);
  }

  // ~55 cps typewriter with punctuation pauses, the VN convention. sfx lines
  // land slower for impact. Array.from keeps surrogate pairs (emoji) intact.
  const CHAR_MS = 18;
  const SFX_CHAR_MS = 34;
  const LINE_PAUSE_MS = 260;
  const PUNCT_PAUSE_MS = 140;
  const PUNCT = new Set([".", "!", "?", "…", "~", ","]);

  // Renders lines[0..upTo). Lines of earlier beats appear settled; the
  // current beat's lines type out character by character, each line's
  // expression swap (at most one per beat) firing as its line starts.
  // onDone fires once, after the text is fully on screen (typed, forced
  // complete, or instant).
  function renderLines(content: HTMLElement, lines: readonly VnLine[], animateFrom: number, upTo: number, onDone?: () => void, instant = false): void {
    // Lines live in a capped, scrollable wrapper (top-faded once scrolled)
    // shared by every renderLines call into the same container.
    let wrap = content.querySelector<HTMLElement>(":scope > .la-vn-lines");
    if (!wrap) {
      const w = el("div", "la-vn-lines");
      w.addEventListener("scroll", () => w.classList.toggle("is-scrolled", w.scrollTop > 4), { passive: true });
      content.appendChild(w);
      wrap = w;
    }
    const pin = (): void => { wrap!.scrollTop = wrap!.scrollHeight; };
    const targets: { div: HTMLElement; ln: VnLine; chars: string[] }[] = [];
    for (let i = 0; i < upTo; i++) {
      const ln = lines[i]!;
      const div = el("div", `la-vn-line la-vn-${ln.kind}`);
      if (i < animateFrom) {
        fillLine(div, ln);
        div.classList.add("is-settled");
      } else if (instant) {
        fillLine(div, ln);
        if (ln.expr) setExpression(ln.expr, false);
      } else {
        targets.push({ div, ln, chars: Array.from(decorated(ln)) });
      }
      wrap.appendChild(div);
    }
    pin();
    if (targets.length === 0) {
      onDone?.();
      return;
    }
    let done = false;
    const finishAll = (): void => {
      if (done) return;
      done = true;
      typingFinish = null;
      for (const t of targets) {
        fillLine(t.div, t.ln);
        if (t.ln.expr) setExpression(t.ln.expr, false);
      }
      pin();
      onDone?.();
    };
    typingFinish = finishAll;
    let li = 0;
    let ci = 0;
    const step = (): void => {
      if (done) return;
      if (li >= targets.length) {
        done = true;
        typingFinish = null;
        onDone?.();
        return;
      }
      const t = targets[li]!;
      if (ci === 0 && t.ln.expr) setExpression(t.ln.expr);
      if (ci === 0 && t.ln.anim === "fall") playFall();
      const ch = t.chars[ci];
      if (ch === undefined) {
        li++;
        ci = 0;
        exprTimers.push(setTimeout(step, LINE_PAUSE_MS));
        return;
      }
      if (t.ln.kind === "sfx") t.div.appendChild(wiggleChar(ch, ci));
      else t.div.textContent = (t.div.textContent ?? "") + ch;
      pin();
      ci++;
      const base = t.ln.kind === "sfx" ? SFX_CHAR_MS : CHAR_MS;
      exprTimers.push(setTimeout(step, base + (PUNCT.has(ch) ? PUNCT_PAUSE_MS : 0)));
    };
    step();
  }

  function dotsRow(): HTMLElement {
    const row = el("div", "la-tut-dots");
    let qn = 0;
    for (const st of TUTORIAL_STEPS) {
      if (st.kind !== "quiz") continue;
      qn++;
      const dot = el("span", "la-tut-dot");
      const a = answers.get(st.id);
      if (a) dot.classList.add(a.correct ? "is-right" : "is-wrong");
      dot.title = `Question ${qn}`;
      row.appendChild(dot);
    }
    return row;
  }

  function capsButton(big: boolean): HTMLButtonElement {
    const b = el("button", `la-tut-caps${big ? " is-big" : ""}`, "Read resume ✧") as HTMLButtonElement;
    b.type = "button";
    b.title = "Her full resume: everything she can read and write across Lumiverse";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deps.onShowCapabilities();
    });
    return b;
  }

  // No Next button by design: say beats advance from a click anywhere in the
  // tab (the ▼ is the cue). Only a quiz answer gates on its Continue button.
  function navRow(opts: { back: boolean; resume?: boolean; continueLabel?: string; waiting?: boolean }): HTMLElement {
    const nav = el("div", "la-tut-nav");
    const backBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Back") as HTMLButtonElement;
    backBtn.type = "button";
    backBtn.disabled = !opts.back;
    backBtn.addEventListener("click", (ev) => { ev.stopPropagation(); goBack(); });
    nav.appendChild(backBtn);
    if (opts.resume !== false) nav.appendChild(capsButton(false));
    nav.appendChild(dotsRow());
    if (opts.continueLabel !== undefined) {
      const cont = el("button", "la-btn la-btn-mini la-tut-next", opts.continueLabel) as HTMLButtonElement;
      cont.type = "button";
      cont.addEventListener("click", (ev) => { ev.stopPropagation(); advance(); });
      nav.appendChild(cont);
    } else if (opts.waiting) {
      nav.appendChild(el("span", "la-tut-waiting", "your call…"));
    }
    return nav;
  }

  function atVeryStart(): boolean {
    return idx === 0 && beatIdx === 0;
  }

  function advance(): void {
    const beats = currentBeats();
    if (beatIdx < beats.length - 1) {
      beatIdx++;
    } else {
      idx++;
      beatIdx = 0;
    }
    renderStep();
  }

  function goBack(): void {
    if (beatIdx > 0) {
      beatIdx--;
    } else if (idx > 0) {
      idx--;
      beatIdx = Math.max(0, currentBeats().length - 1);
    } else {
      return;
    }
    renderStep();
  }

  function cardShell(): HTMLElement | null {
    if (!card) return null;
    card.replaceChildren();
    card.classList.remove("is-bonk");
    card.appendChild(el("div", "la-vn-nametag", "Mousey"));
    const close = el("button", "la-tut-close", "✕") as HTMLButtonElement;
    close.type = "button";
    close.setAttribute("aria-label", "Leave the tour");
    close.title = "Leave the tour (retake it anytime from the ⋯ menu)";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeTutorial();
    });
    card.appendChild(close);
    const content = el("div", "la-tut-content");
    card.appendChild(content);
    return content;
  }

  // VN click contract, tab-wide: a click anywhere mid-type completes the
  // text; once settled it advances, unless the beat gates on a choice or the
  // Continue button. The overlay handler (set at open) reads this flag.
  let clickAdvances = false;
  function enableClickAdvance(alsoAdvance = true): void {
    clickAdvances = alsoAdvance;
    overlay?.classList.toggle("is-advance", alsoAdvance);
  }

  function renderStep(): void {
    if (!overlay) return;
    clearExprTimers();
    // A cancelled fall must not leave her lying down or faded out.
    if (spriteEl) {
      spriteEl.classList.remove("is-falling");
      spriteEl.style.opacity = "";
      spriteEl.style.transition = "";
    }
    enableClickAdvance(false);
    const step = currentStep();
    if (!step) {
      renderFinale();
      placeSpot();
      return;
    }
    const content = cardShell();
    if (!content) return;
    const lines = step.lines;
    const beats = currentBeats();
    beatIdx = Math.min(beatIdx, beats.length - 1);
    const start = beats[beatIdx]!;
    const end = beatEnd(beats, beatIdx, lines.length);
    // Settle the sprite on whatever the already-revealed lines decided.
    const settled = lastExprBefore(lines, start);
    if (settled) setExpression(settled, false);

    if (step.kind === "say") {
      // VN habit: clicking anywhere completes the typing, then advances.
      enableClickAdvance();
      renderLines(content, lines, start, end, () => {
        const nav = navRow({ back: !atVeryStart() });
        nav.appendChild(el("div", "la-vn-adv", "▼"));
        content.appendChild(nav);
      });
    } else {
      renderQuiz(content, step, lines, beats, start, end);
    }
    placeSpot();
  }

  function renderQuiz(content: HTMLElement, q: TutQuizStep, lines: readonly VnLine[], beats: number[], start: number, end: number): void {
    content.appendChild(el("div", "la-tut-qlabel", `Question ${quizNumber(q)} of ${tutorialQuizCount()}`));
    const prior = answers.get(q.id) ?? null;
    const lastBeat = beatIdx >= beats.length - 1;

    if (!prior && !lastBeat) {
      // Flavor beats before the question: plain VN advance.
      enableClickAdvance();
      renderLines(content, lines, start, end, () => {
        const nav = navRow({ back: !atVeryStart() });
        nav.appendChild(el("div", "la-vn-adv", "▼"));
        content.appendChild(nav);
      });
      return;
    }

    const group = el("div", "la-tut-options");
    group.setAttribute("role", "radiogroup");
    const options = shuffled(q);
    let locked = prior !== null;
    const btns: HTMLButtonElement[] = [];

    const settle = (picked: HTMLButtonElement | null, pickedCorrect: boolean, instant: boolean): void => {
      for (const b of btns) {
        b.disabled = true;
        if (options[btns.indexOf(b)]!.correct) b.classList.add("is-correct");
      }
      if (picked && !pickedCorrect) picked.classList.add("is-wrong");
      if (!pickedCorrect) card?.classList.add("is-bonk");
      const reaction = el("div", "la-vn-reaction");
      content.appendChild(reaction);
      const verdict = pickedCorrect ? VERDICT_RIGHT : VERDICT_WRONG;
      const why: VnLine = { kind: "speech", text: q.why };
      renderLines(reaction, verdict, 0, verdict.length, () => {
        renderLines(reaction, [why], 0, 1, () => {
          content.appendChild(navRow({ back: !atVeryStart(), continueLabel: "Continue ▸" }));
        }, instant);
      }, instant);
    };

    for (const o of options) {
      const btn = el("button", "la-tut-option", o.text) as HTMLButtonElement;
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (locked) return;
        locked = true;
        answers.set(q.id, { pickedText: o.text, correct: o.correct });
        settle(btn, o.correct, false);
      });
      btns.push(btn);
      group.appendChild(btn);
    }

    if (prior) {
      // A revisited answered quiz shows everything settled at once.
      renderLines(content, lines, lines.length, lines.length, undefined, true);
      content.appendChild(group);
      const pickedBtn = btns.find((b) => b.textContent === prior.pickedText) ?? null;
      settle(pickedBtn, prior.correct, true);
    } else {
      // Clicks complete the question's typing; answering takes a choice.
      enableClickAdvance(false);
      renderLines(content, lines, start, end, () => {
        content.appendChild(group);
        content.appendChild(navRow({ back: !atVeryStart(), waiting: true }));
      });
    }
  }

  function renderFinale(): void {
    const content = cardShell();
    if (!content) return;
    content.appendChild(el("div", "la-tut-qlabel", "End of shift"));
    const lines = currentLines();
    const beats = currentBeats();
    beatIdx = Math.min(beatIdx, beats.length - 1);
    const start = beats[beatIdx]!;
    const end = beatEnd(beats, beatIdx, lines.length);
    const settled = lastExprBefore(lines, start);
    if (settled) setExpression(settled, false);

    if (beatIdx < beats.length - 1) {
      enableClickAdvance();
      renderLines(content, lines, start, end, () => {
        const nav = navRow({ back: beatIdx > 0 });
        nav.appendChild(el("div", "la-vn-adv", "▼"));
        content.appendChild(nav);
      });
      return;
    }

    if (!completedFired) {
      completedFired = true;
      deps.onCompleted();
    }
    enableClickAdvance(false);
    renderLines(content, lines, start, end, () => {
      renderLines(content, [
        { kind: "speech", text: "Oh! And my resume is right here, if you ever wonder just how much of Lumiverse I can reach. I may have gone a little overboard on it. It also lives under the ⋯ menu~" },
      ], 0, 1, () => {
        content.appendChild(capsButton(true));
        const nav = el("div", "la-tut-nav");
        const retake = el("button", "la-btn la-btn-mini la-btn-ghost", "Retake") as HTMLButtonElement;
        retake.type = "button";
        retake.addEventListener("click", () => {
          answers.clear();
          idx = 0;
          beatIdx = 0;
          finaleLines = null;
          setExpression("cardboard", false);
          renderStep();
        });
        nav.appendChild(retake);
        nav.appendChild(dotsRow());
        const finish = el("button", "la-btn la-btn-mini la-tut-next", "Finish") as HTMLButtonElement;
        finish.type = "button";
        finish.addEventListener("click", () => {
          closeTutorial();
          deps.onFinished();
        });
        nav.appendChild(finish);
        content.appendChild(nav);
      });
    });
  }

  /* ---------------------------------------------------------- lifecycle */

  function openTutorial(): void {
    if (overlay) return;
    idx = 0;
    beatIdx = 0;
    answers.clear();
    finaleLines = null;
    completedFired = false;
    // She starts boxed: the intro's first beat is the shaking cardboard,
    // beat two poofs her out of it.
    currentExpr = "cardboard";
    overlay = el("div", "la-tut-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "LumiAgent tour");
    // Esc leaves the tour without also collapsing an expanded drawer.
    overlay.tabIndex = -1;
    overlay.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeTutorial();
      }
    });
    // Tab-wide VN click: anywhere that isn't a button completes the typing
    // or advances the beat.
    overlay.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("button")) return;
      if (typingFinish) {
        typingFinish();
        return;
      }
      if (clickAdvances) advance();
    });
    spot = el("div", "la-tut-spot");
    // The sprite lives in the overlay, not the card, so her legs can run
    // behind the dialogue box and swaps survive step re-renders.
    const sprite = document.createElement("img");
    sprite.className = "la-vn-sprite is-shaking";
    sprite.src = MOUSEY_EXPRESSIONS["cardboard"] ?? MOUSEY_EXPRESSIONS["neutral"] ?? "";
    sprite.alt = "";
    sprite.setAttribute("aria-hidden", "true");
    spriteEl = sprite;
    card = el("div", "la-tut-card");
    overlay.append(spot, sprite, card);
    deps.root.appendChild(overlay);
    resizeObs = new ResizeObserver(() => placeSpot());
    resizeObs.observe(deps.root);
    cardObs = new ResizeObserver(() => syncSpriteBottom());
    cardObs.observe(card);
    renderStep();
    overlay.focus();
    deps.onOpened();
  }

  function closeTutorial(): void {
    clearExprTimers();
    resizeObs?.disconnect();
    resizeObs = null;
    cardObs?.disconnect();
    cardObs = null;
    cardLift = 0;
    overlay?.remove();
    overlay = null;
    spot = null;
    card = null;
    spriteEl = null;
  }

  return {
    open: openTutorial,
    close: closeTutorial,
    isOpen: () => overlay !== null,
  };
}
