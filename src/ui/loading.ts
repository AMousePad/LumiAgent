// Cycling-verb "thinking" indicator with a scramble-sweep transition.

import { pickLoaderVariant } from "./loaders";

const WORDS: readonly string[] = [
  "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing",
  "Calculating", "Cerebrating", "Channelling", "Churning", "Clauding",
  "Coalescing", "Cogitating", "Combobulating", "Computing", "Concocting",
  "Conjuring", "Considering", "Contemplating", "Cooking", "Crafting",
  "Creating", "Crunching", "Deciphering", "Deliberating", "Determining",
  "Discombobulating", "Divining", "Doing", "Effecting", "Elucidating",
  "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting", "Forging",
  "Forming", "Frolicking", "Generating", "Germinating", "Hatching",
  "Herding", "Honking", "Hustling", "Ideating", "Imagining", "Incubating",
  "Inferring", "Jiving", "Manifesting", "Marinating", "Meandering",
  "Moseying", "Mulling", "Mustering", "Musing", "Noodling", "Percolating",
  "Perusing", "Philosophising", "Pondering", "Pontificating", "Processing",
  "Puttering", "Puzzling", "Reticulating", "Ruminating", "Scheming",
  "Schlepping", "Shimmying", "Shucking", "Simmering", "Smooshing",
  "Spelunking", "Spinning", "Stewing", "Sussing", "Synthesizing",
  "Thinking", "Tinkering", "Transmuting", "Unfurling", "Unravelling",
  "Vibing", "Wandering", "Whirring", "Wibbling", "Wizarding", "Working",
  "Wrangling",
];

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SCRAMBLE_MS = 480;
const HOLD_MIN_MS = 2400;
const HOLD_JITTER_MS = 1400;

function randomChar(): string {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]!;
}

function pickWord(exclude: string | null): string {
  let pick = WORDS[Math.floor(Math.random() * WORDS.length)]!;
  if (exclude && pick === exclude) {
    pick = WORDS[(WORDS.indexOf(pick) + 1) % WORDS.length]!;
  }
  return pick;
}

export interface LoadingHandle {
  destroy(): void;
}

export function mountLoading(parent: HTMLElement): LoadingHandle {
  const wrap = document.createElement("div");
  wrap.className = "la-thinking";
  const spinner = document.createElement("span");
  spinner.className = `la-ld ${pickLoaderVariant()}`;
  const word = document.createElement("span");
  word.className = "la-thinking-word";
  const dots = document.createElement("span");
  dots.className = "la-thinking-dots";
  dots.innerHTML = "<span>.</span><span>.</span><span>.</span>";
  wrap.append(spinner, word, dots);
  parent.appendChild(wrap);

  let active = true;
  let current = pickWord(null);
  word.textContent = current;

  let rafHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const animateTo = (target: string): Promise<void> => new Promise((resolve) => {
    const start = performance.now();
    const sourceLen = current.length;
    const targetLen = target.length;
    const maxLen = Math.max(sourceLen, targetLen);
    const stepMs = SCRAMBLE_MS / Math.max(1, maxLen);

    const frame = (now: number) => {
      if (!active) { resolve(); return; }
      const elapsed = now - start;
      let out = "";
      for (let i = 0; i < maxLen; i++) {
        const lockAt = i * stepMs;
        if (elapsed >= lockAt + 60) {
          // Settled — show target character if any.
          if (i < targetLen) out += target[i]!;
        } else if (elapsed >= lockAt) {
          // Coin-flip between target and random while settling.
          out += Math.random() < 0.5 && i < targetLen ? target[i]! : randomChar();
        } else {
          // Pre-lock — pure scramble, but only emit if the source or target
          // still wants a char in this slot (avoids tail overflow on shorter target).
          if (i < Math.max(sourceLen, targetLen)) out += randomChar();
        }
      }
      word.textContent = out;
      if (elapsed < SCRAMBLE_MS + 80) {
        rafHandle = requestAnimationFrame(frame);
      } else {
        word.textContent = target;
        current = target;
        resolve();
      }
    };
    rafHandle = requestAnimationFrame(frame);
  });

  const cycle = async (): Promise<void> => {
    if (!active) return;
    const next = pickWord(current);
    await animateTo(next);
    if (!active) return;
    timeoutHandle = setTimeout(cycle, HOLD_MIN_MS + Math.random() * HOLD_JITTER_MS);
  };

  timeoutHandle = setTimeout(cycle, 1400);

  return {
    destroy() {
      active = false;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      wrap.remove();
    },
  };
}
