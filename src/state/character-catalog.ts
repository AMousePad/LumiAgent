import type { CharacterDTO, SpindleAPI } from "lumiverse-spindle-types";

const CHARACTER_PAGE_SIZE = 200;

export async function* characterPages(spindle: SpindleAPI, userId: string): AsyncGenerator<CharacterDTO[]> {
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await spindle.characters.list({ limit: CHARACTER_PAGE_SIZE, offset, userId });
    const fresh = page.data.filter(character => {
      if (seen.has(character.id)) return false;
      seen.add(character.id);
      return true;
    });
    if (fresh.length) yield fresh;
    offset += page.data.length;
    if (offset >= page.total) break;
    if (!page.data.length) throw new Error("Character listing ended before all results arrived. Retry the request.");
  }
}

export async function listAllCharacters(spindle: SpindleAPI, userId: string): Promise<CharacterDTO[]> {
  const out: CharacterDTO[] = [];
  for await (const page of characterPages(spindle, userId)) out.push(...page);
  return out;
}

export async function mapInBatches<T, R>(items: readonly T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += 8) {
    out.push(...await Promise.all(items.slice(start, start + 8).map(map)));
  }
  return out;
}
