// Sampler defs mirror LumiRealm's so behaviour matches user expectations.

export type SamplerKey =
  | "temperature" | "maxTokens" | "contextSize"
  | "topP" | "minP" | "topK"
  | "frequencyPenalty" | "presencePenalty" | "repetitionPenalty";

export const SAMPLER_KEYS: readonly SamplerKey[] = [
  "temperature", "maxTokens", "contextSize",
  "topP", "minP", "topK",
  "frequencyPenalty", "presencePenalty", "repetitionPenalty",
];

export type SamplerBag = Readonly<Record<SamplerKey, number | null>>;

export interface SamplerDef {
  readonly key: SamplerKey;
  readonly label: string;
  readonly type: "int" | "float";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultHint: number;
}

export const SAMPLER_DEFS: readonly SamplerDef[] = [
  { key: "temperature",       label: "Temperature",  type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 1.0 },
  { key: "maxTokens",         label: "Max Response", type: "int",   min: 1, max: 128000,  step: 1,    defaultHint: 32768 },
  { key: "contextSize",       label: "Context Size", type: "int",   min: 1, max: 2000000, step: 1,    defaultHint: 200000 },
  { key: "topP",              label: "Top P",        type: "float", min: 0, max: 1,       step: 0.01, defaultHint: 0.95 },
  { key: "minP",              label: "Min P",        type: "float", min: 0, max: 1,       step: 0.01, defaultHint: 0 },
  { key: "topK",              label: "Top K",        type: "int",   min: 0, max: 500,     step: 1,    defaultHint: 0 },
  { key: "frequencyPenalty",  label: "Freq Penalty", type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 0 },
  { key: "presencePenalty",   label: "Pres Penalty", type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 0 },
  { key: "repetitionPenalty", label: "Rep Penalty",  type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 0 },
];

export function defaultSamplerBag(): SamplerBag {
  return {
    temperature: null, maxTokens: null, contextSize: null,
    topP: null, minP: null, topK: null,
    frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
  };
}

export function coerceSamplerBag(input: unknown): SamplerBag {
  if (!input || typeof input !== "object") return defaultSamplerBag();
  const src = input as Record<string, unknown>;
  const out: Record<SamplerKey, number | null> = { ...defaultSamplerBag() };
  for (const k of SAMPLER_KEYS) {
    const v = src[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return out;
}

const SAMPLER_WIRE_KEYS: Readonly<Record<SamplerKey, string>> = {
  temperature: "temperature",
  maxTokens: "max_tokens",
  contextSize: "context_size",
  topP: "top_p",
  minP: "min_p",
  topK: "top_k",
  frequencyPenalty: "frequency_penalty",
  presencePenalty: "presence_penalty",
  repetitionPenalty: "repetition_penalty",
};

// Returns null when nothing is set so callers can omit `parameters` entirely.
export function samplersToWire(samplers: SamplerBag | null | undefined): Record<string, number> | null {
  if (!samplers) return null;
  const out: Record<string, number> = {};
  for (const k of SAMPLER_KEYS) {
    const v = samplers[k];
    if (v !== null) out[SAMPLER_WIRE_KEYS[k]] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

// max_tokens must always be sent. Anthropic requires it and defaults to 4096
// when omitted, which truncates long generations (175-line greeting
// translations, big tool_use input_json, etc.) mid-stream. The defaultHint
// shown in the UI is otherwise cosmetic, this materializes it onto the wire.
const DEFAULT_HINTS: Readonly<Record<SamplerKey, number>> = (() => {
  const m = {} as Record<SamplerKey, number>;
  for (const def of SAMPLER_DEFS) m[def.key] = def.defaultHint;
  return m;
})();

export function samplersToWireWithRequired(
  samplers: SamplerBag | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = samplersToWire(samplers) ?? {};
  if (out.max_tokens === undefined) out.max_tokens = DEFAULT_HINTS.maxTokens;
  return out;
}
