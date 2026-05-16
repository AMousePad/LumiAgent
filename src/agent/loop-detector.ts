// Ported from open-multi-agent, then hardened to a no-progress invariant:
// every signal buffer is cleared by noteProgress(), so a "loop" can only ever
// be flagged across turns that produced zero progress (no edit, revert, or
// finish). Repetition that coexists with progress is just work and never
// fires. This is what keeps the detector false-positive-free.

export interface LoopDetectionConfig {
  maxRepetitions?: number;
  loopDetectionWindow?: number;
}

export interface LoopDetectionInfo {
  readonly kind: "tool_repetition" | "text_repetition";
  readonly repetitions: number;
  readonly detail: string;
}

// These return a fresh value for identical args by design, so repeating them
// with the same input is legitimate ("roll 3d6 three times"). Never counted.
const NONDETERMINISTIC_TOOLS = new Set(["roll_dice", "random_pick"]);

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

// `tool_search` with `select:b,a` and `select:a,b` load the same schemas but
// serialise to different JSON, which would reset the repetition counter every
// turn and hide a tool_search/<x> ping-pong loop. Canonicalise the select
// list so order variants collapse to one signature.
function normaliseInput(
  name: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (name !== "tool_search" || typeof input.query !== "string") return input;
  const q = input.query.trim();
  const m = /^select:(.*)$/i.exec(q);
  if (!m) return { ...input, query: q.toLowerCase() };
  const sorted = m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join(",");
  return { ...input, query: `select:${sorted}` };
}

export class LoopDetector {
  private readonly maxRepeats: number;
  private readonly windowSize: number;
  private readonly toolSignatures: string[] = [];
  private readonly textOutputs: string[] = [];

  constructor(config: LoopDetectionConfig = {}) {
    this.maxRepeats = config.maxRepetitions ?? 3;
    const requested = config.loopDetectionWindow ?? 4;
    // The window must hold at least one full alternating cycle of length
    // maxRepeats, i.e. 2*maxRepeats turns, or an A/B/A/B loop never reaches
    // the frequency threshold inside the window.
    this.windowSize = Math.max(requested, this.maxRepeats * 2);
  }

  // Any forward motion (an edit landed, a revert applied, the task finished)
  // means the agent is not looping. Wipe every buffer so suspicion only ever
  // builds across a run of strictly unproductive turns.
  noteProgress(): void {
    this.toolSignatures.length = 0;
    this.textOutputs.length = 0;
  }

  recordToolCalls(
    blocks: ReadonlyArray<{ name: string; input: Record<string, unknown> }>,
  ): LoopDetectionInfo | null {
    const counted = blocks.filter((b) => !NONDETERMINISTIC_TOOLS.has(b.name));
    if (counted.length === 0) return null;
    const signature = this.computeToolSignature(counted);
    this.push(this.toolSignatures, signature);
    const names = counted.map((b) => b.name).join(", ");

    // Because the buffer is cleared on any progress, every entry here is a
    // turn that changed nothing. The exact same call landing maxRepeats times
    // back-to-back under that condition is unambiguously stuck.
    const consecutive = this.consecutiveRepeats(this.toolSignatures);
    if (consecutive >= this.maxRepeats) {
      return {
        kind: "tool_repetition",
        repetitions: consecutive,
        detail: `Tool call "${names}" with identical arguments has repeated ${consecutive} times with no progress in between. The agent appears to be stuck.`,
      };
    }

    // Interleaved cycle (A/B/A/B). Require a full window of uninterrupted
    // no-progress turns before flagging, so a single re-read between real
    // edits can never trip it (the edit clears the buffer first).
    if (this.toolSignatures.length >= this.windowSize) {
      const windowed = this.windowFrequency(this.toolSignatures, signature);
      if (windowed >= this.maxRepeats) {
        return {
          kind: "tool_repetition",
          repetitions: windowed,
          detail: `Tool call "${names}" with identical arguments has repeated ${windowed} times in ${this.toolSignatures.length} turns with no progress (interleaved with other unproductive calls). The agent appears to be stuck in a cycle.`,
        };
      }
    }
    return null;
  }

  recordText(text: string): LoopDetectionInfo | null {
    const normalised = text.trim().replace(/\s+/g, " ");
    if (normalised.length === 0) return null;
    this.push(this.textOutputs, normalised);
    const count = this.consecutiveRepeats(this.textOutputs);
    if (count >= this.maxRepeats) {
      return {
        kind: "text_repetition",
        repetitions: count,
        detail: `The agent has produced the same text response ${count} times consecutively. It appears to be stuck.`,
      };
    }
    return null;
  }

  private computeToolSignature(
    blocks: ReadonlyArray<{ name: string; input: Record<string, unknown> }>,
  ): string {
    const items = blocks
      .map((b) => ({ name: b.name, input: sortKeys(normaliseInput(b.name, b.input)) }))
      .sort((a, b) => {
        const cmp = a.name.localeCompare(b.name);
        if (cmp !== 0) return cmp;
        return JSON.stringify(a.input).localeCompare(JSON.stringify(b.input));
      });
    return JSON.stringify(items);
  }

  private push(buffer: string[], entry: string): void {
    buffer.push(entry);
    while (buffer.length > this.windowSize) buffer.shift();
  }

  private windowFrequency(buffer: string[], entry: string): number {
    let count = 0;
    for (const s of buffer) if (s === entry) count++;
    return count;
  }

  private consecutiveRepeats(buffer: string[]): number {
    if (buffer.length === 0) return 0;
    const last = buffer[buffer.length - 1];
    let count = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i] === last) count++;
      else break;
    }
    return count;
  }
}
