import type { ToolCtx } from "./_context";

const DEFAULT_READ_LIMIT = 800;
const MAX_READ_LIMIT = 4000;
const MAX_LINE_CHARS = 2000;

export function formatLineSlice(
  text: string,
  label: string,
  offsetIn: number | undefined,
  limitIn: number | undefined,
): string {
  if (text.length === 0) return `[${label}: empty]`;
  const lines = text.split("\n");
  const total = lines.length;
  const offset = Math.max(1, Math.floor(offsetIn ?? 1));
  const limit = Math.min(MAX_READ_LIMIT, Math.max(1, Math.floor(limitIn ?? DEFAULT_READ_LIMIT)));
  const start = Math.min(offset, total);
  const end = Math.min(total, start + limit - 1);
  const slice = lines.slice(start - 1, end);
  const numbered = slice.map((line, i) => {
    const lineNo = start + i;
    const truncated = line.length > MAX_LINE_CHARS
      ? `${line.slice(0, MAX_LINE_CHARS)} [... line truncated, ${line.length} chars total]`
      : line;
    return `${String(lineNo).padStart(6, " ")}\t${truncated}`;
  });
  const header = total === slice.length
    ? `[${label}: ${total} lines, ${text.length} chars]`
    : `[${label}: showing lines ${start}-${end} of ${total} (${text.length} chars total); pass offset/limit to page]`;
  return `${header}\n${numbered.join("\n")}`;
}

export function readBudgetTokens(ctx: ToolCtx): number {
  return Math.max(2000, Math.min(25_000, Math.floor(ctx.contextTokens * 0.10)));
}

export function readBudgetChars(ctx: ToolCtx): number {
  return readBudgetTokens(ctx) * 3;
}

const PREVIEW_CHARS = 2000;

// Preview prefix for a spilled payload. Snaps to the last newline in range so
// the teaser never cuts mid-line (ported from Claude Code's generatePreview).
function generatePreview(content: string, maxChars: number): { preview: string; hasMore: boolean } {
  if (content.length <= maxChars) return { preview: content, hasMore: false };
  const head = content.slice(0, maxChars);
  const lastNewline = head.lastIndexOf("\n");
  const cut = lastNewline > maxChars * 0.5 ? lastNewline : maxChars;
  return { preview: content.slice(0, cut), hasMore: true };
}

export async function spillOrReturn(
  ctx: ToolCtx,
  payload: string,
  origin: string,
  peekHint?: string,
): Promise<string> {
  const budgetChars = readBudgetChars(ctx);
  if (payload.length <= budgetChars) return payload;
  const { writeTmp } = await import("../../state/tmp-store");
  const info = await writeTmp(ctx.spindle, ctx.sessionId, ctx.userId, payload, origin);
  const { preview: peek } = generatePreview(payload, PREVIEW_CHARS);
  return JSON.stringify({
    spilled: true,
    tmp_handle: info.handle,
    origin,
    total_chars: info.totalChars,
    total_lines: info.totalLines,
    budget_chars: budgetChars,
    peek_chars: peek.length,
    peek,
    note: `Output exceeded the ${readBudgetTokens(ctx)}-token budget (${info.totalChars} chars). Stored at tmp handle '${info.handle}'. Use tmp_grep / tmp_read / tmp_stat to inspect specific parts without dumping it all into context.${peekHint ? " " + peekHint : ""}`,
  }, null, 2);
}
