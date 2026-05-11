import { z } from "zod";
import { defineTool } from "./_framework";

const CJK_RANGES: Array<[number, number, string]> = [
  [0xAC00, 0xD7A3, "korean_hangul"],
  [0x1100, 0x11FF, "korean_jamo"],
  [0x3130, 0x318F, "korean_compat_jamo"],
  [0x3040, 0x309F, "japanese_hiragana"],
  [0x30A0, 0x30FF, "japanese_katakana"],
  [0x31F0, 0x31FF, "japanese_kana_ext"],
  [0x4E00, 0x9FFF, "cjk_unified"],
  [0x3400, 0x4DBF, "cjk_ext_a"],
  [0xF900, 0xFAFF, "cjk_compat"],
  [0xFF66, 0xFF9F, "halfwidth_kana"],
];

function classifyChar(code: number): string | null {
  for (const [lo, hi, label] of CJK_RANGES) if (code >= lo && code <= hi) return label;
  return null;
}

const inputSchema = z.object({ text: z.string() });

export const countCjkCharsTool = defineTool({
  name: "count_cjk_chars",
  description: "Count Korean / Japanese / Chinese characters in a string, broken down by script.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  defaultSensitivity: "insensitive",
  execute: async (input) => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const ch of input.text) {
      const code = ch.codePointAt(0);
      if (code === undefined) continue;
      const label = classifyChar(code);
      if (label) {
        counts[label] = (counts[label] ?? 0) + 1;
        total++;
      }
    }
    return { content: JSON.stringify({ total_cjk_chars: total, total_chars: [...input.text].length, by_script: counts }) };
  },
});
