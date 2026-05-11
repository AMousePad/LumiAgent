// Ported from open-multi-agent.

export interface LoopDetectionConfig {
  maxRepetitions?: number;
  loopDetectionWindow?: number;
}

export interface LoopDetectionInfo {
  readonly kind: "tool_repetition" | "text_repetition";
  readonly repetitions: number;
  readonly detail: string;
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export class LoopDetector {
  private readonly maxRepeats: number;
  private readonly windowSize: number;
  private readonly toolSignatures: string[] = [];
  private readonly textOutputs: string[] = [];

  constructor(config: LoopDetectionConfig = {}) {
    this.maxRepeats = config.maxRepetitions ?? 3;
    const requested = config.loopDetectionWindow ?? 4;
    this.windowSize = Math.max(requested, this.maxRepeats);
  }

  recordToolCalls(
    blocks: ReadonlyArray<{ name: string; input: Record<string, unknown> }>,
  ): LoopDetectionInfo | null {
    if (blocks.length === 0) return null;
    const signature = this.computeToolSignature(blocks);
    this.push(this.toolSignatures, signature);
    const count = this.consecutiveRepeats(this.toolSignatures);
    if (count >= this.maxRepeats) {
      const names = blocks.map((b) => b.name).join(", ");
      return {
        kind: "tool_repetition",
        repetitions: count,
        detail: `Tool call "${names}" with identical arguments has repeated ${count} times consecutively. The agent appears to be stuck.`,
      };
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
      .map((b) => ({ name: b.name, input: sortKeys(b.input) }))
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
