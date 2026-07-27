import type { CharacterDTO, SpindleAPI } from "lumiverse-spindle-types";

const CHARACTER_PAGE_SIZE = 500;

export async function listAllCharacters(
  spindle: SpindleAPI,
  userId: string,
): Promise<CharacterDTO[]> {
  const out: CharacterDTO[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await spindle.characters.list({
      limit: CHARACTER_PAGE_SIZE,
      offset,
      userId,
    });
    total = Math.max(0, page.total);
    for (const character of page.data) {
      if (seen.has(character.id)) continue;
      seen.add(character.id);
      out.push(character);
    }
    if (page.data.length === 0) break;
    offset += page.data.length;
  }

  return out;
}
