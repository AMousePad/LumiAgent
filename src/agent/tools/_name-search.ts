import { z } from "zod";

const description = "Case-insensitive name substring.";
export const nameQuery = z.string().max(200).optional().describe(description);
export const nameQueryProperty = { type: "string", maxLength: 200, description };

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

export function matchesName(name: string | null | undefined, query?: string): boolean {
  return normalize(name ?? "").includes(normalize(query ?? ""));
}

export async function searchPage<T>(
  read: (limit: number, offset: number) => Promise<{ data: readonly T[]; total: number }>,
  name: (item: T) => string | null | undefined,
  options: { query?: string | undefined; limit?: number | undefined; offset?: number | undefined },
  signal: AbortSignal,
) {
  const limit = options.limit ?? 200;
  const offset = options.offset ?? 0;
  const query = normalize(options.query ?? "");
  const data: T[] = [];
  let total = 0;
  let cursor = query ? 0 : offset;
  for (;;) {
    signal.throwIfAborted();
    const page = await read(query ? 200 : Math.min(200, limit - data.length), cursor);
    if (!query) {
      data.push(...page.data.slice(0, limit - data.length));
      total = page.total;
    } else {
      for (const item of page.data) {
        if (!normalize(name(item) ?? "").includes(query)) continue;
        if (total >= offset && data.length < limit) data.push(item);
        total++;
      }
    }
    cursor += page.data.length;
    if (cursor >= page.total || (!query && data.length >= limit)) break;
    if (!page.data.length) throw new Error("Search ended before all results arrived. Retry the request.");
  }
  signal.throwIfAborted();
  const hasMore = offset + data.length < total;
  return { data, total, offset, has_more: hasMore, next_offset: hasMore ? offset + data.length : null };
}
